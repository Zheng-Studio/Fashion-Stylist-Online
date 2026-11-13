"""账号重置：清空个人内容，回到首次体验状态。

删除的是用户自己的内容（单品、搭配、生成记录、照片和文件）；扣费流水属于账务记录，
保留以便对账。user 行本身不删——平台身份还在，重新走一次首次体验即可。
"""
import logging

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import Generation, ImageJob, Item, Outfit, User
from app.storage import Storage

log = logging.getLogger(__name__)


class GenerationInProgress(RuntimeError):
    """有后台生图任务在跑时不能重置，否则任务会回写已删除的记录。"""


def reset_user(db: Session, user: User, storage: Storage) -> None:
    running = db.scalar(
        select(func.count()).select_from(Generation).where(
            Generation.user_id == user.id,
            Generation.status.in_(("pending", "running")),
        )
    )
    running += db.scalar(
        select(func.count()).select_from(ImageJob).where(
            ImageJob.user_id == user.id,
            ImageJob.status.in_(("pending", "running")),
        )
    ) or 0
    if running:
        raise GenerationInProgress("还有图片正在生成，请等它完成后再重新开始")

    # 先生成、再搭配、最后单品；outfit_item 由数据库级 ON DELETE CASCADE 清掉。
    db.execute(delete(Generation).where(Generation.user_id == user.id))
    db.execute(delete(Outfit).where(Outfit.user_id == user.id))
    db.execute(delete(ImageJob).where(ImageJob.user_id == user.id))
    db.execute(delete(Item).where(Item.user_id == user.id))

    user.photos = []
    user.gen_base = None
    user.gender = ""
    user.age = None
    user.height_cm = None
    user.onboarding_completed = False
    db.commit()

    # DB 已经清干净；文件删除失败只留孤儿文件，不该把成功变成失败。
    try:
        storage.delete_prefix(f"u/{user.id}/")
    except Exception:
        log.exception("重置用户 %s 后清理文件失败", user.id)
