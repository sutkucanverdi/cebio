import logging
from datetime import date
from typing import Optional

from google import genai
from google.genai import types
from pydantic import ValidationError

from app.core.config import settings
from app.schemas.subscription import ParsedStatement
from app.services.receipt_parser import ReceiptParseError

logger = logging.getLogger("cebio")

# Gemini'ye gönderilecek en fazla metin (CSV/TXT ekstreler için)
MAX_TEXT_CHARS = 200_000

SYSTEM_PROMPT = """Sen Cebio'nun banka ve kredi kartı ekstresi okuma motorusun.
Gönderilen ekstreden yalnızca HARCAMA (para çıkışı / borç) işlemlerini çıkar:
- date: İşlem tarihini YYYY-MM-DD formatına çevir. Yıl yazmıyorsa ekstre dönemine göre tahmin et.
- description: Üye işyeri / açıklama metnini ekstrede yazdığı gibi, kısaltmadan yaz.
- amount: Tutarı pozitif ondalık sayı olarak yaz (Türkçe 1.234,56 -> 1234.56).
- currency: İşlemin orijinal para birimi (TRY, USD, EUR...). Belirtilmemişse TRY.
Kart borcu ödemeleri, iadeler, para girişleri, faiz/ücret iadeleri ve devreden bakiye satırlarını EKLEME.
Taksitli işlemlerde her taksiti ayrı işlem olarak değil, ekstrede göründüğü şekliyle tek satır olarak yaz.
"""


def decode_text(data: bytes) -> str:
    """CSV/TXT ekstreleri bankaya göre UTF-8 veya Windows-1254 (Türkçe) olabilir."""
    for encoding in ("utf-8-sig", "cp1254"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1", errors="replace")


class StatementParserService:
    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None) -> None:
        self.api_key = api_key or settings.GEMINI_API_KEY
        self.model_name = model or settings.GEMINI_MODEL
        self._client: Optional[genai.Client] = None

    @property
    def client(self) -> genai.Client:
        api_key = self.api_key or settings.GEMINI_API_KEY
        if not api_key or api_key == "your_gemini_api_key_here":
            logger.error("GEMINI_API_KEY tanımlanmamış (backend/.env).")
            raise ReceiptParseError("Ekstre analiz servisi yapılandırılmamış. Lütfen daha sonra tekrar deneyin.")
        if self._client is None:
            self._client = genai.Client(api_key=api_key)
        return self._client

    async def parse_statement(self, data: bytes, mime_type: str) -> ParsedStatement:
        instruction = (
            f"Bugünün tarihi: {date.today().isoformat()}. "
            "Bu ekstredeki tüm harcama işlemlerini istenen JSON şemasına uygun olarak çıkar."
        )

        if mime_type.startswith("text/"):
            text = decode_text(data)
            if len(text) > MAX_TEXT_CHARS:
                text = text[:MAX_TEXT_CHARS]
                logger.info("Ekstre metni %s karaktere kısaltıldı.", MAX_TEXT_CHARS)
            contents: list = [instruction, f"EKSTRE İÇERİĞİ ({mime_type}):\n{text}"]
        else:
            contents = [instruction, types.Part.from_bytes(data=data, mime_type=mime_type)]

        response = await self.client.aio.models.generate_content(
            model=self.model_name,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                response_mime_type="application/json",
                response_schema=ParsedStatement,
                temperature=0.0,
            ),
        )

        if isinstance(response.parsed, ParsedStatement):
            return response.parsed
        if not response.text:
            raise ReceiptParseError("Ekstre okunamadı. Lütfen dosyayı kontrol edip tekrar deneyin.")
        try:
            return ParsedStatement.model_validate_json(response.text)
        except ValidationError as exc:
            logger.warning("Gemini ekstre çıktısı şemaya uymadı: %s", exc)
            raise ReceiptParseError("Ekstre okunamadı. Lütfen dosyayı kontrol edip tekrar deneyin.") from exc


statement_parser_service = StatementParserService()
