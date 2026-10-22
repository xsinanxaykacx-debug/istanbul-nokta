-- AYTAR: Fotoğraflar isteğe bağlı (0-3) ve yeni kategori sistemi.
-- Supabase SQL Editor'de bir kez çalıştırın.
begin;

alter table public.pins add column if not exists category text;

update public.pins
set category = case
  when category in ('YEŞİL','Yeşil','Yeşiller') then 'YEŞİL'
  when category in ('MAVİ','Mavi','Maviler') then 'MAVİ'
  when category in ('GRİ','Gri','Sivil','Siviller') then 'GRİ'
  when category in ('KIRMIZI','Kırmızı','Hepsi') or category is null then 'KIRMIZI'
  else 'KIRMIZI'
end;

alter table public.pins alter column category set default 'KIRMIZI';
alter table public.pins alter column category set not null;
alter table public.pins drop constraint if exists pins_category_check;
alter table public.pins add constraint pins_category_check
  check (category in ('YEŞİL','MAVİ','KIRMIZI','GRİ'));

-- Arşiv kayıtlarında da eski kategori isimlerini yeni isimlere dönüştür.
do $$
begin
  if to_regclass('public.archived_pins') is not null then
    update public.archived_pins
    set category = case
      when category in ('YEŞİL','Yeşil','Yeşiller') then 'YEŞİL'
      when category in ('MAVİ','Mavi','Maviler') then 'MAVİ'
      when category in ('GRİ','Gri','Sivil','Siviller') then 'GRİ'
      when category in ('KIRMIZI','Kırmızı','Hepsi') or category is null then 'KIRMIZI'
      else 'KIRMIZI'
    end;
  end if;
end $$;

-- Eski fotoğraf zorunluluğu olan 4 parametreli sürümü kaldır.
drop function if exists public.create_pin_with_photos(double precision, double precision, text, jsonb);

create or replace function public.create_pin_with_photos(
  p_lat double precision,
  p_lng double precision,
  p_description text,
  p_category text,
  p_photos jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
  v_pin_id uuid;
  v_photos jsonb := coalesce(p_photos, '[]'::jsonb);
  v_count integer;
  v_item jsonb;
  v_path text;
  v_url text;
  v_order integer;
begin
  if v_uid is null then
    raise exception 'Önce giriş yapmalısınız.';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_uid and status = 'active'
  ) then
    raise exception 'İşaretçi eklemek için aktif üye olmalısınız.';
  end if;

  if p_lat is null or p_lng is null
     or p_lat not between 40.7 and 41.8
     or p_lng not between 27.8 and 29.9 then
    raise exception 'Konum İstanbul sınırları dışında veya geçersiz.';
  end if;

  if p_description is null or length(p_description) > 5000 then
    raise exception 'Açıklama en fazla 5000 karakter olabilir.';
  end if;

  -- Küfür filtresi korunur; kontrol veritabanında da zorunludur.
  if public.check_profanity(p_description) then
    raise exception 'Açıklamanızda uygun olmayan ifadeler tespit edildi. Lütfen saygılı bir dil kullanın.';
  end if;

  if p_category is null or p_category not in ('YEŞİL','MAVİ','KIRMIZI','GRİ') then
    raise exception 'Kategori geçersiz.';
  end if;

  if jsonb_typeof(v_photos) <> 'array' then
    raise exception 'Fotoğraf listesi geçersiz.';
  end if;

  v_count := jsonb_array_length(v_photos);
  if v_count > 3 then
    raise exception 'En fazla 3 fotoğraf ekleyebilirsiniz.';
  end if;

  for v_item in select value from jsonb_array_elements(v_photos) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Fotoğraf bilgisi geçersiz.';
    end if;

    v_path := v_item->>'storage_path';
    v_url := v_item->>'public_url';
    v_order := (v_item->>'sort_order')::integer;

    if v_path is null
       or split_part(v_path, '/', 1) <> v_uid::text
       or v_path !~ '\\.jpg$' then
      raise exception 'Fotoğraf yolu geçersiz.';
    end if;

    if v_url is null or length(trim(v_url)) = 0
       or v_order is null or v_order < 0 or v_order > 2 then
      raise exception 'Fotoğraf bilgisi geçersiz.';
    end if;
  end loop;

  if (
    select count(distinct (value->>'sort_order'))
    from jsonb_array_elements(v_photos)
  ) <> v_count then
    raise exception 'Fotoğraf sıraları tekrarlanamaz.';
  end if;

  insert into public.pins(owner_id, lat, lng, description, category)
  values(v_uid, p_lat, p_lng, p_description, p_category)
  returning id into v_pin_id;

  insert into public.pin_photos(pin_id, storage_path, public_url, sort_order)
  select v_pin_id, item->>'storage_path', item->>'public_url',
         (item->>'sort_order')::smallint
  from jsonb_array_elements(v_photos) as x(item);

  return v_pin_id;
end;
$function$;

revoke all on function public.create_pin_with_photos(double precision, double precision, text, text, jsonb) from public, anon;
grant execute on function public.create_pin_with_photos(double precision, double precision, text, text, jsonb) to authenticated;

commit;
