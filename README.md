# Cebio — Otonom Cüzdan Denetçisi

**Cebio**, fiş fotoğraflarını yapay zeka ile analiz edip kalem kalem harcamaları çıkaran ve banka ekstrelerindeki abonelik kaçaklarını yakalayan otonom bir cüzdan denetçisidir.

## Mimari & Klasör Yapısı (Monorepo)

```text
cebio/
├── backend/                  # FastAPI + SQLAlchemy 2.0 + OpenAI Structured Output
│   ├── app/
│   │   ├── core/             # Konfigürasyon ve Veritabanı bağlantısı
│   │   ├── models/           # SQLAlchemy 2.0 ORM modelleri (Receipt, ReceiptItem)
│   │   ├── schemas/          # Pydantic v2 veri doğrulama ve OpenAI şemaları
│   │   ├── services/         # OpenAI gpt-4o-mini Fiş Ayrıştırıcı Servisi
│   │   ├── api/              # REST API uç noktaları (/api/v1/...)
│   │   └── main.py           # FastAPI uygulama başlatıcı ve CORS ayarları
│   ├── requirements.txt
│   └── .env.example
├── frontend/                 # Sonraki fazda eklenecek
├── .gitignore
└── README.md
```

## Faz 1: Çekirdek Fiş Ayrıştırıcı Servisi Kurulumu

### 1. Sanal Ortam ve Bağımlılıklar

```bash
cd backend
python -m venv ../venv
# Windows (PowerShell):
..\venv\Scripts\Activate.ps1
# macOS / Linux:
# source ../venv/bin/activate

pip install -r requirements.txt
```

### 2. Ortam Değişkenleri

`backend/.env.example` dosyasını `backend/.env` olarak kopyalayın ve OpenAI API anahtarınızı girin:

```bash
cp .env.example .env
```

```env
OPENAI_API_KEY=sk-proj-...
```

### 3. Sunucuyu Başlatma

`backend/` dizini içerisindeyken:

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### 4. API Kullanımı

- **Swagger UI (İnteraktif Dokümantasyon):** `http://localhost:8000/docs`
- **Fiş Yükleme Endpoint'i:** `POST http://localhost:8000/api/v1/receipts/upload`
  - Form-data parametresi: `file` (JPEG, PNG, WEBP fiş görseli)
