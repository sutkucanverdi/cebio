"""Türkiye'de yaygın dijital abonelikler.

`patterns` ekstre açıklamalarında aranan (normalize edilmiş, büyük harf) ifadelerdir.
Fiyatlar sık değiştiği için katalogda tutulmaz; tutar her zaman kullanıcıdan/ekstreden gelir.
"""
from typing import List, Optional, TypedDict


class CatalogItem(TypedDict):
    key: str
    name: str
    category: str
    default_cycle: str
    patterns: List[str]
    cancel_url: Optional[str]


CATALOG: List[CatalogItem] = [
    {"key": "netflix", "name": "Netflix", "category": "Dizi & Film", "default_cycle": "monthly",
     "patterns": ["NETFLIX"], "cancel_url": "https://www.netflix.com/cancelplan"},
    {"key": "disney", "name": "Disney+", "category": "Dizi & Film", "default_cycle": "monthly",
     "patterns": ["DISNEY PLUS", "DISNEYPLUS", "DISNEY+"], "cancel_url": None},
    {"key": "amazon_prime", "name": "Amazon Prime", "category": "Dizi & Film", "default_cycle": "monthly",
     "patterns": ["AMAZON PRIME", "PRIME VIDEO", "AMZN PRIME"], "cancel_url": None},
    {"key": "hbo_max", "name": "HBO Max", "category": "Dizi & Film", "default_cycle": "monthly",
     "patterns": ["HBO MAX", "HBOMAX", "BLUTV"], "cancel_url": None},
    {"key": "exxen", "name": "Exxen", "category": "Dizi & Film", "default_cycle": "monthly",
     "patterns": ["EXXEN"], "cancel_url": None},
    {"key": "gain", "name": "Gain", "category": "Dizi & Film", "default_cycle": "monthly",
     "patterns": ["GAIN MEDYA", "GAIN.TV", "GAINTV"], "cancel_url": None},
    {"key": "tod", "name": "TOD (beIN)", "category": "Spor", "default_cycle": "monthly",
     "patterns": ["TOD TV", "BEIN CONNECT", "DIGITURK"], "cancel_url": None},
    {"key": "mubi", "name": "MUBI", "category": "Dizi & Film", "default_cycle": "monthly",
     "patterns": ["MUBI"], "cancel_url": None},
    {"key": "spotify", "name": "Spotify", "category": "Müzik", "default_cycle": "monthly",
     "patterns": ["SPOTIFY"], "cancel_url": "https://www.spotify.com/account/subscription/"},
    {"key": "youtube_premium", "name": "YouTube Premium", "category": "Müzik", "default_cycle": "monthly",
     "patterns": ["YOUTUBE PREMIUM", "YOUTUBEPREMIUM", "GOOGLE YOUTUBE", "YOUTUBE MUSIC"],
     "cancel_url": "https://www.youtube.com/paid_memberships"},
    {"key": "apple_music", "name": "Apple Music", "category": "Müzik", "default_cycle": "monthly",
     "patterns": ["APPLE MUSIC"], "cancel_url": None},
    {"key": "fizy", "name": "Fizy", "category": "Müzik", "default_cycle": "monthly",
     "patterns": ["FIZY"], "cancel_url": None},
    {"key": "icloud", "name": "iCloud+", "category": "Bulut Depolama", "default_cycle": "monthly",
     "patterns": ["ICLOUD", "APPLE.COM/BILL", "APPLE COM BILL"], "cancel_url": None},
    {"key": "google_one", "name": "Google One", "category": "Bulut Depolama", "default_cycle": "monthly",
     "patterns": ["GOOGLE ONE", "GOOGLE STORAGE"], "cancel_url": "https://one.google.com/settings"},
    {"key": "microsoft_365", "name": "Microsoft 365", "category": "Yazılım", "default_cycle": "yearly",
     "patterns": ["MICROSOFT 365", "MICROSOFT*365", "MSFT 365", "OFFICE 365"], "cancel_url": None},
    {"key": "adobe", "name": "Adobe Creative Cloud", "category": "Yazılım", "default_cycle": "monthly",
     "patterns": ["ADOBE"], "cancel_url": None},
    {"key": "chatgpt", "name": "ChatGPT Plus", "category": "Yazılım", "default_cycle": "monthly",
     "patterns": ["OPENAI", "CHATGPT"], "cancel_url": None},
    {"key": "claude", "name": "Claude Pro", "category": "Yazılım", "default_cycle": "monthly",
     "patterns": ["ANTHROPIC", "CLAUDE.AI"], "cancel_url": None},
    {"key": "xbox", "name": "Xbox Game Pass", "category": "Oyun", "default_cycle": "monthly",
     "patterns": ["XBOX", "GAME PASS"], "cancel_url": None},
    {"key": "playstation", "name": "PlayStation Plus", "category": "Oyun", "default_cycle": "monthly",
     "patterns": ["PLAYSTATION", "PSN", "SONY INTERACTIVE"], "cancel_url": None},
    {"key": "linkedin", "name": "LinkedIn Premium", "category": "Yazılım", "default_cycle": "monthly",
     "patterns": ["LINKEDIN"], "cancel_url": None},
    {"key": "duolingo", "name": "Duolingo Super", "category": "Eğitim", "default_cycle": "yearly",
     "patterns": ["DUOLINGO"], "cancel_url": None},
    {"key": "storytel", "name": "Storytel", "category": "Kitap", "default_cycle": "monthly",
     "patterns": ["STORYTEL"], "cancel_url": None},
]

CATEGORIES = [
    "Dizi & Film",
    "Müzik",
    "Spor",
    "Bulut Depolama",
    "Yazılım",
    "Oyun",
    "Eğitim",
    "Kitap",
    "Spor Salonu",
    "Fatura & İletişim",
    "Diğer",
]


_TR_ASCII = str.maketrans({
    "İ": "I", "ı": "I", "i": "I", "Ş": "S", "ş": "S", "Ğ": "G", "ğ": "G",
    "Ü": "U", "ü": "U", "Ö": "O", "ö": "O", "Ç": "C", "ç": "C",
})


def normalize_text(text: str) -> str:
    """Ekstre açıklamasını karşılaştırılabilir hale getirir: büyük harf, ASCII, tek boşluk.

    Örn: 'Netflix.com İstanbul*TR' -> 'NETFLIX COM ISTANBUL TR'
    """
    upper = (text or "").translate(_TR_ASCII).upper()
    cleaned = "".join(ch if ch.isalnum() or ch == "+" else " " for ch in upper)
    return " ".join(cleaned.split())


_NORMALIZED_PATTERNS = [
    (item, [normalize_text(p) for p in item["patterns"]]) for item in CATALOG
]


def match_catalog(description: str) -> Optional[CatalogItem]:
    """Açıklamada katalogdaki bir servisin adı geçiyorsa (kelime sınırına dikkat ederek) onu döner."""
    padded = f" {normalize_text(description)} "
    for item, patterns in _NORMALIZED_PATTERNS:
        if any(f" {pattern} " in padded for pattern in patterns):
            return item
    return None
