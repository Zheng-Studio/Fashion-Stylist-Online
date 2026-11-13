"""换装的叠穿次序（纯逻辑）。提示词本身在 domain/image_scenes.py 的 tryon_prompt。

换装固定为 single：人物照 + 全部单品图一次送进 images/generations。
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
