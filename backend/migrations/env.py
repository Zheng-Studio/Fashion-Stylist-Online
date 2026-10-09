"""Alembic 迁移环境：连接串取 app.config，表结构取 app.models。

改了 models.py 之后：
    alembic revision --autogenerate -m "说明"   # 生成迁移，务必人工过一遍
    alembic upgrade head
"""
from logging.config import fileConfig

from alembic import context

from app import models  # noqa: F401  注册所有表到 Base.metadata
from app.config import get_settings
from app.db import Base, make_engine

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata
# 测试可通过 Config.set_main_option("sqlalchemy.url", ...) 指到临时库；平时 alembic.ini 不设，走 app.config
url = config.get_main_option("sqlalchemy.url") or get_settings().database_url


def run_migrations_offline() -> None:
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        render_as_batch=url.startswith("sqlite"),
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    sqlite = url.startswith("sqlite")
    engine = make_engine(url)
    with engine.connect() as connection:
        if sqlite:
            # batch 改表 = 建新表、拷数据、DROP 旧表；外键开着时 DROP 会把子表行 ON DELETE CASCADE 掉
            # （见 pitfalls 3d）。迁移期间关外键，跑完用 foreign_key_check 兜底。
            # PRAGMA foreign_keys 在事务里不生效，必须在 begin_transaction 之前执行。
            connection.exec_driver_sql("PRAGMA foreign_keys = OFF")
            connection.commit()
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # SQLite 不支持大部分 ALTER TABLE，用 batch 模式（建新表拷数据）来改表
            render_as_batch=sqlite,
        )
        with context.begin_transaction():
            context.run_migrations()
        if sqlite:
            broken = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
            connection.exec_driver_sql("PRAGMA foreign_keys = ON")
            connection.commit()
            if broken:
                raise RuntimeError(f"迁移后存在失效的外键引用：{broken[:10]}")


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
