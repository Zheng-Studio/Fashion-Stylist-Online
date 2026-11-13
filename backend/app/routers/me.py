"""当前用户（= 家庭版的「模特」）：资料 + 本人照片（生图底图从这里选）。"""
from fastapi.concurrency import run_in_threadpool
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, get_storage
from app.domain import imaging, profile
from app.models import User
from app.serializers import user_out
from app.services import account
from app.storage import Storage, new_key

router = APIRouter(prefix="/api/me", tags=["me"])

# 本人照片上限（前端 constants.ts 的 MAX_PHOTOS 须一致，页面按 3×3 排）
MAX_PHOTOS = 9


@router.get("")
def read_me(user: User = Depends(get_current_user)):
    return user_out(user)


class MeUpdate(BaseModel):
    name: str | None = None
    gender: str | None = None  # female / male / 空
    age: int | None = None  # null = 未知
    height_cm: int | None = None
    gen_base: str | None = None  # 生图底图，必须是 photos 里的一张
    photos: list[str] | None = None  # 只允许重排


@router.put("")
def update_me(body: MeUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(400, "名字不能为空")
        user.name = name[:64]
    if "gender" in body.model_fields_set:
        if body.gender not in (None, "", "female", "male"):
            raise HTTPException(400, "性别只能是 female 或 male")
        user.gender = body.gender or ""
    if "age" in body.model_fields_set:
        if body.age is not None and not (profile.AGE_RANGE[0] <= body.age <= profile.AGE_RANGE[1]):
            raise HTTPException(400, "年龄需在 10 到 100 之间")
        user.age = body.age
    if "height_cm" in body.model_fields_set:
        if body.height_cm is not None and not (
            profile.HEIGHT_RANGE[0] <= body.height_cm <= profile.HEIGHT_RANGE[1]
        ):
            raise HTTPException(400, "身高需在 120 到 230 厘米之间")
        user.height_cm = body.height_cm
    if body.gen_base is not None:
        if body.gen_base and body.gen_base not in (user.photos or []):
            raise HTTPException(400, "生图底图必须是已上传的照片之一")
        user.gen_base = body.gen_base or None
    if body.photos is not None:
        if sorted(body.photos) != sorted(user.photos or []):
            raise HTTPException(400, "photos 只能是现有照片的重排")
        user.photos = list(body.photos)
    db.commit()
    return user_out(user)


@router.post("/reset")
def reset_me(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
):
    """清空衣橱、搭配、试穿记录和照片，回到新用户（首次体验）状态。"""
    try:
        account.reset_user(db, user, storage)
    except account.GenerationInProgress as e:
        raise HTTPException(409, str(e)) from e
    return user_out(user)


async def _store_upload(file: UploadFile, user: User, kind: str, storage: Storage) -> str:
    raw = await file.read()
    try:
        data = await run_in_threadpool(imaging.normalize_to_jpeg, raw)  # CPU 活，别卡事件循环
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
    # 先查上限再写存储，超了不留孤儿文件。AI 编辑的结果也走这里保存。
    if len(user.photos or []) >= MAX_PHOTOS:
        raise HTTPException(409, f"最多 {MAX_PHOTOS} 张照片，先删除一张再添加")
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
    storage.delete(body.path)
    db.commit()
    return user_out(user)
