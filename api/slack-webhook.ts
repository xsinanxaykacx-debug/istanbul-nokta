import { createHmac, timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Slack signs the exact HTTP request body. Keep Vercel from parsing JSON first.
export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_REQUEST_AGE_SECONDS = 60 * 5;

function headerValue(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first.trim() : undefined;
}

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  // This also supports local adapters/tests which expose the unmodified payload
  // as a Buffer or string instead of leaving it on the IncomingMessage stream.
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');

  // If middleware already consumed and parsed the stream, the original bytes
  // cannot be reconstructed safely for Slack signature verification.
  if (req.readableEnded) {
    throw new Error(
      req.body !== undefined
        ? 'Request body was parsed before signature verification; ensure bodyParser is disabled.'
        : 'Request stream ended before its raw body could be read.',
    );
  }

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onAborted);
    };

    const finish = (error?: Error, body?: Buffer) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(body ?? Buffer.alloc(0));
    };

    const onData = (chunk: Buffer | string | Uint8Array) => {
      if (typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk, 'utf8'));
      } else if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
      } else {
        chunks.push(Buffer.from(chunk));
      }
    };
    const onEnd = () => finish(undefined, Buffer.concat(chunks));
    const onError = (error: Error) => finish(error);
    const onAborted = () => finish(new Error('Request body stream was aborted.'));

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);

    // Avoid missing the end event if the adapter ended the stream while the
    // listeners were being attached.
    if (req.readableEnded) onEnd();
  });
}

function isValidSlackSignature(
  rawBody: Buffer,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret || !timestampHeader || !signatureHeader) return false;
  if (!/^\d{1,12}$/.test(timestampHeader)) return false;

  const normalizedSignature = signatureHeader.toLowerCase();
  if (!/^v0=[0-9a-f]{64}$/.test(normalizedSignature)) return false;

  const requestTimestamp = Number(timestampHeader);
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(requestTimestamp) ||
    Math.abs(now - requestTimestamp) > MAX_REQUEST_AGE_SECONDS
  ) {
    return false;
  }

  // Hash the raw bytes directly; do not JSON-parse or decode/re-encode them.
  const expectedSignature =
    'v0=' +
    createHmac('sha256', signingSecret)
      .update('v0:' + timestampHeader + ':', 'utf8')
      .update(rawBody)
      .digest('hex');

  const expectedBytes = Buffer.from(expectedSignature, 'utf8');
  const providedBytes = Buffer.from(normalizedSignature, 'utf8');
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
}

function normalizeSlackText(value: string): string {
  return value
    // Preserve a Slack link's visible label while discarding its URL.
    .replace(/<https?:\/\/[^>|]+\|([^>]+)>/gi, '$1')
    .replace(/<https?:\/\/[^>]+>/gi, ' ')
    // Remove Slack user, user-group, and broadcast tokens.
    .replace(/<@[A-Z0-9]+(?:\|[^>]*)?>/gi, ' ')
    .replace(/<!(?:here|channel|everyone|subteam\^[A-Z0-9]+)(?:\|[^>]*)?>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  let rawBody: Buffer;
  try {
    rawBody = await readRawBody(req);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Slack webhook raw body could not be read:', message);
    return res.status(400).send('Invalid request body');
  }

  const timestamp = headerValue(req.headers['x-slack-request-timestamp']);
  const signature = headerValue(req.headers['x-slack-signature']);

  if (!isValidSlackSignature(rawBody, timestamp, signature)) {
    console.error('Slack webhook signature validation failed.');
    return res.status(401).send('Invalid Slack signature');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString('utf8')) as unknown;
  } catch {
    return res.status(400).send('Invalid JSON');
  }

  if (!isRecord(payload) || typeof payload.type !== 'string') {
    return res.status(400).send('Invalid Slack event payload');
  }

  // Respond to signed URL verification immediately. No Supabase client,
  // geocoding, or shared processing module is loaded on this path.
  if (payload.type === 'url_verification') {
    if (typeof payload.challenge !== 'string') {
      return res.status(400).send('Missing Slack challenge');
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(payload.challenge);
  }

  // Slack requires a fast acknowledgement; don't wait for geocoding to start.
  res.status(200).send('OK');

  if (payload.type !== 'event_callback' || !isRecord(payload.event)) return;

  const event = payload.event;
  if (
    event.type !== 'message' ||
    typeof event.text !== 'string' ||
    typeof event.bot_id === 'string' ||
    typeof event.subtype === 'string'
  ) {
    return;
  }

  const messageText = normalizeSlackText(event.text);
  if (!messageText) return;

  try {
    // Lazy-load the Supabase/geocoding core only for actual channel messages.
    const { processRadarMessage } = await import('./_lib/webhook-core');
    await processRadarMessage('slack', messageText);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Slack webhook processing failed:', message);
  }
}
