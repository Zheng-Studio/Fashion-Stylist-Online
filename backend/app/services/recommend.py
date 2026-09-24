"""选款流水线：召回 → 预过滤 → 分配句柄 → 调 LLM → 校验（不过重试一次）→ 句柄回填。

返回的每一段中间产物都透给前端「推理过程」面板展示。
"""
import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain import prompt_builder, structure, validator
from app.domain.recommend_schema import RECOMMEND_SCHEMA
from app.models import Item, User
from app.providers.errors import ProviderError
from app.providers.llm import LLM
from app.serializers import item_out


def _full_validate(content: str, valid_ids: set, items_by_handle: dict) -> dict:
    """格式校验 + 结构校验，合并成一份检查清单。"""
    res = validator.validate_output(content, valid_ids)
    checks = list(res["checks"])
    if res["passed"] and res["parsed"]:
        checks += structure.check_structure(res["parsed"].get("outfit") or [], items_by_handle)
    return {"parsed": res["parsed"], "checks": checks, "passed": all(c["ok"] for c in checks)}


def recommend(db: Session, user: User, need: str, history: list[dict], llm: LLM) -> dict:
    # ① 召回候选：本人衣橱，不含心愿单
    all_items = [
        item_out(it)
        for it in db.scalars(
            select(Item)
            .where(Item.user_id == user.id, Item.is_in_wishlist.is_(False))
            .order_by(Item.created_at, Item.id)
        )
    ]

    # ② 硬负约束预过滤（「不要裙子」→ 模型根本看不到裙子）
    items, excluded = prompt_builder.apply_negative_filter(need, all_items)
    # ③ 季节预过滤
    items, season_info = prompt_builder.apply_season_filter(need, items, datetime.date.today())
    prefiltered = {"excluded_categories": excluded, "season": season_info}

    # ④ 分配临时句柄（如 鞋1 / 下装2），LLM 用句柄选款，不接触真实 id
    handles = prompt_builder.assign_handles(items)
    items_by_handle = dict(zip(handles, items))
    valid_ids = set(handles)

    # ⑤ 拼 prompt
    prompt = prompt_builder.build_prompt(
        need, items, handles,
        wearer_name=user.name or None,
        wearer_gender=user.gender or None,
        history=history,
    )
    messages = [
        {"role": "system", "content": prompt["system"]},
        {"role": "user", "content": prompt["user"]},
    ]
    base = {"prompt": prompt, "model": getattr(llm, "model", ""), "prefiltered": prefiltered}

    # ⑥ 调 LLM
    try:
        content = llm.chat(messages, schema=RECOMMEND_SCHEMA, schema_name="recommend")
    except ProviderError as e:
        return {**base, "error": str(e), "raw_output": None, "validation": None,
                "passed": False, "enriched": None, "retried": False}

    # ⑦ 校验（格式 + 结构），不过带着问题清单重试 1 次
    result = _full_validate(content, valid_ids, items_by_handle)
    retried = False
    if not result["passed"]:
        retried = True
        followup = messages + [
            {"role": "assistant", "content": content},
            {"role": "user", "content": prompt_builder.build_correction(result["checks"])},
        ]
        try:
            content = llm.chat(followup, schema=RECOMMEND_SCHEMA, schema_name="recommend")
            result = _full_validate(content, valid_ids, items_by_handle)
        except ProviderError:
            pass

    # ⑧ 句柄回填成完整单品
    enriched = None
    if result["passed"] and result["parsed"]:
        enriched = {
            "items": [items_by_handle[h] for h in result["parsed"]["outfit"] if h in items_by_handle],
            "reason": result["parsed"].get("reason", ""),
            "confidence": result["parsed"].get("confidence"),
        }

    return {**base, "raw_output": content, "validation": result["checks"],
            "passed": result["passed"], "enriched": enriched, "retried": retried}
