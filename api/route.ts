// @ts-nocheck
/* eslint-disable */
type VercelRequest = { method?: string; body?: unknown };
type VercelResponse = { setHeader(name: string, value: string): void; status(code: number): VercelResponse; json(body: unknown): VercelResponse; send(body: string): VercelResponse };

const ORS_URL = 'https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson';
const MAX_BODY_BYTES = 32 * 1024;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ORS_API_KEY?.trim();
  if (!apiKey) {
    return res.status(500).json({ error: 'ORS API key is missing' });
  }

  const body = req.body;
  if (!body || typeof body !== 'object' || !Array.isArray(body.coordinates) || body.coordinates.length !== 2) {
    return res.status(400).json({ error: 'Invalid route request body' });
  }
  for (const coordinate of body.coordinates) {
    if (!Array.isArray(coordinate) || coordinate.length !== 2 || !coordinate.every((value: unknown) => typeof value === 'number' && Number.isFinite(value))) {
      return res.status(400).json({ error: 'Coordinates must be finite [longitude, latitude] pairs' });
    }
    const [lng, lat] = coordinate as number[];
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      return res.status(400).json({ error: 'Coordinates are outside valid geographic bounds' });
    }
  }

  const serializedBody = JSON.stringify(body);
  if (Buffer.byteLength(serializedBody, 'utf8') > MAX_BODY_BYTES) {
    return res.status(413).json({ error: 'Route request is too large' });
  }

  try {
    const orsResponse = await fetch(`${ORS_URL}?api_key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/geo+json, application/json' },
      body: serializedBody,
    });
    const responseText = await orsResponse.text();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', orsResponse.headers.get('content-type') || 'application/json; charset=utf-8');
    return res.status(orsResponse.status).send(responseText);
  } catch (error) {
    console.error('ORS proxy request failed:', error);
    return res.status(502).json({ error: 'ORS request failed' });
  }
}
