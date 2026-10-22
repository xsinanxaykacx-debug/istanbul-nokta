-- İstanbul Nokta - Supabase SQL Editor içinde bir kez çalıştırın.
-- Frontend'e yalnızca publishable/anon key koyun; service_role anahtarını asla koymayın.
create extension if not exists pgcrypto with schema extensions;

do $$ begin create type public.member_status as enum ('pending','active','disabled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.member_role as enum ('user','admin'); exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  status public.member_status not null default 'pending',
  role public.member_role not null default 'user',
  created_at timestamptz not null default now()
);
create table if not exists public.reference_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  created_by uuid references auth.users(id),
  redeemed_by uuid unique references auth.users(id),
  created_at timestamptz not null default now(),
  redeemed_at timestamptz,
  is_enabled boolean not null default true
);
create table if not exists public.pins (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  lat double precision not null check (lat between 40.7 and 41.8),
  lng double precision not null check (lng between 27.8 and 29.9),
  description text not null default '' check (length(description) <= 5000),
  category text not null default 'KIRMIZI' check (category in ('YEŞİL','MAVİ','KIRMIZI','GRİ')),
  created_at timestamptz not null default now()
);
create table if not exists public.pin_photos (
  id uuid primary key default gen_random_uuid(),
  pin_id uuid not null references public.pins(id) on delete cascade,
  storage_path text not null unique,
  public_url text not null,
  sort_order smallint not null check (sort_order between 0 and 2),
  created_at timestamptz not null default now(),
  unique(pin_id, sort_order)
);
create index if not exists pins_created_at_idx on public.pins(created_at desc);
create index if not exists pin_photos_pin_id_idx on public.pin_photos(pin_id,sort_order);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,status,role) values(new.id,'pending','user') on conflict(id) do nothing;
  return new;
end; $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.reference_codes enable row level security;
alter table public.pins enable row level security;
alter table public.pin_photos enable row level security;
drop policy if exists "profile owner reads own profile" on public.profiles;
create policy "profile owner reads own profile" on public.profiles for select to authenticated using (id=(select auth.uid()));
drop policy if exists "active members read pins" on public.pins;
create policy "active members read pins" on public.pins for select to authenticated using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='active'));
drop policy if exists "active members read photos" on public.pin_photos;
create policy "active members read photos" on public.pin_photos for select to authenticated using (exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='active'));
revoke all on public.reference_codes from anon, authenticated;
grant select on public.profiles,public.pins,public.pin_photos to authenticated;

create or replace function public.redeem_reference_code(p_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_hash text; v_code_id uuid;
begin
  if v_uid is null then raise exception 'Önce giriş yapmalısınız.'; end if;
  if p_code is null or length(trim(p_code)) < 4 then raise exception 'Referans kodu geçersiz.'; end if;
  v_hash := encode(extensions.digest(upper(trim(p_code)),'sha256'),'hex');
  select id into v_code_id from public.reference_codes where code_hash=v_hash and is_enabled and redeemed_by is null for update;
  if v_code_id is null then raise exception 'Kod geçersiz, devre dışı veya daha önce kullanılmış.'; end if;
  update public.reference_codes set redeemed_by=v_uid,redeemed_at=now() where id=v_code_id and redeemed_by is null;
  if not found then raise exception 'Kod başka bir kullanıcı tarafından kullanılmış.'; end if;
  update public.profiles set status='active' where id=v_uid and status='pending';
  if not found then raise exception 'Hesap etkinleştirilemedi.'; end if;
end; $$;

create table if not exists public.banned_words (
  word text primary key
);
alter table public.banned_words enable row level security;
revoke all on public.banned_words from public, anon, authenticated;

create or replace function public.check_profanity(input_text text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_clean_text text;
  v_clean_word text;
begin
  if input_text is null or length(trim(input_text)) = 0 then return false; end if;
  v_clean_text := lower(input_text);
  v_clean_text := replace(v_clean_text, 'ı', 'i');
  v_clean_text := replace(v_clean_text, 'ğ', 'g');
  v_clean_text := replace(v_clean_text, 'ü', 'u');
  v_clean_text := replace(v_clean_text, 'ş', 's');
  v_clean_text := replace(v_clean_text, 'ö', 'o');
  v_clean_text := replace(v_clean_text, 'ç', 'c');
  for v_clean_word in select lower(word) from public.banned_words loop
    v_clean_word := replace(v_clean_word, 'ı', 'i');
    v_clean_word := replace(v_clean_word, 'ğ', 'g');
    v_clean_word := replace(v_clean_word, 'ü', 'u');
    v_clean_word := replace(v_clean_word, 'ş', 's');
    v_clean_word := replace(v_clean_word, 'ö', 'o');
    v_clean_word := replace(v_clean_word, 'ç', 'c');
    if v_clean_text like '%' || v_clean_word || '%' then return true; end if;
  end loop;
  return false;
end; $$;

create or replace function public.create_pin_with_photos(
  p_lat double precision,
  p_lng double precision,
  p_description text,
  p_category text,
  p_photos jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_pin_id uuid;
  v_count integer;
  v_item jsonb;
  v_path text;
  v_url text;
  v_order integer;
begin
  if v_uid is null then raise exception 'Önce giriş yapmalısınız.'; end if;
  if not exists(select 1 from public.profiles where id=v_uid and status='active') then
    raise exception 'İşaretçi eklemek için aktif üye olmalısınız.';
  end if;
  if p_lat is null or p_lng is null or p_lat not between 40.7 and 41.8 or p_lng not between 27.8 and 29.9 then
    raise exception 'Konum İstanbul sınırları dışında veya geçersiz.';
  end if;
  if p_description is null or length(p_description)>5000 then
    raise exception 'Açıklama en fazla 5000 karakter olabilir.';
  end if;
  if public.check_profanity(p_description) then
    raise exception 'Açıklamanızda uygun olmayan ifadeler tespit edildi. Lütfen saygılı bir dil kullanın.';
  end if;
  if p_category is null or p_category not in ('YEŞİL','MAVİ','KIRMIZI','GRİ') then
    raise exception 'Kategori geçersiz.';
  end if;
  if jsonb_typeof(coalesce(p_photos, '[]'::jsonb)) <> 'array' then
    raise exception 'Fotoğraf listesi geçersiz.';
  end if;
  v_count := jsonb_array_length(coalesce(p_photos, '[]'::jsonb));
  if v_count > 3 then raise exception 'En fazla 3 fotoğraf ekleyebilirsiniz.'; end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'Fotoğraf bilgisi geçersiz.'; end if;
    v_path := v_item->>'storage_path';
    v_url := v_item->>'public_url';
    v_order := (v_item->>'sort_order')::integer;
    if v_path is null or split_part(v_path,'/',1) <> v_uid::text or v_path !~ '\.jpg$' then
      raise exception 'Fotoğraf yolu geçersiz.';
    end if;
    if v_url is null or length(trim(v_url)) = 0 or v_order is null or v_order < 0 or v_order > 2 then
      raise exception 'Fotoğraf bilgisi geçersiz.';
    end if;
  end loop;
  if (select count(distinct (value->>'sort_order')) from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb))) <> v_count then
    raise exception 'Fotoğraf sıraları tekrarlanamaz.';
  end if;

  insert into public.pins(owner_id,lat,lng,description,category)
  values(v_uid,p_lat,p_lng,p_description,p_category) returning id into v_pin_id;

  insert into public.pin_photos(pin_id,storage_path,public_url,sort_order)
  select v_pin_id,item->>'storage_path',item->>'public_url',(item->>'sort_order')::smallint
  from jsonb_array_elements(coalesce(p_photos, '[]'::jsonb)) as x(item);
  return v_pin_id;
end; $$;
revoke all on function public.redeem_reference_code(text) from public,anon;
grant execute on function public.redeem_reference_code(text) to authenticated;
revoke all on function public.create_pin_with_photos(double precision,double precision,text,text,jsonb) from public,anon;
grant execute on function public.create_pin_with_photos(double precision,double precision,text,text,jsonb) to authenticated;

-- MVP kolaylığı için public bucket kullanılıyor: URL'yi bilen fotoğrafı görebilir.
-- Gizli fotoğraf gerekiyorsa private bucket ve imzalı URL uygulamasına geçin.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('pin-photos','pin-photos',true,12582912,array['image/jpeg'])
on conflict(id) do update set public=true,file_size_limit=12582912,allowed_mime_types=array['image/jpeg'];
drop policy if exists "members upload photos to own folder" on storage.objects;
create policy "members upload photos to own folder" on storage.objects for insert to authenticated
with check(bucket_id='pin-photos' and (storage.foldername(name))[1]=(select auth.uid())::text and exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.status='active'));
drop policy if exists "users remove own photos" on storage.objects;
create policy "users remove own photos" on storage.objects for delete to authenticated
using(bucket_id='pin-photos' and (storage.foldername(name))[1]=(select auth.uid())::text);

-- İlk yönetici: önce uygulamadan kayıt olun. Sonra SQL Editor'de select id,email from auth.users;
-- Aşağıdaki UPDATE içindeki UUID'yi kendi kullanıcı UUID'nizle değiştirin.
-- update public.profiles set role='admin',status='active' where id='KENDI-UUID';
-- Referans kodu ekleme örneği (düz metin kodu kendi seçiminizle değiştirin):
-- insert into public.reference_codes(code_hash,created_by) values(encode(extensions.digest(upper('IST-AB12CD'),'sha256'),'hex'),'ADMIN-UUID');
