import datetime as dt
import logging
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, List, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.models.user import User
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


class RateLimiter:
    """Kullanıcı başına kayan pencereli basit istek limiti (tek süreç için, bellek içi).

    Birden fazla sunucu örneğine geçildiğinde Redis tabanlı bir limitleyiciyle değiştirilmeli.
    """

    def __init__(self, max_requests: int, window_seconds: int) -> None:
        self.max_requests = max_requests
        self.window = window_seconds
        self._hits: Dict[int, Deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()

    def allow(self, key: int) -> bool:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= self.max_requests:
                return False
            hits.append(now)
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


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

    ctx = ToolContext(db=db, user_id=current_user.id, today=today())
    history = [ChatTurn(role=m.role, content=m.content.strip()) for m in payload.messages]

    try:
        result = await assistant_service.chat(ctx, history)
    except ReceiptParseError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("Asistan hatası (user_id=%s)", current_user.id)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Asistana şu anda ulaşılamıyor. Lütfen biraz sonra tekrar deneyin.",
        ) from exc

    return ChatResponse(reply=result.reply, tools_used=result.tools_used)
