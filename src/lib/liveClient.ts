import { createClient } from '@supabase/supabase-js';

const LIVE_URL = (import.meta.env.VITE_LIVE_SUPABASE_URL as string | undefined)?.trim();
const LIVE_KEY = (import.meta.env.VITE_LIVE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export const isLiveConfigured = Boolean(
  LIVE_URL &&
  LIVE_KEY &&
  !LIVE_URL.includes('YOUR-PROJECT') &&
  !LIVE_KEY.includes('YOUR_')
);

const noCacheFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: 'no-store' });

// LAB veritabanına anonim (public) olarak bağlanıyoruz.
export const liveSupabase = isLiveConfigured
  ? createClient(LIVE_URL!, LIVE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 5 } },
      global: { fetch: noCacheFetch },
    })
  : null;

const TURN_URLS = (import.meta.env.VITE_TURN_URLS as string | undefined)
  ?.split(',')
  .map((url) => url.trim())
  .filter((url) => url.startsWith('turn:') || url.startsWith('turns:')) ?? [];
const TURN_USERNAME = (import.meta.env.VITE_TURN_USERNAME as string | undefined)?.trim();
const TURN_CREDENTIAL = (import.meta.env.VITE_TURN_CREDENTIAL as string | undefined)?.trim();

const CONFIGURED_TURN_SERVERS: RTCIceServer[] =
  TURN_URLS.length > 0 && TURN_USERNAME && TURN_CREDENTIAL
    ? [{ urls: TURN_URLS, username: TURN_USERNAME, credential: TURN_CREDENTIAL }]
    : [
        {
          urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443'],
          username: 'openrelayproject',
          credential: 'openrelayproject',
        },
      ];

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  ...CONFIGURED_TURN_SERVERS,
];
