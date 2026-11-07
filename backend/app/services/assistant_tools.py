"""AI asistanın çağırabileceği araçlar (Gemini function calling).

Her araç yalnızca oturumdaki kullanıcının verisini okur; yazma/silme yapan araç yoktur.
Araç hataları istisna fırlatmak yerine {"error": ...} döner ki model düzeltip tekrar deneyebilsin.
"""
import datetime as dt
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Callable, Dict, Optional

from sqlalchemy.orm import Session

from app.services.analytics import (
    budget_status,
    list_receipts_brief,
    monthly_trend,
    parse_month,
    search_items,
    spending_summary,
)
from app.services.subscription_logic import monthly_equivalent, yearly_equivalent


@dataclass
class ToolContext:
    db: Session
    user_id: int
    today: dt.date


def jsonable(value: Any) -> Any:
    """Decimal/date içeren yapıları Gemini'ye gönderilebilir JSON'a çevirir."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (dt.date, dt.datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    return value


def _date(args: Dict[str, Any], key: str) -> Optional[dt.date]:
    raw = args.get(key)
    if raw in (None, ""):
        return None
    try:
        return dt.date.fromisoformat(str(raw)[:10])
    except ValueError as exc:
        raise ValueError(f"{key} 'YYYY-MM-DD' biçiminde olmalı.") from exc


def _int(args: Dict[str, Any], key: str, default: int, low: int, high: int) -> int:
    try:
        return max(low, min(high, int(args.get(key, default))))
    except (TypeError, ValueError):
        return default


def _str(args: Dict[str, Any], key: str) -> Optional[str]:
    value = args.get(key)
    return str(value).strip()[:100] if value not in (None, "") else None


# --- Araç uygulamaları ---

def tool_spending_summary(ctx: ToolContext, args: Dict[str, Any]) -> dict:
    return spending_summary(
        ctx.db,
        ctx.user_id,
        start=_date(args, "start_date"),
        end=_date(args, "end_date"),
        category=_str(args, "category"),
        merchant=_str(args, "merchant"),
    )


def tool_monthly_trend(ctx: ToolContext, args: Dict[str, Any]) -> dict:
    return {"months": monthly_trend(ctx.db, ctx.user_id, _int(args, "months", 6, 1, 24), ctx.today)}


def tool_search_items(ctx: ToolContext, args: Dict[str, Any]) -> dict:
    query = _str(args, "query")
    if not query:
        raise ValueError("query boş olamaz.")
    return search_items(
        ctx.db,
        ctx.user_id,
        query,
        start=_date(args, "start_date"),
        end=_date(args, "end_date"),
        limit=_int(args, "limit", 20, 1, 50),
    )


def tool_recent_receipts(ctx: ToolContext, args: Dict[str, Any]) -> dict:
    return {
        "receipts": list_receipts_brief(
            ctx.db,
            ctx.user_id,
            start=_date(args, "start_date"),
            end=_date(args, "end_date"),
            merchant=_str(args, "merchant"),
            limit=_int(args, "limit", 10, 1, 50),
        )
    }


def tool_subscriptions(ctx: ToolContext, args: Dict[str, Any]) -> dict:
    # Döngüsel import'u önlemek için geç import
    from app.api.subscriptions import load_user_subscriptions
    from app.models.user import User

    user = ctx.db.get(User, ctx.user_id)
    if user is None:
        return {"subscriptions": []}
    wanted_status = _str(args, "status")
    subs = load_user_subscriptions(ctx.db, user)
    items = []
    for sub in subs:
        if wanted_status and sub.status != wanted_status:
            continue
        last = sub.price_changes[0] if sub.price_changes else None
        items.append(
            {
                "name": sub.name,
                "amount": sub.amount,
                "currency": sub.currency,
                "billing_cycle": sub.billing_cycle,
                "monthly_equivalent": monthly_equivalent(sub.amount, sub.billing_cycle),
                "yearly_equivalent": yearly_equivalent(sub.amount, sub.billing_cycle),
                "next_billing_date": sub.next_billing_date,
                "days_until_next": (sub.next_billing_date - ctx.today).days,
                "status": sub.status,
                "category": sub.category,
                "trial_ends_at": sub.trial_ends_at,
                "last_price_change": (
                    {"old": last.old_amount, "new": last.new_amount, "date": last.changed_at} if last else None
                ),
            }
        )
    return {"subscriptions": items, "count": len(items)}


def tool_budget_status(ctx: ToolContext, args: Dict[str, Any]) -> dict:
    rng = parse_month(_str(args, "month"), ctx.today)
    budgets = budget_status(ctx.db, ctx.user_id, rng, ctx.today)
    return {"month": rng.key, "budgets": budgets, "note": None if budgets else "Kullanıcı henüz bütçe tanımlamamış."}


_DATE_PARAM = {"type": "string", "description": "YYYY-MM-DD"}

# name -> (açıklama, JSON şeması, uygulama)
TOOLS: Dict[str, tuple[str, dict, Callable[[ToolContext, Dict[str, Any]], dict]]] = {
    "get_spending_summary": (
        "Tarih aralığındaki fiş harcamalarının toplamını, kategori ve mağaza kırılımını getirir. "
        "category verilirse toplam yalnızca o kategorideki ürünlerin toplamıdır. "
        "Kategoriler: Gıda, Atıştırmalık, İçecek, Temizlik, Kişisel Bakım, Ev & Yaşam, Elektronik, Giyim, "
        "Restoran & Kafe, Ulaşım, Diğer.",
        {
            "type": "object",
            "properties": {
                "start_date": _DATE_PARAM,
                "end_date": _DATE_PARAM,
                "category": {"type": "string", "description": "Ürün kategorisi (opsiyonel)"},
                "merchant": {"type": "string", "description": "Mağaza adında geçen ifade (opsiyonel)"},
            },
        },
        tool_spending_summary,
    ),
    "get_monthly_trend": (
        "Son N ayın aylık toplam fiş harcamasını getirir (karşılaştırma ve trend soruları için).",
        {
            "type": "object",
            "properties": {"months": {"type": "integer", "description": "Kaç ay (1-24), varsayılan 6"}},
        },
        tool_monthly_trend,
    ),
    "search_purchased_items": (
        "Fişlerdeki ürün adlarında arama yapar (Örn: 'kahve', 'süt', 'deterjan') ve eşleşen ürünlerin "
        "toplam tutarını, tarihini ve mağazasını getirir.",
        {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Ürün adında aranacak kelime"},
                "start_date": _DATE_PARAM,
                "end_date": _DATE_PARAM,
                "limit": {"type": "integer", "description": "En fazla kaç satır (varsayılan 20)"},
            },
            "required": ["query"],
        },
        tool_search_items,
    ),
    "list_recent_receipts": (
        "Fişleri en yeniden eskiye listeler (tarih, mağaza, toplam).",
        {
            "type": "object",
            "properties": {
                "start_date": _DATE_PARAM,
                "end_date": _DATE_PARAM,
                "merchant": {"type": "string"},
                "limit": {"type": "integer", "description": "Varsayılan 10"},
            },
        },
        tool_recent_receipts,
    ),
    "get_subscriptions": (
        "Kullanıcının aboneliklerini (ücret, dönem, aylık/yıllık karşılık, sonraki ödeme, zam geçmişi) getirir.",
        {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["active", "trial", "paused", "cancelled"],
                    "description": "Opsiyonel durum filtresi",
                }
            },
        },
        tool_subscriptions,
    ),
    "get_budget_status": (
        "Kullanıcının aylık bütçelerini ve o ay ne kadar harcandığını, kalan tutarı, ay sonu tahminini getirir.",
        {
            "type": "object",
            "properties": {"month": {"type": "string", "description": "YYYY-MM; boşsa bu ay"}},
        },
        tool_budget_status,
    ),
}


def execute_tool(ctx: ToolContext, name: str, args: Optional[Dict[str, Any]]) -> dict:
    entry = TOOLS.get(name)
    if entry is None:
        return {"error": f"Bilinmeyen araç: {name}"}
    try:
        return jsonable(entry[2](ctx, dict(args or {})))
    except ValueError as exc:
        return {"error": str(exc)}
