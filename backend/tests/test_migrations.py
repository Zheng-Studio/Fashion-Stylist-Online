"""迁移不能丢数据：SQLite 上 batch 改父表会 DROP 旧表，外键开着就会级联删掉子表（pitfalls 3d）。

conftest 的库是 create_all 建的，不走迁移，所以这里单独用一个临时库从旧版本升上来。
"""
import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config

BACKEND_DIR = Path(__file__).resolve().parent.parent


def _alembic(db: Path) -> Config:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{db.as_posix()}")
    return cfg


def _counts(db: Path) -> dict:
    with sqlite3.connect(db) as c:
        return {t: c.execute(f"select count(*) from {t}").fetchone()[0]
                for t in ("user", "item", "outfit", "outfit_item")}


def test_upgrade_keeps_child_rows(tmp_path):
    db = tmp_path / "mig.db"
    cfg = _alembic(db)
    command.upgrade(cfg, "82f0c56b2dcc")  # 删 user.avatar/gender 之前
    with sqlite3.connect(db) as c:
        c.execute("insert into user(id, external_id, name, gender, photos, created_at) "
                  "values ('u1', 'alice', '', 'female', '[]', '2026-10-08')")
        c.execute("insert into item(id, user_id, name, gender, category, color, season, description, "
                  "images, created_at) values ('i1', 'u1', '', '', '上装', '[]', '[]', '', '[]', '2026-10-08')")
        c.execute("insert into outfit(id, user_id, note, created_at) values ('o1', 'u1', '', '2026-10-08')")
        c.execute("insert into outfit_item(id, outfit_id, item_id, sort_order) values ('oi1', 'o1', 'i1', 0)")
    before = _counts(db)

    command.upgrade(cfg, "head")
    assert _counts(db) == before
    command.downgrade(cfg, "82f0c56b2dcc")
    assert _counts(db) == before
