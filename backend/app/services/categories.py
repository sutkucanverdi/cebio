"""Harcama kategorileri: fiş ürünleri ve banka işlemleri aynı listeyi kullanır ki bütçe ve analizler tutarlı olsun."""

# Fiş ürünleri için (receipt_parser SYSTEM_PROMPT ile aynı sıra)
RECEIPT_CATEGORIES = [
    "Gıda",
    "Atıştırmalık",
    "İçecek",
    "Temizlik",
    "Kişisel Bakım",
    "Ev & Yaşam",
    "Elektronik",
    "Giyim",
    "Restoran & Kafe",
    "Ulaşım",
    "Diğer",
]

# Banka/kart işlemlerine özgü ek kategoriler
BANK_ONLY_CATEGORIES = [
    "Fatura & İletişim",
    "Sağlık",
    "Eğlence",
    "Eğitim",
    "Abonelik",
    "Nakit & Transfer",
]

SPENDING_CATEGORIES = RECEIPT_CATEGORIES[:-1] + BANK_ONLY_CATEGORIES + ["Diğer"]


def normalize_category(value: str | None) -> str:
    """Modelin döndürdüğü kategoriyi bilinen listeye oturtur (büyük/küçük harf, Türkçe karakter farkı tolere edilir)."""
    from app.services.subscription_catalog import normalize_text

    wanted = normalize_text(value or "")
    for category in SPENDING_CATEGORIES:
        if normalize_text(category) == wanted:
            return category
    return "Diğer"
