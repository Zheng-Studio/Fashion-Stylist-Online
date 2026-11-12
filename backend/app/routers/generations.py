"""生成上身图：提交即返回，后台跑，前端轮询进度。"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import tasks
from app.billing import Billing
from app.db import get_db
from app.deps import get_billing, get_current_user, get_image_gen, get_storage
from app.models import Generation, Outfit, User
from app.providers.image import ImageGen
from app.routers.outfits import get_owned_outfit
from app.serializers import generation_out, outfit_out, user_gen_base
from app.services.generation import run_generation
from app.storage import Storage

router = APIRouter(prefix="/api/generations", tags=["generations"])


class GenerationIn(BaseModel):
    outfit_id: str


@router.post("")
def create_generation(
    body: GenerationIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    image_gen: ImageGen = Depends(get_image_gen),
    storage: Storage = Depends(get_storage),
    billing: Billing = Depends(get_billing),
):
    outfit = get_owned_outfit(db, user, body.outfit_id)
    if not outfit.links and not (outfit.example_item_ids or []):
        raise HTTPException(400, "这套搭配没有单品，无法生成。")
    # 能提前判断的失败就别进队列：没照片直接告诉用户
    if not user_gen_base(user):
        raise HTTPException(400, "还没有上传本人照片，无法生成上身图。请先在「我」里上传一张全身照。")
    gen = Generation(user_id=user.id, outfit_id=outfit.id, status="pending",
                     params={"total": len(outfit.links) + len(outfit.example_item_ids or []), "done": 0,
                             "base": user_gen_base(user)})
    db.add(gen)
    db.commit()
    tasks.submit(run_generation, gen.id, image_gen, storage, billing)
    return generation_out(gen)


@router.get("")
def list_generations(
    offset: int = Query(0, ge=0),
    limit: int = Query(24, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(Generation, Outfit)
        .join(Outfit, Generation.outfit_id == Outfit.id)
        .where(Generation.user_id == user.id, Outfit.user_id == user.id,
               Generation.status == "done", Generation.result_path.is_not(None))
        .order_by(Generation.created_at.desc(), Generation.id.desc())
        .offset(offset).limit(limit + 1)
    ).all()
    return {
        "items": [{**generation_out(gen), "outfit": outfit_out(outfit)} for gen, outfit in rows[:limit]],
        "has_more": len(rows) > limit,
    }


@router.get("/{gen_id}")
def read_generation(gen_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    gen = db.get(Generation, gen_id)
    if gen is None or gen.user_id != user.id:
        raise HTTPException(404, "生成记录不存在")
    return generation_out(gen)
