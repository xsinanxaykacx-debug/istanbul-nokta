import { createClient } from '@supabase/supabase-js';
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const isConfigured = Boolean(url && key && !url.includes('YOUR-PROJECT'));
// Avoid serving Supabase REST reads from the browser's HTTP cache, especially on mobile.
const noCacheFetch: typeof fetch = (input, init) => fetch(input, { ...init, cache: 'no-store' });
export const supabase = isConfigured ? createClient(url!, key!, { global: { fetch: noCacheFetch } }) : null;
