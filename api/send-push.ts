import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { timingSafeEqual } from 'node:crypto';

type DatabaseWebhook = {
  type?: string; table?: string; schema?: string;
  record?: Record<string, unknown> | null;
};
type SubscriptionRow = { id: string; endpoint: string; p256dh: string; auth: string };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const secret = process.env.PUSH_WEBHOOK_SECRET;
  const supplied = req.headers['x-push-secret'];
  if (!secret || typeof supplied !== 'string') return res.status(401).json({ error: 'Unauthorized' });
  const suppliedBuffer = Buffer.from(supplied);
  const secretBuffer = Buffer.from(secret);
  if (suppliedBuffer.length !== secretBuffer.length || !timingSafeEqual(suppliedBuffer, secretBuffer)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'Push environment is incomplete' });
  }

  const event = (req.body ?? {}) as DatabaseWebhook;
  const row = event.record;
  if (event.type !== 'INSERT' || event.schema !== 'public' || !row) return res.status(202).json({ ignored: true });

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let recipients: string[] = [];
  let notice: { title: string; body: string; url: string; tag: string; kind: string };

  if (event.table === 'pins') {
    const owner = String(row.owner_id ?? '');
    const { data, error } = await db.from('profiles').select('id').eq('status', 'active');
    if (error) return res.status(500).json({ error: 'Could not load active profiles' });
    recipients = (data ?? []).map((item) => String(item.id)).filter((id) => id !== owner);
    notice = { title: 'AYTAR · Yeni ihbar', body: 'Haritaya yeni bir konum eklendi.', url: '/',
      tag: `pin-${String(row.id ?? Date.now())}`, kind: 'new_pin' };
  } else if (event.table === 'aytar_call_signals' && row.kind === 'offer') {
    const recipient = String(row.recipient_id ?? '');
    const sender = String(row.sender_id ?? '');
    if (!recipient || !sender) return res.status(202).json({ ignored: true });
    recipients = [recipient];

    const { data: callerProfile } = await db.from('profiles')
      .select('username').eq('id', sender).maybeSingle();
    const payload = (row.payload && typeof row.payload === 'object')
      ? row.payload as Record<string, unknown> : {};
    const callerName = String(callerProfile?.username || payload.callerName || 'AYTAR kullanıcısı');
    const callMode = payload.mode === 'video' ? 'Görüntülü arama' : 'Sesli arama';
    notice = {
      title: 'AYTAR · Gelen Arama',
      body: `${callerName} seni arıyor · ${callMode}`,
      url: '/?incomingCall=1',
      tag: `call-${String(row.call_id ?? row.id ?? Date.now())}`,
      kind: 'incoming_call',
    };
  } else if (event.table === 'aytar_direct_messages') {
    const sender = String(row.sender_id ?? '');
    const recipient = String(row.recipient_id ?? '');
    if (!sender || !recipient || sender === recipient) return res.status(202).json({ ignored: true });
    recipients = [recipient];

    const { data: senderProfile } = await db.from('profiles')
      .select('username').eq('id', sender).maybeSingle();
    const senderName = String(senderProfile?.username ?? 'Yeni mesaj');
    const preview = String(row.body ?? '').trim().replace(/\\s+/g, ' ').slice(0, 100);
    notice = {
      title: 'AYTAR · Yeni mesaj',
      body: preview ? `${senderName}: ${preview}` : `${senderName} sana yeni bir mesaj gönderdi.`,
      url: '/',
      tag: `message-${String(row.id ?? Date.now())}`,
      kind: 'new_message',
    };
  } else {
    return res.status(202).json({ ignored: true });
  }

  if (!recipients.length) return res.status(200).json({ sent: 0 });

  // Mute suppresses only push notifications; in-app messages remain untouched.
  // Block is mutual for delivery: either side blocking the other suppresses the push.
  if ((event.table === 'aytar_direct_messages' || event.table === 'aytar_call_signals')
      && notice.kind !== 'new_pin') {
    const sender = String(row.sender_id ?? '');
    const recipient = String(row.recipient_id ?? '');
    if (!sender || !recipient) return res.status(202).json({ ignored: true });

    const { data: muteRows, error: muteError } = await db.from('aytar_muted_users')
      .select('user_id')
      .eq('user_id', recipient)
      .eq('muted_id', sender)
      .limit(1);
    if (muteError) return res.status(500).json({ error: 'Could not verify mute preferences' });
    if (muteRows?.length) return res.status(200).json({ attempted: 0, sent: 0, suppressed: 'muted' });

    const { data: blockRows, error: blockError } = await db.from('aytar_blocked_users')
      .select('blocker_id')
      .or(`and(blocker_id.eq.${sender},blocked_id.eq.${recipient}),and(blocker_id.eq.${recipient},blocked_id.eq.${sender})`)
      .limit(1);
    if (blockError) return res.status(500).json({ error: 'Could not verify block preferences' });
    if (blockRows?.length) return res.status(200).json({ attempted: 0, sent: 0, suppressed: 'blocked' });
  }

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  const { data, error } = await db.from('push_subscriptions')
    .select('id,endpoint,p256dh,auth').in('user_id', recipients);
  if (error) return res.status(500).json({ error: 'Could not load subscriptions' });

  const subscriptions = (data ?? []) as SubscriptionRow[];
  const ttl = notice.kind === 'incoming_call' ? 300 : 60;
  const results = await Promise.allSettled(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(notice), { TTL: ttl, urgency: notice.kind === 'incoming_call' ? 'high' : 'normal' });
      return true;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await db.from('push_subscriptions').delete().eq('id', subscription.id);
      return false;
    }
  }));
  return res.status(200).json({ attempted: subscriptions.length,
    sent: results.filter((result) => result.status === 'fulfilled' && result.value).length });
}
