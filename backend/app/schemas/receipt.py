from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


# --- Gemini Structured Output Şemaları ---

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
    name: str = Field(..., min_length=1, description="Ürün adı")
    price: float = Field(..., ge=0.0, description="Satır toplam tutarı")
    quantity: float = Field(default=1.0, gt=0.0, description="Ürün adedi")
    unit_price: Optional[float] = Field(default=None, ge=0.0, description="Ürün birim fiyatı")
    category: str = Field(..., min_length=1, description="Ürün kategorisi")


class ReceiptUpdate(BaseModel):
    merchant: str = Field(..., min_length=1, description="Mağaza veya işletme adı")
    date: str = Field(..., min_length=1, description="Fiş tarihi (YYYY-MM-DD)")
    total_amount: float = Field(..., ge=0.0, description="Fiş genel toplam tutarı")
    items: List[ReceiptItemUpdate] = Field(
        default_factory=list,
        description="Güncel ürün listesi",
    )


# --- API Request / Response Şemaları ---

class ReceiptItemResponse(BaseModel):
    id: int
    receipt_id: int
    name: str
    price: float
    quantity: float = 1.0
    unit_price: Optional[float] = None
    category: str

    model_config = ConfigDict(from_attributes=True)


class ReceiptResponse(BaseModel):
    id: int
    merchant: str
    date: str
    total_amount: float
    created_at: datetime
    items: List[ReceiptItemResponse]

    model_config = ConfigDict(from_attributes=True)


# --- Harcama Özeti (Summary) Şemaları ---

class CategoryBreakdown(BaseModel):
    category: str = Field(..., description="Harcama kategorisi adı")
    total_amount: float = Field(..., description="Bu kategorideki toplam harcama tutarı")
    item_count: int = Field(..., description="Bu kategorideki toplam ürün adedi")


class ReceiptSummaryResponse(BaseModel):
    total_receipts: int = Field(..., description="Kaydedilen toplam fiş sayısı")
    total_amount: float = Field(..., description="Tüm fişlerin genel harcama toplamı")
    category_breakdown: List[CategoryBreakdown] = Field(
        default_factory=list,
        description="Kategori bazlı harcama dağılımı",
    )
