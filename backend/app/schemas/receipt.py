import datetime as dt
from decimal import Decimal
from typing import Annotated, List, Optional

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer

# Veritabanında Decimal olarak tutulan tutarlar JSON'a sayı (number) olarak yazılır;
# Pydantic varsayılan olarak Decimal'i string'e çevirdiği için frontend sözleşmesi bozulmasın.
Money = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]


# --- Gemini Structured Output Şemaları ---
# Not: Gemini response_schema ile uyum için bu iki şema bilerek float/str kullanır.
# Değerler veritabanına yazılmadan önce Decimal ve date tiplerine dönüştürülür.

class ParsedReceiptItem(BaseModel):
    name: str = Field(..., description="Fişteki ürün veya hizmetin tam adı")
    price: float = Field(..., description="Ürünün toplam satır tutarı (quantity * unit_price)")
    quantity: float = Field(
        default=1.0,
        description="Ürünün adedi veya miktarı (Örn: '2X 200,00' ise 2.0, belirtilmemişse varsayılan 1.0)",
    )
    unit_price: Optional[float] = Field(
        default=None,
        description="Ürünün birim fiyatı (Örn: '2X 200,00' ise 200.0, belirtilmemişse None veya satır fiyatı)",
    )
    category: str = Field(
        ...,
        description="Ürünün kategorisi (Örn: Gıda, İçecek, Temizlik, Kişisel Bakım, Teknoloji, Restoran, Diğer)",
    )


class ParsedReceipt(BaseModel):
    merchant: str = Field(..., description="Market, mağaza veya işletme adı")
    date: str = Field(..., description="Fiş tarihi, YYYY-MM-DD formatında (Örn: 2026-11-01)")
    total_amount: float = Field(..., description="Fişin genel toplam tutarı")
    items: List[ParsedReceiptItem] = Field(
        ...,
        description="Fişte yer alan tüm harcama ürünlerinin listesi",
    )


# --- Fiş Güncelleme (PUT) Şemaları ---

class ReceiptItemUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="Ürün adı")
    price: Decimal = Field(..., ge=0, description="Satır toplam tutarı")
    quantity: Decimal = Field(default=Decimal("1"), gt=0, description="Ürün adedi")
    unit_price: Optional[Decimal] = Field(default=None, ge=0, description="Ürün birim fiyatı")
    category: str = Field(..., min_length=1, max_length=100, description="Ürün kategorisi")


class ReceiptUpdate(BaseModel):
    merchant: str = Field(..., min_length=1, max_length=255, description="Mağaza veya işletme adı")
    date: dt.date = Field(..., description="Fiş tarihi (YYYY-MM-DD)")
    total_amount: Decimal = Field(..., ge=0, description="Fiş genel toplam tutarı")
    items: List[ReceiptItemUpdate] = Field(
        default_factory=list,
        description="Güncel ürün listesi",
    )


# --- API Response Şemaları ---

class ReceiptItemResponse(BaseModel):
    id: int
    receipt_id: int
    name: str
    price: Money
    quantity: Money = Decimal("1")
    unit_price: Optional[Money] = None
    category: str

    model_config = ConfigDict(from_attributes=True)


class ReceiptResponse(BaseModel):
    id: int
    merchant: str
    date: dt.date
    total_amount: Money
    created_at: dt.datetime
    items: List[ReceiptItemResponse]

    model_config = ConfigDict(from_attributes=True)


# --- Harcama Özeti (Summary) Şemaları ---

class CategoryBreakdown(BaseModel):
    category: str = Field(..., description="Harcama kategorisi adı")
    total_amount: Money = Field(..., description="Bu kategorideki toplam harcama tutarı")
    item_count: float = Field(..., description="Bu kategorideki toplam ürün adedi")


class ReceiptSummaryResponse(BaseModel):
    total_receipts: int = Field(..., description="Filtreye uyan toplam fiş sayısı")
    total_amount: Money = Field(..., description="Filtreye uyan fişlerin genel harcama toplamı")
    category_breakdown: List[CategoryBreakdown] = Field(
        default_factory=list,
        description="Kategori bazlı harcama dağılımı",
    )


# --- Kişisel enflasyon / fiyat takibi ---

class PricePoint(BaseModel):
    date: dt.date
    merchant: str
    name: str
    unit_price: Money


class PriceHistoryResponse(BaseModel):
    query: str
    points: List[PricePoint]
    first_price: Optional[Money] = None
    last_price: Optional[Money] = None
    change_pct: Optional[float] = None


class PriceWatchItem(BaseModel):
    name: str
    purchases: int
    first_date: dt.date
    first_price: Money
    last_date: dt.date
    last_price: Money
    change_pct: float
    total_spent: Money


class PriceWatchResponse(BaseModel):
    since: dt.date
    tracked_items: int
    basket_change_pct: Optional[float] = None
    items: List[PriceWatchItem]
