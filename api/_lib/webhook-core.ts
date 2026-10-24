import { createClient } from '@supabase/supabase-js';

export type RadarSource = 'telegram' | 'slack';

export interface RadarLocation {
  latitude: number;
  longitude: number;
}

interface Coordinates {
  lat: number;
  lng: number;
}

const FILTER_KEYWORDS = [
  'kaza',
  'yangın',
  'trafik',
  'kapalı',
  'yol',
  'sivil',
  'yeleksiz',
  'uygulama',
  'dikkat',
  'çatal',
  'durak',
  'geçiş',
  'kilit',
  'yeşil',
];

const RADAR_PIN_MARKER = '[AYTAR-RADAR]';
const MIN_LAT = 40.7;
const MAX_LAT = 41.8;
const MIN_LNG = 27.8;
const MAX_LNG = 29.9;

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ownerId = process.env.RADAR_OWNER_ID ?? process.env.TELEGRAM_OWNER_ID;

const supabaseAdmin =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Requests are serialized per warm serverless instance to respect Nominatim's
// usage policy. Vercel instances do not share memory, so this is not global.
let nominatimQueue: Promise<void> = Promise.resolve();
let lastNominatimRequestAt = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTurkishText(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase('tr-TR');
}

function containsFilterKeyword(value: string): boolean {
  const normalized = normalizeTurkishText(value);
  return FILTER_KEYWORDS.some((keyword) =>
    normalized.includes(normalizeTurkishText(keyword)),
  );
}

function getRadarCategory(messageText: string): 'GRİ' | 'MAVİ' | 'YEŞİL' | 'KIRMIZI' {
  const normalized = normalizeTurkishText(messageText);
  if (/(^|[^\p{L}])sivil(?:ler)?(?=$|[^\p{L}])/u.test(normalized)) {
    return 'GRİ';
  }
  if (/(^|[^\p{L}])yeleksiz(?=$|[^\p{L}])/u.test(normalized)) {
    return 'MAVİ';
  }
  if (/(^|[^\p{L}])yeşil(?:ler)?(?=$|[^\p{L}])/u.test(normalized)) {
    return 'YEŞİL';
  }
  return 'KIRMIZI';
}

function isIstanbulCoordinate(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= MIN_LAT &&
    lat <= MAX_LAT &&
    lng >= MIN_LNG &&
    lng <= MAX_LNG
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const GEOCODING_STOPWORDS = [
  'bağlantı yolu',
  'son durak',
  'kucaktasın',
  'yönünde',
  'çatalda',
  'siviller',
  'yeleksiz',
  'uygulama',
  'yangın',
  'trafik',
  'geçiş',
  'dikkat',
  'çatal',
  'kaza',
  'kapalı',
  'yön',
  'önü',
  'girişi',
  'çıkışı',
  'üstü',
  'altı',
  'sivil',
  'kilit',
  'göbek',
  'nihayet',
  'durak',
  'yol',
  'var',
  've',
  'yok',
  'acil',
  'oldu',
  'olmuş',
  'oluyor',
  'bildirildi',
  'meydana',
  'geldi',
  'geliyor',
  'nedeniyle',
];

function cleanRadarText(value: string): string {
  return value
    // Strip a forwarded channel prefix such as "[24.10.2026 16:15] UserName: ".
    .replace(
      /^\s*\[[^\]\r\n]*(?:\d{1,2}:\d{2}|\d{1,2}[./-]\d{1,2})[^\]\r\n]*\]\s*[^:\r\n]{1,64}:\s*/u,
      '',
    )
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/@[\p{L}\p{N}_]{2,}/gu, ' ')
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0E\uFE0F\u200D]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildGeocodeQuery(messageText: string): string {
  let query = cleanRadarText(messageText)
    .slice(0, 1000)
    .toLocaleLowerCase('tr-TR');

  const phrases = [...new Set(GEOCODING_STOPWORDS.filter((word) => /\s/u.test(word)))]
    .sort((left, right) => right.length - left.length);
  for (const phrase of phrases) {
    const escapedPhrase = phrase.replace(/\s+/gu, '\\s+');
    const phrasePattern = new RegExp(
      '(^|[^\\p{L}\\p{N}_])(?:' + escapedPhrase + ')(?=$|[^\\p{L}\\p{N}_])',
      'giu',
    );
    query = query.replace(phrasePattern, '$1');
  }

  query = query
    .replace(/['’](?:da|de|ta|te|dan|den|tan|ten)(?=$|[^\p{L}\p{N}_])/giu, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ');

  const blockedWords = new Set(
    [...GEOCODING_STOPWORDS.filter((word) => !/\s/u.test(word)), ...FILTER_KEYWORDS]
      .map((word) => normalizeTurkishText(word)),
  );

  return query
    .split(/\s+/u)
    .filter((word) => word.length > 0 && !blockedWords.has(normalizeTurkishText(word)))
    .join(' ')
    .trim()
    .slice(0, 300);
}

function buildFallbackQuery(cleanedText: string, wordLimit: 3 | 1): string {
  return buildGeocodeQuery(cleanedText)
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, wordLimit)
    .join(' ');
}

async function geocodeQueryWithNominatim(query: string): Promise<Coordinates | null> {
  const request = nominatimQueue.then(async (): Promise<Coordinates | null> => {
    const elapsed = Date.now() - lastNominatimRequestAt;
    if (lastNominatimRequestAt > 0 && elapsed < 1000) {
      await delay(1000 - elapsed);
    }
    lastNominatimRequestAt = Date.now();

    try {
      const url = new URL('https://nominatim.openstreetmap.org/search');
      url.search = new URLSearchParams({
        format: 'jsonv2',
        q: query,
        limit: '5',
        addressdetails: '0',
        countrycodes: 'tr',
        viewbox: '27.8,41.8,29.9,40.7',
        bounded: '1',
      }).toString();

      const response = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'tr',
          'User-Agent': 'AYTAR-Radar-Webhook/1.0 (+https://aytar.vercel.app)',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        console.error('Nominatim request failed with HTTP status:', response.status);
        return null;
      }

      const nominatimData: unknown = await response.json();
      if (!Array.isArray(nominatimData) || nominatimData.length === 0) return null;

      for (const entry of nominatimData) {
        if (!isRecord(entry)) continue;
        const latText = entry.lat;
        const lonText = entry.lon;
        if (
          typeof latText !== 'string' ||
          typeof lonText !== 'string' ||
          latText.trim() === '' ||
          lonText.trim() === ''
        ) {
          continue;
        }

        const lat = Number(latText);
        const lng = Number(lonText);
        if (isIstanbulCoordinate(lat, lng)) return { lat, lng };
      }

      return null;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('Nominatim request failed:', message);
      return null;
    }
  });

  nominatimQueue = request.then(
    () => undefined,
    () => undefined,
  );

  return request;
}

async function geocodeWithNominatim(messageText: string): Promise<Coordinates | null> {
  const cleanedText = buildGeocodeQuery(messageText);
  if (!cleanedText) {
    console.error('Konum bulunamadı, atlanıyor: geocoding sorgusu boş');
    return null;
  }

  const attempts = [
    cleanedText,
    buildFallbackQuery(cleanedText, 3),
    buildFallbackQuery(cleanedText, 1),
  ];
  const attemptedQueries = new Set<string>();

  for (const query of attempts) {
    if (!query || attemptedQueries.has(query)) continue;
    attemptedQueries.add(query);

    const coordinates = await geocodeQueryWithNominatim(query);
    if (coordinates) return coordinates;
  }

  console.error('Konum bulunamadı, atlanıyor:', cleanedText);
  return null;
}

/**
 * Process a filtered Telegram or Slack message using the same cleaning,
 * categorization, geocoding and Supabase insert pipeline.
 */
export async function processRadarMessage(
  source: RadarSource,
  rawMessageText: string,
  location?: RadarLocation,
): Promise<void> {
  const sourceLabel = source === 'telegram' ? 'Telegram' : 'Slack';
  if (!rawMessageText || !containsFilterKeyword(rawMessageText)) return;

  const messageText = cleanRadarText(rawMessageText);
  if (!messageText) {
    console.error(sourceLabel + ' mesajı temizlik sonrası boş kaldı; pin oluşturulmadı');
    return;
  }
  const category = getRadarCategory(messageText);

  if (!supabaseAdmin || !ownerId || !UUID_PATTERN.test(ownerId)) {
    console.error(
      'Radar webhook yapılandırılmamış: SUPABASE_URL (veya VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY ve mevcut auth.users UUID değerine sahip RADAR_OWNER_ID (veya TELEGRAM_OWNER_ID) gerekli.',
    );
    return;
  }

  let coordinates: Coordinates | null = null;
  if (location) {
    const lat = Number(location.latitude);
    const lng = Number(location.longitude);
    if (!isIstanbulCoordinate(lat, lng)) {
      console.error(sourceLabel + ' konumu yapılandırılmış İstanbul sınırlarının dışında; atlandı.');
      return;
    }
    coordinates = { lat, lng };
  } else {
    coordinates = await geocodeWithNominatim(messageText);
  }

  if (!coordinates) return;

  const { data, error } = await supabaseAdmin
    .from('pins')
    .insert({
      owner_id: ownerId,
      lat: coordinates.lat,
      lng: coordinates.lng,
      description: RADAR_PIN_MARKER + ' ' + messageText,
      category,
    })
    .select('id');

  if (error) {
    console.error('Supabase Insert Hatası (' + sourceLabel + '):', {
      code: error.code,
      message: error.message,
    });
  } else if (!data || data.length === 0) {
    console.error('Supabase hata dönmedi ancak insert cevabı boş geldi (' + sourceLabel + ')');
  }
}
