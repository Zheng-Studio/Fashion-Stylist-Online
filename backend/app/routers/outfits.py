"""搭配：试穿过的一套单品（点「生成上身图」时落库）。"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_storage
from app.models import Generation, Item, Outfit, OutfitItem, User
from app.serializers import outfit_out
from app.storage import Storage

router = APIRouter(prefix="/api/outfits", tags=["outfits"])


class OutfitIn(BaseModel):
    item_ids: list[str]
    note: str = ""


def get_owned_outfit(db: Session, user: User, outfit_id: str) -> Outfit:
    outfit = db.get(Outfit, outfit_id)
    if outfit is None or outfit.user_id != user.id:
        raise HTTPException(404, "搭配不存在")
    return outfit


@router.post("")
def create_outfit(body: OutfitIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not body.item_ids:
        raise HTTPException(400, "至少需要一件单品")
    owned = set(db.scalars(select(Item.id).where(Item.user_id == user.id, Item.id.in_(body.item_ids))))
    if owned != set(body.item_ids):
        raise HTTPException(400, "搭配里有单品已不存在，请刷新后重试")
    outfit = Outfit(user_id=user.id, note=body.note)
    outfit.links = [OutfitItem(item_id=i, sort_order=n) for n, i in enumerate(body.item_ids)]
    db.add(outfit)
    db.commit()
    return outfit_out(outfit)


@router.get("")
def list_outfits(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    q = select(Outfit).where(Outfit.user_id == user.id).order_by(Outfit.created_at.desc())
    return [outfit_out(o) for o in db.scalars(q)]


@router.get("/{outfit_id}")
def read_outfit(outfit_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    outfit = get_owned_outfit(db, user, outfit_id)
    gens = db.scalars(
        select(Generation).where(Generation.outfit_id == outfit.id).order_by(Generation.created_at.desc())
    ).all()
    return outfit_out(outfit, gens)


@router.delete("/{outfit_id}")
def delete_outfit(
    outfit_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
):
    outfit = get_owned_outfit(db, user, outfit_id)
    # 结果图路径要在删行之前取——generation 行会被级联删掉
    paths = [p for p in db.scalars(select(Generation.result_path).where(Generation.outfit_id == outfit.id)) if p]
    db.delete(outfit)
    db.commit()
    for p in paths:
        storage.delete(p)
    return {"deleted": outfit_id}
