"""穿搭结构校验。

格式校验（validator）只保证"id 真实存在"，不管组合是否合理——曾出现过
"一件内搭 + 一件下装 + 一件整身"这种穿不出门的搭配。这一道按品类派生的
slot/layer 判断组合是否成立，拦掉乱搭。

只在格式校验通过后再跑（否则 id 可能根本不在衣橱里，反查不到品类）。
检查项格式与 validator 完全一致（{name, ok, detail}），由上层 merge 进同一份
checks。detail 带上凶手单品的 id + 品类，供校验失败回喂模型时直接复用。
"""
from app.domain import taxonomy

# 「可以开始 AI 搭配」的唯一标准：衣橱能搭出至少这么多套。
# 对话页、衣橱页的引导和 /api/recommend 的拦截都用它，过了就能用，不过就不行。
#   套数 = 上衣数 × 下装数 + 整身数
# 上衣 = 内搭 + 外套（外套单穿也算上身有覆盖）；整身（连衣裙 / 连体裤）只能单独成套，
# 一件算一套。鞋帽配饰不影响套数。4 = 两件上衣 × 两件下装，给模型留出挑选余地。
MIN_OUTFITS = 4

GAP_UPPER = "上衣"
GAP_LOWER = "下装"


def _counts(categories: list[str | None]) -> tuple[int, int, int]:
    slots = [taxonomy.slot_of(c) for c in categories]
    return slots.count("upper"), slots.count("lower"), slots.count("full")


def outfit_count(tops: int, bottoms: int, one_pieces: int) -> int:
    return tops * bottoms + one_pieces


def wardrobe_readiness(categories: list[str | None]) -> dict:
    """衣橱能搭出几套、够不够开始，以及最少还要补什么。

    补的建议按贪心算：每次补「多出套数更多」的一边（补一件上衣多出「下装数」套，
    补一件下装多出「上衣数」套），一样多时先补上衣。不推荐补整身——一件只多一套。
    """
    tops, bottoms, one_pieces = _counts(categories)
    have = outfit_count(tops, bottoms, one_pieces)
    add_tops = add_bottoms = 0
    t, b = tops, bottoms
    while outfit_count(t, b, one_pieces) < MIN_OUTFITS:
        if b > t:
            t, add_tops = t + 1, add_tops + 1
        elif t > b:
            b, add_bottoms = b + 1, add_bottoms + 1
        else:  # 一样多：先补上衣
            t, add_tops = t + 1, add_tops + 1
    missing = []
    if add_tops:
        missing.append(f"{GAP_UPPER} {add_tops} 件")
    if add_bottoms:
        missing.append(f"{GAP_LOWER} {add_bottoms} 件")
    return {
        "ready": have >= MIN_OUTFITS,
        "outfits": {"have": have, "need": MIN_OUTFITS},
        "tops": tops,
        "bottoms": bottoms,
        "one_pieces": one_pieces,
        "missing": missing,
    }


def _label(item_id: str, items_by_id: dict[str, dict]) -> str:
    """把单品渲染成 `id(品类)`，让回喂消息里模型看得懂是哪件。"""
    cat = (items_by_id.get(item_id) or {}).get("category") or "未知"
    return f"{item_id}({cat})"


def check_structure(outfit_ids: list[str], items_by_id: dict[str, dict]) -> list[dict]:
    """对 outfit 做 4 条结构校验，返回检查项列表。"""
    cats = {i: (items_by_id.get(i) or {}).get("category") for i in outfit_ids}
    slots = {i: taxonomy.slot_of(cats[i]) for i in outfit_ids}

    lower = [i for i in outfit_ids if slots[i] == "lower"]
    full = [i for i in outfit_ids if slots[i] == "full"]
    upper_base = [i for i in outfit_ids
                  if slots[i] == "upper" and taxonomy.layer_of(cats[i]) == "base"]
    upper_outer = [i for i in outfit_ids
                   if slots[i] == "upper" and taxonomy.layer_of(cats[i]) == "outer"]
    feet = [i for i in outfit_ids if slots[i] == "feet"]
    head = [i for i in outfit_ids if slots[i] == "head"]

    def labels(ids: list[str]) -> str:
        return "、".join(_label(i, items_by_id) for i in ids)

    checks: list[dict] = []

    # 规则1：下身恰好一次（下装 + 整身 合计恰好 1 件）—— 主力规则
    lower_cover = lower + full
    if len(lower_cover) == 1:
        ok1, d1 = True, "下身恰好 1 件"
    elif not lower_cover:
        ok1, d1 = False, "缺下身：没有下装也没有整身，请补一件"
    else:
        ok1 = False
        d1 = f"下身重复（下装/整身只能留一件）：{labels(lower_cover)}；请去掉多余的"
    checks.append({"name": "下身恰好一次", "ok": ok1, "detail": d1})

    # 规则2：上身要有覆盖（内搭/外套/整身 至少 1 件，允许叠穿）
    upper_cover = upper_base + upper_outer + full
    ok2 = len(upper_cover) >= 1
    checks.append({
        "name": "上身有覆盖",
        "ok": ok2,
        "detail": "上身有覆盖" if ok2 else "缺上身：内搭/外套/整身都没有，请补一件上身",
    })

    # 规则3：整身 ⊥ 内搭（整身已盖上身；但允许整身+外套）
    if full and upper_base:
        ok3 = False
        d3 = (f"整身不能再配内搭：{labels(full + upper_base)}；"
              "去掉内搭，或改成下装+内搭")
    else:
        ok3, d3 = True, "无整身+内搭冲突"
    checks.append({"name": "整身不配内搭", "ok": ok3, "detail": d3})

    # 规则4：鞋 ≤ 1，帽 ≤ 1
    parts = []
    if len(feet) > 1:
        parts.append(f"鞋多于 1 件：{labels(feet)}")
    if len(head) > 1:
        parts.append(f"帽多于 1 件：{labels(head)}")
    ok4 = not parts
    checks.append({
        "name": "鞋帽数量",
        "ok": ok4,
        "detail": "鞋、帽数量正常" if ok4 else "；".join(parts),
    })

    return checks
