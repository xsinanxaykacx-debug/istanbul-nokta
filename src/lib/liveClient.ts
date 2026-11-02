import { createClient } from '@supabase/supabase-js';

// AYTAR LIVE, ayrı bir Supabase projesinde (aytar-live-lab) çalışır.
// AYTAR ana verisi (istanbul-nokta) buradan ASLA etkilenmez.
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

export const liveSupabase = isLiveConfigured
  ? createClient(LIVE_URL!, LIVE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 5 } },
      global: { fetch: noCacheFetch },
    })
  : null;

// WebRTC için public STUN sunucuları (ücretsiz, kayıt gerekmez).
// TURN olmadan simetrik NAT arkasındaki kullanıcılar bağlanamaz;
// MVP aşamasında bu kabul edilebilir bir sınırlamadır.
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];
