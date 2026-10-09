"""自动打标：单品图 → 大模型（LLM_MODEL，需多模态）→ 结构化字段（预填前端表单，不落库）。"""
from app.domain import imaging
from app.domain.tagging import TAG_PROMPT, parse_tag_output
from app.providers.llm import LLM, image_part

TAG_LONG_EDGE = 1024  # 识别不需要原图分辨率，缩小提速


class TagError(RuntimeError):
    """识别 + 重问后仍拿不到合规结果，上层转 422。"""


def auto_tag(raw: bytes, llm: LLM) -> dict:
    try:
        jpeg = imaging.normalize_to_jpeg(raw, TAG_LONG_EDGE, 90)
    except ValueError as e:
        raise TagError(str(e)) from e
    messages = [{"role": "user", "content": [{"type": "text", "text": TAG_PROMPT}, image_part(jpeg)]}]

    content = llm.chat(messages, temperature=0.2)
    try:
        return parse_tag_output(content)
    except ValueError as first_err:
        followup = messages + [
            {"role": "assistant", "content": content},
            {"role": "user", "content": (
                f"上面的输出不符合要求：{first_err}。"
                "请严格按字段要求重新输出，只输出一个 JSON 对象，不要任何其他文字。"
            )},
        ]
        content = llm.chat(followup, temperature=0.2)
        try:
            return parse_tag_output(content)
        except ValueError as second_err:
            raise TagError(f"识别失败（重试后仍不合规）：{second_err}") from second_err
