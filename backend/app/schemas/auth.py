from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


def _check_bcrypt_limit(value: str) -> str:
    # bcrypt en fazla 72 bayt kabul eder; Türkçe karakterler UTF-8'de 2 bayt tutar.
    if len(value.encode("utf-8")) > 72:
        raise ValueError("Şifre çok uzun (en fazla 72 bayt).")
    return value


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str = Field(..., pattern=r"^[0-9]{6}$", description="E-postayla gelen 6 haneli kod")
    new_password: str = Field(..., min_length=8, max_length=72)

    @field_validator("new_password")
    @classmethod
    def _bcrypt_byte_limit(cls, value: str) -> str:
        return _check_bcrypt_limit(value)


class MessageResponse(BaseModel):
    message: str


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=72, description="En az 8 karakter")
    full_name: Optional[str] = Field(default=None, max_length=255)
    accept_terms: Literal[True] = Field(
        ...,
        description="Kullanım koşulları ve gizlilik politikasını (KVKK aydınlatma metni) okuduğunun onayı (zorunlu)",
    )
    ai_consent: bool = Field(
        default=False,
        description="Fiş/ekstre/soruların yapay zeka servisine (Google Gemini, yurt dışı) aktarılmasına açık rıza. "
        "İsteğe bağlıdır; verilmezse yapay zeka özellikleri kapalı kalır.",
    )
    locale: Literal["tr", "en"] = "tr"

    @field_validator("password")
    @classmethod
    def _bcrypt_byte_limit(cls, value: str) -> str:
        return _check_bcrypt_limit(value)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=72)


class UserResponse(BaseModel):
    id: int
    email: EmailStr
    full_name: Optional[str] = None
    created_at: datetime
    terms_version: Optional[str] = None
    ai_consent_at: Optional[datetime] = None
    locale: str = "tr"

    model_config = ConfigDict(from_attributes=True)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class PreferencesUpdate(BaseModel):
    """Ayarlar: dil, yapay zeka açık rızası (verme / geri alma) ve ad soyad."""

    locale: Optional[Literal["tr", "en"]] = None
    ai_consent: Optional[bool] = None
    full_name: Optional[str] = Field(default=None, max_length=255)
