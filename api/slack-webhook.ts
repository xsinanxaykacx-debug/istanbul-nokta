import { createHmac, timingSafeEqual } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { processRadarMessage } from './_lib/webhook-core';

// Slack signatures are calculated from the exact raw request body. Disable
// Vercel's JSON body parser so verification happens before parsing the payload.
export const config = {
  api: {
    bodyParser: false,
  },
};

const MAX_REQUEST_AGE_SECONDS = 60 * 5;

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(
      typeof chunk === 'string'
        ? Buffer.from(chunk, 'utf8')
        : Buffer.from(chunk as Uint8Array),
    );
  }
  return Buffer.concat(chunks);
}

function isValidSlackSignature(
  rawBody: Buffer,
  timestampHeader: string | undefined,
  signatureHeader: string | undefined,
): boolean {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!signingSecret || !timestampHeader || !signatureHeader) return false;
  if (!/^\d{1,12}$/.test(timestampHeader)) return false;
  if (!/^v0=[0-9a-f]{64}$/i.test(signatureHeader)) return false;

  const requestTimestamp = Number(timestampHeader);
  const now = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(requestTimestamp) ||
    Math.abs(now - requestTimestamp) > MAX_REQUEST_AGE_SECONDS
  ) {
    return false;
  }

  const signatureBase = 'v0:' + timestampHeader + ':' + rawBody.toString('utf8');
  const expectedSignature =
    'v0=' + createHmac('sha256', signingSecret).update(signatureBase, 'utf8').digest('hex');

  const expectedBytes = Buffer.from(expectedSignature, 'utf8');
  const providedBytes = Buffer.from(signatureHeader.toLowerCase(), 'utf8');
  return (
    expectedBytes.length === providedBytes.length &&
    timingSafeEqual(expectedBytes, providedBytes)
  );
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

  // Slack sends this signed request when verifying a new Events API endpoint.
  if (payload.type === 'url_verification') {
    if (typeof payload.challenge !== 'string') {
      return res.status(400).send('Missing Slack challenge');
    }
    return res.status(200).json({ challenge: payload.challenge });
  }

  // Acknowledge valid Slack events promptly. The async handler continues to
  // await the shared processing pipeline so the serverless invocation remains
  // active while geocoding and writing the pin.
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

  const messageText = event.text.trim();
  if (!messageText) return;

  try {
    await processRadarMessage('slack', messageText);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Slack webhook processing failed:', message);
  }
}
