"""品类体系：单一真相源。

每件单品只打一个 `category`；`slot`（占据身体哪个部位）和 `layer`（穿衣层次）
都由 category 派生——不入库、不让模型在输出里声明角色。structure 校验器据此
判断一套搭配的组合是否合理（见 domain/structure.py）。

slot:  upper(上身) / lower(下身) / full(整身，上下都占的一件式或不可拆套装) / feet / head / accessory
layer: base(贴身/主上衣) / outer(外套)；仅 upper 有意义，其余为 None
"""

# 用户可选的品类闭集。前端 frontend/src/constants.ts 的 CATEGORIES 须与此一致。
# 品类 = 单品在一套搭配里的「角色」(slot+layer)，不是形状；形状交给 name/description。
# 「整身」= 占满上下、当一套不可拆地穿的一件式（连衣裙 / 连体裤 / 比基尼等成套），靠 name 区分款式。
CATEGORIES = ["内搭", "外套", "下装", "整身", "鞋", "帽", "配饰"]

# category -> (slot, layer)
_TAXONOMY: dict[str, tuple[str, str | None]] = {
    "内搭": ("upper", "base"),
    "外套": ("upper", "outer"),
    "下装": ("lower", None),
    "整身": ("full", None),
    "鞋": ("feet", None),
    "帽": ("head", None),
    "配饰": ("accessory", None),
}


def slot_of(category: str | None) -> str | None:
    """品类 → slot；未知品类返回 None。"""
    entry = _TAXONOMY.get(category or "")
    return entry[0] if entry else None


def layer_of(category: str | None) -> str | None:
    """品类 → layer；非上身或未知品类返回 None。"""
    entry = _TAXONOMY.get(category or "")
    return entry[1] if entry else None
