import datetime as dt
import logging
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.i18n import get_locale, translate
from app.models.ai_report import AIReport
from app.core.rate_limit import RateLimiter
from app.models.user import User
from app.services.billing import ensure_quota, record_usage
from app.services.ai_errors import is_quota_error, quota_exceeded
from app.services.assistant import ChatTurn, assistant_service
from app.services.assistant_tools import ToolContext
from app.services.receipt_parser import ReceiptParseError

logger = logging.getLogger("cebio")

router = APIRouter(prefix="/api/v1/assistant", tags=["Assistant"])

MAX_MESSAGES = 20
MAX_MESSAGE_CHARS = 2000


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=MAX_MESSAGE_CHARS)


class ChatRequest(BaseModel):
    messages: List[ChatMessage] = Field(..., min_length=1, max_length=MAX_MESSAGES)

    @field_validator("messages")
    @classmethod
    def _last_is_user(cls, value: List[ChatMessage]) -> List[ChatMessage]:
        if value[-1].role != "user":
            raise ValueError("Son mesaj kullanıcıdan gelmeli.")
        return value


class ChatResponse(BaseModel):
    reply: str
    tools_used: List[str]


class AIReportRequest(BaseModel):
    reason: Literal["offensive", "wrong", "harmful", "other"]
    content: str = Field(..., min_length=1, max_length=4000, description="Bildirilen yapay zeka cevabı")
    note: Optional[str] = Field(default=None, max_length=500)


class MessageOut(BaseModel):
    message: str


report_limiter = RateLimiter(20, 3600)

rate_limiter = RateLimiter(settings.ASSISTANT_RATE_LIMIT, settings.ASSISTANT_RATE_WINDOW_SECONDS)


def today() -> dt.date:
    return dt.date.today()


@router.post("/chat", response_model=ChatResponse, summary="Harcama asistanına soru sor")
async def chat(
    payload: ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ChatResponse:
    if not rate_limiter.allow(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Çok fazla soru sordunuz. Lütfen birkaç dakika sonra tekrar deneyin.",
        )

    ensure_quota(db, current_user, "assistant")

    ctx = ToolContext(db=db, user_id=current_user.id, today=today())
    history = [ChatTurn(role=m.role, content=m.content.strip()) for m in payload.messages]

    try:
        # Cevap dili: arayüzün o anki dili (Accept-Language); yoksa hesabın kayıtlı dili
        result = await assistant_service.chat(ctx, history, locale=get_locale())
    except ReceiptParseError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        if is_quota_error(exc):
            logger.warning("Gemini kotası doldu (user_id=%s)", current_user.id)
            raise quota_exceeded() from exc
        logger.exception("Asistan hatası (user_id=%s)", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Asistana şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.",
        ) from exc

    record_usage(db, current_user, "assistant")
    return ChatResponse(reply=result.reply, tools_used=result.tools_used)


@router.post(
    "/report",
    response_model=MessageOut,
    status_code=status.HTTP_201_CREATED,
    summary="Uygunsuz veya hatalı yapay zeka cevabını bildir",
    description="Google Play Yapay Zeka İçeriği politikası gereği uygulama içinden bildirim.",
)
def report_reply(
    payload: AIReportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> MessageOut:
    if not report_limiter.allow(current_user.id):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Çok fazla bildirim gönderdiniz. Lütfen daha sonra tekrar deneyin.",
        )
    db.add(
        AIReport(
            user_id=current_user.id,
            feature="assistant",
            reason=payload.reason,
            content=payload.content.strip(),
            note=(payload.note or "").strip() or None,
        )
    )
    db.commit()
    logger.warning("Yapay zeka cevabı bildirildi (user_id=%s, sebep=%s)", current_user.id, payload.reason)
    return MessageOut(message=translate("Geri bildiriminiz alındı. Teşekkürler!"))
