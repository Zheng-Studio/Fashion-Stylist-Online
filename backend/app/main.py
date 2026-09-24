"""FastAPI 入口：装配路由、CORS、本地文件服务。业务都在 routers/ services/ domain/ 里。"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import DBAPIError

from app import tasks
from app.config import get_settings
from app.db import SessionLocal
from app.routers import generations, images, items, me, outfits, recommend
from app.storage import LocalStorage, get_storage

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # 进程内线程池的任务不跨重启：把上次没跑完的生图标成失败，前端会提示重试
    log = logging.getLogger(__name__)
    try:
        with SessionLocal() as db:
            n = tasks.fail_stale_generations(db)
            if n:
                log.info("标记了 %d 条中断的生图任务为失败", n)
    except DBAPIError:
        log.warning("数据库表还没建：请先在 backend 目录运行 `alembic upgrade head`")
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Fashion Stylist Online API", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/health")
    def health():
        return {"status": "ok"}

    for r in (me, items, images, recommend, outfits, generations):
        app.include_router(r.router)

    # 本地存储时由后端直接托管文件；换对象存储后这里不挂，前端直连存储/CDN
    storage = get_storage()
    if isinstance(storage, LocalStorage):
        prefix = "/" + settings.files_url_prefix.strip("/")
        app.mount(prefix, StaticFiles(directory=str(storage.root)), name="files")
    return app


app = create_app()
