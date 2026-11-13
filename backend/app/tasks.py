"""后台任务（生图：试穿 + 单品标准照 / 自定义编辑）。

现在用进程内线程池（多线程，并发数 = TASK_WORKERS）：简单、本地开发零依赖。
生图主要在等模型接口，不吃 CPU，线程多开几个没问题；真正的上限是模型服务的并发配额。代价是进程重启会丢掉在跑的任务——
启动时把卡在 pending/running 的记录统一标成失败（fail_stale_generations），
前端据此提示重试，不会永远转圈。

多实例部署时换成 Redis 队列 + 独立 worker，只需要替换 submit() 的实现。
"""
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.models import Generation, ImageJob

_executor: ThreadPoolExecutor | None = None


def submit(fn, *args) -> None:
    global _executor
    if _executor is None:
        _executor = ThreadPoolExecutor(max_workers=get_settings().task_workers, thread_name_prefix="task")
    _executor.submit(fn, *args)


STALE_MSG = "服务重启，任务已中断，请重新生成。"


def fail_stale_generations(db: Session) -> int:
    """进程启动时调用：上次没跑完的试穿和单品生图都标成失败（没扣过费）。返回条数。"""
    res = db.execute(
        update(Generation)
        .where(Generation.status.in_(["pending", "running"]))
        .values(status="failed", params={"error": STALE_MSG})
    )
    jobs = db.execute(
        update(ImageJob).where(ImageJob.status.in_(["pending", "running"])).values(status="failed", error=STALE_MSG)
    )
    db.commit()
    return (res.rowcount or 0) + (jobs.rowcount or 0)
