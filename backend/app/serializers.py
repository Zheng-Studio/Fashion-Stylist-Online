"""ORM 对象 → API 返回的字典。"""
from app.models import Generation, Item, Outfit, User


def primary_path(item: Item) -> str | None:
    """主图 = images 里 id==primary_image_id 那张；缺失则回落最近一张。
    封面 / 选款展示 / 换装都只认这一个字段。"""
    imgs = item.images or []
    chosen = next((im for im in imgs if im.get("id") == item.primary_image_id), None)
    chosen = chosen or (imgs[-1] if imgs else None)
    return chosen["path"] if chosen else None


def item_out(item: Item) -> dict:
    return {
        "id": item.id,
        "name": item.name or "",
        "gender": item.gender or "",
        "category": item.category,
        "color": item.color or [],
        "season": item.season or [],
        "description": item.description or "",
        "images": item.images or [],
        "primary_image_id": item.primary_image_id,
        "primary_path": primary_path(item),
        "created_at": item.created_at.isoformat() if item.created_at else "",
    }


def user_gen_base(user: User) -> str | None:
    """生图底图：显式设置的 gen_base，否则回落第一张照片。"""
    return user.gen_base or ((user.photos or [None])[0])


def user_out(user: User) -> dict:
    return {
        "id": user.id,
        "name": user.name or "",
        "gender": user.gender or "",
        "avatar": user.avatar,
        "gen_base": user_gen_base(user),
        "photos": user.photos or [],
    }


def generation_out(gen: Generation) -> dict:
    return {
        "id": gen.id,
        "outfit_id": gen.outfit_id,
        "status": gen.status,
        "result_path": gen.result_path,
        "params": gen.params or {},
        "created_at": gen.created_at.isoformat() if gen.created_at else "",
    }


def outfit_out(outfit: Outfit, generations: list[Generation] | None = None) -> dict:
    out = {
        "id": outfit.id,
        "note": outfit.note or "",
        "created_at": outfit.created_at.isoformat() if outfit.created_at else "",
        "items": [item_out(link.item) for link in outfit.links],
    }
    if generations is not None:
        out["generations"] = [generation_out(g) for g in generations]
    return out
