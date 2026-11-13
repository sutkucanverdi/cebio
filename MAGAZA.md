# Cebio — App Store ve Google Play Uyum Kontrol Listesi

Son kontrol: **13 Kasım 2026**. Kurallar sık değişir; yüklemeden önce Play Console ve App Store Connect'teki
uyarıları mutlaka oku.

- ✅ = kodda / projede tamamlandı.
- ⬜ = senin hesabınla veya kararınla yapılacak (kod yazmak gerekmez).

Teknik kurulum adımları [YAYIN.md](YAYIN.md) dosyasındadır.

---

## 1. Her iki mağaza için ortak kurallar

| # | Gereksinim | Durum | Nerede |
|---|---|---|---|
| 1 | Gizlilik politikası hem uygulama içinden hem herkese açık bir URL'den erişilebilir olmalı | ✅ uygulama içinde (Ayarlar, kayıt ekranı, satın alma ekranı) · ⬜ URL'i yayınla | `public/gizlilik.html`, `privacy.html` |
| 2 | Hesap oluşturulabiliyorsa uygulama içinden hesap **ve tüm veriler** silinebilmeli (dondurma sayılmaz) | ✅ Ayarlar → "Hesabımı ve tüm verilerimi sil", hesap menüsü → "Hesabımı Sil"; tüm tablolar CASCADE ile silinir | `DELETE /api/v1/auth/me` |
| 3 | Üçüncü taraf yapay zekaya kişisel veri gönderilmeden önce açıkça bildirilmeli ve **izin** alınmalı (Apple 5.1.2(i), Kasım 2025; Google Play Kullanıcı Verileri, Temmuz 2026) | ✅ Kayıtta ayrı ve isteğe bağlı onay kutusu, ilk kullanımda izin penceresi, Ayarlar'dan geri alma. İzin yoksa sunucu Gemini'yi hiç çağırmaz (403) | `AiConsent.tsx`, `billing.ensure_ai_consent` |
| 4 | Yapay zeka izni verilmese de uygulama işe yarar olmalı (izin hizmet şartı yapılmamalı; KVKK m.5) | ✅ Elle fiş ekleme, abonelikler, bütçeler, raporlar ve fiyat takibi izinsiz çalışır | `POST /api/v1/receipts` |
| 5 | Dijital abonelik **yalnızca mağaza ödeme sistemiyle** satılmalı (Apple 3.1.1, Play Ödemeler politikası) | ✅ RevenueCat ile mağaza satın alma. Anahtar yoksa satın alma butonu hiç gösterilmez (yarım kalmış buton inceleme reddi sebebidir) | `lib/purchases.ts`, `PlanModal.tsx` |
| 6 | Abonelik ekranında fiyat, süre, otomatik yenileme açıklaması, Koşullar + Gizlilik bağlantıları ve "Satın alımları geri yükle" butonu olmalı (Apple 3.1.2) | ✅ | `PlanModal.tsx` |
| 7 | Yapay zeka cevaplarını uygulamadan çıkmadan bildirme özelliği (Google Play Yapay Zeka İçeriği politikası) | ✅ Her asistan cevabında "Bildir"; kayıtlar `python -m app.cli ai-reports` ile incelenir | `POST /api/v1/assistant/report` |
| 8 | Finansal tavsiye vermediği açıkça belirtilmeli | ✅ Asistan ekranında, koşullarda ve sistem talimatında | `AssistantView.tsx` |
| 9 | Kullanıcı verisi reklam veya takip için kullanılmamalı / beyan edilmeli | ✅ Reklam, takip SDK'sı, analitik yok | `PrivacyInfo.xcprivacy` (`NSPrivacyTracking=false`) |
| 10 | Destek URL'i ve iletişim e-postası | ✅ `destek.html`, `support.html` · ⬜ gerçek e-posta adresini yaz | `VITE_SUPPORT_EMAIL` |
| 11 | Yasal metinlerde gerçek kimlik bilgileri | ⬜ `[KÖŞELİ PARANTEZ]` alanlarını 8 HTML dosyasında doldur (ad/unvan, adres, e-posta, sunucu konumu, yedek süresi) | `frontend/public/*.html` |
| 12 | İnceleme ekibi için demo hesap | ⬜ Sunucuda bir demo hesap aç, içine örnek fiş/abonelik ekle, yapay zeka iznini ver, `grant-premium` ile premium ver | Bölüm 5 |
| 13 | Uygulama Türkçe ve İngilizce | ✅ Arayüz, hata mesajları, raporlar, asistan, e-postalar, bildirimler, yasal metinler | `src/i18n`, `app/core/i18n.py` |

---

## 2. Google Play

| # | Gereksinim | Durum |
|---|---|---|
| P1 | **Hedef API 36 (Android 16)**: 31 Ağustos 2026'dan beri yeni uygulamalar ve güncellemeler için zorunlu | ✅ `targetSdkVersion = 36`, `compileSdkVersion = 36` |
| P2 | **Web'den hesap silme talebi bağlantısı** (uygulamayı yeniden kurmadan silme isteyebilmeli); Veri güvenliği formuna girilir | ✅ `hesap-silme.html` / `delete-account.html` · ⬜ URL'i Play Console > Veri güvenliği > Veri silme alanına gir |
| P3 | Veri güvenliği formu, gizlilik politikasıyla tutarlı olmalı | ⬜ Bölüm 4.2'deki cevaplarla doldur |
| P4 | Tam zamanlı alarm izni (`SCHEDULE_EXACT_ALARM` / `USE_EXACT_ALARM`) kısıtlı | ✅ Manifest'ten kaldırıldı; hatırlatıcılar tam zamanlı alarm kullanmaz |
| P5 | Fotoğraf/video izinleri: tek seferlik seçimde sistem fotoğraf seçicisi kullanılmalı, `READ_MEDIA_IMAGES` istenmemeli | ✅ Geniş medya izinleri manifest'ten kaldırıldı; dosya seçici ve kamera sistem arayüzüyle açılır |
| P6 | Android 13+ bildirim izni çalışma zamanında istenmeli | ✅ `POST_NOTIFICATIONS`; yalnızca kullanıcı "Hatırlatıcılar"ı açınca sorulur |
| P7 | Hassas veriler bulut yedeğine gitmemeli | ✅ `allowBackup=false`, `data_extraction_rules.xml` |
| P8 | Kamera zorunlu donanım olmamalı (tabletler kurabilsin) | ✅ `android.hardware.camera required=false` |
| P9 | Uygulama dilleri (Android 13+) | ✅ `locales_config.xml` (tr, en) |
| P10 | 16 KB bellek sayfası uyumu (Android 15+ hedefleyen uygulamalar) | ✅ Uygulamada kendi yerel (C/C++) kütüphanemiz yok. ⬜ AAB yükleyince Play Console'daki "16 KB" uyarısına bak (RevenueCat ve Capacitor güncel sürümleri uyumludur) |
| P11 | Kenardan kenara (edge-to-edge) görünüm (hedef API 35+) | ✅ Capacitor SystemBars `insetsHandling: 'css'` + güvenli alan CSS değişkenleri |
| P12 | **Finansal özellikler beyanı** (tüm uygulamalar doldurur) | ⬜ "Kişisel finans → Bütçe/harcama takibi" seç; kredi, yatırım, kripto, ödeme hizmeti **yok** |
| P13 | Yeni kişisel geliştirici hesapları: üretime çıkmadan önce **en az 12 test kullanıcısıyla 14 gün kapalı test** | ⬜ Kapalı test kanalı aç, 12+ kişiyi ekle, 14 gün aktif tut |
| P14 | İçerik derecelendirmesi (IARC) anketi | ⬜ Bölüm 4.3 |
| P15 | Hedef kitle ve içerik | ⬜ 18+ seç; çocuklara yönelik değil |
| P16 | Reklam beyanı | ⬜ "Reklam içermiyor" |
| P17 | Uygulama erişimi (giriş gerektiren uygulamalar inceleme için hesap verir) | ⬜ Demo hesap e-posta ve şifresini "Uygulama erişimi" bölümüne yaz |
| P18 | Uygulama içi ürünler / abonelikler | ⬜ `cebio_premium_monthly`, `cebio_premium_yearly` ürünlerini oluştur (YAYIN.md §6) |
| P19 | Geliştirici kimlik doğrulaması ve iletişim adresi | ⬜ Play Console hesap doğrulaması |
| P20 | Ekran görüntüleri ve öne çıkan görsel | ⬜ En az 2 telefon ekran görüntüsü + 1024×500 öne çıkan görsel |

---

## 3. App Store

| # | Gereksinim | Durum |
|---|---|---|
| A1 | **Xcode 26 / iOS 26 SDK** ile derleme (28 Nisan 2026'dan beri zorunlu) | ⬜ Mac'te Xcode 26 veya üstü kullan |
| A2 | **Gizlilik manifesti** (`PrivacyInfo.xcprivacy`) ve "required reason" API beyanları | ✅ `ios/App/App/PrivacyInfo.xcprivacy` (UserDefaults CA92.1, FileTimestamp C617.1; takip yok). Xcode projesine eklendi |
| A3 | Kamera / fotoğraf izin açıklamaları (eksikse uygulama çöker veya reddedilir) | ✅ `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription` |
| A4 | İhracat uyumu (şifreleme beyanı) | ✅ `ITSAppUsesNonExemptEncryption = false` (yalnızca HTTPS) |
| A5 | Desteklenen diller | ✅ `CFBundleLocalizations` tr, en |
| A6 | 64-bit cihaz gereksinimi | ✅ `UIRequiredDeviceCapabilities = arm64` (eski `armv7` düzeltildi) |
| A7 | Sign in with Apple | ✅ Gerekmez: üçüncü taraf (Google/Facebook) girişi yok, yalnızca e-posta/şifre |
| A8 | App Tracking Transparency | ✅ Gerekmez: takip yok |
| A9 | **App Privacy** (beslenme etiketi) | ⬜ Bölüm 4.1'deki cevaplarla doldur (manifest ile aynı) |
| A10 | **Yaş derecelendirmesi** yeni anketi (13+/16+/18+; Eylül 2026'dan beri yüklemede zorunlu) | ⬜ Bölüm 4.3 |
| A11 | Abonelik ürünleri, abonelik grubu, "Review Information" ekran görüntüsü | ⬜ YAYIN.md §6 |
| A12 | Kullanım koşulları (EULA) bağlantısı uygulama açıklamasında veya "License Agreement" alanında | ✅ Koşullarda Apple EULA maddesi var · ⬜ açıklamanın sonuna Koşullar ve Gizlilik URL'lerini ekle |
| A13 | **AB Dijital Hizmetler Yasası (DSA) tacir beyanı** — AB'de yayınlanacaksa | ⬜ App Store Connect > Business: tacir/tacir değil beyanı (tacirsen adres ve telefon herkese açık olur). Yalnızca Türkiye'de yayınlamak da bir seçenek |
| A14 | Destek URL'i ve gizlilik politikası URL'i | ⬜ `https://ALAN-ADIN/destek.html`, `https://ALAN-ADIN/gizlilik.html` |
| A15 | 4.2 Asgari işlevsellik (yalnızca web sitesini saran uygulama olmamalı) | ✅ Yerel bildirimler, kamera, paylaşım, mağaza aboneliği, çevrimdışı açılan yasal sayfalar |
| A16 | İnceleme notu ve demo hesap | ⬜ Bölüm 5 |

---

## 4. Form cevapları (kopyala-yapıştır)

### 4.1 App Store — App Privacy

"Data Used to Track You": **Hiçbiri**. Aşağıdakilerin hepsi için: *Linked to the user: Yes*,
*Used for tracking: No*, *Purpose: App Functionality*.

| Kategori | Tür |
|---|---|
| Contact Info | Email Address, Name |
| Financial Info | Other Financial Info (abonelikler, bütçeler, banka işlemleri) |
| Purchases | Purchase History (fiş kalemleri; mağaza aboneliği durumu) |
| User Content | Photos or Videos (fiş fotoğrafı, işlenir ve saklanmaz), Other User Content (asistan soruları, bildirilen cevaplar) |
| Identifiers | User ID |

### 4.2 Google Play — Veri güvenliği

- Veriler aktarım sırasında şifreleniyor mu? **Evet**.
- Kullanıcılar verilerinin silinmesini isteyebilir mi? **Evet**: uygulama içinden ve `https://ALAN-ADIN/hesap-silme.html` üzerinden.
- Toplanan ve paylaşılan veriler:

| Veri türü | Toplanıyor | Paylaşılıyor | Neden | İsteğe bağlı mı? |
|---|---|---|---|---|
| E-posta adresi | Evet | Hayır | Hesap yönetimi | Zorunlu |
| Ad | Evet | Hayır | Hesap yönetimi | İsteğe bağlı |
| Kullanıcı kimlikleri | Evet | Hayır | Uygulama işlevselliği | Zorunlu |
| Satın alma geçmişi | Evet | Hayır | Uygulama işlevselliği | Zorunlu |
| Diğer finansal bilgiler | Evet | **Evet** (Google Gemini: ekstre analizi) | Uygulama işlevselliği | İsteğe bağlı |
| Fotoğraflar | Evet (geçici işleme, saklanmaz) | **Evet** (Google Gemini: fiş okuma) | Uygulama işlevselliği | İsteğe bağlı |
| Dosyalar ve belgeler | Evet (geçici işleme, saklanmaz) | **Evet** (Google Gemini) | Uygulama işlevselliği | İsteğe bağlı |
| Uygulama içi mesajlar | Evet (asistan soruları, saklanmaz) | **Evet** (Google Gemini) | Uygulama işlevselliği | İsteğe bağlı |

Google'ın açıklamasına göre, hizmet sağlayıcıya (Gemini) yalnızca senin adına işlem için yapılan aktarım
"paylaşım" sayılmayabilir. Yine de beyan etmek daha güvenli ve şeffaftır; inceleme reddi riskini azaltır.

### 4.3 İçerik / yaş derecelendirmesi

Uygulamada şunların hiçbiri **yok**: şiddet, cinsellik, kumar, uyuşturucu, kullanıcılar arası iletişim,
herkese açık kullanıcı içeriği, konum paylaşımı, reklam. Uygulama yapay zeka ile metin üretir; çıktılar
yalnızca kullanıcının kendi harcama verisiyle sınırlıdır. Uygulama finansal veriler içerdiği için hedef kitle
**18+** seçilmelidir (Apple'ın yeni sistemindeki sonuç büyük olasılıkla 4+ olur; hedef kitle ayrıca 18+ beyan edilir).

---

## 5. İnceleme notu (App Review / Play "Uygulama erişimi")

> **TR:** Cebio fiş fotoğraflarından harcama kaydı çıkaran, abonelik ve bütçe takibi yapan bir kişisel finans
> uygulamasıdır. Demo hesap: `demo@ALAN-ADIN` / `ŞİFRE`. Hesapta örnek veriler ve Premium tanımlıdır.
> Yapay zeka özellikleri (fiş tarama, ekstre analizi, asistan) veriyi Google Gemini'ye gönderdiği için yalnızca
> kullanıcı ayrı bir izin ekranında onay verdiğinde çalışır. İzin Ayarlar'dan geri alınabilir. Fiş taramayı
> denemek için herhangi bir market fişinin fotoğrafını kullanabilirsiniz. Uygulama ödeme, kredi veya yatırım hizmeti sunmaz.
>
> **EN:** Cebio is a personal finance app that turns receipt photos into expense records and tracks
> subscriptions and budgets. Demo account: `demo@YOUR-DOMAIN` / `PASSWORD` (sample data and Premium enabled).
> AI features (receipt scan, statement analysis, assistant) send data to Google Gemini and therefore only run after
> the user grants explicit permission in a dedicated consent screen; it can be withdrawn in Settings. Any grocery
> receipt photo can be used to test scanning. The app does not provide payments, loans or investment services.
> Account deletion: Settings → "Delete my account and all my data".

---

## 6. Mağaza metinleri

### Türkçe

- **Ad (30):** Cebio: Fiş ve Harcama Takibi
- **Alt başlık / kısa açıklama (30 / 80):** Fişini çek, harcamanı anla · *Fişini çek, aboneliklerini yakala, kişisel enflasyonunu gör.*
- **Uzun açıklama:**

> Cebio fişlerini saniyeler içinde harcama kaydına çevirir, aboneliklerini ve bütçeni tek yerde toplar.
>
> • **Fiş tarama:** Fotoğrafı çek; mağaza, tarih ve tüm ürünler kalem kalem kaydedilsin. İstersen yapay zeka olmadan elle ekle.
> • **Kişisel enflasyon:** Sık aldığın ürünlerin fiyatı aylar içinde ne kadar arttı? Senin sepetinin enflasyonunu gör.
> • **Banka ekstresi:** PDF, CSV veya ekran görüntüsünü yükle; harcamalar kategorilere ayrılsın, fişi olanlar iki kez sayılmasın.
> • **Abonelikler:** Netflix'ten spor salonuna tüm sabit giderlerin; yenilemeden ve deneme bitmeden önce hatırlatma; zam geçmişi.
> • **Bütçeler ve aylık rapor:** Kategori bütçeleri, ay sonu tahmini, geçen aya göre ne değişti?
> • **Asistan:** "Bu ay markete ne kadar harcadım?" diye sor; cevap kendi verinden gelsin.
>
> Gizlilik önce gelir: reklam yok, takip yok. Yapay zeka özellikleri yalnızca izin verirsen çalışır; fiş ve ekstre
> dosyaları saklanmaz. Hesabını ve tüm verilerini tek dokunuşla silebilirsin.
>
> Premium: daha yüksek aylık yapay zeka limitleri (otomatik yenilenen aylık/yıllık abonelik).
> Kullanım Koşulları: https://ALAN-ADIN/kullanim-kosullari.html · Gizlilik: https://ALAN-ADIN/gizlilik.html

- **Anahtar kelimeler (App Store, 100 karakter):** fiş,harcama,bütçe,abonelik,ekstre,gider,tasarruf,market,enflasyon,finans

### English

- **Name:** Cebio: Receipt & Spend Tracker
- **Subtitle / short description:** Snap receipts, master spending · *Scan receipts, catch subscriptions, see your personal inflation.*
- **Description:**

> Cebio turns your receipts into expense records in seconds and brings your subscriptions and budgets together.
>
> • **Receipt scanning:** Snap a photo; store, date and every item are saved line by line, or add receipts manually without AI.
> • **Personal inflation:** How much more do the things you buy every week cost now? See the inflation of *your* basket.
> • **Bank statements:** Import PDF, CSV or screenshots; transactions are categorized and receipt duplicates aren't counted twice.
> • **Subscriptions:** All recurring costs in one place, with reminders before renewals and trial endings, plus price-hike history.
> • **Budgets & monthly report:** Category budgets, month-end forecast and what changed since last month.
> • **Assistant:** Ask "How much did I spend on groceries this month?" and get answers from your own data.
>
> Privacy first: no ads, no tracking. AI features run only with your permission, and receipt and statement files
> are never stored. Delete your account and all data with one tap.
>
> Premium: higher monthly AI limits (auto-renewing monthly/yearly subscription).
> Terms: https://YOUR-DOMAIN/terms.html · Privacy: https://YOUR-DOMAIN/privacy.html

- **Keywords:** receipt,expense,budget,subscription,statement,spending,scanner,inflation,finance,tracker

---

## 7. KVKK ve Türkiye'ye özgü yükümlülükler (mağaza dışı)

- ⬜ **VERBİS:** Yıllık çalışan sayısı 50'den az ve yıllık mali bilanço toplamı 100 milyon TL'den az ise
  ve ana faaliyetin özel nitelikli veri işlemek değilse kayıt istisnası olabilir. Güncel Kurul kararını kontrol et.
- ⬜ **Yurt dışına aktarım (KVKK m.9, 2024 değişikliği):** Gemini'ye aktarım için uygulama ayrı açık rıza alıyor.
  Kalıcı çözüm için Google'ın standart sözleşme seçeneklerini değerlendir. Standart sözleşme imzalanırsa
  **5 iş günü içinde Kurul'a bildirim** zorunludur.
- ⬜ **Gemini ücretli katman:** Ücretsiz katmanda Google, içerikleri ürün geliştirme için kullanabilir. Gizlilik
  metni ücretli katmanı varsayar; gerçek kullanıcılara açmadan önce Google AI Studio'da faturalandırmayı aç.
- ⬜ **E-posta:** Şifre sıfırlama e-postaları ticari ileti değildir (İYS kaydı gerekmez). Pazarlama e-postası
  gönderilecekse İYS ve ayrı onay gerekir.
- ⬜ **Mesafeli sözleşmeler:** Abonelik satışını mağaza yapar; iade/cayma süreçleri mağazanın politikasına tabidir
  ve koşullarda belirtilmiştir.
- ⬜ Yasal metinleri bir avukata veya KVKK danışmanına kontrol ettir. Bu metinler şablondur, hukuki görüş değildir.
