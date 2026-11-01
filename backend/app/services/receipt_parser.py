from typing import Optional

from google import genai
from google.genai import types

from app.core.config import settings
from app.schemas.receipt import ParsedReceipt

SYSTEM_PROMPT = """Sen Cebio adlı otonom cüzdan denetçisinin uzman fiş ayrıştırma motorusun.
Gönderilen fiş veya fatura fotoğrafını dikkatlice incele ve aşağıdaki kurallara göre verileri çıkar:
1. merchant: Mağaza, market veya işletmenin adını temiz ve okunaklı şekilde yaz.
2. date: Fiş üzerindeki tarihi mutlaka YYYY-MM-DD formatına dönüştür (Örn: 2026-11-01). Eğer fişte tarih okunamıyorsa bugünün tarihini YYYY-MM-DD olarak varsay.
3. total_amount: Fişin genel toplam (TOPLAM / GENEL TOPLAM) tutarını float olarak çıkar.
4. items: Fişteki her bir ürünü ayrı ayrı çıkar:
   - name: Ürün adını düzeltilmiş ve anlaşılır şekilde yaz (adet veya çarpan bilgisini ürün adına ekleme).
   - quantity: Ürünün adedini veya miktarını float olarak yaz. Fişte "2X 200,00", "2 ADET X 200,00" gibi çarpanlar varsa quantity: 2.0 olarak yaz; belirtilmemişse varsayılan olarak 1.0 yaz.
   - unit_price: Fişte "2X 200,00" gibi birim fiyat belirtilmişse unit_price: 200.0 olarak yaz. Tek adetli ürünlerde birim fiyat satır tutarına eşittir.
   - price: İlgili satırın toplam tutarını float olarak yaz (Örn: "2X 200,00" ise price: 400.0).
   - category: Ürünü en uygun kategoriye ata (Gıda, Atıştırmalık, İçecek, Temizlik, Kişisel Bakım, Ev & Yaşam, Elektronik, Giyim, Restoran & Kafe, Ulaşım, Diğer).
"""


class ReceiptParserService:
    """Google GenAI SDK (`google-genai`) kullanarak fiş görsellerini ayrıştıran servis."""

    def __init__(self, api_key: Optional[str] = None, model: Optional[str] = None) -> None:
        self.api_key = api_key or settings.GEMINI_API_KEY
        self.model_name = model or settings.GEMINI_MODEL
        self._client: Optional[genai.Client] = None

    @property
    def client(self) -> genai.Client:
        api_key = self.api_key or settings.GEMINI_API_KEY
        if not api_key or api_key == "your_gemini_api_key_here":
            raise ValueError(
                "GEMINI_API_KEY tanımlanmamış. Lütfen backend/.env dosyasına geçerli bir Gemini API anahtarı ekleyin."
            )
        if self._client is None:
            self._client = genai.Client(api_key=api_key)
        return self._client

    def parse_receipt_image(self, image_bytes: bytes, mime_type: str = "image/jpeg") -> ParsedReceipt:
        """
        Gelen fiş görselini `google-genai` SDK ile Gemini modeline gönderir
        ve `ParsedReceipt` şemasına uygun Structured JSON çıktısı olarak geri döner.
        """
        image_part = types.Part.from_bytes(
            data=image_bytes,
            mime_type=mime_type,
        )

        prompt = (
            "Bu fiş görselini analiz et; mağaza adını, tarihi, genel toplamı ve tüm ürünleri "
            "(quantity, unit_price ve satır toplam tutarı price dahil) istenen JSON şemasına uygun olarak çıkar."
        )

        response = self.client.models.generate_content(
            model=self.model_name,
            contents=[prompt, image_part],
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                response_mime_type="application/json",
                response_schema=ParsedReceipt,
                temperature=0.0,
            ),
        )

        if response.parsed is not None and isinstance(response.parsed, ParsedReceipt):
            return response.parsed

        if not response.text:
            raise ValueError("Gemini modelinden yapılandırılmış fiş verisi alınamadı.")

        return ParsedReceipt.model_validate_json(response.text)


receipt_parser_service = ReceiptParserService()
