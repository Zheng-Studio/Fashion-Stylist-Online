"""扣费。

约定：只对「花钱的生图」收费，而且**成功之后才扣**，失败不扣。
选款、自动打标不收费。每次扣费都在 charge_record 记一条流水，方便之后对账。

- ledger 模式：只记流水，不调外部接口。对接 Lucimix 之前用这个。
- lucimix 模式：记流水 + 调平台扣费接口。接口规格确定后在 LucimixBilling 里实现。
"""
from functools import lru_cache
from typing import Protocol

from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import ChargeRecord

# 收费动作
TRYON = "tryon"  # 生成上身图
IMAGE_EDIT = "image_edit"  # 单品 / 本人照片 AI 编辑
IMAGE_NORMALIZE = "image_normalize"  # 单品白底标准照


class Billing(Protocol):
    def charge(
        self, db: Session, user_id: str, action: str, *, ref_id: str = "", amount: int = 1,
        detail: dict | None = None,
    ) -> ChargeRecord:
        """记一笔扣费并提交。调用方保证只在动作成功后调用。"""
        ...


class LedgerBilling:
    def charge(self, db, user_id, action, *, ref_id="", amount=1, detail=None) -> ChargeRecord:
        rec = ChargeRecord(
            user_id=user_id, action=action, amount=amount, ref_id=ref_id,
            status="recorded", detail=detail or {},
        )
        db.add(rec)
        db.commit()
        return rec


class LucimixBilling(LedgerBilling):
    """TODO：Lucimix 扣费接口规格确定后实现——先记流水，再调平台扣费，按结果更新 status。"""

    def charge(self, db, user_id, action, *, ref_id="", amount=1, detail=None) -> ChargeRecord:
        raise NotImplementedError("Lucimix 扣费尚未接入")


@lru_cache
def get_billing() -> Billing:
    mode = get_settings().billing_mode
    if mode == "ledger":
        return LedgerBilling()
    if mode == "lucimix":
        return LucimixBilling()
    raise RuntimeError(f"未知的 BILLING_MODE：{mode}")
