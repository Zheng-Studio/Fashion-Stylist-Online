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


# 品类 → (换装动作, 该单品占据区域以外要「保持不变」的部位)。
# 「保持不变」= 全身 − 占据区域：外套占外层 → 保留里面的内搭；整身占上下 → 只保留鞋和头。
# 整身不写「裙」：款式由 garment_name 带出，避免把连体裤画成裙子。
_DRESS_RULES: dict[str, tuple[str, str]] = {
    "内搭": ("把图1人物的上衣换成图2的{garment}", "下半身的裤装、鞋子和头部"),
    "外套": ("给图1人物在现有衣服外面套上图2的{garment}", "里面已穿的衣服、下半身、鞋子和头部"),
    "下装": ("把图1人物的下半身换成图2的{garment}", "上身的衣着、鞋子和头部"),
    "整身": ("把图1人物原本的上衣和下装整体换成图2的{garment}", "鞋子和头部"),
    "鞋": ("把图1人物脚上的鞋换成图2的{garment}", "上身衣着、下半身和头部"),
    "帽": ("给图1人物戴上图2的{garment}", "身上的衣着和鞋子"),
    "配饰": ("给图1人物配上图2的{garment}", "原有的衣着、鞋子和发型"),
}
_DRESS_FALLBACK = ("把图1人物换上图2的{garment}", "脸、身材以外尽量不变")


def serial_prompt(item: dict) -> str:
    """serial 模式单步提示词：图1 = 当前人物，图2 = 这一件。"""
    action_tpl, keep = _DRESS_RULES.get(item.get("category") or "", _DRESS_FALLBACK)
    return f"{action_tpl.format(garment=garment_name(item))}。{keep}保持不变。"


# single 模式：每件单品在整句里的动作短语（图号由调用方按顺序分配）
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
    """single 模式提示词：图1 = 人物，图2..图N+1 = 按 ordered_items 顺序的单品。"""
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
