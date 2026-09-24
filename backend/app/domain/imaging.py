"""纯图片处理（不调模型、不碰存储）：转码、旋转、白底补边。"""
import io

from PIL import Image, ImageOps

# 全站落盘口径：RGB JPEG，长边 ≤ 1280，q85
STORE_LONG_EDGE = 1280
STORE_QUALITY = 85

# 白底标准照统一成 3:4 竖图（和家庭版 ComfyUI 归一化的 960×1280 同口径）
NORMALIZED_SIZE = (960, 1280)


def open_image(raw: bytes) -> Image.Image:
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
    except Exception as e:
        raise ValueError(f"无法解析图片：{e}") from e
    return ImageOps.exif_transpose(im)  # 手机照片按 EXIF 方向摆正


def _to_rgb(im: Image.Image) -> Image.Image:
    """带 alpha 的垫白底（直接 convert 会变黑底）。"""
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        return bg
    return im.convert("RGB")


def to_jpeg(im: Image.Image, long_edge: int = STORE_LONG_EDGE, quality: int = STORE_QUALITY) -> bytes:
    im = _to_rgb(im)
    if max(im.size) > long_edge:
        im.thumbnail((long_edge, long_edge))  # 只缩不放
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality)
    return buf.getvalue()


def normalize_to_jpeg(raw: bytes, long_edge: int = STORE_LONG_EDGE, quality: int = STORE_QUALITY) -> bytes:
    """任意格式图片 → RGB JPEG bytes。解析失败抛 ValueError。"""
    return to_jpeg(open_image(raw), long_edge, quality)


def rotate_clockwise(raw: bytes) -> bytes:
    """顺时针转 90°。"""
    return to_jpeg(open_image(raw).transpose(Image.Transpose.ROTATE_270), quality=95)


def pad_to_canvas(raw: bytes, size: tuple[int, int] = NORMALIZED_SIZE) -> bytes:
    """等比缩进白底画布并居中（生图接口出的白底图尺寸不一，统一成 3:4）。"""
    im = _to_rgb(open_image(raw))
    im.thumbnail(size)
    canvas = Image.new("RGB", size, (255, 255, 255))
    canvas.paste(im, ((size[0] - im.width) // 2, (size[1] - im.height) // 2))
    buf = io.BytesIO()
    canvas.save(buf, "JPEG", quality=STORE_QUALITY)
    return buf.getvalue()
