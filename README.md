# İstanbul Nokta — PWA MVP

İstanbul haritasında konum, serbest açıklama ve konum başına 1–3 sıkıştırılmış JPEG fotoğraf paylaşımı. React + TypeScript + Vite + Leaflet/OpenStreetMap + Supabase kullanır. Telefon ve bilgisayar tarayıcılarında çalışır; PWA olarak ana ekrana eklenebilir.

## Maliyet ve servis sınırları

- Kaynak kod ve temel kütüphaneler ücretsiz/açık kaynak.
- Supabase ücretsiz planı Auth, PostgreSQL ve Storage için kullanılabilir; kota ve plan şartları değişebilir.
- Netlify ücretsiz statik hosting seçeneğiyle yayınlanabilir. Özel alan adı satın almak gerekmez.
- OpenStreetMap standart tile sunucusu ücretsizdir ama sınırsız kullanım garantisi yoktur. Attribution gösterin, tile'ları toplu indirmeyin ve kullanım politikasına uyun.
- Dolayısıyla başlangıç hedefi 0 TL'dir; üçüncü tarafların ücretsiz planları/limitleri garanti edilmez.

## 1. Gerekenler

Windows'a Node.js LTS kurun. Supabase'de ücretsiz bir proje açın.

## 2. Supabase kurulumu

1. Supabase Dashboard → SQL Editor bölümünde `supabase/schema.sql` dosyasının tamamını çalıştırın.
2. Project Settings → API içinden Project URL ve publishable/anon key değerlerini alın. `service_role` anahtarını frontend'e kesinlikle koymayın.
3. Proje kökünde `.env` dosyası oluşturun. `.env.example` içeriğini kopyalayıp gerçek değerleri girin:

   `VITE_SUPABASE_URL=https://PROJE-REF.supabase.co`

   `VITE_SUPABASE_ANON_KEY=SUPABASE_PUBLISHABLE_OR_ANON_KEY`

4. Supabase Authentication → URL Configuration içinde `http://localhost:5173` adresini izinli yönlendirme URL'lerine ekleyin. Yayın adresini de yayına aldığınızda ekleyin.
5. E-posta sağlayıcısı ayarlarını kontrol edin. E-posta doğrulaması açıksa kayıt sonrası e-postayı doğrulayın, ardından giriş yapın.

## 3. İlk yönetici ve referans kodu oluşturma

Bu ilk sürümde yönetici paneli yok; yönetici ve kodlar SQL Editor üzerinden ayarlanır.

1. Uygulamadan bir hesap oluşturun ve giriş yapın.
2. Supabase SQL Editor'de `select id,email from auth.users;` sorgusunu çalıştırıp kendi kullanıcı UUID'nizi bulun.
3. UUID'yi değiştirip çalıştırın:

   `update public.profiles set role='admin',status='active' where id='KENDI-UUID';`

4. Örnekteki `IST-AB12CD` kodunu kendi seçtiğiniz bir kodla değiştirin; `ADMIN-UUID` alanına kendi UUID'nizi yazın:

   `insert into public.reference_codes(code_hash,created_by) values(encode(extensions.digest(upper('IST-AB12CD'),'sha256'),'hex'),'ADMIN-UUID');`

5. Kodu kullanıcıya gönderin. Kullanıcı kayıt olup giriş yaptıktan sonra kodu girerek hesabını etkinleştirir. Kod bir kez kullanılabilir.

## 4. Windows'ta çalıştırma

PowerShell'de proje klasörüne gidin. Örneğin ZIP'i çıkardığınız klasör:

    npm install
    Copy-Item .env.example .env
    notepad .env
    npm run dev

`.env` dosyasına gerçek Supabase bilgilerini kaydedin. Terminalde verilen `http://localhost:5173` adresini tarayıcıda açın. Derleme testi:

    npm run build

## 5. Ücretsiz yayına alma

1. `npm run build` çalıştırın; yayın dosyaları `dist` klasörüne çıkar.
2. `dist` klasörünü Netlify Drop veya başka ücretsiz statik hosting seçeneğiyle yayınlayın.
3. Hosting ayarlarına `VITE_SUPABASE_URL` ve `VITE_SUPABASE_ANON_KEY` değişkenlerini girin ve yeniden deploy edin.
4. Yayın adresini Supabase Authentication → URL Configuration bölümüne ekleyin.

## Uygulama kuralları

- Anonim ziyaretçi haritayı görür; işaretçi sorgusu yapamaz.
- Yeni hesap `pending` başlar. Geçerli referans kodu hesabı `active` yapar.
- Yalnızca `active` üyeler ortak işaretçileri görebilir ve ekleyebilir.
- Fotoğraf başına kaynak dosya sınırı 12 MB; istemci en uzun kenarı 1280 piksele indirip JPEG'e sıkıştırır.
- Pin ve 1–3 fotoğraf metadata'sı tek PostgreSQL RPC transaction'ında kaydedilir.

## Güvenlik / MVP sınırlamaları

- Storage dosyaları RPC öncesinde yüklenir. PostgreSQL transaction'ı Storage yüklemesini kapsayamaz; RPC başarısız olursa istemci yüklenen dosyaları silmeye çalışır. Bağlantı kesintisi halinde sahipsiz dosya kalabilir.
- Bu MVP'de fotoğraf bucket'ı public olarak ayarlanır; dosya URL'sini bilen biri fotoğrafı görebilir. Pin verisi RLS ile korunur ama fotoğraflar gizli sayılmaz. Fotoğraf gizliliği zorunluysa private bucket + signed URL akışına geçilmelidir.
- Referans kodu yönetimi için uygulama içi admin paneli henüz yoktur.
- Konum kontrolü İstanbul için yaklaşık koordinat kutusudur; il sınırlarının kesin poligonu değildir.
- Canlı kullanımdan önce rate limiting, spam önlemleri, yedekleme ve güvenlik testleri eklenmelidir.
