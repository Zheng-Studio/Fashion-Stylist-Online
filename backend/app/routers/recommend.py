from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_llm
from app.domain import structure
from app.models import Item, User
from app.providers.llm import LLM
from app.services import recommend as recommend_service

router = APIRouter(prefix="/api", tags=["recommend"])

HISTORY_LIMIT = 8  # 只带最近几轮，prompt 不随聊天无限膨胀


def _wardrobe_categories(db: Session, user: User) -> list[str]:
    return list(db.scalars(select(Item.category).where(Item.user_id == user.id)))


@router.get("/recommend/readiness")
def recommend_readiness(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """衣橱能搭出几套、够不够开始 AI 搭配（标准见 structure.MIN_OUTFITS）。对话页和衣橱页据此显示引导。"""
    categories = _wardrobe_categories(db, user)
    return {**structure.wardrobe_readiness(categories), "item_count": len(categories)}


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
    """需求 → 从本人衣橱选一套。模型出错不抛 HTTP 错误，而是在返回里带 error，前端照常展示过程。

    衣橱没达到开始标准（和引导同一条线）时直接 409，不调模型。提示语不讲门槛细节，只让用户多加单品。
    """
    if not structure.wardrobe_readiness(_wardrobe_categories(db, user))["ready"]:
        raise HTTPException(409, "衣橱里的单品还不够，再添加一些就能开始 AI 搭配")
    history = [h.model_dump() for h in body.history][-HISTORY_LIMIT:]
    return recommend_service.recommend(db, user, body.need.strip(), history, llm)
