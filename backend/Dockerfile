# Cebio API - production imajı
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini .
COPY alembic ./alembic
COPY app ./app

# Root olmayan kullanıcıyla çalıştır
RUN useradd --create-home --uid 10001 cebio && chown -R cebio /app
USER cebio

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4).status == 200 else 1)"

# Migration'lar açılışta AUTO_MIGRATE ile uygulanır. Birden fazla örnek çalıştırırken
# AUTO_MIGRATE=False yapıp deploy adımında `alembic upgrade head` çalıştırın.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --workers ${WEB_CONCURRENCY:-1}"]
