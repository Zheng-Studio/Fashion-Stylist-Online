from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_llm
from app.models import User
from app.providers.llm import LLM
from app.services import recommend as recommend_service

router = APIRouter(prefix="/api", tags=["recommend"])

HISTORY_LIMIT = 8  # 只带最近几轮，prompt 不随聊天无限膨胀


class HistoryTurn(BaseModel):
    role: str  # user | assistant
    text: str


class RecommendIn(BaseModel):
    need: str
    history: list[HistoryTurn] = Field(default_factory=list)


@router.post("/recommend")
def recommend(
    body: RecommendIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    llm: LLM = Depends(get_llm),
):
    """需求 → 从本人衣橱选一套。模型出错不抛 HTTP 错误，而是在返回里带 error，前端照常展示过程。"""
    history = [h.model_dump() for h in body.history][-HISTORY_LIMIT:]
    return recommend_service.recommend(db, user, body.need.strip(), history, llm)
