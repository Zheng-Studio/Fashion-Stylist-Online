"""First-run path uses example images without filling the personal wardrobe."""
import io

from PIL import Image
from sqlalchemy import select

from app.db import SessionLocal
from app.models import User
from app.storage import get_storage
from tests.conftest import auth, jpeg


def test_first_tryon_keeps_wardrobe_empty(client, llm, image_gen, monkeypatch):
    llm.replies = ['{"gender": "female", "age": 27, "height_cm": 168}']

    class ImageResponse:
        content = jpeg()

        def raise_for_status(self):
            pass

    from app.services import generation
    fetched = []
    monkeypatch.setattr(generation.httpx, "get", lambda url, timeout: fetched.append(url) or ImageResponse())

    me = client.get("/api/me", headers=auth("new-user")).json()
    assert me["onboarding_completed"] is False
    assert me["photos"] == []

    photo = client.post(
        "/api/onboarding/photo", files={"file": ("me.jpg", jpeg(), "image/jpeg")}, headers=auth("new-user")
    )
    assert photo.status_code == 200, photo.text
    assert photo.json()["gender"] == "female"
    assert photo.json()["age"] == 27
    assert photo.json()["height_cm"] == 168
    assert photo.json()["gen_base"]

    # 估计值只是默认值，用户可以改（包括清空）。
    saved = client.put(
        "/api/me",
        json={"gender": "male", "age": 31, "height_cm": 174},
        headers=auth("new-user"),
    )
    assert saved.status_code == 200, saved.text
    assert (saved.json()["gender"], saved.json()["age"], saved.json()["height_cm"]) == ("male", 31, 174)
    assert client.put("/api/me", json={"age": 200}, headers=auth("new-user")).status_code == 400
    assert client.put("/api/me", json={"height_cm": None}, headers=auth("new-user")).json()["height_cm"] is None

    scenes = client.get(
        "/api/onboarding/scenes", params={"gender": "male", "need": "上班"}, headers=auth("new-user")
    ).json()
    assert len(scenes) == 3
    assert next(s for s in scenes if s["recommended"])["id"] == "work"
    assert all(item["id"].startswith("M") for s in scenes for item in s["items"])

    # User can correct the inferred gender before choosing a fixed scene.
    started = client.post(
        "/api/onboarding/try-on",
        json={"gender": "male", "scene_id": "work", "need": "上班"},
        headers=auth("new-user"),
    )
    assert started.status_code == 200, started.text
    gen_id = started.json()["id"]
    result = client.get(f"/api/generations/{gen_id}", headers=auth("new-user")).json()
    assert result["status"] == "done"
    assert len(fetched) == 3
    assert all(url.endswith(("M01.jpg", "M09.jpg", "M14.jpg")) for url in fetched)
    assert client.get("/api/items", headers=auth("new-user")).json() == []

    # Completion belongs to the user who viewed this successful result.
    assert client.post(
        "/api/onboarding/complete", json={"generation_id": gen_id}, headers=auth("other-user")
    ).status_code == 404
    done = client.post(
        "/api/onboarding/complete", json={"generation_id": gen_id}, headers=auth("new-user")
    )
    assert done.status_code == 200
    assert done.json()["onboarding_completed"] is True
    assert done.json()["gender"] == "male"
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.external_id == "new-user"))
        assert user.onboarding_completed is True


def test_photo_can_skip_ai_processing(client, llm, image_gen):
    """用户对原图满意时直接用原图做底图：不调生图，档案只看这一张。"""
    llm.replies = ['{"gender": "male", "age": 35, "height_cm": null}']
    original = jpeg((200, 30, 30), (60, 120))

    r = client.post(
        "/api/onboarding/photo",
        files={"file": ("me.jpg", original, "image/jpeg")},
        data={"enhance": "false"},
        headers=auth("raw-user"),
    )
    assert r.status_code == 200, r.text
    me = r.json()
    assert image_gen.calls == []
    assert (me["gender"], me["age"], me["height_cm"]) == ("male", 35, None)
    assert me["photos"] == [me["gen_base"]]

    # 底图就是原图（只做了统一的 JPEG 规整），不是生图结果。
    stored = Image.open(io.BytesIO(get_storage().get(me["gen_base"])))
    assert stored.size == (60, 120)

    content = llm.calls[0]["messages"][0]["content"]
    assert sum(1 for part in content if part.get("type") == "image_url") == 1
    assert "第二张" not in content[0]["text"]
