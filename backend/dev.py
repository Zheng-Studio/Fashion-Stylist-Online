"""开发用热重载启动器。

为什么不用 `uvicorn --reload`：uvicorn 在 Windows 上重启子进程时调用
`os.kill(pid, CTRL_C_EVENT)`，依赖控制台进程组广播。子进程不是独立的进程组，
信号发不到它身上，`process.join()` 就永久阻塞 —— 结果是**改第一次能重载，
之后 reloader 彻底卡死**。

watchfiles 的 `run_process()` 改用 `os.kill(pid, SIGINT)`，在 Windows 上
CPython 会走 `TerminateProcess`，是可靠的硬杀。

用法：
    .venv\\Scripts\\python.exe dev.py

环境变量：
    DEV_HOST  默认 127.0.0.1（给局域网/手机访问就设成 0.0.0.0）
    DEV_PORT  默认 8000
"""

import os
import sys
from pathlib import Path

import uvicorn
from watchfiles import run_process

WATCH_DIR = Path(__file__).parent / "app"


def serve() -> None:
    uvicorn.run(
        "app.main:app",
        host=os.environ.get("DEV_HOST", "127.0.0.1"),
        port=int(os.environ.get("DEV_PORT", "8000")),
    )


if __name__ == "__main__":
    if not WATCH_DIR.is_dir():
        sys.exit(f"[dev] 找不到要监视的目录：{WATCH_DIR}")
    run_process(WATCH_DIR, target=serve, target_type="function")
