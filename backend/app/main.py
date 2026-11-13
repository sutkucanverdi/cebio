import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.analytics import router as analytics_router
from app.api.assistant import router as assistant_router
from app.api.auth import router as auth_router
from app.api.billing import router as billing_router
from app.api.reports import router as reports_router
from app.api.routes import router as receipts_router
from app.api.statements import router as statements_router
from app.api.subscriptions import router as subscriptions_router
from app.core.config import settings
from app.core.i18n import parse_accept_language, set_locale, translate
from app.core.migrations import run_migrations

logging.basicConfig(level=logging.DEBUG if settings.DEBUG else logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    # Şema değişiklikleri Alembic ile yönetilir (backend/alembic/versions).
    if settings.AUTO_MIGRATE:
        run_migrations()
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Cebio — Fiş Fotoğrafı Analizi ve Otonom Cüzdan Denetçisi Backend Servisi",
    lifespan=lifespan,
)

# Kimlik doğrulama Authorization: Bearer başlığıyla yapıldığı için çerez (credentials) gerekmez.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)



@app.middleware("http")
async def locale_middleware(request: Request, call_next):
    """İstek dilini (Accept-Language) belirler; hata mesajları ve raporlar bu dile göre üretilir."""
    set_locale(parse_accept_language(request.headers.get("accept-language")))
    response = await call_next(request)
    response.headers.setdefault("Content-Language", parse_accept_language(request.headers.get("accept-language")))
    return response


@app.exception_handler(StarletteHTTPException)
async def translated_http_exception_handler(request: Request, exc: StarletteHTTPException):
    if isinstance(exc.detail, str):
        locale = parse_accept_language(request.headers.get("accept-language"))
        exc = HTTPException(status_code=exc.status_code, detail=translate(exc.detail, locale), headers=exc.headers)
    return await http_exception_handler(request, exc)


app.include_router(auth_router)
app.include_router(receipts_router)
app.include_router(subscriptions_router)
app.include_router(analytics_router)
app.include_router(statements_router)
app.include_router(assistant_router)
app.include_router(billing_router)
app.include_router(reports_router)


@app.get("/health", tags=["System"])
def health_check() -> dict:
    return {
        "status": "ok",
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
    }
