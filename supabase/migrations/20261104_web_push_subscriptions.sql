create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_length check (char_length(endpoint) between 1 and 4096)
);
create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "users read own push subscriptions" on public.push_subscriptions;
create policy "users read own push subscriptions" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "active users create own push subscriptions" on public.push_subscriptions;
create policy "active users create own push subscriptions" on public.push_subscriptions for insert to authenticated with check (
  user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active')
);
drop policy if exists "users update own push subscriptions" on public.push_subscriptions;
create policy "users update own push subscriptions" on public.push_subscriptions for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "users delete own push subscriptions" on public.push_subscriptions;
create policy "users delete own push subscriptions" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- Server-side push dispatch: secrets stay in Supabase Vault, never in table rows or source code.
create extension if not exists pg_net with schema extensions;
select vault.create_secret('E8tv_kZwPvgW7miG8NCZZQV5JUrfQBPuFXehJ_Mm7naDpzN0N0O7sqlW8Pw13tep', 'aytar_push_webhook_secret', 'Shared secret for AYTAR push webhook');

create or replace function public.dispatch_aytar_push_webhook()
returns trigger
language plpgsql
security definer
set search_path = public, vault, extensions, net
as $$
declare
  v_secret text;
  v_event jsonb;
begin
  -- Only aytar_call_signals has a kind column; never access NEW.kind for pins.
  if tg_table_name = 'aytar_call_signals' then
    if new.kind is distinct from 'offer' then
      return new;
    end if;
  end if;
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'aytar_push_webhook_secret'
  limit 1;
  if v_secret is null then
    raise warning 'AYTAR push webhook secret is not configured in Vault';
    return new;
  end if;
  v_event := jsonb_build_object(
    'type', 'INSERT', 'schema', 'public', 'table', tg_table_name,
    'record', to_jsonb(new), 'old_record', null
  );
  perform net.http_post(
    url := 'https://aytar.vercel.app/api/send-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    body := v_event,
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

 drop trigger if exists aytar_push_on_pin_insert on public.pins;
create trigger aytar_push_on_pin_insert
after insert on public.pins
for each row execute function public.dispatch_aytar_push_webhook();

drop trigger if exists aytar_push_on_call_offer on public.aytar_call_signals;
create trigger aytar_push_on_call_offer
after insert on public.aytar_call_signals
for each row when (new.kind = 'offer')
execute function public.dispatch_aytar_push_webhook();
