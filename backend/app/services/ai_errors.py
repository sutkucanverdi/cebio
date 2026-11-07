"""Yapay zeka servisinden (Gemini) gelen hataları kullanıcıya anlamlı mesajlara çevirir."""
from fastapi import HTTPException, status
from google.genai import errors as genai_errors

QUOTA_MESSAGE = (
    "Yapay zeka servisinin kullanım limiti doldu. Lütfen daha sonra tekrar deneyin."
)


def is_quota_error(exc: BaseException) -> bool:
    """Gemini 429 RESOURCE_EXHAUSTED (günlük/dakikalık kota doldu) hatası mı?"""
    return isinstance(exc, genai_errors.APIError) and getattr(exc, "code", None) == 429


def quota_exceeded() -> HTTPException:
    return HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=QUOTA_MESSAGE)
