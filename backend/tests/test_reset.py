"""重新开始：只清除当前用户的内容，回到首次体验状态。"""
from sqlalchemy import func, select

from app.billing import LedgerBilling
from app.db import SessionLocal
from app.models import ChargeRecord, Generation, User
from app.storage import get_storage
from tests.conftest import auth, create_item, jpeg


def _outfit_with_generation(client, user: str, item_id: str, status: str = "done") -> tuple[str, str]:
    me = client.get("/api/me", headers=auth(user)).json()
    outfit = client.post("/api/outfits", json={"item_ids": [item_id], "note": "通勤"}, headers=auth(user)).json()
    result_key = f"u/{me['id']}/generations/reset-test.jpg"
    storage = get_storage()
    storage.put(result_key, jpeg())
    with SessionLocal() as db:
        db.add(Generation(user_id=me["id"], outfit_id=outfit["id"], status=status, result_path=result_key))
        db.commit()
    return me["id"], result_key


def test_reset_clears_only_current_user(client):
    alice, bob = auth("alice"), auth("bob")
    item = create_item(client, "内搭", "白衬衫")
    bob_item = create_item(client, "鞋", "球鞋", user="bob")
    photo = client.post(
        "/api/me/photos", files={"file": ("me.jpg", jpeg(), "image/jpeg")}, headers=alice
    ).json()["photos"][0]
    client.put("/api/me", json={"name": "Alice"}, headers=alice)

    user_id, result_key = _outfit_with_generation(client, "alice", item["id"])
    with SessionLocal() as db:
        LedgerBilling().charge(db, user_id, "tryon", ref_id="gen-1")
        user = db.get(User, user_id)
        user.onboarding_completed = True
        user.gender = "female"
        user.age = 30
        user.height_cm = 175
        db.commit()

    r = client.post("/api/me/reset", headers=alice)
    assert r.status_code == 200, r.text
    me = r.json()
    assert me["onboarding_completed"] is False
    assert me["photos"] == [] and me["gen_base"] is None and me["gender"] == ""
    assert me["age"] is None and me["height_cm"] is None
    assert me["name"] == "Alice"  # 账号资料保留，只清内容

    assert client.get("/api/items", headers=alice).json() == []
    assert client.get("/api/outfits", headers=alice).json() == []
    assert client.get("/api/generations", headers=alice).json() == {"items": [], "has_more": False}

    storage = get_storage()
    assert not storage.exists(item["primary_path"])
    assert not storage.exists(photo)
    assert not storage.exists(result_key)

    # 别人的数据不受影响
    bob_items = client.get("/api/items", headers=bob).json()
    assert [it["id"] for it in bob_items] == [bob_item["id"]]
    assert storage.exists(bob_item["primary_path"])

    # 扣费流水是账务记录，保留
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(ChargeRecord)) == 1


def test_reset_refuses_while_generation_running(client):
    alice = auth("alice")
    item = create_item(client, "内搭", "白衬衫")
    user_id, _ = _outfit_with_generation(client, "alice", item["id"], status="running")
    with SessionLocal() as db:
        user = db.get(User, user_id)
        user.onboarding_completed = True
        db.commit()

    r = client.post("/api/me/reset", headers=alice)
    assert r.status_code == 409
    assert "正在生成" in r.json()["detail"]
    assert client.get("/api/me", headers=alice).json()["onboarding_completed"] is True
    assert len(client.get("/api/items", headers=alice).json()) == 1
