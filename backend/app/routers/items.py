"""单品：增删改查 + 图片上传 + 自动打标。所有单品都属于当前用户。"""
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_llm, get_storage
from app.domain import imaging
from app.domain.tagging import normalize_gender
from app.domain.taxonomy import CATEGORIES
from app.models import Item, User
from app.providers.errors import ProviderError
from app.providers.llm import LLM
from app.serializers import item_out
from app.services import tagging
from app.storage import Storage, new_key, owned_by

router = APIRouter(prefix="/api/items", tags=["items"])


class ImageIn(BaseModel):
    id: str
    kind: str  # upload | normalized | edited
    path: str  # 存储 key
    prompt: str | None = None  # 编辑图所用指令
    source_id: str | None = None  # 由哪张图派生


class ItemIn(BaseModel):
    name: str = ""
    gender: str = ""
    category: str
    color: list[str] = Field(default_factory=list)
    season: list[str] = Field(default_factory=list)
    description: str = ""
    is_in_wishlist: bool = False
    images: list[ImageIn] = Field(default_factory=list)
    primary_image_id: str | None = None


def _get_owned(db: Session, user: User, item_id: str) -> Item:
    item = db.get(Item, item_id)
    if item is None or item.user_id != user.id:
        raise HTTPException(404, "单品不存在")
    return item


def _apply(item: Item, body: ItemIn, user: User, storage: Storage) -> None:
    """校验并写入字段。图库每张图都必须是本人名下、已存在的文件。"""
    if body.category not in CATEGORIES:
        raise HTTPException(400, f"category 必须是 {'/'.join(CATEGORIES)} 之一")
    if not body.images:
        raise HTTPException(400, "至少需要一张图片")
    images, ids = [], set()
    for im in body.images:
        if not owned_by(im.path, user.id) or not storage.exists(im.path):
            raise HTTPException(400, f"图片不存在：{im.path}")
        ids.add(im.id)
        images.append(im.model_dump(exclude_none=True))
    item.name = body.name.strip()[:64]
    item.gender = normalize_gender(body.gender)
    item.category = body.category
    item.color = body.color[:3]
    item.season = body.season
    item.description = body.description
    item.is_in_wishlist = body.is_in_wishlist
    item.images = images
    # 主图 id 缺失/非法则回落最近一张
    item.primary_image_id = body.primary_image_id if body.primary_image_id in ids else images[-1]["id"]


@router.get("")
def list_items(
    is_in_wishlist: bool | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = select(Item).where(Item.user_id == user.id)
    if is_in_wishlist is not None:
        q = q.where(Item.is_in_wishlist.is_(is_in_wishlist))
    return [item_out(it) for it in db.scalars(q.order_by(Item.created_at.desc(), Item.id))]


@router.post("")
def create_item(
    body: ItemIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
):
    item = Item(user_id=user.id)
    _apply(item, body, user, storage)
    db.add(item)
    db.commit()
    return item_out(item)


@router.put("/{item_id}")
def update_item(
    item_id: str,
    body: ItemIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
):
    item = _get_owned(db, user, item_id)
    old_paths = {im["path"] for im in item.images or []}
    _apply(item, body, user, storage)
    db.commit()
    # 图库里被移除的图，文件一并清掉
    for p in old_paths - {im["path"] for im in item.images}:
        storage.delete(p)
    return item_out(item)


@router.delete("/{item_id}")
def delete_item(
    item_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
):
    item = _get_owned(db, user, item_id)
    paths = [im["path"] for im in item.images or []]
    db.delete(item)  # 搭配里的关联行由 ON DELETE CASCADE 清掉
    db.commit()
    for p in paths:
        storage.delete(p)
    return {"deleted": item_id}


@router.post("/upload")
async def upload_image(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    storage: Storage = Depends(get_storage),
):
    """单品图落存储（统一转 JPEG），返回 key。表单保存时才调，先攒在前端。"""
    try:
        data = imaging.normalize_to_jpeg(await file.read())
    except ValueError as e:
        raise HTTPException(400, f"图片解析失败：{e}")
    key = new_key(user.id, "items")
    storage.put(key, data)
    return {"path": key}


@router.post("/auto-tag")
async def auto_tag(
    file: UploadFile = File(...),
    _user: User = Depends(get_current_user),
    llm: LLM = Depends(get_llm),
):
    """传图（不落盘）→ 视觉模型识别 → 返回结构化字段预填表单。不收费。"""
    raw = await file.read()
    try:
        return tagging.auto_tag(raw, llm)
    except ProviderError as e:
        raise HTTPException(503, str(e))
    except tagging.TagError as e:
        raise HTTPException(422, str(e))
