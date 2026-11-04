import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = (import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined)?.trim().replace(/^["']|["']$/g, '');

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error('VITE_VAPID_PUBLIC_KEY geçerli base64url biçiminde değil.');
  }
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const raw = window.atob(padded);
  const bytes = Uint8Array.from(raw, (character) => character.charCodeAt(0));
  if (bytes.length !== 65 || bytes[0] !== 4) {
    throw new Error('VAPID public key 65 baytlık geçerli P-256 anahtarı değil. Vercel VITE_VAPID_PUBLIC_KEY değerini kontrol edin.');
  }
  return bytes;
}

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator
    && 'PushManager' in window && 'Notification' in window && Boolean(VAPID_PUBLIC_KEY);
}

export async function getPushEnabled(): Promise<boolean> {
  if (!isPushSupported() || !supabase || Notification.permission !== 'granted') return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase.from('push_subscriptions').select('id')
    .eq('user_id', user.id).eq('endpoint', subscription.endpoint).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function enablePush(): Promise<void> {
  if (!supabase) throw new Error('Supabase bağlantısı hazır değil.');
  if (!isPushSupported() || !VAPID_PUBLIC_KEY) throw new Error('Bu tarayıcı Web Push desteklemiyor veya public VAPID anahtarı tanımlı değil.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Bildirim izni verilmedi.');
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(VAPID_PUBLIC_KEY) as BufferSource,
    });
  }
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!user) throw new Error('Bildirimleri açmak için giriş yapmalısınız.');
  const keys = subscription.toJSON().keys;
  if (!keys?.p256dh || !keys.auth) throw new Error('Tarayıcı abonelik anahtarları alınamadı.');
  const { error } = await supabase.from('push_subscriptions').upsert({
    user_id: user.id, endpoint: subscription.endpoint, p256dh: keys.p256dh, auth: keys.auth,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });
  if (error) throw error;
}

export async function disablePush(): Promise<void> {
  if (!supabase || !('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { error } = await supabase.from('push_subscriptions').delete()
      .eq('user_id', user.id).eq('endpoint', subscription.endpoint);
    if (error) throw error;
  }
  await subscription.unsubscribe();
}
