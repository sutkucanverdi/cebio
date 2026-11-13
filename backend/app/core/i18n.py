"""Basit çok dillilik (tr / en).

- İstek dili `Accept-Language` başlığından okunur (middleware -> contextvar).
- Kod tabanındaki kullanıcıya dönük mesajlar Türkçe yazılır; İngilizce istenirse `translate()`
  bu sözlükten (sabit metinler) veya kalıplardan (sayı/isim içeren metinler) çevirir.
- Böylece her `HTTPException` tek tek elden geçirilmeden, merkezi bir exception handler ile çevrilir.
"""
import re
from contextvars import ContextVar
from typing import Callable, Dict, List, Literal, Optional, Tuple

Locale = Literal["tr", "en"]
SUPPORTED: Tuple[Locale, ...] = ("tr", "en")
DEFAULT_LOCALE: Locale = "tr"

_current: ContextVar[Locale] = ContextVar("cebio_locale", default=DEFAULT_LOCALE)


def parse_accept_language(header: Optional[str]) -> Locale:
    """'en-US,en;q=0.9,tr;q=0.8' -> 'en'. Desteklenmeyen dillerde varsayılan Türkçe."""
    if not header:
        return DEFAULT_LOCALE
    best: Tuple[float, Optional[Locale]] = (-1.0, None)
    for part in header.split(","):
        pieces = part.strip().split(";")
        lang = pieces[0].strip().lower().split("-")[0]
        q = 1.0
        for p in pieces[1:]:
            if p.strip().startswith("q="):
                try:
                    q = float(p.strip()[2:])
                except ValueError:
                    q = 0.0
        if lang in SUPPORTED and q > best[0]:
            best = (q, lang)  # type: ignore[assignment]
    return best[1] or DEFAULT_LOCALE


def set_locale(locale: Locale) -> None:
    _current.set(locale)


def get_locale() -> Locale:
    return _current.get()


def normalize_locale(value: Optional[str]) -> Locale:
    value = (value or "").lower()[:2]
    return value if value in SUPPORTED else DEFAULT_LOCALE  # type: ignore[return-value]


# --- Sabit mesajlar (Türkçe -> İngilizce) ---
EN: Dict[str, str] = {
    # auth
    "E-posta veya şifre hatalı.": "Incorrect email or password.",
    "Bu e-posta adresiyle kayıtlı bir hesap zaten var.": "An account with this email address already exists.",
    "Bu e-posta adresi kayıtlıysa sıfırlama kodu gönderildi.": "If this email is registered, a reset code has been sent.",
    "Kod hatalı veya süresi dolmuş.": "The code is wrong or has expired.",
    "Şifreniz değiştirildi. Yeni şifrenizle giriş yapabilirsiniz.": "Your password has been changed. You can sign in with your new password.",
    "Oturum geçersiz veya süresi dolmuş. Lütfen tekrar giriş yapın.": "Your session is invalid or has expired. Please sign in again.",
    "Şifre çok uzun (en fazla 72 bayt).": "Password is too long (max 72 bytes).",
    # yapay zeka / asistan
    "Çok fazla soru sordunuz. Lütfen birkaç dakika sonra tekrar deneyin.": "You've asked too many questions. Please try again in a few minutes.",
    "Asistana şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.": "The assistant is unavailable right now. Please try again shortly.",
    "Asistan şu anda yapılandırılmamış. Lütfen daha sonra tekrar deneyin.": "The assistant is not configured yet. Please try again later.",
    "Son mesaj kullanıcıdan gelmeli.": "The last message must come from the user.",
    "Yapay zeka servisinin kullanım limiti doldu. Lütfen daha sonra tekrar deneyin.": "The AI service usage limit has been reached. Please try again later.",
    "Yapay zeka özelliklerini kullanmak için önce verilerinin yapay zeka servisine (Google Gemini) aktarılmasına izin vermelisin.":
        "To use AI features, you first need to allow your data to be sent to the AI service (Google Gemini).",
    "Geri bildiriminiz alındı. Teşekkürler!": "Thanks, your feedback has been received!",
    "Çok fazla bildirim gönderdiniz. Lütfen daha sonra tekrar deneyin.": "You've sent too many reports. Please try again later.",
    # fiş
    "Desteklenmeyen dosya formatı. Lütfen JPEG (.jpg/.jpeg), PNG (.png) veya WEBP (.webp) yükleyin.":
        "Unsupported file format. Please upload a JPEG (.jpg/.jpeg), PNG (.png) or WEBP (.webp) image.",
    "Yüklenen dosya boş.": "The uploaded file is empty.",
    "Fiş analiz servisine şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.": "The receipt analysis service is unavailable right now. Please try again shortly.",
    "Fiş analiz servisi yapılandırılmamış. Lütfen daha sonra tekrar deneyin.": "The receipt analysis service is not configured. Please try again later.",
    "Fiş okunamadı. Lütfen daha net bir fotoğrafla tekrar deneyin.": "The receipt couldn't be read. Please try again with a clearer photo.",
    "Fiş bulunamadı.": "Receipt not found.",
    # ekstre / banka
    "Desteklenmeyen dosya. Lütfen ekstreyi PDF, CSV veya ekran görüntüsü olarak yükleyin.":
        "Unsupported file. Please upload the statement as a PDF, CSV or screenshot.",
    "Ekstre analiz servisine şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.": "The statement analysis service is unavailable right now. Please try again shortly.",
    "Ekstre analiz servisi yapılandırılmamış. Lütfen daha sonra tekrar deneyin.": "The statement analysis service is not configured. Please try again later.",
    "Ekstre okunamadı. Lütfen dosyayı kontrol edip tekrar deneyin.": "The statement couldn't be read. Please check the file and try again.",
    "Ekstre bulunamadı.": "Statement not found.",
    "İşlem bulunamadı.": "Transaction not found.",
    # abonelik / bütçe / analiz
    "Abonelik bulunamadı.": "Subscription not found.",
    "Bütçe bulunamadı.": "Budget not found.",
    "En fazla 30 bütçe ekleyebilirsiniz.": "You can add at most 30 budgets.",
    "Para birimi 3 harfli olmalı (Örn: TRY).": "Currency must be a 3-letter code (e.g. TRY).",
    "Para birimi 3 harfli olmalı (Örn: TRY, USD).": "Currency must be a 3-letter code (e.g. TRY, USD).",
    "İptal linki http:// veya https:// ile başlamalı.": "The cancel link must start with http:// or https://.",
    "Ay 'YYYY-AA' biçiminde olmalı (Örn: 2026-11).": "Month must be in 'YYYY-MM' format (e.g. 2026-11).",
    "Fiyat geçmişi için en az bir ürün adı girin.": "Enter a product name to see its price history.",
    # webhook
    "Webhook yapılandırılmamış.": "Webhook is not configured.",
    "Yetkisiz.": "Unauthorized.",
    "Geçersiz JSON.": "Invalid JSON.",
    "event alanı eksik.": "Missing event field.",
}

# --- Değişken içeren mesajlar: (Türkçe kalıp, İngilizce şablon) ---
_PATTERNS: List[Tuple[re.Pattern, Callable[[re.Match], str]]] = [
    (
        re.compile(r"^Dosya çok büyük\. En fazla (\d+) MB yükleyebilirsiniz\.$"),
        lambda m: f"The file is too large. You can upload at most {m.group(1)} MB.",
    ),
    (
        re.compile(r"^ID=(\d+) olan fiş bulunamadı\.$"),
        lambda m: f"Receipt #{m.group(1)} was not found.",
    ),
    (
        re.compile(r"^(.+) için zaten bir bütçe var\. Mevcut bütçeyi düzenleyin\.$"),
        lambda m: f"A budget for {_budget_subject_en(m.group(1))} already exists. Edit the existing budget instead.",
    ),
    (
        re.compile(r"^Bu ayki (.+) limitinize \((\d+)\) ulaştınız\. Limit her ayın başında yenilenir\.$"),
        lambda m: f"You've reached this month's {_feature_en(m.group(1))} limit ({m.group(2)}). It resets at the start of each month.",
    ),
    (
        re.compile(
            r"^Ücretsiz planda ayda (\d+) (.+) hakkınız var ve bu ay hepsini kullandınız\. "
            r"Premium'a geçerek limitinizi artırabilir ya da gelecek ayı bekleyebilirsiniz\.$"
        ),
        lambda m: (
            f"The free plan includes {m.group(1)} {_feature_en(m.group(2))}s per month and you've used them all. "
            "Upgrade to Premium for a higher limit or wait until next month."
        ),
    ),
]

_FEATURES_EN = {"fiş tarama": "receipt scan", "ekstre analizi": "statement analysis", "asistan sorusu": "assistant question"}

CATEGORY_EN: Dict[str, str] = {
    "Gıda": "Groceries",
    "Atıştırmalık": "Snacks",
    "İçecek": "Beverages",
    "Temizlik": "Cleaning",
    "Kişisel Bakım": "Personal Care",
    "Ev & Yaşam": "Home & Living",
    "Elektronik": "Electronics",
    "Giyim": "Clothing",
    "Restoran & Kafe": "Restaurants & Cafes",
    "Ulaşım": "Transport",
    "Fatura & İletişim": "Bills & Telecom",
    "Sağlık": "Health",
    "Eğlence": "Entertainment",
    "Eğitim": "Education",
    "Abonelik": "Subscriptions",
    "Nakit & Transfer": "Cash & Transfers",
    "Diğer": "Other",
    "Genel": "Overall",
    "Genel bütçe": "Overall budget",
}


def _feature_en(label: str) -> str:
    return _FEATURES_EN.get(label, label)


def _category_en(name: str) -> str:
    return CATEGORY_EN.get(name, name)


def _budget_subject_en(subject: str) -> str:
    """'"Gıda" kategorisi' -> 'the "Groceries" category', 'Genel harcama' -> 'overall spending'."""
    match = re.match(r'^"(.+)" kategorisi$', subject)
    if match:
        return f'the "{_category_en(match.group(1))}" category'
    return "overall spending" if subject == "Genel harcama" else subject


def category_label(name: str, locale: Optional[Locale] = None) -> str:
    return _category_en(name) if (locale or get_locale()) == "en" else name


def translate(message: str, locale: Optional[Locale] = None) -> str:
    """Türkçe kullanıcı mesajını istenen dile çevirir; bilinmeyen mesaj olduğu gibi döner."""
    if (locale or get_locale()) != "en" or not isinstance(message, str):
        return message
    if message in EN:
        return EN[message]
    for pattern, render in _PATTERNS:
        match = pattern.match(message)
        if match:
            return render(match)
    return message
