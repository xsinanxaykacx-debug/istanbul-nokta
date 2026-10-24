import { createHash, timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

interface TelegramLocation {
  latitude: number;
  longitude: number;
}

interface TelegramChat {
  id: number;
}

interface TelegramMessage {
  text?: string;
  caption?: string;
  chat?: TelegramChat;
  chat_id?: number | string;
  location?: TelegramLocation;
}

interface TelegramUpdateBody {
  update_id?: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  channel_post?: TelegramMessage;
  edited_channel_post?: TelegramMessage;
  text?: string;
  caption?: string;
  chat?: TelegramChat;
  chat_id?: number | string;
  location?: TelegramLocation;
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

const TELEGRAM_PIN_MARKER = '[AYTAR-RADAR]';

const MIN_LAT = 40.7;
const MAX_LAT = 41.8;
const MIN_LNG = 27.8;
const MAX_LNG = 29.9;

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const ownerId = process.env.TELEGRAM_OWNER_ID;

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

// Nominatim calls are serialized and spaced within each warm serverless instance.
// Vercel instances do not share memory; a globally shared limit requires shared storage.
let nominatimQueue: Promise<void> = Promise.resolve();
let lastNominatimRequestAt = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTelegramMessage(value: unknown): value is TelegramMessage {
  if (!isRecord(value)) return false;
  return (
    typeof value.text === 'string' ||
    typeof value.caption === 'string' ||
    isRecord(value.location)
  );
}

function extractMessage(body: unknown): TelegramMessage | null {
  if (!isRecord(body)) return null;

  // Telegram sends different update fields for groups and channels.
  // Inspect each one in order instead of stopping at the first non-null field.
  const candidates: unknown[] = [
    body.message,
    body.channel_post,
    body.edited_message,
    body.edited_channel_post,
  ];

  for (const candidate of candidates) {
    if (isTelegramMessage(candidate)) return candidate;
  }

  // Keep support for test/custom clients that post the message object directly.
  return isTelegramMessage(body) ? body : null;
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

function getTelegramCategory(messageText: string): 'GRİ' | 'MAVİ' | 'YEŞİL' | 'KIRMIZI' {
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

function cleanTelegramText(value: string): string {
  return value
    // Strip a channel-forwarding prefix such as "[24.10.2026 16:15] UserName: "
    .replace(
      /^\s*\[[^\]\r\n]*(?:\d{1,2}:\d{2}|\d{1,2}[./-]\d{1,2})[^\]\r\n]*\]\s*[^:\r\n]{1,64}:\s*/u,
      '',
    )
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/@[\p{L}\p{N}_]{2,}/gu, ' ')
    // Remove pictographic emoji, flags, variation selectors and joiners.
    .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0E\uFE0F\u200D]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildGeocodeQuery(messageText: string): string {
  let query = cleanTelegramText(messageText)
    .slice(0, 1000)
    .toLocaleLowerCase('tr-TR');

  // Remove multi-word phrases first, then remove every blocked token.
  // Each phrase is processed separately so adjacent noise words cannot slip through.
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
  // Fallbacks always come from the already-sanitized query, never raw channel text.
  return buildGeocodeQuery(cleanedText)
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, wordLimit)
    .join(' ');
}

async function geocodeQueryWithNominatim(
  query: string,
): Promise<Coordinates | null> {
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
          'User-Agent': 'AYTAR-Telegram-Webhook/1.0 (+https://aytar.vercel.app)',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        console.error('Nominatim request failed with HTTP status:', response.status);
        return null;
      }

      const nominatimData: unknown = await response.json();

      if (!Array.isArray(nominatimData) || nominatimData.length === 0) {
        return null;
      }

      // Use the first valid result inside the Istanbul bounds.
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
        if (isIstanbulCoordinate(lat, lng)) {
          return { lat, lng };
        }
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

async function geocodeWithNominatim(
  messageText: string,
): Promise<Coordinates | null> {
  const cleanedText = buildGeocodeQuery(messageText);
  if (!cleanedText) {
    console.error('Konum bulunamadı, atlanıyor:', cleanedText);
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

function isValidWebhookSecret(providedSecret: string | undefined): boolean {
  if (!telegramBotToken || !providedSecret) return false;

  // Telegram's secret_token allows only A-Z, a-z, 0-9, "_" and "-".
  // Deriving a hex secret avoids exposing the bot token in the webhook header.
  const expectedSecret = createHash('sha256')
    .update(telegramBotToken, 'utf8')
    .digest('hex');
  const expectedBytes = new Uint8Array(Buffer.from(expectedSecret, 'utf8'));
  const providedBytes = new Uint8Array(Buffer.from(providedSecret, 'utf8'));

  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

async function processTelegramUpdate(body: unknown): Promise<void> {
  const message = extractMessage(body);
  if (!message) return;

  const rawMessageText =
    typeof message.text === 'string'
      ? message.text.trim()
      : typeof message.caption === 'string'
        ? message.caption.trim()
        : '';

  // Filter on the original message, then normalize Telegram metadata/noise.
  if (!rawMessageText || !containsFilterKeyword(rawMessageText)) return;

  const messageText = cleanTelegramText(rawMessageText);
  if (!messageText) {
    console.error('Telegram mesajı temizlik sonrası boş kaldı; pin oluşturulmadı');
    return;
  }
  const telegramCategory = getTelegramCategory(messageText);

  // pins.owner_id references auth.users(id). Service role bypasses RLS,
  // but cannot bypass this foreign-key constraint; use an existing system account.
  if (
    !supabaseAdmin ||
    !ownerId ||
    !UUID_PATTERN.test(ownerId)
  ) {
    console.error(
      'Telegram webhook is not configured: set SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY and TELEGRAM_OWNER_ID (an existing auth.users UUID).',
    );
    return;
  }

  let coordinates: Coordinates | null = null;

  if (message.location) {
    const lat = Number(message.location.latitude);
    const lng = Number(message.location.longitude);
    if (!isIstanbulCoordinate(lat, lng)) {
      console.error('Telegram location ignored because it is outside the configured Istanbul bounds.');
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
      description: `${TELEGRAM_PIN_MARKER} ${messageText}`.slice(0, 5000),
      category: telegramCategory,
    })
    .select('id');

  if (error) {
    console.error('Supabase Insert Hatası:', { code: error.code, message: error.message });
  } else if (!data || data.length === 0) {
    console.error('Supabase hata dönmedi ancak insert cevabı boş geldi');
  } else {
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  try {
    if (req.method === 'POST') {
      const header = req.headers['x-telegram-bot-api-secret-token'];
      const providedSecret = Array.isArray(header) ? header[0] : header;

      // Always acknowledge Telegram, but never process an unauthenticated update.
      if (!isValidWebhookSecret(providedSecret)) {
        console.error('Güvenlik hatası: Token uyuşmuyor');
      } else {
        await processTelegramUpdate(req.body as TelegramUpdateBody);
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Telegram webhook processing failed:', message);
  }

  return res.status(200).send('OK');
}
