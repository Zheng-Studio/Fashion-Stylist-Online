"""把用户需求 + 候选单品拼成给 LLM 的 prompt。

采用「全量喂」：把用户衣橱里的所有单品当候选，让模型自己挑。返回的
system / user 文本会原样透给前端预览，所以这里拼出来的就是「到底给了 LLM 什么」。
"""
import datetime
import json
import re

from app.domain.recommend_schema import SCHEMA_HINT

SYSTEM_PROMPT = (
    "你是一名专业服装搭配师。用户会给出穿衣需求，"
    "你要从给定的「候选单品清单」里挑选若干件，组成一套协调、能真正穿出门的搭配。\n\n"
    "候选里每件的 category 取值范围：内搭 / 外套 / 下装 / 整身 / 鞋 / 帽 / 配饰。\n"
    "（内搭=贴身主上衣如T恤衬衫毛衣；外套=最外层如夹克风衣大衣；下装=裤子或半身裙；"
    "整身=占满上下、当一套不可拆穿的一件式，如连衣裙/连体裤/比基尼套装）\n\n"
    "穿搭结构硬规则（必须全部满足，否则这套穿不出门）：\n"
    "1. 下身恰好一件：从「下装」和「整身」里二选一、且只能一件——"
    "不能同时出现下装和整身，也不能两件下装；\n"
    "2. 上身要有覆盖：内搭 / 外套 / 整身 至少一件（内搭+外套叠穿可以）；\n"
    "3. 选了整身就别再加内搭（整身已盖住上身），但可以配外套；\n"
    "4. 鞋最多一件，帽最多一件。\n\n"
    "输出步骤：\n"
    "- 先在 analysis 里复述需求要点（场合 / 风格 / 颜色 / 硬约束），想清楚再选；\n"
    "- outfit 里只放候选清单里每行行首的单品编号（如 鞋1、下装2），不要自己编；\n"
    "- reason 用一句中文说明搭配思路；\n"
    "- 严格按要求的 JSON 结构输出，不要输出多余文字。\n\n"
    + SCHEMA_HINT
)


def assign_handles(items: list[dict]) -> list[str]:
    """给候选分配「品类+序号」的临时句柄（如 鞋1 / 下装2），与 items 顺序一一对应。

    句柄只在本次请求里有效、不入库——LLM 用它指代候选并回声，比把不透明的
    uuid 主键塞进 prompt 可读得多，且没有"把品类编进身份会漂移"的问题。
    """
    counters: dict[str, int] = {}
    handles: list[str] = []
    for it in items:
        cat = it.get("category") or "件"
        counters[cat] = counters.get(cat, 0) + 1
        handles.append(f"{cat}{counters[cat]}")
    return handles


def format_items(items: list[dict], handles: list[str]) -> str:
    """把候选单品压成一行行紧凑文本，省 token 又便于模型读。行首是临时句柄。"""
    lines = []
    for it, handle in zip(items, handles):
        color = it.get("color") or []
        season = it.get("season") or []
        if isinstance(color, str):
            color = _safe_list(color) or ([color] if color else [])
        if isinstance(season, str):
            season = _safe_list(season)
        lines.append(
            f"- {handle} | {it.get('category', '')} | "
            f"颜色:{'/'.join(color) or '未知'} | "
            f"季节:{'/'.join(season) or '通用'} | "
            f"{it.get('description', '')}"
        )
    return "\n".join(lines)


def _safe_list(raw: str) -> list:
    try:
        v = json.loads(raw)
        return v if isinstance(v, list) else []
    except (TypeError, ValueError):
        return []


# --- 硬负约束预过滤 -------------------------------------------------------
# 把"不要 X"这类硬负约束，喂模型前就从候选剔除（模型看不到就选不了，最稳）。
# 每条规则：触发关键词 → (要排除的 category 集合, name/description 命中也排除的子串, 前端标签)。
# 注意"裙"：不绑品类、纯文本匹配 name/description 含"裙"——连衣裙(名含裙)、半身裙(在「下装」)
# 一网打尽；连体裤/整身套装名里是"裤/套装"不含"裙"，天然不误伤。
_NEGATIVE_RULES: list[tuple[list[str], set[str], list[str], str]] = [
    # (关键词, 排除的category, name/desc命中子串, 给前端看的标签)
    (["裙", "裙子"], set(), ["裙"], "裙子"),
    (["外套"], {"外套"}, [], "外套"),
    (["帽", "帽子"], {"帽"}, ["帽"], "帽子"),
    (["配饰"], {"配饰"}, [], "配饰"),
    (["鞋", "鞋子"], {"鞋"}, [], "鞋"),
]
# 否定线索：线索词与关键词在 0~4 字内相邻才算（避免"想要裙子"被误伤）。
_NEG_CUES = ["不要", "不穿", "别穿", "别要", "不想", "没有", "去掉", "排除"]


def _is_negated(need: str, keyword: str) -> bool:
    for cue in _NEG_CUES:
        if re.search(re.escape(cue) + r".{0,4}" + re.escape(keyword), need):
            return True
    return False


def apply_negative_filter(need: str, items: list[dict]) -> tuple[list[dict], list[str]]:
    """按用户需求里的硬负约束剔除候选。

    返回 (保留的候选, 被排除的标签列表)。标签供前端检查窗展示"剔除了什么"。
    """
    exclude_cats: set[str] = set()
    exclude_text_kw: list[str] = []
    labels: list[str] = []
    for keywords, cats, text_kw, label in _NEGATIVE_RULES:
        if any(_is_negated(need, kw) for kw in keywords):
            exclude_cats |= cats
            exclude_text_kw += text_kw
            labels.append(label)

    if not exclude_cats and not exclude_text_kw:
        return items, []

    kept = []
    for it in items:
        cat = it.get("category")
        text = f"{it.get('name') or ''} {it.get('description') or ''}"
        if cat in exclude_cats:
            continue
        if any(kw in text for kw in exclude_text_kw):
            continue
        kept.append(it)
    return kept, labels


# --- 季节预过滤 -----------------------------------------------------------
# 目标季节：need 显式提到则用之（含"四季/通用"=全季不过滤）；否则按当前月份当季。
# 保留规则：item.season 为空(=通用)恒留；与目标季节有交集则留；否则剔。
_SEASONS = ["春", "夏", "秋", "冬"]
_SEASON_KEYWORDS: dict[str, list[str]] = {
    "春": ["春天", "春季", "春"],
    "夏": ["夏天", "夏季", "夏", "天热", "炎热", "酷暑"],
    "秋": ["秋天", "秋季", "秋"],
    "冬": ["冬天", "冬季", "冬", "天冷", "寒冷", "严寒"],
}
_ALL_SEASON_CUES = ["四季", "通用", "全季"]


def current_season(today: datetime.date) -> str:
    """按月份推断当季（北半球）：3~5 春 / 6~8 夏 / 9~11 秋 / 12~2 冬。"""
    m = today.month
    if 3 <= m <= 5:
        return "春"
    if 6 <= m <= 8:
        return "夏"
    if 9 <= m <= 11:
        return "秋"
    return "冬"


def _season_from_need(need: str) -> list[str]:
    """从 need 抠出显式季节；命中"四季/通用"返回全季。返回有序列表，空=未提。"""
    if any(cue in need for cue in _ALL_SEASON_CUES):
        return list(_SEASONS)
    return [s for s in _SEASONS if any(k in need for k in _SEASON_KEYWORDS[s])]


def apply_season_filter(
    need: str, items: list[dict], today: datetime.date
) -> tuple[list[dict], dict | None]:
    """按目标季节剔除明显异季的候选。

    返回 (保留的候选, info)。info=None 表示未过滤（明确"四季/通用"）；
    否则 info = {target: [季节], source: "text"|"date", excluded_count: N}，供前端展示。
    """
    explicit = _season_from_need(need)
    if explicit and set(explicit) >= set(_SEASONS):
        return items, None  # 明确"四季/通用" → 不过滤
    if explicit:
        target, source = explicit, "text"
    else:
        target, source = [current_season(today)], "date"

    tset = set(target)
    kept, excluded = [], 0
    for it in items:
        s = it.get("season") or []
        if not s or (set(s) & tset):  # 通用(空)恒留；含目标季节则留
            kept.append(it)
        else:
            excluded += 1
    return kept, {"target": target, "source": source, "excluded_count": excluded}


# --- prompt 组装 ----------------------------------------------------------
def format_history(history: list[dict] | None, max_turns: int = 6) -> str:
    """把最近几轮对话压成纯文本，作为上下文折进 user message。

    支持连续调整（"把刚才的裤子换成裙子"）。不做成真 assistant 轮——
    候选句柄每次请求都会重排，复用旧句柄会指错单品；用纯文本喂历史，让模型
    凭语义理解"刚才"，再从本次候选里重新挑句柄。只取最近 max_turns 轮、且跳过
    本轮自己（调用方传入的 history 不含当前 need）。
    """
    if not history:
        return ""
    recent = [h for h in history if (h.get("text") or "").strip()][-max_turns:]
    if not recent:
        return ""
    lines = []
    for h in recent:
        who = "用户" if h.get("role") == "user" else "助手"
        lines.append(f"{who}：{h['text'].strip()}")
    return "\n".join(lines)


def build_prompt(
    user_need: str,
    items: list[dict],
    handles: list[str],
    wearer_name: str | None = None,
    wearer_gender: str | None = None,
    history: list[dict] | None = None,
) -> dict:
    """返回 {system, user}，两段都会透传给前端预览。handles 与 items 一一对应。

    可注入穿搭对象（用户名/性别），辅助 LLM 理解；
    可注入对话历史（history），支持"把刚才的裤子换成裙子"这类连续调整。
    """
    context_parts = []
    hist_text = format_history(history)
    if hist_text:
        context_parts.append(f"【对话历史（供理解「刚才/上一套」等指代，勿照搬旧编号）】\n{hist_text}")
    context_parts.append(f"用户需求：{user_need}")
    if wearer_name:
        gender_hint = {"female": "女", "male": "男", "unisex": "中性"}.get(wearer_gender or "", "")
        context_parts.append(f"穿搭对象：{wearer_name}{'（' + gender_hint + '）' if gender_hint else ''}")
    context_parts.append(
        f"候选单品清单（共 {len(items)} 件，行首是单品编号）：\n"
        f"{format_items(items, handles)}\n"
        "请先在 analysis 里分析需求，再从上面挑选单品组成一套搭配。"
    )
    user_prompt = "\n\n".join(context_parts)
    return {"system": SYSTEM_PROMPT, "user": user_prompt}


def build_correction(failed_checks: list[dict]) -> str:
    """把没通过的检查项拼成纠错消息，回喂模型重试。

    只列没过的项；要求"修正问题 + 保证整套协调"，改动幅度交给模型自己定，
    不强制最小改动（否则可能留下不协调的残局）。
    """
    lines = [f"- {c['name']}：{c['detail']}" for c in failed_checks if not c["ok"]]
    problems = "\n".join(lines)
    return (
        "上面这套没通过检查，问题如下：\n"
        f"{problems}\n\n"
        "请修正这些问题，并保证整套搭配依然协调——为此你可以调整其他单品，"
        "不必拘泥于上一版。仍然只能从候选清单里挑编号，按同样的 JSON 结构输出。"
    )
