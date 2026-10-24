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
  display_name?: string;
}

const FILTER_KEYWORDS = [
  'siviller',
  'yeleksizler',
  'trafik',
  'sivil',
  'yeleksiz',
  'gezici',
  'kaza',
  'yangın',
  'yangin',
];

const GRAY_CATEGORY_KEYWORDS = ['sivil', 'yeleksiz', 'gezici'];

const MIN_LAT = 40.7;
const MAX_LAT = 41.8;
const MIN_LNG = 27.8;
const MAX_LNG = 29.9;

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// This queue spaces requests within the same warm serverless instance.
// Vercel instances do not share module memory; a globally shared rate limiter
// would require a shared queue/lock service.
let nominatimQueue: Promise<void> = Promise.resolve();
let lastNominatimRequestAt = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractMessage(body: unknown): TelegramMessage | null {
  if (!isRecord(body)) return null;

  const candidate =
    body.message ??
    body.edited_message ??
    body.channel_post ??
    body.edited_channel_post ??
    body;

  if (!isRecord(candidate)) return null;

  const message = candidate as unknown as TelegramMessage;
  if (
    typeof message.text !== 'string' &&
    typeof message.caption !== 'string' &&
    !message.location
  ) {
    return null;
  }

  return message;
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

async function geocodeWithNominatim(
  messageText: string,
): Promise<Coordinates | null> {
  const query = messageText
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

  if (!query) return null;

  const request = nominatimQueue.then(async () => {
    const elapsed = Date.now() - lastNominatimRequestAt;
    if (elapsed < 1000) {
      await delay(1000 - elapsed);
    }
    lastNominatimRequestAt = Date.now();

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

    const results = (await response.json()) as NominatimResult[];
    const first = Array.isArray(results) ? results[0] : undefined;
    if (!first) return null;

    const lat = Number(first.lat);
    const lng = Number(first.lon);
    return isIstanbulCoordinate(lat, lng) ? { lat, lng } : null;
  });

  nominatimQueue = request.then(
    () => undefined,
    () => undefined,
  );

  return request;
}

function chooseCategory(messageText: string): 'GRİ' | 'KIRMIZI' {
  const normalized = normalizeTurkishText(messageText);
  return GRAY_CATEGORY_KEYWORDS.some((keyword) => normalized.includes(keyword))
    ? 'GRİ'
    : 'KIRMIZI';
}

async function processTelegramUpdate(body: unknown, requestToken: string | undefined): Promise<void> {
  const expectedToken = process.env.TELEGRAM_SECRET_TOKEN;

  // Fail closed when the webhook secret is not configured or does not match.
  if (!expectedToken || !requestToken || requestToken !== expectedToken) {
    return;
  }

  const message = extractMessage(body);
  if (!message) return;

  const messageText =
    typeof message.text === 'string'
      ? message.text.trim()
      : typeof message.caption === 'string'
        ? message.caption.trim()
        : '';

  if (!messageText || !containsFilterKeyword(messageText)) return;

  // owner_id references auth.users(id). An arbitrary example UUID would fail
  // the foreign-key constraint even when the service role bypasses RLS.
  if (
    !supabaseAdmin ||
    !ownerId ||
    !UUID_PATTERN.test(ownerId)
  ) {
    console.error(
      'Telegram webhook is not configured: set SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY and a valid TELEGRAM_OWNER_ID.',
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

  const category = chooseCategory(messageText);
  const { error } = await supabaseAdmin.from('pins').insert({
    owner_id: ownerId,
    lat: coordinates.lat,
    lng: coordinates.lng,
    description: messageText.slice(0, 5000),
    category,
  });

  if (error) {
    console.error('Telegram pin insert failed:', error.message);
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  try {
    if (req.method === 'POST') {
      const header = req.headers['x-telegram-bot-api-secret-token'];
      const requestToken = Array.isArray(header) ? header[0] : header;
      await processTelegramUpdate(req.body as TelegramUpdateBody, requestToken);
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Telegram webhook processing failed:', message);
  }

  // Telegram receives HTTP 200 even when the message is ignored or processing fails.
  return res.status(200).send('OK');
}
