import { createHash, timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { processRadarMessage } from './_lib/webhook-core.js';
import type { RadarCategory } from './_lib/webhook-core.js';

interface TelegramLocation { latitude: number; longitude: number; }
interface TelegramChat { id: number; }
interface TelegramMessage {
  text?: string; caption?: string; chat?: TelegramChat;
  chat_id?: number | string; message_id?: number; location?: TelegramLocation;
}
interface TelegramUpdateBody {
  update_id?: number; message?: TelegramMessage; edited_message?: TelegramMessage;
  channel_post?: TelegramMessage; edited_channel_post?: TelegramMessage;
  text?: string; caption?: string; chat?: TelegramChat;
  chat_id?: number | string; message_id?: number; location?: TelegramLocation;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTelegramMessage(value: unknown): value is TelegramMessage {
  if (!isRecord(value)) return false;
  return typeof value.text === 'string' || typeof value.caption === 'string' || isRecord(value.location);
}

function extractMessage(body: unknown): TelegramMessage | null {
  if (!isRecord(body)) return null;
  const candidates: unknown[] = [body.message, body.channel_post, body.edited_message, body.edited_channel_post];
  for (const candidate of candidates) {
    if (isTelegramMessage(candidate)) return candidate;
  }
  return isTelegramMessage(body) ? body : null;
}

function isValidWebhookSecret(providedSecret: string | undefined): boolean {
  const rawTelegramBotToken = process.env.TELEGRAM_BOT_TOKEN || '';
  const telegramBotToken = rawTelegramBotToken.trim();
  const normalizedProvidedSecret = providedSecret?.trim();

  if (!telegramBotToken || !normalizedProvidedSecret) return false;

  const expectedSecret = createHash('sha256').update(telegramBotToken, 'utf8').digest('hex');
  const expectedBytes = new Uint8Array(Buffer.from(expectedSecret, 'utf8'));
  const providedBytes = new Uint8Array(Buffer.from(normalizedProvidedSecret, 'utf8'));

  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}

// YENİ: Hata mesajlarını Telegram'a iletmek için fonksiyon
async function sendTelegramMessage(message: TelegramMessage, text: string): Promise<void> {
  const telegramBotToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  const chatId = message.chat?.id ?? message.chat_id;

  if (!telegramBotToken || chatId === undefined || chatId === null) return;

  try {
    await fetch('https://api.telegram.org/bot' + telegramBotToken + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (error) {
    console.error('Telegram mesajı gönderilemedi:', error);
  }
}

async function processTelegramUpdate(body: unknown): Promise<void> {
  const message = extractMessage(body);
  if (!message) return;

  const rawMessageText = typeof message.text === 'string' ? message.text.trim() : typeof message.caption === 'string' ? message.caption.trim() : '';

  const result = await processRadarMessage('telegram', rawMessageText, message.location);
  
  if (result.saved) {
    const confirmationText = '✅ İhbarınız AYTAR haritasına kaydedildi. (Kategori: ' + result.category + ')';
    await sendTelegramMessage(message, confirmationText);
  } else if (result.error) {
    // YENİ: Hata varsa Telegram'a hatayı yaz (Sessiz kalmayı önler)
    const errorText = '❌ İhbar kaydedilemedi. Sebep: ' + result.error;
    await sendTelegramMessage(message, errorText);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'POST') {
      const header = req.headers['x-telegram-bot-api-secret-token'];
      const providedSecret = Array.isArray(header) ? header[0] : header;

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