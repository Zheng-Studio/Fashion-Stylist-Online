"""单品：增删改查 + 图片上传 + 自动打标 + 单品页的单个操作。所有单品都属于当前用户。

单品页没有「保存 / 取消」：改一个字段、转一张图、设主图、删图都是各自一个接口，调用即生效；
生成标准照 / 自定义编辑是后台任务（services/image_jobs.py），完成后结果追加进图库。
"""
from fastapi.concurrency import run_in_threadpool
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app import tasks
from app.billing import Billing
from app.db import get_db
from app.deps import get_billing, get_current_user, get_image_gen, get_llm, get_storage
from app.domain import imaging
from app.domain import image_scenes
from app.domain.tagging import normalize_gender
from app.domain.taxonomy import CATEGORIES
from app.models import ImageJob, Item, User, new_id
from app.providers.errors import ProviderError
from app.providers.image import ImageGen
from app.providers.llm import LLM
from app.serializers import item_out
from app.services import image_jobs, tagging
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
    item.images = images
    # 主图 id 缺失/非法则回落最近一张
    item.primary_image_id = body.primary_image_id if body.primary_image_id in ids else images[-1]["id"]


def _full(db: Session, user: User, item: Item) -> dict:
    """单品 + 它的后台生成任务（进行中 / 失败未关掉）。单品页的接口都返回这个，前端直接整件替换。"""
    return item_out(item, image_jobs.visible_jobs(db, user.id, [item.id]).get(item.id, []))


@router.get("")
def list_items(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """按用户手动排的顺序返回（sort_order 小的在前；同值时新的在前）。带各单品的后台生成任务（卡片角标用）。"""
    q = select(Item).where(Item.user_id == user.id)
    jobs = image_jobs.visible_jobs(db, user.id)
    return [
        item_out(it, jobs.get(it.id, []))
        for it in db.scalars(q.order_by(Item.sort_order, Item.created_at.desc(), Item.id))
    ]


@router.get("/{item_id}")
def get_item(item_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """单品页打开 / 轮询后台生成进度用。"""
    return _full(db, user, _get_owned(db, user, item_id))


class BatchDeleteIn(BaseModel):
    ids: list[str] = Field(min_length=1, max_length=500)


@router.post("/batch-delete")
def batch_delete_items(
    body: BatchDeleteIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
):
    """批量删除（衣橱多选）。全有或全无：有一件不是自己的 / 不存在就整批 404，一件都不删。"""
    ids = list(dict.fromkeys(body.ids))
    items = list(db.scalars(select(Item).where(Item.user_id == user.id, Item.id.in_(ids))))
    if len(items) != len(ids):
        raise HTTPException(404, "有单品不存在，请刷新后重试")
    paths = [im["path"] for it in items for im in it.images or []]
    for it in items:
        db.delete(it)  # 搭配里的关联行由 ON DELETE CASCADE 清掉
    db.commit()
    for p in paths:  # 库里删干净了再删文件
        storage.delete(p)
    return {"deleted": ids}


class ReorderIn(BaseModel):
    ids: list[str]


@router.post("/reorder")
def reorder_items(body: ReorderIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """拖拽排序：传当前用户全部单品的 id，按新顺序。必须恰好是自己的全部单品，不能多也不能少。"""
    items = {it.id: it for it in db.scalars(select(Item).where(Item.user_id == user.id))}
    if len(body.ids) != len(set(body.ids)) or set(body.ids) != set(items):
        raise HTTPException(400, "排序列表和衣橱里的单品对不上，请刷新后重试")
    for n, item_id in enumerate(body.ids):
        items[item_id].sort_order = n
    db.commit()
    return {"ids": body.ids}


@router.post("")
def create_item(
    body: ItemIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
):
    # 新单品排最前：比当前最靠前的再小 1
    first = db.scalar(select(func.min(Item.sort_order)).where(Item.user_id == user.id))
    item = Item(user_id=user.id, sort_order=(first - 1) if first is not None else 0)
    _apply(item, body, user, storage)
    db.add(item)
    db.commit()
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
    """单品图落存储，返回 key。用户上传的图按原样保存：只转成 JPEG、长边超过 1280 时等比缩小，
    不补边、不裁切、不改比例。"""
    raw = await file.read()
    try:
        # Pillow 解码/缩放是 CPU 活，放线程池，别卡住事件循环（会连带 /files 图片都发不出去）
        data = await run_in_threadpool(imaging.normalize_to_jpeg, raw)
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
    """传图（不落盘）→ 视觉模型识别 → 返回结构化字段预填表单。不收费。

    模型调用要好几秒，必须进线程池：直接在 async 路由里调会阻塞整个事件循环，
    期间所有请求（包括衣橱图片）都卡住——衣橱批量添加时卡片会白一阵。
    """
    raw = await file.read()
    try:
        return await run_in_threadpool(tagging.auto_tag, raw, llm)
    except ProviderError as e:
        raise HTTPException(503, str(e))
    except tagging.TagError as e:
        raise HTTPException(422, str(e))


# ---------------------------------------------------------------------------
# 单品页：单个操作，调用即生效
# ---------------------------------------------------------------------------
SEASON_ORDER = ["春", "夏", "秋", "冬"]
MAX_NAME = 64
MAX_DESCRIPTION = 1000
MAX_COLORS = 3
MAX_COLOR_CHARS = 16
MAX_IMAGES_PER_ITEM = 5  # 每件单品最多 5 张图；生成中的任务也占一个位置


class ItemPatch(BaseModel):
    """只传要改的字段。没传的不动。"""

    name: str | None = None
    gender: str | None = None
    category: str | None = None
    color: list[str] | None = None
    season: list[str] | None = None
    description: str | None = None


@router.patch("/{item_id}")
def patch_item(
    item_id: str,
    body: ItemPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = _get_owned(db, user, item_id)
    fields = body.model_fields_set
    if "name" in fields:
        item.name = (body.name or "").strip()[:MAX_NAME]
    if "description" in fields:
        item.description = (body.description or "").strip()[:MAX_DESCRIPTION]
    # 必填是业务约束：品类、性别只能改成合法值，不能清空
    if "category" in fields:
        if body.category not in CATEGORIES:
            raise HTTPException(400, f"category 必须是 {'/'.join(CATEGORIES)} 之一")
        item.category = body.category
    if "gender" in fields:
        gender = normalize_gender(body.gender or "")
        if not gender:
            raise HTTPException(400, "请选择适用性别")
        item.gender = gender
    if "color" in fields:
        colors = [c.strip()[:MAX_COLOR_CHARS] for c in body.color or [] if c and c.strip()]
        item.color = list(dict.fromkeys(colors))[:MAX_COLORS]
    if "season" in fields:
        picked = set(body.season or [])
        if not picked <= set(SEASON_ORDER):
            raise HTTPException(400, "季节只能是 春 / 夏 / 秋 / 冬")
        item.season = [s for s in SEASON_ORDER if s in picked]
    db.commit()
    return _full(db, user, item)


def _check_room(db: Session, item: Item) -> None:
    """图库满了（已有的图 + 生成中的任务）就不能再加：生成完也会多出一张。"""
    running = db.scalar(
        select(func.count()).select_from(ImageJob).where(ImageJob.item_id == item.id, ImageJob.status.in_(image_jobs.ACTIVE))
    ) or 0
    if len(item.images or []) + running >= MAX_IMAGES_PER_ITEM:
        raise HTTPException(409, f"每件单品最多 {MAX_IMAGES_PER_ITEM} 张图，先删掉一张")


def _image(item: Item, image_id: str) -> dict:
    im = next((im for im in item.images or [] if im.get("id") == image_id), None)
    if im is None:
        raise HTTPException(404, "图片不存在")
    return im


@router.post("/{item_id}/images")
async def add_item_image(
    item_id: str,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
):
    """给单品加一张图（追加到图库末尾，不改主图）。和新建单品一样按原样保存（只转码 / 缩小）。"""
    item = _get_owned(db, user, item_id)
    _check_room(db, item)
    raw = await file.read()
    try:
        data = await run_in_threadpool(imaging.normalize_to_jpeg, raw)
    except ValueError as e:
        raise HTTPException(400, f"图片解析失败：{e}")
    key = new_key(user.id, "items")
    storage.put(key, data)
    item.images = [*(item.images or []), {"id": new_id(), "kind": "upload", "path": key}]
    db.commit()
    return _full(db, user, item)


class RotateIn(BaseModel):
    direction: str = "cw"  # cw 顺时针 | ccw 逆时针


@router.post("/{item_id}/images/{image_id}/rotate")
def rotate_item_image(
    item_id: str,
    image_id: str,
    body: RotateIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
):
    """转 90° 并立即生效。图片 key 不可变：转好的图写成新 key，图库里这张只换 path（id 不变，主图跟着走），旧文件删掉。"""
    if body.direction not in ("cw", "ccw"):
        raise HTTPException(400, f"未知的旋转方向：{body.direction}")
    item = _get_owned(db, user, item_id)
    im = _image(item, image_id)
    old = im["path"]
    try:
        data = imaging.rotate_90(storage.get(old), clockwise=body.direction == "cw")
    except FileNotFoundError:
        raise HTTPException(404, "图片文件不存在")
    except ValueError as e:
        raise HTTPException(400, str(e))
    key = new_key(user.id, "items")
    storage.put(key, data)
    item.images = [{**x, "path": key} if x.get("id") == image_id else x for x in item.images]
    db.commit()
    storage.delete(old)
    return _full(db, user, item)


class PrimaryIn(BaseModel):
    image_id: str


@router.put("/{item_id}/primary")
def set_item_primary(
    item_id: str,
    body: PrimaryIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    item = _get_owned(db, user, item_id)
    _image(item, body.image_id)
    item.primary_image_id = body.image_id
    db.commit()
    return _full(db, user, item)


@router.delete("/{item_id}/images/{image_id}")
def delete_item_image(
    item_id: str,
    image_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: Storage = Depends(get_storage),
):
    """删一张图。至少留一张；删的是主图就回落到剩下的最后一张。正在用它当源图的生成任务不受影响（源图已读走）。"""
    item = _get_owned(db, user, item_id)
    im = _image(item, image_id)
    rest = [x for x in item.images if x.get("id") != image_id]
    if not rest:
        raise HTTPException(409, "至少保留一张图片")
    item.images = rest
    if item.primary_image_id == image_id:
        item.primary_image_id = rest[-1]["id"]
    db.commit()
    storage.delete(im["path"])
    return _full(db, user, item)


class JobIn(BaseModel):
    kind: str  # item_normalize | item_edit
    source_image_id: str
    prompt: str | None = None  # 自定义编辑的用户指令


@router.post("/{item_id}/jobs")
def start_item_job(
    item_id: str,
    body: JobIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    image_gen: ImageGen = Depends(get_image_gen),
    storage: Storage = Depends(get_storage),
    billing: Billing = Depends(get_billing),
):
    """开始后台生成（标准照 / 自定义编辑）。立即返回；完成后结果追加进图库，成功才扣费。"""
    if body.kind not in image_jobs.JOB_KINDS:
        raise HTTPException(400, f"未知的生成类型：{body.kind}")
    item = _get_owned(db, user, item_id)
    im = _image(item, body.source_image_id)
    prompt = ""
    if body.kind == "item_edit":
        prompt = image_scenes.clean_instruction(body.prompt)
        if not prompt:
            raise HTTPException(400, "编辑指令不能为空")
    _check_room(db, item)
    if image_jobs.active_count(db, user.id) >= image_jobs.MAX_ACTIVE_PER_USER:
        raise HTTPException(429, f"同时最多 {image_jobs.MAX_ACTIVE_PER_USER} 个生成任务，等一个完成再试")
    try:
        source = storage.get(im["path"])  # 建任务时就把源图读走，之后删掉源图也不影响
    except FileNotFoundError:
        raise HTTPException(404, "图片文件不存在")
    job = ImageJob(user_id=user.id, item_id=item.id, kind=body.kind, source_image_id=im["id"], prompt=prompt)
    db.add(job)
    db.commit()
    tasks.submit(image_jobs.run_image_job, job.id, source, image_gen, storage, billing)
    db.expire_all()  # 后台线程可能已经改过（测试里是同步跑完的）
    return {"job_id": job.id, "item": _full(db, user, _get_owned(db, user, item_id))}


@router.delete("/{item_id}/jobs/{job_id}")
def dismiss_item_job(
    item_id: str,
    job_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """关掉一条失败任务的提示。进行中的不能关（关了也停不下来）。"""
    item = _get_owned(db, user, item_id)
    job = db.get(ImageJob, job_id)
    if job is None or job.user_id != user.id or job.item_id != item.id:
        raise HTTPException(404, "任务不存在")
    if job.status in image_jobs.ACTIVE:
        raise HTTPException(409, "还在生成，完成后再关")
    job.dismissed = True
    db.commit()
    return _full(db, user, item)
