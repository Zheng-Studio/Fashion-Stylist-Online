"""当前用户（= 家庭版的「模特」）：资料 + 本人照片（生图底图从这里选）。"""
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_storage
from app.domain import imaging
from app.domain.tagging import normalize_gender
from app.models import User
from app.serializers import user_out
from app.storage import Storage, new_key

router = APIRouter(prefix="/api/me", tags=["me"])


@router.get("")
def read_me(user: User = Depends(get_current_user)):
    return user_out(user)


class MeUpdate(BaseModel):
    name: str | None = None
    gender: str | None = None
    avatar: str | None = None
    gen_base: str | None = None  # 生图底图，必须是 photos 里的一张
    photos: list[str] | None = None  # 只允许重排


@router.put("")
def update_me(body: MeUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(400, "名字不能为空")
        user.name = name[:64]
    if body.gender is not None:
        user.gender = normalize_gender(body.gender)
    if body.gen_base is not None:
        if body.gen_base and body.gen_base not in (user.photos or []):
            raise HTTPException(400, "生图底图必须是已上传的照片之一")
        user.gen_base = body.gen_base or None
    if body.avatar is not None:
        if body.avatar and body.avatar not in (user.photos or []) and body.avatar != user.avatar:
            raise HTTPException(400, "头像必须是已上传的图片")
        user.avatar = body.avatar or None
    if body.photos is not None:
        if sorted(body.photos) != sorted(user.photos or []):
            raise HTTPException(400, "photos 只能是现有照片的重排")
        user.photos = list(body.photos)
    db.commit()
    return user_out(user)


async def _store_upload(file: UploadFile, user: User, kind: str, storage: Storage) -> str:
    try:
        data = imaging.normalize_to_jpeg(await file.read())
    except ValueError as e:
        raise HTTPException(400, f"图片解析失败：{e}")
    key = new_key(user.id, kind)
    storage.put(key, data)
    return key


@router.post("/photos")
async def upload_photo(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
):
    key = await _store_upload(file, user, "photos", storage)
    user.photos = [*(user.photos or []), key]  # 整体赋值，JSON 列才会被识别为已修改
    db.commit()
    return user_out(user)


class PhotoDelete(BaseModel):
    path: str


@router.delete("/photos")
def delete_photo(
    body: PhotoDelete,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
):
    if body.path not in (user.photos or []):
        raise HTTPException(404, "照片不存在")
    user.photos = [p for p in user.photos if p != body.path]
    if user.gen_base == body.path:
        user.gen_base = None  # 回落到剩下的第一张
    if user.avatar != body.path:
        storage.delete(body.path)  # 还被当头像用着就先留着文件
    db.commit()
    return user_out(user)


@router.post("/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
):
    """上传裁好的头像（独立于 photos）。旧头像若不在 photos 里就删掉文件。"""
    key = await _store_upload(file, user, "avatars", storage)
    old = user.avatar
    user.avatar = key
    db.commit()
    if old and old not in (user.photos or []):
        storage.delete(old)
    return user_out(user)
