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

interface NominatimResult {
  lat: string;
  lon: string;
}

const FILTER_KEYWORDS = ['kaza', 'yangın', 'trafik', 'kapalı', 'yol'];

const MIN_LAT = 40.7;
const MAX_LAT = 41.8;
const MIN_LNG = 27.8;
const MAX_LNG = 29.9;

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
const ownerId = process.env.TELEGRAM_OWNER_ID;

// Diagnostic presence checks only: never print the service-role key or its value.
console.log('Supabase URL mevcut mu?:', Boolean(process.env.SUPABASE_URL));
console.log(
  'VITE_SUPABASE_URL mevcut mu?:',
  Boolean(process.env.VITE_SUPABASE_URL),
);
console.log(
  'Service Role Key mevcut mu?:',
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
);

const supabaseAdmin =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
    : null;

console.log('Supabase admin istemcisi başlatıldı mı?:', Boolean(supabaseAdmin));

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
  'kaza',
  'yangın',
  'trafik',
  'kapalı',
  'yol',
  'var',
  'yok',
  'siviller',
  'sivil',
  'dikkat',
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

function buildGeocodeQuery(messageText: string): string {
  const withoutUrls = messageText
    .replace(/https?:\/\/\S+/gi, ' ')
    .slice(0, 1000);

  // Match whole Turkish words (including letters such as ı, ş, ğ) so
  // "Kadıköy kaza siviller" becomes "Kadıköy", not the original sentence.
  const stopwordPattern = new RegExp(
    `(^|[^\\p{L}\\p{N}_])(?:${GEOCODING_STOPWORDS.join('|')})(?=$|[^\\p{L}\\p{N}_])`,
    'giu',
  );

  const locationQuery = withoutUrls
    .replace(stopwordPattern, '$1')
    .replace(/['’](?:da|de|ta|te|dan|den|tan|ten)(?=$|[^\p{L}\p{N}_])/giu, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

  return locationQuery;
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
        limit: '1',
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
      console.log('Nominatim Cevabı:', JSON.stringify(nominatimData));

      if (!Array.isArray(nominatimData) || nominatimData.length === 0) {
        console.warn('Konum bulunamadı, işlem iptal');
        return null;
      }

      const first = nominatimData[0] as Partial<NominatimResult> | null;
      if (
        !first ||
        typeof first.lat !== 'string' ||
        typeof first.lon !== 'string' ||
        first.lat.trim() === '' ||
        first.lon.trim() === ''
      ) {
        console.warn('Nominatim cevabında lat/lon alanları yok, işlem iptal');
        return null;
      }

      const lat = Number(first.lat);
      const lng = Number(first.lon);
      if (!isIstanbulCoordinate(lat, lng)) {
        console.warn('Nominatim koordinatları geçersiz veya İstanbul sınırları dışında');
        return null;
      }

      console.log('Nominatim koordinatları doğrulandı:', { lat, lng });
      return { lat, lng };
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
  const query = buildGeocodeQuery(messageText);
  if (!query) {
    console.warn('Temizlenmiş konum sorgusu boş, Nominatim isteği atlanıyor');
    return null;
  }

  console.log('Nominatim temiz sorgusu:', query);
  return geocodeQueryWithNominatim(query);
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

  const messageText =
    typeof message.text === 'string'
      ? message.text.trim()
      : typeof message.caption === 'string'
        ? message.caption.trim()
        : '';

  if (!messageText || !containsFilterKeyword(messageText)) return;

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
      console.warn('Telegram location ignored because it is outside the configured Istanbul bounds.');
      return;
    }
    coordinates = { lat, lng };
  } else {
    coordinates = await geocodeWithNominatim(messageText);
  }

  if (!coordinates) return;

  console.log('Supabase kaydı başlatılıyor:', {
    lat: coordinates.lat,
    lng: coordinates.lng,
    category: 'KIRMIZI',
  });

  const { data, error } = await supabaseAdmin
    .from('pins')
    .insert({
      owner_id: ownerId,
      lat: coordinates.lat,
      lng: coordinates.lng,
      description: messageText.slice(0, 5000),
      category: 'KIRMIZI',
    })
    .select('id, owner_id, lat, lng, category, created_at');

  if (error) {
    console.error('Supabase Insert Hatası:', error);
  } else {
    console.log('Supabase kaydı başarılı:', data);
    if (!data || data.length === 0) {
      console.warn('Supabase hata dönmedi ancak insert cevabı boş geldi');
    }
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
        // Temporary diagnostic log, intentionally placed after authentication.
        console.log('Gelen Veri:', JSON.stringify(req.body));
        await processTelegramUpdate(req.body as TelegramUpdateBody);
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Telegram webhook processing failed:', message);
  }

  return res.status(200).send('OK');
}
