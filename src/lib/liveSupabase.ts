import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_LIVE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_LIVE_SUPABASE_ANON_KEY as string | undefined;

export const liveSupabase = url && key
  ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;
