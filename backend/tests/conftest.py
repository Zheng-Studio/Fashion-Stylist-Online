"""测试环境：临时 SQLite + 临时存储目录 + 假的大模型/生图，完全不碰真实数据和外部服务。

环境变量必须在 import app 之前设好（引擎和配置都在导入时创建）。
"""
import io
import json
import os
import shutil
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="fso-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_TMP / 'test.db').as_posix()}"
os.environ["STORAGE_DIR"] = str(_TMP / "files")
os.environ["AUTH_MODE"] = "dev"
os.environ["BILLING_MODE"] = "ledger"
os.environ["TRYON_MODE"] = "single"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from PIL import Image  # noqa: E402

from app import tasks  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.db import Base, engine  # noqa: E402
from app.deps import get_image_gen, get_llm  # noqa: E402
from app.main import app  # noqa: E402


def jpeg(color=(200, 50, 50), size=(40, 60)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "JPEG")
    return buf.getvalue()


class FakeLLM:
    """按顺序吐预设回复；记录收到的 messages。"""

    model = "fake-llm"

    def __init__(self):
        self.replies: list = []
        self.calls: list = []

    def chat(self, messages, *, schema=None, schema_name="output", temperature=0.3, vision=False):
        self.calls.append({"messages": messages, "schema": schema, "vision": vision})
        reply = self.replies.pop(0) if self.replies else "{}"
        return reply(messages) if callable(reply) else reply


class FakeImage:
    model = "fake-image"

    def __init__(self):
        self.calls: list = []

    def edit(self, images, prompt):
        self.calls.append({"n_images": len(images), "prompt": prompt})
        return jpeg((10, 200, 10), (100, 100))


@pytest.fixture(autouse=True)
def _fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    shutil.rmtree(_TMP / "files", ignore_errors=True)
    yield


@pytest.fixture
def llm():
    fake = FakeLLM()
    app.dependency_overrides[get_llm] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_llm, None)


@pytest.fixture
def image_gen():
    fake = FakeImage()
    app.dependency_overrides[get_image_gen] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_image_gen, None)


@pytest.fixture(autouse=True)
def _sync_tasks(monkeypatch):
    """后台任务改成同步执行，测试里提交完就能断言结果。"""
    monkeypatch.setattr(tasks, "submit", lambda fn, *args: fn(*args))


@pytest.fixture
def client():
    return TestClient(app)


def auth(user: str) -> dict:
    return {"Authorization": f"Bearer {user}"}


@pytest.fixture
def settings():
    return get_settings()


def upload_item_image(client, user="alice", color=(200, 50, 50)) -> str:
    r = client.post("/api/items/upload", files={"file": ("a.png", jpeg(color), "image/png")}, headers=auth(user))
    assert r.status_code == 200, r.text
    return r.json()["path"]


def create_item(client, category, name="", user="alice", wishlist=False, season=None) -> dict:
    path = upload_item_image(client, user)
    body = {
        "name": name or category,
        "gender": "female",
        "category": category,
        "color": ["黑"],
        "season": season or [],
        "description": f"{name or category}描述",
        "is_in_wishlist": wishlist,
        "images": [{"id": "img1", "kind": "upload", "path": path}],
        "primary_image_id": "img1",
    }
    r = client.post("/api/items", json=body, headers=auth(user))
    assert r.status_code == 200, r.text
    return r.json()


def recommend_reply(handles: list[str]) -> str:
    return json.dumps({"analysis": "需求分析", "outfit": handles, "reason": "好看", "confidence": 0.9}, ensure_ascii=False)
