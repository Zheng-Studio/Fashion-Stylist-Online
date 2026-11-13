"""按场景生图：所有调生图模型的地方都走这里（场景定义见 domain/image_scenes.py）。

调用方负责拼提示词（场景里各有函数）、收费和存储；这里只管「按场景请求什么尺寸、出来的图怎么规整」：
- 方图场景（单品）：请求 IMAGE_SIZE_SQUARE（没配就用 IMAGE_SIZE），落成 1280×1280，按场景补白或补边缘色；
- 竖图场景（人物、试穿）：请求 IMAGE_SIZE，长边缩到 1280，比例不动。
"""
from app.config import get_settings
from app.domain import imaging
from app.domain.image_scenes import ITEM_CANVAS, SCENES
from app.providers.image import ImageGen


def generate(image_gen: ImageGen, scene: str, images: list[bytes], prompt: str) -> bytes:
    """同步调用（几十秒），在 async 路由里要放进线程池。模型失败抛 ProviderError，结果解析失败抛 ValueError。"""
    spec = SCENES[scene]
    s = get_settings()
    if spec.shape == "square":
        out = image_gen.edit(images, prompt, size=s.image_size_square or None)
        return imaging.pad_to_square(out, ITEM_CANVAS, fill=spec.pad or "edge")
    out = image_gen.edit(images, prompt)
    return imaging.normalize_to_jpeg(out)
