"""单品图后台生成（标准照 / 自定义编辑）：建任务 → 后台线程生图 → 结果追加进单品图库 → 扣费。

单品页每个操作即时生效，生图要几十秒，所以做成后台任务：关掉单品页、切页面都不影响。
- 源图字节在建任务时就读好交给后台线程：任务跑的时候用户删了源图也不影响结果。
- 结果图 id = 任务 id，前端轮询到任务结束后用它定位新图（不需要再查一次）。
- 跑完前重新读一次任务和单品：单品被删（任务随之级联删除）就丢弃结果、不扣费。
- 成功落库之后才扣费；失败不扣。
"""
import logging

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app import billing as billing_mod
from app.billing import Billing
from app.db import SessionLocal
from app.domain import image_scenes
from app.domain.taxonomy import CATEGORIES
from app.models import Generation, ImageJob, Item
from app.providers.errors import ProviderError
from app.providers.image import ImageGen
from app.services import imagegen
from app.storage import Storage, new_key

log = logging.getLogger(__name__)

ACTIVE = ("pending", "running")
# 每个用户同时在跑的生成任务上限（单品生图 + 试穿一起算），免得一个人点十几次把队列堵住
MAX_ACTIVE_PER_USER = 3

_KIND_TO_IMAGE = {"item_normalize": "normalized", "item_edit": "edited"}
_KIND_TO_CHARGE = {"item_normalize": billing_mod.IMAGE_NORMALIZE, "item_edit": billing_mod.IMAGE_EDIT}
JOB_KINDS = tuple(_KIND_TO_IMAGE)


def active_count(db: Session, user_id: str) -> int:
    jobs = db.scalar(
        select(func.count()).select_from(ImageJob).where(ImageJob.user_id == user_id, ImageJob.status.in_(ACTIVE))
    )
    gens = db.scalar(
        select(func.count()).select_from(Generation).where(Generation.user_id == user_id, Generation.status.in_(ACTIVE))
    )
    return (jobs or 0) + (gens or 0)


def visible_jobs(db: Session, user_id: str, item_ids: list[str] | None = None) -> dict[str, list[ImageJob]]:
    """要给前端看的任务：进行中的 + 失败了但用户还没关掉提示的。按单品分组。"""
    q = select(ImageJob).where(
        ImageJob.user_id == user_id,
        or_(ImageJob.status.in_(ACTIVE), (ImageJob.status == "failed") & (ImageJob.dismissed.is_(False))),
    )
    if item_ids is not None:
        q = q.where(ImageJob.item_id.in_(item_ids))
    out: dict[str, list[ImageJob]] = {}
    for job in db.scalars(q.order_by(ImageJob.created_at, ImageJob.id)):
        out.setdefault(job.item_id, []).append(job)
    return out


def _prompt(job: ImageJob, item: Item) -> str:
    if job.kind == "item_normalize":
        # 单品已经入库，名称 / 品类就是它自己的：点名要保留哪一件，比按面积猜准
        category = item.category if item.category in CATEGORIES else ""
        return image_scenes.item_normalize_prompt(image_scenes.clean_target_name(item.name), category)
    return image_scenes.item_edit_prompt(job.prompt)


def run_image_job(job_id: str, source: bytes, image_gen: ImageGen, storage: Storage, billing: Billing) -> None:
    db = SessionLocal()
    try:
        job = db.get(ImageJob, job_id)
        item = db.get(Item, job.item_id) if job else None
        if job is None or item is None:
            return
        job.status = "running"
        db.commit()
        prompt = _prompt(job, item)
        try:
            data = imagegen.generate(image_gen, job.kind, [source], prompt)
        except (ProviderError, ValueError) as e:
            _fail(db, job_id, str(e) if isinstance(e, ProviderError) else f"生图结果解析失败：{e}")
            return
        except Exception as e:  # 兜底：后台线程不能静默吞异常
            log.exception("image job %s crashed", job_id)
            _fail(db, job_id, f"生图异常：{e}")
            return
        _finish(db, job_id, data, storage, billing)
    finally:
        db.close()


def _finish(db: Session, job_id: str, data: bytes, storage: Storage, billing: Billing) -> None:
    # 生图期间单品可能被改过（旋转、删图）或整个删掉：重新读最新的再追加
    db.expire_all()
    job = db.get(ImageJob, job_id)
    item = db.get(Item, job.item_id) if job else None
    if job is None or item is None:
        return  # 单品没了：结果丢弃，不扣费
    key = new_key(item.user_id, "items")
    storage.put(key, data)
    image = {"id": job.id, "kind": _KIND_TO_IMAGE[job.kind], "path": key, "source_id": job.source_image_id}
    if job.kind == "item_edit" and job.prompt:
        image["prompt"] = job.prompt
    try:
        item.images = [*(item.images or []), image]  # 整体赋值，JSON 列才会被识别为已修改；不改主图
        job.status = "done"
        job.error = ""
        db.commit()
    except Exception:
        db.rollback()
        storage.delete(key)
        raise
    # 成功落库之后才扣费
    billing.charge(db, job.user_id, _KIND_TO_CHARGE[job.kind], ref_id=job.id, detail={"kind": job.kind})


def _fail(db: Session, job_id: str, msg: str) -> None:
    db.rollback()
    job = db.get(ImageJob, job_id)
    if job is None:
        return
    job.status = "failed"
    job.error = msg
    db.commit()
