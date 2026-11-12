"""First-run path uses example images without filling the personal wardrobe."""
from sqlalchemy import select

from app.db import SessionLocal
from app.models import User
from tests.conftest import auth, jpeg


def test_first_tryon_keeps_wardrobe_empty(client, llm, image_gen, monkeypatch):
    llm.replies = ["female"]

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
    assert photo.json()["gen_base"]

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
