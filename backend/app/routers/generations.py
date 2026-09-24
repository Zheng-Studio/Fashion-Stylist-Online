"""生成上身图：提交即返回，后台跑，前端轮询进度。"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import tasks
from app.billing import Billing
from app.db import get_db
from app.deps import get_billing, get_current_user, get_image_gen, get_storage
from app.models import Generation, User
from app.providers.image import ImageGen
from app.routers.outfits import get_owned_outfit
from app.serializers import generation_out, user_gen_base
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
    if not outfit.links:
        raise HTTPException(400, "这套搭配没有单品，无法生成。")
    # 能提前判断的失败就别进队列：没照片直接告诉用户
    if not user_gen_base(user):
        raise HTTPException(400, "还没有上传本人照片，无法生成上身图。请先在「我」里上传一张全身照。")
    gen = Generation(user_id=user.id, outfit_id=outfit.id, status="pending",
                     params={"total": len(outfit.links), "done": 0})
    db.add(gen)
    db.commit()
    tasks.submit(run_generation, gen.id, image_gen, storage, billing)
    return generation_out(gen)


@router.get("/{gen_id}")
def read_generation(gen_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    gen = db.get(Generation, gen_id)
    if gen is None or gen.user_id != user.id:
        raise HTTPException(404, "生成记录不存在")
    return generation_out(gen)
