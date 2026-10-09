"""换装提示词（不含模型调用，调用在 services/generation.py）。

换装固定为 single：人物照 + 全部单品图一次送进 images/generations，一句提示词说清「从内到外怎么穿」。
参考图按 LAYER_ORDER 从内到外排：外套必须晚于内搭，否则叠穿的覆盖关系会反。
"""

# 叠穿覆盖次序（数字小 = 更靠里）。整身与「下装+内搭」互斥（结构校验保证），归同一层不冲突。
LAYER_ORDER: dict[str, int] = {
    "下装": 1,
    "整身": 1,
    "内搭": 2,
    "外套": 3,
    "鞋": 4,
    "帽": 5,
    "配饰": 6,
}
_LAYER_FALLBACK = 99


def order_items(items: list[dict]) -> list[dict]:
    """按叠穿次序排序（稳定排序，同层保持原顺序）。"""
    return sorted(items, key=lambda it: LAYER_ORDER.get(it.get("category", ""), _LAYER_FALLBACK))


def garment_name(item: dict) -> str:
    return (item.get("name") or "").strip() or f"这件{item.get('category') or '服饰'}"


# 每件单品在整句里的动作短语（图号由调用方按顺序分配）
_WEAR_VERB: dict[str, str] = {
    "内搭": "上身穿{ref}的{garment}",
    "外套": "在最外层套上{ref}的{garment}",
    "下装": "下半身穿{ref}的{garment}",
    "整身": "穿上{ref}的{garment}（上下一体，替换原本的上衣和下装）",
    "鞋": "脚上穿{ref}的{garment}",
    "帽": "头上戴{ref}的{garment}",
    "配饰": "配上{ref}的{garment}",
}


def single_prompt(ordered_items: list[dict]) -> str:
    """换装提示词：图1 = 人物，图2..图N+1 = 按 ordered_items 顺序的单品。"""
    parts = []
    for i, it in enumerate(ordered_items):
        verb = _WEAR_VERB.get(it.get("category") or "", "穿上{ref}的{garment}")
        parts.append(verb.format(ref=f"图{i + 2}", garment=garment_name(it)))
    return (
        "给图1的人物换装：" + "；".join(parts) + "。"
        "按从内到外的顺序叠穿，外层衣物要自然盖住内层。"
        "只换衣着，保持图1人物的脸、发型、身材、姿势和背景不变，"
        "服饰的颜色、图案、材质和版型以对应参考图为准。"
        "最终只生成一张单人、单画面的照片，画面中只能有一个人物。"
        "禁止拼贴、分屏、多视图、前后对照、重复人物或在画面中出现参考图缩略图。"
    )


# 白底标准照：固定提示词（前端「生成白底」按钮）
NORMALIZE_PROMPT = (
    "把图中的服装单品处理成电商白底商品图：纯白背景，服装完整、居中、平整展示，"
    "去掉人物、衣架、文字和杂物，保持服装原本的颜色、图案、材质和版型不变。"
)
