# Cebio — Yayın Rehberi

Bu rehber Cebio'yu sunucuya kurup Google Play ve App Store'a çıkarmak için gereken adımları sırayla anlatır.
Kodla ilgili kısımlar hazırdır; aşağıdakiler **senin hesaplarınla ve kararlarınla** yapılması gereken işlerdir.

---

## 0. Yayın öncesi kontrol listesi

- [ ] Yasal metinlerdeki `[KÖŞELİ PARANTEZLİ]` alanları doldur:
      `frontend/public/gizlilik.html` ve `frontend/public/kullanim-kosullari.html`
      (veri sorumlusu adı/unvanı, adres, iletişim e-postası, sunucu konumu, yedek saklama süresi)
- [ ] Yasal metinleri bir avukata/KVKK danışmanına kontrol ettir (bu metinler şablondur, hukuki görüş değildir)
- [ ] Ticari faaliyet olacaksa VERBİS kayıt yükümlülüğünü kontrol et
- [ ] SMTP ayarlandı ve şifre sıfırlama e-postası gerçekten ulaşıyor; e-posta sağlayıcısı gizlilik metnine eklendi
- [ ] Sunucu kuruldu ve `https://...` adresinden `/health` cevap veriyor (Bölüm 1)
- [ ] Gizlilik politikası herkese açık bir URL'den erişilebiliyor (mağazalar zorunlu tutar, Bölüm 2)
- [ ] Mobil derleme gerçek API adresiyle yapıldı (Bölüm 3)
- [ ] İmzalama anahtarı oluşturuldu ve **en az iki ayrı yerde yedeklendi** (Bölüm 3.2)

---

## 1. Backend'i sunucuya kurma

Backend bir Docker imajı olarak hazır (`backend/Dockerfile`). Yönetilen Postgres sunan herhangi bir
platform kullanılabilir: **Render, Railway, Fly.io, DigitalOcean App Platform** veya kendi VPS'in.

> **KVKK notu:** Sunucunun ve veritabanının bulunduğu ülke, gizlilik metnindeki "sunucu konumu" alanına yazılmalı.
> Yurt dışında barındırmak ek bir yurt dışı aktarım demektir; kayıttaki açık rıza metni şu an yalnızca Gemini'yi
> kapsıyor. Yurt dışı sunucu seçersen metni ve rızayı buna göre genişlet (veya Türkiye'de barındır).

### 1.1 Gerekli ortam değişkenleri

| Değişken | Değer |
|---|---|
| `DEBUG` | `False` (zorunlu; False iken JWT_SECRET yoksa sunucu bilerek açılmaz) |
| `DATABASE_URL` | `postgresql+psycopg://KULLANICI:ŞİFRE@HOST:5432/cebio` |
| `JWT_SECRET` | `python -c "import secrets; print(secrets.token_urlsafe(48))"` çıktısı |
| `GEMINI_API_KEY` | Google AI Studio'dan alınan anahtar |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` (ucuz). Google eski modelleri yeni hesaplara kapatabiliyor; güncel listeyi AI Studio'dan kontrol et |
| `CORS_ORIGINS` | `https://localhost,capacitor://localhost,https://WEB-ALAN-ADIN` |
| `AUTO_MIGRATE` | `True` (tek sunucu). Birden fazla örnekte `False` yapıp deploy adımında `alembic upgrade head` çalıştır |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM` | Şifre sıfırlama e-postaları için SMTP bilgileri (Brevo, Resend, Amazon SES vb.). **Boşsa üretimde kod gönderilemez ve kullanıcılar şifresini sıfırlayamaz** |
| `ASSISTANT_RATE_LIMIT` | Kullanıcı başına 10 dk'da en fazla asistan sorusu (varsayılan 30) |

`https://localhost` Android uygulamasının, `capacitor://localhost` iOS uygulamasının kaynak adresidir; CORS'ta
ikisi de olmalı.

### 1.2 Yerelde production benzeri deneme

```bash
JWT_SECRET=deneme-icin-uzun-bir-deger GEMINI_API_KEY=... docker compose up --build
```

API `http://localhost:8000` adresinde, Postgres ile çalışır.

### 1.3 Gemini maliyetleri

Fiş okuma, ekstre analizi ve asistan Gemini kullanır. Google AI Studio'da **faturalandırma bütçe uyarısı**
kur. Asistan için kullanıcı başına istek limiti var; fiş/ekstre yükleme için de limit eklenmesi
(veya ücretsiz/ücretli plan ayrımı) yayından sonra ilk iş olarak önerilir.

---

## 2. Web sürümü ve gizlilik politikası URL'i

Google Play ve App Store, uygulama içi metne ek olarak **herkese açık bir gizlilik politikası URL'i** ister.

```bash
cd frontend
cp .env.production.example .env.production   # VITE_API_BASE_URL'i API adresinle değiştir
npm run build                                # çıktı: frontend/dist
```

`frontend/dist` klasörünü Cloudflare Pages, Netlify veya Vercel gibi bir statik barındırmaya yükle.
Gizlilik politikası adresi: `https://WEB-ALAN-ADIN/gizlilik.html`

---

## 3. Android (Google Play)

### 3.1 Derleme ortamı

Android Studio kurulu olmalı. Komut satırından derlerken Android Studio'nun kendi Java'sını kullan:

```powershell
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
```

```bash
cd frontend
npm run cap:sync          # web derlemesi + Android/iOS projelerine kopyalama
npx cap open android      # Android Studio'da açar (emülatör/telefonda çalıştırmak için)
```

Bilgisayardaki API'yi emülatörde denemek için: `.env.production` içine `VITE_API_BASE_URL=http://10.0.2.2:8000`
yaz ve `CAP_DEV_CLEARTEXT=1 npm run cap:sync` ile senkronize et. **Bu ayarla mağazaya derleme yapma.**

### 3.2 İmzalama anahtarı (BİR KEZ yapılır)

```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkeypair -v `
  -keystore frontend\android\cebio-upload.jks -alias cebio-upload `
  -keyalg RSA -keysize 2048 -validity 10000
```

Sonra `frontend/android/keystore.properties` dosyasını oluştur (git'e girmez):

```properties
storeFile=../cebio-upload.jks
storePassword=BELİRLEDİĞİN_ŞİFRE
keyAlias=cebio-upload
keyPassword=BELİRLEDİĞİN_ŞİFRE
```

> ⚠️ `cebio-upload.jks` ve şifresini kaybedersen uygulamayı güncelleyemezsin. Bir parola yöneticisine ve
> şifreli bir yedeğe koy. Google Play App Signing açıkken kaybedilen yükleme anahtarı Play Console'dan
> sıfırlatılabilir, ama süreç günler sürer.

### 3.3 Mağaza paketi (AAB)

Her yeni sürümde `frontend/android/app/build.gradle` içindeki `versionCode`'u 1 artır, `versionName`'i güncelle.

```bash
cd frontend && npm run cap:sync && cd android
./gradlew bundleRelease
# çıktı: android/app/build/outputs/bundle/release/app-release.aab
```

### 3.4 Play Console

1. Geliştirici hesabı aç (tek seferlik ücret). Kişisel hesaplarda kimlik doğrulaması istenir.
2. **Yeni kişisel hesaplar** üretime çıkmadan önce bir süre **kapalı test** yapmak zorunda (belirli sayıda test
   kullanıcısı, belirli gün sayısı). Güncel şartları Play Console'da kontrol et ve arkadaşlarını test grubuna ekle.
3. Uygulama oluştur: varsayılan dil Türkçe, uygulama adı "Cebio", paket adı `io.github.sutkucanverdi.cebio`.
4. **Veri güvenliği formu** için toplanan veriler:
   - E-posta adresi, ad (isteğe bağlı) — hesap yönetimi
   - Finansal bilgi: satın alma geçmişi (fişler), diğer finansal bilgiler (abonelikler, bütçeler)
   - Fotoğraflar (fiş) ve dosyalar (ekstre) — işlenir, dosyaların kendisi **saklanmaz**
   - Finansal bilgi: kullanıcının onaylayıp içe aktardığı banka/kart işlemleri — **saklanır** (silinebilir)
   - Uygulama içi mesajlar (asistan soruları) — işlenir, saklanmaz
   - Veriler aktarım sırasında şifrelenir: Evet · Kullanıcı verisinin silinmesini isteyebilir: Evet (uygulama içinden)
   - Üçüncü tarafla paylaşım: Google (Gemini) — hizmetin sunulması için işleme
5. **Finansal özellikler beyanı:** "Kişisel finans / bütçe takibi" seç; uygulama ödeme, kredi veya yatırım hizmeti sunmuyor.
6. Mağaza girdisi: ikon `frontend/assets/play-store-icon-512.png`, öne çıkan görsel (1024×500, hazırlanmalı),
   en az 2 telefon ekran görüntüsü, kısa ve uzun açıklama, gizlilik politikası URL'i.
7. İçerik derecelendirmesi anketi, hedef kitle (18+), reklam beyanı (reklam yok).

---

## 4. iOS (App Store)

iOS derlemesi için **macOS ve Xcode** gerekir (Windows'ta yapılamaz). Proje `frontend/ios` altında hazır.

1. Apple Developer Program'a katıl (yıllık ücret).
2. Mac'te: `cd frontend && npm install && npm run cap:sync && npx cap open ios`
3. Xcode'da Signing & Capabilities → Team seç; Bundle ID `io.github.sutkucanverdi.cebio`.
4. Product → Archive → App Store Connect'e yükle.
5. App Store Connect'te **App Privacy** bölümünü Bölüm 3.4'teki verilerle doldur.
6. Gereksinimler zaten karşılanıyor: uygulama içinden hesap silme ✓, gizlilik politikası ✓,
   üçüncü taraf girişi olmadığı için "Sign in with Apple" zorunlu değil ✓.

---

## 5. Bildirimler

- **Abonelik hatırlatıcıları** telefonda yerel bildirim olarak çalışır (sunucu/Firebase gerekmez):
  yenilemeden 1 gün, deneme bitiminden 2 gün önce saat 10:00'da. Abonelikler ekranındaki
  "Hatırlatıcılar" düğmesiyle açılır.
- Sunucudan gönderilen bildirimler (ör. "bütçeni aştın") için ileride Firebase Cloud Messaging +
  `@capacitor/push-notifications` eklenebilir; `google-services.json` ve APNs anahtarı gerekir
  (ikisi de git'e girmez).

---

## 6. Premium abonelik (RevenueCat)

Uygulama içinde dijital bir hizmet sattığın için Google Play ve App Store **kendi ödeme sistemlerini zorunlu
tutar** (kartla doğrudan ödeme alamazsın). İki mağazayı tek yerden yönetmek için RevenueCat kullanılır;
backend tarafı hazır, yalnızca hesap ve anahtarlar eksik.

**Plan limitleri** (`backend/.env`, aylık): ücretsiz 15 fiş / 2 ekstre / 30 asistan sorusu,
premium 200 / 20 / 300 (adil kullanım tavanı). Limitler yalnızca başarılı yapay zeka işlemlerinden düşer.

1. Play Console ve App Store Connect'te abonelik ürünleri oluştur, ör. `cebio_premium_monthly`,
   `cebio_premium_yearly`. Fiyatı mağazada belirlersin (ör. 49,99 ₺/ay, 399,99 ₺/yıl).
2. [RevenueCat](https://www.revenuecat.com)'te proje aç, iki mağazayı bağla, `premium` adında bir
   **entitlement** oluşturup ürünleri ona ekle.
3. RevenueCat → Integrations → Webhooks:
   - URL: `https://API-ADRESIN/api/v1/billing/revenuecat-webhook`
   - Authorization header: uzun rastgele bir değer → aynı değeri sunucuda `REVENUECAT_WEBHOOK_SECRET` yap.
4. Mobil tarafta `@revenuecat/purchases-capacitor` eklenip "Premium'a geç" butonu satın almaya bağlanacak
   (RevenueCat API anahtarları alındıktan sonra yapılacak adım). Uygulama kullanıcıyı RevenueCat'e kendi
   kullanıcı ID'mizle tanıtır: `Purchases.logIn({ appUserID: String(user.id) })`.

**Maliyet notu:** `gemini-3.5-flash-lite` ile bir fiş taraması ~0,1 ₺, bir asistan sorusu ~0,2 ₺ civarındadır.
Premium tavanını sonuna kadar kullanan nadir bir kullanıcının Gemini maliyeti aylık ~80 ₺'ye çıkabilir;
mağaza komisyonu (%15) sonrası fiyatı buna göre belirle veya tavanları `.env`'den düşür.

**Elle premium verme** (promosyon, test kullanıcıları, destek):

```bash
cd backend
python -m app.cli grant-premium kisi@ornek.com --days 30
python -m app.cli revoke-premium kisi@ornek.com
python -m app.cli plan kisi@ornek.com
```

---

## 7. Sürüm yayınlama özeti

```bash
# 1) Testler
cd backend && python -m pytest && cd ../frontend && npm test
# 2) Backend'i deploy et (platformun kendi adımı; migration'lar açılışta uygulanır)
# 3) Mobil
#    android/app/build.gradle -> versionCode +1
npm run cap:sync && cd android && ./gradlew bundleRelease
# 4) AAB'yi Play Console'a yükle (önce kapalı/dahili test kanalı)
```
