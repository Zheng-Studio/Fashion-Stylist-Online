"""纯图片处理（不调模型、不碰存储）：转码、旋转、方图补边。"""
import io

from PIL import Image, ImageOps

# 全站落盘口径：RGB JPEG，长边 ≤ 1280，q85。用户上传的图只走这一步；AI 生成的单品图另外补成方图（pad_to_square）
STORE_LONG_EDGE = 1280
STORE_QUALITY = 85


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


def rotate_90(raw: bytes, clockwise: bool = True) -> bytes:
    """转 90°：clockwise=True 顺时针，False 逆时针。"""
    turn = Image.Transpose.ROTATE_270 if clockwise else Image.Transpose.ROTATE_90
    return to_jpeg(open_image(raw).transpose(turn), quality=95)


def edge_color(im: Image.Image) -> tuple[int, int, int]:
    """图片四周一圈的代表色（逐通道中位数）：补边用，让补出来的边和原背景接得上。"""
    small = _to_rgb(im).resize((64, 64))
    w, h = small.size
    border = [small.getpixel((x, y)) for x in range(w) for y in (0, h - 1)]
    border += [small.getpixel((x, y)) for y in range(1, h - 1) for x in (0, w - 1)]
    return tuple(sorted(px[c] for px in border)[len(border) // 2] for c in range(3))  # type: ignore[return-value]


def pad_to_square(raw: bytes, side: int, fill: str = "edge") -> bytes:
    """等比缩放后居中放进 side×side 方图。fill="white" 补纯白；"edge" 补原图四周的颜色。

    只补不裁：单品不会被切掉一截。原图比方图小时会等比放大到贴边，保证所有单品图尺寸一致。
    """
    im = _to_rgb(open_image(raw))
    scale = side / max(im.size)
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.Resampling.LANCZOS)
    color = (255, 255, 255) if fill == "white" else edge_color(im)
    canvas = Image.new("RGB", (side, side), color)
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    buf = io.BytesIO()
    canvas.save(buf, "JPEG", quality=STORE_QUALITY)
    return buf.getvalue()
