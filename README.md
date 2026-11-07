# Cebio — Otonom Cüzdan Denetçisi

**Cebio**, fiş fotoğraflarını yapay zeka (Google Gemini) ile analiz edip kalem kalem harcamaları çıkaran,
kategori bazlı harcama analizi sunan bir cüzdan denetçisidir.

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
│   │   ├── services/            # Gemini fiş ayrıştırıcı (async)
│   │   └── main.py
│   ├── tests/                   # pytest (20 test)
│   ├── requirements.txt
│   └── .env.example
├── frontend/                    # React 18 + Vite + Tailwind + Recharts
│   └── src/
│       ├── auth/                # AuthContext (oturum yönetimi)
│       ├── components/          # Dashboard, Header, StatCards, UploadCard, CategoryChart, ReceiptTable, ...
│       ├── hooks/               # useDashboard (veri çekme + filtreler)
│       ├── lib/                 # format, export (CSV/Excel), storage
│       └── services/api.ts      # Axios istemcisi + token interceptor
└── README.md
```

## Kurulum

### Backend

```bash
python -m venv venv
venv\Scripts\Activate.ps1        # macOS/Linux: source venv/bin/activate
pip install -r backend/requirements.txt
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

Fiş uç noktalarının hepsi `Authorization: Bearer <token>` başlığı ister ve yalnızca kullanıcının kendi fişlerini döner.
