-- AYTAR Communication Center: online presence and private direct messages.
create table if not exists public.aytar_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now()
);
create index if not exists aytar_presence_last_seen_idx on public.aytar_presence(last_seen_at desc);

alter table public.aytar_presence enable row level security;
drop policy if exists "active members read communication presence" on public.aytar_presence;
create policy "active members read communication presence"
on public.aytar_presence for select to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active'));

drop policy if exists "active members publish own presence" on public.aytar_presence;
create policy "active members publish own presence"
on public.aytar_presence for insert to authenticated
with check (user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active'));

drop policy if exists "active members update own presence" on public.aytar_presence;
create policy "active members update own presence"
on public.aytar_presence for update to authenticated
using (user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active'))
with check (user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active'));

drop policy if exists "active members remove own presence" on public.aytar_presence;
create policy "active members remove own presence"
on public.aytar_presence for delete to authenticated
using (user_id = (select auth.uid()));

create or replace function public.aytar_online_members()
returns table(user_id uuid, username text, last_seen_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active'
  ) then
    raise exception 'Aktif üyelik gerekli.';
  end if;

  return query
  select pr.user_id, coalesce(p.username, 'AYTAR Üyesi')::text, pr.last_seen_at
  from public.aytar_presence pr
  join public.profiles p on p.id = pr.user_id and p.status = 'active'
  where pr.last_seen_at > now() - interval '90 seconds'
    and pr.user_id <> auth.uid()
  order by pr.last_seen_at desc;
end;
$$;
revoke all on function public.aytar_online_members() from public;
grant execute on function public.aytar_online_members() to authenticated;

create table if not exists public.aytar_direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  constraint aytar_direct_messages_no_self check (sender_id <> recipient_id)
);
create index if not exists aytar_direct_messages_pair_idx
on public.aytar_direct_messages(sender_id, recipient_id, created_at desc);
create index if not exists aytar_direct_messages_recipient_idx
on public.aytar_direct_messages(recipient_id, sender_id, created_at desc);

alter table public.aytar_direct_messages enable row level security;
drop policy if exists "active members read own direct messages" on public.aytar_direct_messages;
create policy "active members read own direct messages"
on public.aytar_direct_messages for select to authenticated
using (
  (sender_id = (select auth.uid()) or recipient_id = (select auth.uid()))
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
);

drop policy if exists "active members send direct messages" on public.aytar_direct_messages;
create policy "active members send direct messages"
on public.aytar_direct_messages for insert to authenticated
with check (
  sender_id = (select auth.uid())
  and recipient_id <> (select auth.uid())
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
);

do $$
begin
  alter publication supabase_realtime add table public.aytar_presence;
exception when duplicate_object then null;
when undefined_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.aytar_direct_messages;
exception when duplicate_object then null;
when undefined_object then null;
end $$;
