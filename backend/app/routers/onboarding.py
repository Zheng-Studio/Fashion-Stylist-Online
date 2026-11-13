"""First try-on: processed person photo, fixed example scenes, and completion."""
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import tasks
from app.billing import Billing
from app.db import get_db
from app.deps import get_billing, get_current_user, get_image_gen, get_llm, get_storage
from app.domain import image_scenes, imaging, profile
from app.example_catalog import scene_for, scene_list
from app.models import Generation, Outfit, User
from app.providers.errors import ProviderError
from app.providers.image import ImageGen
from app.providers.llm import LLM, image_part
from app.serializers import generation_out, user_gen_base, user_out
from app.services import imagegen
from app.services.generation import run_generation
from app.storage import Storage, new_key

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])

PROFILE_LONG_EDGE = 1024  # 估计档案不需要原图分辨率，缩小提速


def _infer_profile(source: bytes, processed: bytes | None, llm: LLM) -> dict:
    """估计性别 / 年龄 / 身高。失败只返回空档案，不阻断首次体验。

    processed 为 None 表示用户选择直接用原图，只看这一张。
    """
    try:
        images = [source] if processed is None else [source, processed]
        parts = [image_part(imaging.normalize_to_jpeg(img, PROFILE_LONG_EDGE, 90)) for img in images]
        reply = llm.chat(
            [{"role": "user", "content": [
                {"type": "text", "text": profile.profile_prompt(processed is not None)},
                *parts,
            ]}],
            temperature=0,
        )
        return profile.parse_profile_output(reply)
    except (ProviderError, ValueError):
        return profile.empty_profile()


@router.post("/photo")
async def prepare_photo(
    file: UploadFile = File(...),
    enhance: bool = Form(True),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    llm: LLM = Depends(get_llm),
    image_gen: ImageGen = Depends(get_image_gen),
    storage: Storage = Depends(get_storage),
):
    """enhance=false：用户对原图满意，跳过 AI 补全，直接把原图作为生图底图。"""
    if user.onboarding_completed:
        raise HTTPException(409, "首次体验已完成")
    try:
        source = await run_in_threadpool(imaging.normalize_to_jpeg, await file.read())
        if enhance:
            photo = await run_in_threadpool(
                imagegen.generate, image_gen, "person_fullbody", [source], image_scenes.person_fullbody_prompt()
            )
        else:
            photo = source
        inferred = await run_in_threadpool(_infer_profile, source, photo if enhance else None, llm)
    except ValueError as e:
        raise HTTPException(400, f"照片无法处理：{e}") from e
    except ProviderError as e:
        raise HTTPException(502, str(e)) from e
    key = new_key(user.id, "photos")
    storage.put(key, photo)
    user.photos = [*(user.photos or []), key]
    user.gen_base = key
    user.gender = inferred["gender"]
    user.age = inferred["age"]
    user.height_cm = inferred["height_cm"]
    db.commit()
    return user_out(user)


@router.get("/scenes")
def list_scenes(gender: str, need: str = "", user: User = Depends(get_current_user)):
    if gender not in ("female", "male"):
        raise HTTPException(400, "请选择女装或男装")
    return scene_list(gender, need)


class TryonIn(BaseModel):
    gender: str
    scene_id: str
    need: str = ""


@router.post("/try-on")
def start_tryon(
    body: TryonIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    image_gen: ImageGen = Depends(get_image_gen),
    storage: Storage = Depends(get_storage),
    billing: Billing = Depends(get_billing),
):
    if user.onboarding_completed:
        raise HTTPException(409, "首次体验已完成")
    scene = scene_for(body.gender, body.scene_id)
    if scene is None:
        raise HTTPException(400, "场景不存在")
    base = user_gen_base(user)
    if not base:
        raise HTTPException(400, "请先上传本人照片")
    user.gender = body.gender
    outfit = Outfit(user_id=user.id, note=body.need.strip() or scene["name"],
                    example_item_ids=list(scene["item_ids"]))
    db.add(outfit)
    db.flush()
    gen = Generation(user_id=user.id, outfit_id=outfit.id, status="pending",
                     params={"total": len(scene["item_ids"]), "done": 0, "base": base, "scene_id": scene["id"]})
    db.add(gen)
    db.commit()
    tasks.submit(run_generation, gen.id, image_gen, storage, billing)
    return generation_out(gen)


class CompleteIn(BaseModel):
    generation_id: str


@router.post("/complete")
def complete_onboarding(
    body: CompleteIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    gen = db.get(Generation, body.generation_id)
    if gen is None or gen.user_id != user.id:
        raise HTTPException(404, "试穿记录不存在")
    if gen.status != "done" or not gen.result_path:
        raise HTTPException(400, "请先完成首次试穿")
    outfit = db.get(Outfit, gen.outfit_id)
    if outfit is None or outfit.user_id != user.id:
        raise HTTPException(404, "搭配不存在")
    if not (outfit.example_item_ids or []):
        raise HTTPException(400, "这不是首次体验的试穿结果")
    user.onboarding_completed = True
    db.commit()
    return user_out(user)
