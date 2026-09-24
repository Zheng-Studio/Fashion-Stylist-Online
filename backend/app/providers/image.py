"""生图：OpenAI 兼容协议的 images/edits。

换装、单品 AI 编辑、白底标准照三件事都是「若干张输入图 + 一句指令 → 一张新图」，
所以只需要一个 edit() 能力。多图输入（人物 + 多件单品一次换装）要看供应商是否支持，
不支持就把 TRYON_MODE 设成 serial，逐件两两输入。
"""
import base64
from typing import Protocol

import httpx
import openai

from app.config import Settings
from app.providers.errors import ProviderError


class ImageGen(Protocol):
    model: str

    def edit(self, images: list[bytes], prompt: str) -> bytes:
        """输入若干张 JPEG + 指令，返回结果图字节（格式由供应商决定，上层统一转 JPEG）。"""
        ...


class OpenAICompatImage:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.model = settings.image_model
        self._client: openai.OpenAI | None = None

    def _get_client(self) -> openai.OpenAI:
        s = self.settings
        if not (s.image_base and s.image_model):
            raise ProviderError("生图接口未配置：请在 backend/.env 里填写 IMAGE_MODEL（及 IMAGE_BASE_URL / IMAGE_API_KEY，不填则沿用 LLM 的）。")
        if self._client is None:
            self._client = openai.OpenAI(
                base_url=s.image_base, api_key=s.image_key or "none", timeout=s.image_timeout
            )
        return self._client

    def edit(self, images: list[bytes], prompt: str) -> bytes:
        if not images:
            raise ProviderError("生图至少需要一张输入图。")
        client = self._get_client()
        files = [(f"image{i + 1}.jpg", data, "image/jpeg") for i, data in enumerate(images)]
        kwargs: dict = {
            "model": self.model,
            # 单图时传单个文件：有的实现不接受数组
            "image": files if len(files) > 1 else files[0],
            "prompt": prompt,
            "n": 1,
        }
        if self.settings.image_size:
            kwargs["size"] = self.settings.image_size
        try:
            resp = client.images.edit(**kwargs)
        except openai.APITimeoutError as e:
            raise ProviderError(f"生图超时（>{self.settings.image_timeout:.0f}s），请稍后重试。") from e
        except openai.APIConnectionError as e:
            raise ProviderError(f"连不上生图服务（{self.settings.image_base}）。") from e
        except openai.APIStatusError as e:
            raise ProviderError(f"生图接口返回错误 {e.status_code}：{(e.response.text or str(e))[:300]}") from e
        except openai.OpenAIError as e:
            raise ProviderError(f"调用生图接口失败：{e}") from e
        return _first_image(resp, self.settings.image_timeout)


def _first_image(resp, timeout: float) -> bytes:
    """取第一张结果：优先 b64_json，其次 url（有的供应商只给临时链接）。"""
    data = getattr(resp, "data", None) or []
    if not data:
        raise ProviderError("生图接口没有返回图片。")
    first = data[0]
    if getattr(first, "b64_json", None):
        return base64.b64decode(first.b64_json)
    if getattr(first, "url", None):
        try:
            r = httpx.get(first.url, timeout=timeout)
            r.raise_for_status()
        except httpx.HTTPError as e:
            raise ProviderError(f"下载生图结果失败：{e}") from e
        return r.content
    raise ProviderError("生图接口返回里既没有 b64_json 也没有 url。")
