import { createHash, timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { processRadarMessage } from './_lib/webhook-core';

interface TelegramLocation {
  latitude: number;
  longitude: number;
}

interface TelegramMessage {
  text?: string;
  caption?: string;
  chat?: { id: number };
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
  chat?: { id: number };
  chat_id?: number | string;
  location?: TelegramLocation;
}

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
  // Inspect each one instead of stopping at the first non-null field.
  const candidates: unknown[] = [
    body.message,
    body.channel_post,
    body.edited_message,
    body.edited_channel_post,
  ];

  for (const candidate of candidates) {
    if (isTelegramMessage(candidate)) return candidate;
  }

  // Keep support for test/custom clients that post a message object directly.
  return isTelegramMessage(body) ? body : null;
}

function isValidWebhookSecret(providedSecret: string | undefined): boolean {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!telegramBotToken || !providedSecret) return false;

  // Preserve the existing webhook secret scheme so the Telegram integration
  // continues to work without changing its Vercel environment configuration.
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

  await processRadarMessage('telegram', rawMessageText, message.location);
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
