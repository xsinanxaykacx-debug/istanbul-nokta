-- AYTAR viewport loading and access hardening.
create index if not exists pins_lat_lng_created_at_idx on public.pins (lat, lng, created_at desc);

alter table public.pins enable row level security;
alter table public.pin_photos enable row level security;

drop policy if exists "active members read pins" on public.pins;
create policy "active members read pins" on public.pins for select to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active'));

drop policy if exists "active members read photos" on public.pin_photos;
create policy "active members read photos" on public.pin_photos for select to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = 'active'));

do $$ begin
  if to_regclass('public.archived_pins') is not null then
    execute 'alter table public.archived_pins enable row level security';
    execute 'revoke all on table public.archived_pins from anon';
    execute 'grant select on table public.archived_pins to authenticated';
    execute 'drop policy if exists "active members read archived pins" on public.archived_pins';
    execute 'create policy "active members read archived pins" on public.archived_pins for select to authenticated using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.status = ''active''))';
  end if;
end $$;
