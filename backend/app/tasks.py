"""后台任务（目前只有生图）。

现在用进程内线程池：简单、本地开发零依赖。代价是进程重启会丢掉在跑的任务——
启动时把卡在 pending/running 的记录统一标成失败（fail_stale_generations），
前端据此提示重试，不会永远转圈。

多实例部署时换成 Redis 队列 + 独立 worker，只需要替换 submit() 的实现。
"""
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Generation

_executor: ThreadPoolExecutor | None = None


def submit(fn, *args) -> None:
    global _executor
    if _executor is None:
        _executor = ThreadPoolExecutor(max_workers=get_settings().task_workers, thread_name_prefix="task")
    _executor.submit(fn, *args)


def fail_stale_generations(db: Session) -> int:
    res = db.execute(
        update(Generation)
        .where(Generation.status.in_(["pending", "running"]))
        .values(status="failed", params={"error": "服务重启，任务已中断，请重新生成。"})
    )
    db.commit()
    return res.rowcount or 0
