"""生成上身图（后台任务）：用户照片 + 搭配单品主图 → 生图接口 → 结果落存储 → 扣费。

在后台线程里跑，自己开 DB 会话；过程信息实时写回 generation.params 供前端轮询。
"""
import logging

from app import billing as billing_mod
from app.billing import Billing
from app.config import get_settings
from app.db import SessionLocal
from app.domain import dressing, imaging
from app.models import Generation, Outfit, User
from app.providers.errors import ProviderError
from app.providers.image import ImageGen
from app.serializers import item_out, user_gen_base
from app.storage import Storage

log = logging.getLogger(__name__)


class GenerationError(RuntimeError):
    """可预期的失败（缺照片、文件丢失等），错误文案直接给用户看。"""


def run_generation(gen_id: str, image_gen: ImageGen, storage: Storage, billing: Billing) -> None:
    db = SessionLocal()
    try:
        gen = db.get(Generation, gen_id)
        if gen is None:
            return
        gen.status = "running"
        db.commit()
        try:
            _dress(db, gen, image_gen, storage, billing)
        except (GenerationError, ProviderError) as e:
            _fail(db, gen, str(e))
        except Exception as e:  # 兜底：后台线程不能静默吞异常
            log.exception("generation %s crashed", gen_id)
            _fail(db, gen, f"生图异常：{e}")
    finally:
        db.close()


def _fail(db, gen: Generation, msg: str) -> None:
    db.rollback()
    gen.status = "failed"
    gen.params = {**(gen.params or {}), "error": msg}
    db.commit()


def _dress(db, gen: Generation, image_gen: ImageGen, storage: Storage, billing: Billing) -> None:
    user = db.get(User, gen.user_id)
    outfit = db.get(Outfit, gen.outfit_id)
    if user is None or outfit is None:
        raise GenerationError("搭配或用户已不存在。")

    base_key = user_gen_base(user)
    if not base_key:
        raise GenerationError("还没有上传本人照片，无法生成上身图。请先在「我」里上传一张全身照。")
    items = dressing.order_items([item_out(link.item) for link in outfit.links])
    if not items:
        raise GenerationError("这套搭配没有单品，无法生成。")

    try:
        person = storage.get(base_key)
        garments = [storage.get(it["primary_path"]) for it in items]
    except FileNotFoundError as e:
        raise GenerationError(f"图片文件缺失：{e}") from e

    mode = get_settings().tryon_mode
    total = len(items)
    common = {"total": total, "base": base_key, "model": getattr(image_gen, "model", ""), "mode": mode}

    def progress(done: int, current: str) -> None:
        gen.params = {**common, "done": done, "current": current}
        db.commit()

    if mode == "serial":
        prompts = []
        current = person
        for i, (it, garment) in enumerate(zip(items, garments)):
            progress(i, dressing.garment_name(it))
            prompt = dressing.serial_prompt(it)
            prompts.append({"item": dressing.garment_name(it), "prompt": prompt})
            current = imaging.normalize_to_jpeg(image_gen.edit([current, garment], prompt))
        result = current
    else:
        progress(0, "整套")
        prompt = dressing.single_prompt(items)
        prompts = [{"item": "整套（" + "、".join(dressing.garment_name(it) for it in items) + "）", "prompt": prompt}]
        result = imaging.normalize_to_jpeg(image_gen.edit([person, *garments], prompt))

    key = f"u/{user.id}/generations/{gen.id}.jpg"
    storage.put(key, result)
    gen.status = "done"
    gen.result_path = key
    gen.params = {**common, "done": total, "prompts": prompts}
    db.commit()
    # 成功之后才扣费
    billing.charge(db, user.id, billing_mod.TRYON, ref_id=gen.id, detail={"items": total, "mode": mode})
