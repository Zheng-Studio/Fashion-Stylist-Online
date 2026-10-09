"""自动打标的 prompt 与结果解析（不含模型调用，调用在 services/tagging.py）。

视觉请求普遍不支持结构化输出约束，所以走「明确字段 prompt + 容错解析」：
剥 ```json 围栏 → json.loads → 字段/枚举校验；不合规由上层带错误重问一次。
"""
import json
import re

from app.domain import taxonomy

SEASONS = {"春", "夏", "秋", "冬"}
GENDER_ALIASES = {
    "female": "female", "women": "female", "woman": "female", "girl": "female",
    "feminine": "female", "womens": "female", "ladies": "female",
    "male": "male", "men": "male", "man": "male", "boy": "male",
    "masculine": "male", "mens": "male", "gentlemen": "male",
    "unisex": "unisex", "neutral": "unisex", "gender-neutral": "unisex",
    "genderless": "unisex", "androgynous": "unisex",
    "女": "female", "女性": "female", "女士": "female",
    "男": "male", "男性": "male", "男士": "male",
    "中性": "unisex",
}

TAG_PROMPT = (
    "识别图中这件服装单品，只输出一个 JSON 对象，不要输出任何其他文字。字段：\n"
    "name: 单品短名，主色+一个核心款式词（如「黑色阔腿裤」「白色衬衫」「灰色棒球帽」），"
    "只用一个款式词、不堆叠版型/图案/工艺修饰，名称太长可省略颜色\n"
    "gender: 适用性别，只能取 female/male/unisex 之一（看不出明显男女倾向就给 unisex）\n"
    "category: 只能取 内搭/外套/下装/整身/鞋/帽/配饰 之一"
    "（内搭=贴身主上衣如T恤衬衫毛衣；外套=最外层如夹克风衣大衣；半身裙算下装；"
    "整身=占满上下、当一套不可拆穿的一件式，如连衣裙/连体裤/连体衣/比基尼套装——"
    "连衣裙也归整身，款式差异写进 name/description）\n"
    "color: 主色数组，只放占大面积的颜色，主色在前，最多3个，小面积点缀不算\n"
    "season: 适合季节数组，取值 春/夏/秋/冬，拿不准就给空数组\n"
    "description: 一到两句中文描述，尽量信息完整——涵盖款式、版型剪裁、材质质感、"
    "配色关系（撞色/印花/拼接等）、以及风格气质与适合场合（如通勤/约会/运动/休闲）"
)

_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")


def normalize_gender(value: object) -> str:
    """把性别值归一到 female/male/unisex；认不出返回空串。大小写不敏感。"""
    if not isinstance(value, str):
        return ""
    return GENDER_ALIASES.get(value.strip().lower(), "")


def parse_tag_output(content: str) -> dict:
    """剥围栏 → JSON → 逐字段校验/归一。不合规抛 ValueError（供上层重问）。"""
    try:
        out = json.loads(_FENCE.sub("", (content or "").strip()))
    except (TypeError, ValueError) as e:
        raise ValueError(f"不是合法 JSON：{e}") from e
    if not isinstance(out, dict):
        raise ValueError("输出不是 JSON 对象")

    category = out.get("category")
    if category not in taxonomy.CATEGORIES:
        raise ValueError(f"category 必须是 {'/'.join(taxonomy.CATEGORIES)} 之一，收到：{category!r}")

    def str_list(key: str) -> list[str]:
        v = out.get(key) or []
        if not isinstance(v, list):
            raise ValueError(f"{key} 必须是数组，收到：{v!r}")
        return [str(x).strip() for x in v if str(x).strip()]

    return {
        "name": str(out.get("name") or "").strip(),
        "gender": normalize_gender(out.get("gender")),  # 空值允许，前端保存时再做必填校验
        "category": category,
        "color": str_list("color")[:3],  # 主色 ≤3，超出截断而不报错
        "season": [s for s in str_list("season") if s in SEASONS],  # 枚举外的静默丢弃
        "description": str(out.get("description") or "").strip(),
    }
