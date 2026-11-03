-- AYTAR one-to-one WebRTC call signaling.
create table if not exists public.aytar_call_signals (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('offer', 'answer', 'ice', 'reject', 'hangup')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint aytar_call_signals_no_self check (sender_id <> recipient_id),
  constraint aytar_call_signals_payload_size check (pg_column_size(payload) < 65536)
);
create index if not exists aytar_call_signals_recipient_created_idx
  on public.aytar_call_signals(recipient_id, created_at desc);
create index if not exists aytar_call_signals_call_idx
  on public.aytar_call_signals(call_id, created_at);

alter table public.aytar_call_signals enable row level security;
drop policy if exists "active members receive own call signals" on public.aytar_call_signals;
create policy "active members receive own call signals"
on public.aytar_call_signals for select to authenticated
using (
  (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()))
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
);

drop policy if exists "active members send call signals to active members" on public.aytar_call_signals;
create policy "active members send call signals to active members"
on public.aytar_call_signals for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and recipient_id <> (select auth.uid())
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
  and exists (select 1 from public.profiles p where p.id = recipient_id and p.status = 'active')
);

drop policy if exists "participants delete own call signals" on public.aytar_call_signals;
create policy "participants delete own call signals"
on public.aytar_call_signals for delete to authenticated
using (
  (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()))
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
);

grant select, insert, delete on public.aytar_call_signals to authenticated;

do $$
begin
  alter publication supabase_realtime add table public.aytar_call_signals;
exception when duplicate_object then null;
when undefined_object then null;
end $$;
