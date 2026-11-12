"""First try-on: processed person photo, fixed example scenes, and completion."""
import re

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app import tasks
from app.billing import Billing
from app.db import get_db
from app.deps import get_billing, get_current_user, get_image_gen, get_llm, get_storage
from app.domain import imaging
from app.example_catalog import scene_for, scene_list
from app.models import Generation, Outfit, User
from app.providers.errors import ProviderError
from app.providers.image import ImageGen
from app.providers.llm import LLM, image_part
from app.serializers import generation_out, user_gen_base, user_out
from app.services.generation import run_generation
from app.storage import Storage, new_key

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])

PERSON_PROMPT = (
    "编辑上传的人物照片，生成同一个人的全身正面摄影照片。优先保持原图的五官、脸型、发型、肤色和年龄特征，保留自然表情。"
    "人物轻松直立，肩膀放松，双臂自然垂落于身体两侧，手指放松；双脚朝前，间距约一只鞋宽，重心平稳。"
    "穿浅灰色基础款圆领短袖 T 恤、深灰色直筒长裤和白色低帮平底鞋。"
    "衣服正常合身，有自然余量和褶皱，上衣与裤子的边界清晰。"
    "原图未拍到的身体部分按与人物年龄、可见肩宽和上身相协调的普通人体比例补全，避免刻意拉长腿部、收窄腰部或夸大曲线。"
    "使用浅灰色摄影棚背景和均匀柔光。相机保持水平，呈现自然平视的全身构图，避免广角透视。"
    "人物居中，从头顶到鞋底完整入镜，上下留少量空白。画面中只有一个人。"
)


def _infer_gender(photo: bytes, llm: LLM) -> str:
    """The field is editable; an uncertain result stays empty instead of guessing."""
    try:
        reply = llm.chat([{"role": "user", "content": [
            {"type": "text", "text": "根据照片判断适合默认展示女装还是男装。只回答 female 或 male 一个词；无法判断则回答 unknown。"},
            image_part(photo),
        ]}], temperature=0)
    except ProviderError:
        return ""
    answer = reply.strip().lower()
    return answer if re.fullmatch(r"female|male", answer) else ""


@router.post("/photo")
async def prepare_photo(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    llm: LLM = Depends(get_llm),
    image_gen: ImageGen = Depends(get_image_gen),
    storage: Storage = Depends(get_storage),
):
    if user.onboarding_completed:
        raise HTTPException(409, "首次体验已完成")
    try:
        source = imaging.normalize_to_jpeg(await file.read())
        gender = await run_in_threadpool(_infer_gender, source, llm)
        processed = await run_in_threadpool(image_gen.edit, [source], PERSON_PROMPT)
        photo = imaging.normalize_to_jpeg(processed)
    except ValueError as e:
        raise HTTPException(400, f"照片无法处理：{e}") from e
    except ProviderError as e:
        raise HTTPException(502, str(e)) from e
    key = new_key(user.id, "photos")
    storage.put(key, photo)
    user.photos = [*(user.photos or []), key]
    user.gen_base = key
    user.gender = gender
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
