import type { VercelRequest, VercelResponse } from '@vercel/node';

type GeocodeResult = unknown;

type CacheEntry = {
  expiresAt: number;
  data: GeocodeResult;
};

const CACHE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 500;
const MIN_UPSTREAM_INTERVAL_MS = 1100;
const responseCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<GeocodeResult>>();
let upstreamQueue: Promise<void> = Promise.resolve();
let lastUpstreamRequestAt = 0;

function getCached(key: string): GeocodeResult | undefined {
  const entry = responseCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return undefined;
  }
  return entry.data;
}

function setCached(key: string, data: GeocodeResult): void {
  if (responseCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey) responseCache.delete(oldestKey);
  }
  responseCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

async function fetchNominatim(url: URL): Promise<GeocodeResult> {
  const previousRequest = upstreamQueue;
  let releaseQueue!: () => void;
  upstreamQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });

  await previousRequest;
  try {
    const waitMs = Math.max(0, MIN_UPSTREAM_INTERVAL_MS - (Date.now() - lastUpstreamRequestAt));
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    lastUpstreamRequestAt = Date.now();
    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'tr',
        'User-Agent': 'AYTAR/1.0 (https://aytar.vercel.app; OpenStreetMap geocoding proxy)',
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      const error = new Error(`Nominatim HTTP ${response.status}`);
      (error as Error & { status?: number; retryAfter?: string; details?: string }).status = response.status;
      (error as Error & { status?: number; retryAfter?: string; details?: string }).retryAfter =
        response.headers.get('retry-after') ?? undefined;
      (error as Error & { status?: number; retryAfter?: string; details?: string }).details = errorBody.slice(0, 500);
      throw error;
    }

    return await response.json() as GeocodeResult;
  } finally {
    releaseQueue();
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'GET,OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET,OPTIONS');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const type = typeof req.query.type === 'string' ? req.query.type : '';
  const upstreamUrl = new URL('https://nominatim.openstreetmap.org/' + (type === 'search' ? 'search' : 'reverse'));
  upstreamUrl.searchParams.set('format', 'json');
  upstreamUrl.searchParams.set('accept-language', 'tr');

  let cacheKey: string;
  if (type === 'search') {
    const query = typeof req.query.q === 'string' ? req.query.q.trim().replace(/\\s+/g, ' ') : '';
    if (!query || query.length > 200) {
      return res.status(400).json({ error: 'Geçerli bir arama metni gerekli.' });
    }

    const limitValue = Number(req.query.limit);
    const limit = Number.isInteger(limitValue) && limitValue >= 1 && limitValue <= 10 ? limitValue : 5;
    upstreamUrl.searchParams.set('q', query);
    upstreamUrl.searchParams.set('countrycodes', 'tr');
    upstreamUrl.searchParams.set('limit', String(limit));
    upstreamUrl.searchParams.set('addressdetails', '1');
    cacheKey = `search:${query.toLocaleLowerCase('tr-TR')}:${limit}`;
  } else if (type === 'reverse') {
    const lat = Number(req.query.lat);
    const lon = Number(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'Geçerli enlem ve boylam gerekli.' });
    }

    upstreamUrl.searchParams.set('lat', String(lat));
    upstreamUrl.searchParams.set('lon', String(lon));
    upstreamUrl.searchParams.set('zoom', '18');
    upstreamUrl.searchParams.set('addressdetails', '1');
    cacheKey = `reverse:${lat.toFixed(5)}:${lon.toFixed(5)}`;
  } else {
    return res.status(400).json({ error: 'type search veya reverse olmalı.' });
  }

  // Vercel edge cache shares successful GET responses across warm function instances.
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

  const cached = getCached(cacheKey);
  if (cached !== undefined) {
    res.setHeader('X-Geocode-Cache', 'HIT');
    return res.status(200).json(cached);
  }

  try {
    let request = inFlight.get(cacheKey);
    if (!request) {
      request = fetchNominatim(upstreamUrl);
      inFlight.set(cacheKey, request);
    }

    const data = await request;
    setCached(cacheKey, data);
    res.setHeader('X-Geocode-Cache', 'MISS');
    return res.status(200).json(data);
  } catch (error) {
    const failure = error as Error & { status?: number; retryAfter?: string; details?: string };
    const status = failure.status === 429 ? 429 : failure.status && failure.status >= 400 ? failure.status : 502;
    if (failure.retryAfter) res.setHeader('Retry-After', failure.retryAfter);
    // Do not cache failures or transient rate-limit responses.
    res.setHeader('Cache-Control', 'no-store');
    console.error('Geocoding proxy failed:', failure.message, failure.details ?? '');
    return res.status(status).json({ error: 'Adres servisine şu anda ulaşılamıyor.' });
  } finally {
    inFlight.delete(cacheKey);
  }
}
