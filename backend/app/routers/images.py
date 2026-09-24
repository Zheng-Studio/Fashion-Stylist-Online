"""图片工具：白底标准照 / AI 编辑（收费）、旋转。

生成类接口是纯图像变换：直接收源图字节、返回结果图字节，不碰 DB、不落存储——
前端握着结果当待提交项，保存单品（或确认用作本人照片）时才上传。
"""
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import billing as billing_mod
from app.billing import Billing
from app.db import get_db
from app.deps import get_billing, get_current_user, get_image_gen, get_storage
from app.domain import dressing, imaging
from app.models import User
from app.providers.errors import ProviderError
from app.providers.image import ImageGen
from app.storage import Storage, new_key, owned_by

router = APIRouter(prefix="/api/images", tags=["images"])


@router.post("/generate")
async def generate_image(
    source: UploadFile = File(...),
    kind: str = Form(...),  # normalized | edited
    prompt: str | None = Form(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    image_gen: ImageGen = Depends(get_image_gen),
    billing: Billing = Depends(get_billing),
):
    try:
        src = imaging.normalize_to_jpeg(await source.read())
    except ValueError as e:
        raise HTTPException(400, f"源图解析失败：{e}")
    if kind == "normalized":
        text, action = dressing.NORMALIZE_PROMPT, billing_mod.IMAGE_NORMALIZE
    elif kind == "edited":
        text, action = (prompt or "").strip(), billing_mod.IMAGE_EDIT
        if not text:
            raise HTTPException(400, "编辑指令不能为空")
    else:
        raise HTTPException(400, f"未知的生成类型：{kind}")

    try:
        out = image_gen.edit([src], text)
        data = imaging.pad_to_canvas(out) if kind == "normalized" else imaging.normalize_to_jpeg(out)
    except ProviderError as e:
        raise HTTPException(502, str(e))
    except ValueError as e:
        raise HTTPException(502, f"生图结果解析失败：{e}")
    billing.charge(db, user.id, action, detail={"kind": kind})  # 成功后才扣
    return Response(content=data, media_type="image/jpeg")


class RotateIn(BaseModel):
    path: str


@router.post("/rotate")
def rotate_image(
    body: RotateIn,
    user: User = Depends(get_current_user),
    storage: Storage = Depends(get_storage),
):
    """顺时针转 90°，写成**新 key** 返回（不原地覆盖，URL 才能保持不可变）。
    旧文件由单品保存时的「移除图清理」负责删。"""
    if not owned_by(body.path, user.id) or not storage.exists(body.path):
        raise HTTPException(404, "图片不存在")
    try:
        data = imaging.rotate_clockwise(storage.get(body.path))
    except ValueError as e:
        raise HTTPException(400, str(e))
    kind = body.path.split("/")[2] if body.path.count("/") >= 3 else "items"
    key = new_key(user.id, kind)
    storage.put(key, data)
    return {"path": key}
