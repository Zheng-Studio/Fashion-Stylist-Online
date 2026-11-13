"""ORM 模型。

和家庭版的差别：没有「模特」了——模特就是用户本人。所有数据都挂在 user 下，
不再有「共享单品」和「心愿单」。图片字段存的是存储 key（如 u/<uid>/items/<uuid>.jpg），
URL 由前端按 key 拼，换对象存储时数据不用迁。
"""
import datetime
import uuid

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def new_id() -> str:
    return uuid.uuid4().hex


def now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


class User(Base):
    __tablename__ = "user"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    # 平台侧用户标识（Lucimix 传来的用户 id）；dev 模式下就是请求带的 token
    external_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(64), default="")
    gender: Mapped[str] = mapped_column(String(16), default="")
    age: Mapped[int | None] = mapped_column(Integer)  # AI 预估，用户可改；null=未知
    height_cm: Mapped[int | None] = mapped_column(Integer)
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    gen_base: Mapped[str | None] = mapped_column(String(255))  # 生图底图；空则回落 photos[0]
    photos: Mapped[list] = mapped_column(JSON, default=list)  # 本人照片 key 列表
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), default=now)


class Item(Base):
    __tablename__ = "item"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64), default="")
    gender: Mapped[str] = mapped_column(String(16), default="")
    category: Mapped[str] = mapped_column(String(16))
    color: Mapped[list] = mapped_column(JSON, default=list)
    season: Mapped[list] = mapped_column(JSON, default=list)
    description: Mapped[str] = mapped_column(Text, default="")
    # 图库：[{id, kind: upload|normalized|edited, path: <key>, prompt?, source_id?}]
    images: Mapped[list] = mapped_column(JSON, default=list)
    primary_image_id: Mapped[str | None] = mapped_column(String(32))
    # 衣橱里的手动排序（拖拽），越小越靠前；新单品排最前。同一用户内有意义。
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), default=now)


class Outfit(Base):
    """一套试穿过的搭配（点「生成上身图」时才落库）。"""

    __tablename__ = "outfit"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), index=True)
    note: Mapped[str] = mapped_column(Text, default="")
    # Example IDs are a snapshot of the selected fixed scene, separate from personal Item rows.
    example_item_ids: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), default=now)

    links: Mapped[list["OutfitItem"]] = relationship(
        order_by="OutfitItem.sort_order", cascade="all, delete-orphan", passive_deletes=True
    )


class OutfitItem(Base):
    """搭配-单品关联。单品被删 = 搭配里少掉那一件（CASCADE），搭配本身保留。"""

    __tablename__ = "outfit_item"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    outfit_id: Mapped[str] = mapped_column(ForeignKey("outfit.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("item.id", ondelete="CASCADE"), index=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)

    item: Mapped[Item] = relationship()


class Generation(Base):
    """一次上身图生成（异步任务）。"""

    __tablename__ = "generation"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), index=True)
    outfit_id: Mapped[str] = mapped_column(ForeignKey("outfit.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending/running/done/failed
    result_path: Mapped[str | None] = mapped_column(String(255))
    # 过程信息：base（底图 key）、prompts（实际提示词）、model、error 等
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=now, onupdate=now
    )


class ImageJob(Base):
    """单品图的后台生成任务（标准照 / 自定义编辑）。

    单品页里每个操作即时生效：点「生成」就建一条任务，关掉单品页也照样跑；
    成功后结果作为新图追加进单品图库（不设主图），结果图的 id = 任务 id，前端据此定位新图。
    单品被删时随之级联删除，跑完发现任务没了就丢弃结果、不扣费。
    """

    __tablename__ = "image_job"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("item.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # item_normalize | item_edit
    source_image_id: Mapped[str] = mapped_column(String(32))
    prompt: Mapped[str] = mapped_column(Text, default="")  # 自定义编辑的用户指令（清洗后）
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending/running/done/failed
    error: Mapped[str] = mapped_column(Text, default="")
    dismissed: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")  # 失败提示被用户关掉
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime.datetime] = mapped_column(
        DateTime(timezone=True), default=now, onupdate=now
    )


class ChargeRecord(Base):
    """扣费流水。对接 Lucimix 扣费接口前只记账（ledger），便于之后对账/补扣。"""

    __tablename__ = "charge_record"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("user.id", ondelete="CASCADE"), index=True)
    action: Mapped[str] = mapped_column(String(32))  # tryon / image_edit / image_normalize
    amount: Mapped[int] = mapped_column(Integer, default=1)
    ref_id: Mapped[str] = mapped_column(String(64), default="")  # 关联的 generation id 等
    status: Mapped[str] = mapped_column(String(16), default="recorded")  # recorded / charged / failed
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime(timezone=True), default=now)
