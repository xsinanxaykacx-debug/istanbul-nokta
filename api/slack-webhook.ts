import { createHmac, timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// Slack signs the exact HTTP request body. Do not allow Vercel to parse it first.
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

async function readRawBody(req: VercelRequest): Promise<string> {
  // Local adapters can expose the unmodified body directly.
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (typeof req.body === 'string') return req.body;

  // A parsed object is not suitable for verification: JSON serialization would
  // change whitespace/bytes and therefore change Slack's signature.
  if (req.body !== undefined) {
    throw new Error(
      'req.body is already parsed; verify that Vercel bodyParser is disabled and no middleware reads the body first.',
    );
  }

  if (req.readableEnded) {
    throw new Error('Request stream ended before the raw body could be read.');
  }

  // Use IncomingMessage data/end events for compatibility with vercel dev.
  // Keep the original chunks and only decode once after Buffer.concat().
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let settled = false;

    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onAborted);
    };

    const finish = (error?: Error, value?: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value ?? '');
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

    const onEnd = () => finish(undefined, Buffer.concat(chunks).toString('utf8'));
    const onError = (error: Error) => finish(error);
    const onAborted = () => finish(new Error('Request body stream was aborted.'));

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('aborted', onAborted);

    // Handle adapters that finish the request as listeners are being attached.
    if (req.readableEnded) onEnd();
  });
}

interface SlackSignatureCheck {
  valid: boolean;
  reason: string;
  expectedSignature?: string;
  timestampAgeSeconds?: number;
  signingSecretConfigured: boolean;
}

function verifySlackSignature(
  rawBody: string,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
): SlackSignatureCheck {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const signingSecretConfigured = Boolean(signingSecret);

  if (!signingSecret) {
    return {
      valid: false,
      reason: 'SLACK_SIGNING_SECRET is missing or empty',
      signingSecretConfigured,
    };
  }
  if (!timestampHeader) {
    return {
      valid: false,
      reason: 'X-Slack-Request-Timestamp header is missing',
      signingSecretConfigured,
    };
  }
  if (!signatureHeader) {
    return {
      valid: false,
      reason: 'X-Slack-Signature header is missing',
      signingSecretConfigured,
    };
  }
  if (!/^\d{1,12}$/.test(timestampHeader)) {
    return {
      valid: false,
      reason: 'X-Slack-Request-Timestamp is not a valid Unix timestamp',
      signingSecretConfigured,
    };
  }

  const requestTimestamp = Number(timestampHeader);
  const now = Math.floor(Date.now() / 1000);
  const timestampAgeSeconds = now - requestTimestamp;

  // Slack signs v0:<timestamp>:<raw body>. Do not parse or stringify the body.
  const signatureBase = 'v0:' + timestampHeader + ':' + rawBody;
  const expectedSignature =
    'v0=' +
    createHmac('sha256', signingSecret)
      .update(signatureBase, 'utf8')
      .digest('hex');

  if (
    !Number.isSafeInteger(requestTimestamp) ||
    Math.abs(timestampAgeSeconds) > MAX_REQUEST_AGE_SECONDS
  ) {
    return {
      valid: false,
      reason: 'Slack request timestamp is outside the five-minute window',
      expectedSignature,
      timestampAgeSeconds,
      signingSecretConfigured,
    };
  }

  const normalizedSignature = signatureHeader.toLowerCase();
  if (!/^v0=[0-9a-f]{64}$/.test(normalizedSignature)) {
    return {
      valid: false,
      reason: 'X-Slack-Signature has an invalid format',
      expectedSignature,
      timestampAgeSeconds,
      signingSecretConfigured,
    };
  }

  const expectedBytes = Buffer.from(expectedSignature, 'utf8');
  const providedBytes = Buffer.from(normalizedSignature, 'utf8');
  const signaturesMatch =
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes);

  return {
    valid: signaturesMatch,
    reason: signaturesMatch ? 'signature matched' : 'signature mismatch',
    expectedSignature,
    timestampAgeSeconds,
    signingSecretConfigured,
  };
}

function logSignatureFailure(
  rawBody: string,
  timestamp: string | undefined,
  signature: string | undefined,
  check: SlackSignatureCheck,
): void {
  // Full signature values help reproduce local development failures but must
  // not be written to production logs.
  if (process.env.NODE_ENV === 'development') {
    console.error('Slack signature verification diagnostic (development only):', {
      reason: check.reason,
      receivedSignature: signature ?? '(missing)',
      calculatedSignature: check.expectedSignature ?? '(not calculated)',
      timestamp: timestamp ?? '(missing)',
      timestampAgeSeconds: check.timestampAgeSeconds ?? null,
      rawBodyUtf8Bytes: Buffer.byteLength(rawBody, 'utf8'),
      signingSecretConfigured: check.signingSecretConfigured,
    });
    return;
  }

  console.error('Slack webhook signature validation failed:', {
    reason: check.reason,
    timestampAgeSeconds: check.timestampAgeSeconds ?? null,
    signingSecretConfigured: check.signingSecretConfigured,
  });
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

  let rawBody: string;
  try {
    rawBody = await readRawBody(req);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Slack webhook raw body could not be read:', message);
    return res.status(400).send('Invalid request body');
  }

  const timestamp = headerValue(req.headers['x-slack-request-timestamp']);
  const signature = headerValue(req.headers['x-slack-signature']);
  const signatureCheck = verifySlackSignature(rawBody, timestamp, signature);

  if (!signatureCheck.valid) {
    logSignatureFailure(rawBody, timestamp, signature, signatureCheck);
    return res.status(401).send('Invalid Slack signature');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return res.status(400).send('Invalid JSON');
  }

  if (!isRecord(payload) || typeof payload.type !== 'string') {
    return res.status(400).send('Invalid Slack event payload');
  }

  // Return a signed challenge immediately without loading Supabase/geocoding.
  if (payload.type === 'url_verification') {
    if (typeof payload.challenge !== 'string') {
      return res.status(400).send('Missing Slack challenge');
    }

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(payload.challenge);
  }

  // Acknowledge events before geocoding starts.
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
    const { processRadarMessage } = await import('./_lib/webhook-core');
    await processRadarMessage('slack', messageText);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Slack webhook processing failed:', message);
  }
}
