"""生图：OpenAI 兼容协议的 images/generations。

换装、单品 AI 编辑、白底标准照三件事都是「若干张输入图 + 一句指令 → 一张新图」，
所以只需要一个 edit() 能力。多图输入时，人物和全部单品一次放进 image 数组。
"""
import base64
from typing import Protocol

import httpx

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

    def edit(self, images: list[bytes], prompt: str) -> bytes:
        if not images:
            raise ProviderError("生图至少需要一张输入图。")
        s = self.settings
        if not (s.image_base and s.image_model):
            raise ProviderError("生图接口未配置：请在 backend/.env 里填写 IMAGE_MODEL（及 IMAGE_BASE_URL / IMAGE_API_KEY，不填则沿用 LLM 的）。")
        payload: dict = {
            "model": self.model,
            "prompt": prompt,
            "image": [
                "data:image/jpeg;base64," + base64.b64encode(image).decode("ascii") for image in images
            ],
            "n": 1,
            "sequential_image_generation": "disabled",
        }
        if s.image_size:
            payload["size"] = s.image_size
        try:
            response = httpx.post(
                s.image_base.rstrip("/") + "/images/generations",
                headers={"Authorization": f"Bearer {s.image_key or 'none'}"},
                json=payload,
                timeout=s.image_timeout,
            )
            response.raise_for_status()
            result = response.json()
        except httpx.TimeoutException as e:
            raise ProviderError(f"生图超时（>{s.image_timeout:.0f}s），请稍后重试。") from e
        except httpx.HTTPStatusError as e:
            raise ProviderError(f"生图接口返回错误 {e.response.status_code}：{e.response.text[:300]}") from e
        except (httpx.HTTPError, ValueError) as e:
            raise ProviderError(f"调用生图接口失败：{e}") from e
        return _first_image(result, s.image_timeout)


def _first_image(resp, timeout: float) -> bytes:
    """取第一张结果：优先 b64_json，其次 url（有的供应商只给临时链接）。"""
    data = resp.get("data") or []
    if not data:
        raise ProviderError("生图接口没有返回图片。")
    first = data[0]
    if first.get("b64_json"):
        return base64.b64decode(first["b64_json"])
    if first.get("url"):
        try:
            r = httpx.get(first["url"], timeout=timeout)
            r.raise_for_status()
        except httpx.HTTPError as e:
            raise ProviderError(f"下载生图结果失败：{e}") from e
        return r.content
    raise ProviderError("生图接口返回里既没有 b64_json 也没有 url。")
