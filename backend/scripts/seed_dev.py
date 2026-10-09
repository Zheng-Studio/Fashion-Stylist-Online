"""给一个开发用户灌示例衣橱 + 一张示例本人照片，方便本地直接体验选款和生图。

用法（backend 目录下，先 alembic upgrade head）：
    .venv/Scripts/python.exe scripts/seed_dev.py                  # 给 dev 用户灌女装示例
    .venv/Scripts/python.exe scripts/seed_dev.py --user bob --gender male

按性别挑样例：该性别 + 中性单品。幂等：该用户已有单品就跳过（--force 追加）。
只写数据库和存储目录，不碰其它用户。
"""
import argparse
import json
import sys
import uuid
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy import func, select  # noqa: E402

from app.db import SessionLocal  # noqa: E402
from app.models import Item, User  # noqa: E402
from app.storage import get_storage, new_key  # noqa: E402

SAMPLE_DIR = BACKEND_DIR / "sample"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", default="dev", help="平台用户标识（dev 模式下即请求带的 token）")
    ap.add_argument("--gender", choices=["female", "male"], default="female", help="挑哪个性别的样例单品和示例照片")
    ap.add_argument("--force", action="store_true", help="已有单品也追加")
    args = ap.parse_args()

    storage = get_storage()
    samples = json.loads((SAMPLE_DIR / "items.json").read_text(encoding="utf-8"))
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.external_id == args.user))
        if user is None:
            user = User(external_id=args.user, name=args.user, photos=[])
            db.add(user)
            db.flush()
        if db.scalar(select(func.count()).select_from(Item).where(Item.user_id == user.id)) and not args.force:
            print(f"用户 {args.user} 已有单品，跳过（要追加请加 --force）")
            return

        if not user.photos:
            key = new_key(user.id, "photos")
            storage.put(key, (SAMPLE_DIR / "photos" / f"sample_{args.gender}.jpg").read_bytes())
            user.photos = [key]

        n = 0
        for s in samples:
            if s.get("gender") not in (args.gender, "unisex"):
                continue
            key = new_key(user.id, "items")
            storage.put(key, (SAMPLE_DIR / "items" / Path(s["image_path"]).name).read_bytes())
            img_id = uuid.uuid4().hex
            db.add(Item(
                user_id=user.id, name=s.get("name", ""), gender=s.get("gender", ""),
                category=s["category"], color=s.get("color", []), season=s.get("season", []),
                description=s.get("description", ""),
                images=[{"id": img_id, "kind": "upload", "path": key}], primary_image_id=img_id,
            ))
            n += 1
        db.commit()
    print(f"已给用户 {args.user} 灌入 {n} 件示例单品 + 1 张示例照片")


if __name__ == "__main__":
    main()
