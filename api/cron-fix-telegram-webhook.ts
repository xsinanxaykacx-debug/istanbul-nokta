import { createHash, timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const WEBHOOK_URL = 'https://aytar.vercel.app/api/telegram-webhook';
const ALLOWED_UPDATES = ['message', 'edited_message', 'channel_post', 'edited_channel_post'];

interface TelegramWebhookInfo {
  url?: string;
}

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

function hasValidCronSecret(req: VercelRequest): boolean {
  const configuredSecret = process.env.CRON_SECRET;
  const authorizationHeader = req.headers.authorization;
  const authorization = Array.isArray(authorizationHeader)
    ? authorizationHeader[0]
    : authorizationHeader;

  if (!configuredSecret || !authorization) return false;

  const expected = new Uint8Array(Buffer.from(`Bearer ${configuredSecret}`, 'utf8'));
  const received = new Uint8Array(Buffer.from(authorization, 'utf8'));

  return expected.length === received.length && timingSafeEqual(expected, received);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  if (!hasValidCronSecret(req)) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  const telegramBotToken = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
  if (!telegramBotToken) {
    console.error('[telegram-cron] TELEGRAM_BOT_TOKEN is not configured');
    return res.status(500).json({ ok: false, error: 'Telegram bot token is not configured' });
  }

  try {
    const infoResponse = await fetch(
      `https://api.telegram.org/bot${telegramBotToken}/getWebhookInfo`,
      { method: 'GET' },
    );

    if (!infoResponse.ok) {
      console.error('[telegram-cron] getWebhookInfo HTTP failure:', infoResponse.status);
      return res.status(502).json({ ok: false, error: 'Telegram getWebhookInfo request failed' });
    }

    const infoPayload = await infoResponse.json() as TelegramApiResponse<TelegramWebhookInfo>;
    if (!infoPayload.ok || !infoPayload.result) {
      console.error('[telegram-cron] getWebhookInfo API failure:', infoPayload.description || 'Unknown error');
      return res.status(502).json({ ok: false, error: 'Telegram getWebhookInfo API request failed' });
    }

    const currentUrl = infoPayload.result.url || '';
    if (currentUrl === WEBHOOK_URL) {
      return res.status(200).json({ ok: true, repaired: false, message: 'Webhook is already correct' });
    }

    const webhookSecret = createHash('sha256')
      .update(telegramBotToken, 'utf8')
      .digest('hex');

    const setWebhookResponse = await fetch(
      `https://api.telegram.org/bot${telegramBotToken}/setWebhook`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: WEBHOOK_URL,
          secret_token: webhookSecret,
          allowed_updates: ALLOWED_UPDATES,
          drop_pending_updates: false,
        }),
      },
    );

    if (!setWebhookResponse.ok) {
      console.error('[telegram-cron] setWebhook HTTP failure:', setWebhookResponse.status);
      return res.status(502).json({ ok: false, error: 'Telegram setWebhook request failed' });
    }

    const setWebhookPayload = await setWebhookResponse.json() as TelegramApiResponse<boolean>;
    if (!setWebhookPayload.ok || setWebhookPayload.result !== true) {
      console.error('[telegram-cron] setWebhook API failure:', setWebhookPayload.description || 'Unknown error');
      return res.status(502).json({ ok: false, error: 'Telegram setWebhook API request failed' });
    }

    console.log('[telegram-cron] Webhook repaired successfully');
    return res.status(200).json({ ok: true, repaired: true, message: 'Webhook repaired successfully' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[telegram-cron] Webhook repair failed:', message);
    return res.status(500).json({ ok: false, error: 'Webhook repair failed' });
  }
}
