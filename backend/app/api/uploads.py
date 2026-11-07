"""Ekstre dosyası yükleme ve Gemini ile ayrıştırma: abonelik tespiti ve içe aktarma ortak kullanır."""
import logging
from pathlib import Path
from typing import Optional, Tuple

from fastapi import HTTPException, UploadFile, status

from app.core.config import settings
from app.schemas.subscription import ParsedStatement
from app.services.ai_errors import is_quota_error, quota_exceeded
from app.services.receipt_parser import ReceiptParseError
from app.services.statement_parser import statement_parser_service

logger = logging.getLogger("cebio")

STATEMENT_MIME_BY_EXT = {
    ".pdf": "application/pdf",
    ".csv": "text/csv",
    ".txt": "text/plain",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
}
STATEMENT_MIMES = set(STATEMENT_MIME_BY_EXT.values()) | {"application/vnd.ms-excel"}


async def read_statement_upload(file: UploadFile) -> Tuple[bytes, str]:
    """Dosya türünü ve boyutunu doğrular; (içerik, mime) döner."""
    content_type = (file.content_type or "").split(";")[0].strip().lower()
    ext = Path(file.filename or "").suffix.lower()
    mime: Optional[str] = STATEMENT_MIME_BY_EXT.get(ext)
    if mime is None and content_type in STATEMENT_MIMES:
        mime = "text/csv" if content_type == "application/vnd.ms-excel" else content_type
    if mime is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Desteklenmeyen dosya. Lütfen ekstreyi PDF, CSV veya ekran görüntüsü olarak yükleyin.",
        )

    max_bytes = settings.max_upload_bytes
    data = await file.read(max_bytes + 1)
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Yüklenen dosya boş.")
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"Dosya çok büyük. En fazla {settings.MAX_UPLOAD_MB} MB yükleyebilirsiniz.",
        )
    return data, mime


async def parse_statement_or_http(data: bytes, mime: str, user_id: int) -> ParsedStatement:
    """Gemini ile ekstreyi ayrıştırır; hataları kullanıcıya uygun HTTP hatalarına çevirir."""
    try:
        return await statement_parser_service.parse_statement(data, mime)
    except ReceiptParseError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)) from exc
    except Exception as exc:
        if is_quota_error(exc):
            logger.warning("Gemini kotası doldu (user_id=%s)", user_id)
            raise quota_exceeded() from exc
        logger.exception("Ekstre ayrıştırma hatası (user_id=%s)", user_id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Ekstre analiz servisine şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.",
        ) from exc
