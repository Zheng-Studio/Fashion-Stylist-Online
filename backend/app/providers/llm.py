"""大模型：OpenAI 兼容协议的 chat/completions。

国内主流厂商和 Ollama 都提供 OpenAI 兼容接口，所以只写这一个实现，换供应商只改
LLM_BASE_URL / LLM_API_KEY / LLM_MODEL。

结构化输出各家支持程度不一，由 LLM_JSON_MODE 决定怎么要 JSON：
  json_schema —— response_format 带完整 schema（最严格，支持的供应商最少）
  json_object —— 只要求输出 JSON 对象，结构靠 prompt 约定（兼容面最广，默认）
  none        —— 什么都不传，全靠 prompt + validator 兜底
"""
import base64
from typing import Protocol

import openai

from app.config import Settings
from app.providers.errors import ProviderError


class LLM(Protocol):
    model: str

    def chat(
        self,
        messages: list[dict],
        *,
        schema: dict | None = None,
        schema_name: str = "output",
        temperature: float = 0.3,
        vision: bool = False,
    ) -> str:
        """发一轮对话，返回模型输出的原始文本。schema 非空表示要 JSON。"""
        ...


def image_part(jpeg: bytes) -> dict:
    """把一张 JPEG 包成 OpenAI 多模态消息里的 image_url 片段（data URL）。"""
    b64 = base64.b64encode(jpeg).decode()
    return {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}}


class OpenAICompatLLM:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.model = settings.llm_model
        self.vision_model = settings.llm_vision_model or settings.llm_model
        self._client: openai.OpenAI | None = None

    def _get_client(self) -> openai.OpenAI:
        s = self.settings
        if not (s.llm_base_url and s.llm_model):
            raise ProviderError("大模型未配置：请在 backend/.env 里填写 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL。")
        if self._client is None:
            self._client = openai.OpenAI(
                base_url=s.llm_base_url, api_key=s.llm_api_key or "none", timeout=s.llm_timeout
            )
        return self._client

    def chat(self, messages, *, schema=None, schema_name="output", temperature=0.3, vision=False) -> str:
        client = self._get_client()
        model = self.vision_model if vision else self.model
        kwargs: dict = {"model": model, "messages": messages, "temperature": temperature}
        mode = self.settings.llm_json_mode
        # 视觉请求普遍不支持结构化约束，只对纯文本请求加 response_format
        if schema is not None and not vision:
            if mode == "json_schema":
                kwargs["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {"name": schema_name, "schema": schema},
                }
            elif mode == "json_object":
                kwargs["response_format"] = {"type": "json_object"}
        try:
            resp = client.chat.completions.create(**kwargs)
        except openai.APITimeoutError as e:
            raise ProviderError(f"大模型响应超时（>{self.settings.llm_timeout:.0f}s），请稍后重试。") from e
        except openai.APIConnectionError as e:
            raise ProviderError(f"连不上大模型服务（{self.settings.llm_base_url}）。") from e
        except openai.APIStatusError as e:
            raise ProviderError(f"大模型返回错误 {e.status_code}：{_brief(e)}") from e
        except openai.OpenAIError as e:
            raise ProviderError(f"调用大模型失败：{e}") from e
        if not resp.choices:
            raise ProviderError("大模型返回为空。")
        return resp.choices[0].message.content or ""


def _brief(e: openai.APIStatusError) -> str:
    try:
        body = e.response.json()
        err = body.get("error", body)
        return str(err.get("message", err)) if isinstance(err, dict) else str(err)
    except Exception:
        return (e.response.text or str(e))[:300]
