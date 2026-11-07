# Cebio — Otonom Cüzdan Denetçisi

**Cebio**, fiş fotoğraflarını yapay zeka (Google Gemini) ile analiz edip kalem kalem harcamaları çıkaran,
kategori bazlı harcama analizi sunan, online abonelikleri takip eden ve harcamalarınızla ilgili soruları
cevaplayan bir cüzdan denetçisidir.

## Özellikler

- **Fişler:** fotoğraftan otomatik ayrıştırma, düzenleme, kategori grafiği, CSV/Excel dışa aktarma
- **Banka/kart ekstresi:** PDF/CSV/ekran görüntüsü ekstre içe aktarılır; işlemler kategorilere ayrılır,
  mükerrerler atlanır, fişi kayıtlı harcamalar eşleştirilip iki kez sayılmaz, içe aktarma geri alınabilir
- **Ücretsiz/Premium plan:** aylık yapay zeka limitleri (fiş, ekstre, asistan), "Planım" ekranı,
  RevenueCat webhook'u ile mağaza abonelikleri, `python -m app.cli grant-premium` ile elle premium
- **Abonelikler:** aylık/yıllık sabit gider, yaklaşan yenilemeler, deneme süresi uyarısı, zam geçmişi,
  hazır servis kataloğu (Netflix, Spotify, YouTube Premium...)
- **Analiz & bütçe:** son 6 ayın harcama trendi, genel veya kategori bazlı aylık bütçeler
  (%80'de uyarı, aşımda kırmızı, ay sonu tahmini)
- **AI asistan:** "Geçen ay ne kadar harcadım?", "Kahveye ne kadar veriyorum?" gibi soruları Gemini function
  calling ile kullanıcının gerçek verisinden cevaplar (yalnızca okuma araçları, kullanıcıya göre sınırlı, istek limiti)
- **Mobil uygulama:** Capacitor ile Android ve iOS; telefonda abonelik yenileme ve deneme bitişi hatırlatıcıları
- **KVKK:** gizlilik politikası, aydınlatma metni, kayıtta zorunlu açık rıza (sürümüyle birlikte kaydedilir), uygulama içinden hesap silme
- **Ekstreden tespit:** banka/kart ekstresi (PDF, CSV, ekran görüntüsü) yüklenir; Gemini işlemleri okur,
  tekrarlayan ödemeler deterministik bir algoritmayla bulunur, kullanıcı onayladıklarını ekler

## Mimari & Klasör Yapısı (Monorepo)

```text
cebio/
├── backend/                     # FastAPI + SQLAlchemy 2 + Alembic + Gemini
│   ├── alembic/versions/        # Veritabanı migration'ları
│   ├── app/
│   │   ├── api/                 # auth.py (JWT), routes.py (fişler), deps.py
│   │   ├── core/                # config, database, security (bcrypt/JWT), migrations
│   │   ├── models/              # User, Receipt, ReceiptItem (Decimal tutarlar, Date tipi)
│   │   ├── schemas/             # Pydantic v2 şemaları
│   │   ├── services/            # Gemini ayrıştırıcılar, abonelik tespiti, analytics, AI asistan + araçları
│   │   └── main.py
│   ├── Dockerfile               # Production imajı (root olmayan kullanıcı, healthcheck)
│   ├── tests/                   # pytest (78 test)
│   ├── requirements.txt
│   └── .env.example
├── docker-compose.yml           # Postgres + API (production benzeri yerel ortam)
├── YAYIN.md                     # Sunucu, Google Play ve App Store yayın rehberi
├── frontend/                    # React 18 + Vite + Tailwind + Recharts + Capacitor 8
│   ├── android/  ios/           # Capacitor yerel projeleri
│   ├── assets/                  # Mağaza ikonları ve açılış ekranı kaynakları
│   ├── public/gizlilik.html     # Gizlilik politikası + KVKK aydınlatma metni (kullanim-kosullari.html)
│   └── src/
│       ├── auth/                # AuthContext (oturum yönetimi)
│       ├── components/          # Dashboard (sekmeler), ReceiptsView, TrendChart, BudgetsCard, AssistantView, subscriptions/
│       ├── hooks/               # useDashboard, useSubscriptions
│       ├── lib/                 # format, export (CSV/Excel), storage
│       └── services/api.ts      # Axios istemcisi + token interceptor
└── README.md
```

## Kurulum

### Backend

```bash
python -m venv venv
venv\Scripts\Activate.ps1        # macOS/Linux: source venv/bin/activate
pip install -r backend/requirements-dev.txt
cp backend/.env.example backend/.env
```

`backend/.env` içinde en az `GEMINI_API_KEY` girin. Production'da `DEBUG=False` ve güçlü bir `JWT_SECRET` zorunludur:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Sunucuyu başlatın (açılışta Alembic migration'ları otomatik uygulanır):

```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

Migration'ları elle çalıştırmak için (`AUTO_MIGRATE=False` iken):

```bash
cd backend
alembic upgrade head
```

> Kullanıcı sistemi öncesinden kalan fişler, **ilk kayıt olan hesaba** otomatik olarak devredilir.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Varsayılan API adresi `http://localhost:8000`; değiştirmek için `VITE_API_BASE_URL` kullanın.

### Testler

```bash
python -m pytest
```

```bash
cd frontend && npm test
```

### Mobil uygulama

```bash
cd frontend
npm run cap:sync        # web derlemesi + Android/iOS'a kopyala
npx cap open android    # Android Studio'da aç
```

Mağaza derlemesi, imzalama ve sunucu kurulumu için: [YAYIN.md](YAYIN.md)

## API Özeti

Swagger UI: `http://localhost:8000/docs` (sağ üstteki **Authorize** ile giriş yapılabilir).

| Uç nokta | Açıklama |
|---|---|
| `POST /api/v1/auth/register` | Hesap oluştur, token döner |
| `POST /api/v1/auth/login` | E-posta + şifre ile giriş |
| `GET /api/v1/auth/me` | Oturumdaki kullanıcı |
| `DELETE /api/v1/auth/me` | Hesabı ve tüm verileri sil (KVKK / App Store) |
| `POST /api/v1/receipts/upload` | Fiş görseli yükle (JPEG/PNG/WEBP, en fazla `MAX_UPLOAD_MB`) |
| `GET /api/v1/receipts` | Listele: `merchant`, `category`, `start_date`, `end_date` |
| `GET /api/v1/receipts/summary` | Toplam + kategori kırılımı: `merchant`, `start_date`, `end_date` |
| `GET/PUT/DELETE /api/v1/receipts/{id}` | Tekil fiş işlemleri |
| `GET/POST /api/v1/subscriptions` | Abonelikleri listele (`status` filtresi) / ekle |
| `GET/PUT/DELETE /api/v1/subscriptions/{id}` | Tekil abonelik; ücret değişikliği zam geçmişine yazılır |
| `GET /api/v1/subscriptions/summary` | Aylık/yıllık toplam (para birimine göre), yaklaşan yenilemeler, biten denemeler, zamlar |
| `GET /api/v1/subscriptions/catalog` | Hazır servis listesi |
| `POST /api/v1/subscriptions/detect` | Ekstreden abonelik adayları (hiçbir şey kaydetmez) |
| `POST /api/v1/statements/preview` | Ekstreyi oku: işlemler, mükerrer/fiş eşleşmesi, olası abonelikler (kaydetmez) |
| `POST /api/v1/statements/import` | Onaylanan satırları kaydet (mükerrerler atlanır) |
| `GET /api/v1/statements` · `DELETE /api/v1/statements/{id}` | İçe aktarılan ekstreler / içe aktarmayı geri al |
| `GET /api/v1/transactions` · `PATCH/DELETE /api/v1/transactions/{id}` | Banka işlemleri (`q`, `category`, tarih) / kategori değiştir / sil |
| `GET /api/v1/analytics/trend` | Son N ayın harcaması: fiş + banka ayrı ayrı (`months`, en fazla 24) |
| `GET/POST /api/v1/budgets` | Bütçeler ve aylık durumları (`month=YYYY-MM`) / bütçe ekle |
| `PUT/DELETE /api/v1/budgets/{id}` | Bütçe limitini güncelle / sil |
| `GET /api/v1/billing/status` | Plan ve bu ayki kullanım / limitler |
| `POST /api/v1/assistant/chat` | AI asistana soru sor (son 20 mesaj; kullanıcı başına istek limiti) |

Fiş, abonelik, bütçe ve asistan uç noktalarının hepsi `Authorization: Bearer <token>` başlığı ister ve yalnızca kullanıcının kendi kayıtlarını döner.
