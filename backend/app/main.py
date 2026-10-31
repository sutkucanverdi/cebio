from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import router as receipts_router
from app.core.config import settings
from app.core.database import Base, engine
import app.models.receipt  # noqa: F401 - Tabloların metadata'ya kaydolması için


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Uygulama başlarken SQLite tablolarını oluştur
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Cebio — Fiş Fotoğrafı Analizi ve Otonom Cüzdan Denetçisi Backend Servisi",
    lifespan=lifespan,
)

# İleride eklenecek Frontend uygulaması için CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Rotaları bağla
app.include_router(receipts_router)


@app.get("/health", tags=["System"])
def health_check() -> dict:
    return {
        "status": "ok",
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
    }
