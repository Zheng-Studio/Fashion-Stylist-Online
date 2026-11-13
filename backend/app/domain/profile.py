"""从照片估计用户档案（性别 / 年龄 / 身高）。

这些值只是给用户的默认值，全部可改，不参与权限、计费之类的判断。年龄和身高
是从画面比例猜的，误差可能很大；拿不准时宁可留空（null），不要给假精度。
"""
import json
import re

_PROFILE_INTRO_TWO = "第一张是用户上传的原图，第二张是根据原图补全的全身照。"
_PROFILE_INTRO_ONE = "这是用户上传的本人照片（可能是全身或半身）。"
_PROFILE_BODY = (
    "请估计这位用户的档案，只输出一个 JSON 对象，不要输出任何其他文字：\n"
    '{"gender": "female" 或 "male" 或 "unknown", "age": 整数或 null, "height_cm": 整数或 null}\n'
    "- gender：更适合默认展示女装还是男装；判断不了用 unknown\n"
    "- age：根据脸部状态估计的大致年龄，10–100 的整数；拿不准给 null\n"
    "- height_cm：根据全身照的身材比例估计身高，120–230 的整数。"
    "这只是粗略猜测，只有人物完整、站直、比例清晰时才给，否则 null\n"
)
PROFILE_PROMPT = _PROFILE_INTRO_TWO + _PROFILE_BODY


def profile_prompt(with_processed: bool) -> str:
    """有 AI 补全的全身照时两张图一起看；直接用原图时只有一张。"""
    return (_PROFILE_INTRO_TWO if with_processed else _PROFILE_INTRO_ONE) + _PROFILE_BODY

_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")
_FEMALE = {"female", "f", "woman", "women", "girl", "女", "女性", "女士"}
_MALE = {"male", "m", "man", "men", "boy", "男", "男性", "男士"}

AGE_RANGE = (10, 100)
HEIGHT_RANGE = (120, 230)


def empty_profile() -> dict:
    return {"gender": "", "age": None, "height_cm": None}


def _gender(value: object) -> str:
    if not isinstance(value, str):
        return ""
    v = value.strip().lower()
    if v in _FEMALE:
        return "female"
    if v in _MALE:
        return "male"
    return ""


def _int_in_range(value: object, low: int, high: int) -> int | None:
    """只接受整数（或整数字符串/整数值浮点数）；越界视为模型瞎猜，丢掉。"""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, str):
        value = value.strip()
        if not re.fullmatch(r"\d+", value):
            return None
    if isinstance(value, float) and not value.is_integer():
        return None
    try:
        number = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    return number if low <= number <= high else None


def parse_profile_output(content: str) -> dict:
    """剥围栏 → JSON → 逐字段归一。不是 JSON 对象时抛 ValueError。

    字段缺失或不合规只让该字段为空，不报错——它们本来就是可选的。
    """
    try:
        out = json.loads(_FENCE.sub("", (content or "").strip()))
    except (TypeError, ValueError) as e:
        raise ValueError(f"不是合法 JSON：{e}") from e
    if not isinstance(out, dict):
        raise ValueError("输出不是 JSON 对象")
    return {
        "gender": _gender(out.get("gender")),
        "age": _int_in_range(out.get("age"), *AGE_RANGE),
        "height_cm": _int_in_range(out.get("height_cm"), *HEIGHT_RANGE),
    }
