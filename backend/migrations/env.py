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
url = get_settings().database_url


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
    engine = make_engine(url)
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            # SQLite 不支持大部分 ALTER TABLE，用 batch 模式（建新表拷数据）来改表
            render_as_batch=url.startswith("sqlite"),
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
