"""图片工具：同步生图（单品标准照 / 单品自定义编辑 / 本人照片编辑，收费）。

单品页里的生成走后台任务（items 路由的 /jobs），旋转是单品图的单个操作（items 路由），都不在这里。

生成类接口是纯图像变换：直接收源图字节、返回结果图字节，不碰 DB、不落存储——
前端握着结果当待提交项，保存单品（或确认用作本人照片）时才上传。
三种生成流程一样（同步、不落库、按次收费），所以共用一个接口，kind 选场景；
场景对应的提示词、尺寸、兜底约束都在 domain/image_scenes.py，前端只能选场景、写指令。
"""
from fastapi.concurrency import run_in_threadpool
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from sqlalchemy.orm import Session

from app import billing as billing_mod
from app.billing import Billing
from app.db import get_db
from app.deps import get_billing, get_current_user, get_image_gen
from app.domain import image_scenes, imaging
from app.domain.taxonomy import CATEGORIES
from app.models import User
from app.providers.errors import ProviderError
from app.providers.image import ImageGen
from app.services import imagegen

router = APIRouter(prefix="/api/images", tags=["images"])

# kind → 收费动作。提示词由场景决定，不收前端传的提示词（编辑场景只收用户指令）。
_KINDS = {
    "item_normalize": billing_mod.IMAGE_NORMALIZE,
    "item_edit": billing_mod.IMAGE_EDIT,
    "photo_edit": billing_mod.IMAGE_EDIT,
}


@router.post("/generate")
async def generate_image(
    source: UploadFile = File(...),
    kind: str = Form(...),  # item_normalize | item_edit | photo_edit
    prompt: str | None = Form(None),  # 编辑场景的用户指令
    # 标准照点名要哪一件（表单里的名称 / 品类，可不传）；不传就按画面里面积最大的那件
    target_name: str | None = Form(None),
    target_category: str | None = Form(None),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    image_gen: ImageGen = Depends(get_image_gen),
    billing: Billing = Depends(get_billing),
):
    if kind not in _KINDS:
        raise HTTPException(400, f"未知的生成类型：{kind}")
    if kind == "item_normalize":
        category = target_category if target_category in CATEGORIES else ""  # 不认识的品类当没传
        text = image_scenes.item_normalize_prompt(image_scenes.clean_target_name(target_name), category)
    else:
        instruction = image_scenes.clean_instruction(prompt)
        if not instruction:
            raise HTTPException(400, "编辑指令不能为空")
        build = image_scenes.item_edit_prompt if kind == "item_edit" else image_scenes.photo_edit_prompt
        text = build(instruction)

    raw = await source.read()
    try:
        src = await run_in_threadpool(imaging.normalize_to_jpeg, raw)
    except ValueError as e:
        raise HTTPException(400, f"源图解析失败：{e}")

    try:
        # 生图要几十秒，进线程池，别把整个服务卡住
        data = await run_in_threadpool(imagegen.generate, image_gen, kind, [src], text)
    except ProviderError as e:
        raise HTTPException(502, str(e))
    except ValueError as e:
        raise HTTPException(502, f"生图结果解析失败：{e}")
    billing.charge(db, user.id, _KINDS[kind], detail={"kind": kind})  # 成功后才扣
    return Response(content=data, media_type="image/jpeg")
