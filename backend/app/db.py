"""数据库引擎与会话。

本地开发用 SQLite、部署用 Postgres，靠 DATABASE_URL 切换，业务代码不感知。
SQLite 的外键默认关闭且是「每连接」开关，这里在每次建连时统一打开，
否则 ON DELETE CASCADE 形同虚设（家庭版踩过：删单品留下悬空的搭配关联行）。
"""
from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


def make_engine(url: str) -> Engine:
    kwargs = {}
    if url.startswith("sqlite"):
        # FastAPI 同步路由和后台任务跑在线程池里，SQLite 连接要允许跨线程
        kwargs["connect_args"] = {"check_same_thread": False}
        if url.startswith("sqlite:///"):
            Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(url, **kwargs)
    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def _fk_on(dbapi_conn, _record):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys = ON")
            cur.close()

    return engine


engine = make_engine(get_settings().database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
