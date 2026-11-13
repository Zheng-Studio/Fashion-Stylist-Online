import io

from PIL import Image

from app.config import get_settings
from app.storage import get_storage
from tests.conftest import auth, create_item, jpeg, upload_item_image


def test_first_request_creates_user(client):
    r = client.get("/api/me", headers=auth("alice"))
    assert r.status_code == 200
    me = r.json()
    assert me["photos"] == [] and me["gen_base"] is None
    # 同一个 token 再来是同一个用户
    assert client.get("/api/me", headers=auth("alice")).json()["id"] == me["id"]
    # 不带 token 走 dev 默认用户，是另一个人
    assert client.get("/api/me").json()["id"] != me["id"]


def test_photos_and_gen_base(client):
    h = auth("alice")
    p1 = client.post("/api/me/photos", files={"file": ("a.jpg", jpeg(), "image/jpeg")}, headers=h).json()["photos"][0]
    me = client.post("/api/me/photos", files={"file": ("b.jpg", jpeg(), "image/jpeg")}, headers=h).json()
    p2 = me["photos"][1]
    assert me["gen_base"] == p1  # 没设过底图时回落第一张

    me = client.put("/api/me", json={"gen_base": p2}, headers=h).json()
    assert me["gen_base"] == p2
    # 底图只能从自己的照片里选
    assert client.put("/api/me", json={"gen_base": "u/x/photos/y.jpg"}, headers=h).status_code == 400

    me = client.request("DELETE", "/api/me/photos", json={"path": p2}, headers=h).json()
    assert me["photos"] == [p1] and me["gen_base"] == p1
    assert not get_storage().exists(p2)


def test_item_crud_and_file_cleanup(client):
    h = auth("alice")
    item = create_item(client, "内搭", "白衬衫")
    assert item["primary_path"].startswith("u/")
    old_path = item["primary_path"]

    # 换一张图（加新图 → 设为主图 → 删旧图）：旧图文件应被清掉
    r = client.post(f"/api/items/{item['id']}/images", files={"file": ("b.jpg", jpeg(), "image/jpeg")}, headers=h)
    new = r.json()["images"][-1]
    client.put(f"/api/items/{item['id']}/primary", json={"image_id": new["id"]}, headers=h)
    r = client.delete(f"/api/items/{item['id']}/images/{item['images'][0]['id']}", headers=h)
    assert r.status_code == 200 and r.json()["primary_path"] == new["path"]
    assert not get_storage().exists(old_path)
    new_path = new["path"]

    assert len(client.get("/api/items", headers=h).json()) == 1
    assert client.delete(f"/api/items/{item['id']}", headers=h).status_code == 200
    assert client.get("/api/items", headers=h).json() == []
    assert not get_storage().exists(new_path)


def test_items_are_private(client):
    item = create_item(client, "内搭", user="alice")
    bob = auth("bob")
    assert client.get("/api/items", headers=bob).json() == []
    assert client.delete(f"/api/items/{item['id']}", headers=bob).status_code == 404
    # 不能把别人的图片 key 塞进自己的单品
    body = {"category": "内搭", "images": [{"id": "x", "kind": "upload", "path": item["primary_path"]}]}
    assert client.post("/api/items", json=body, headers=bob).status_code == 400


def test_invalid_category_rejected(client):
    path = upload_item_image(client)
    body = {"category": "裙子", "images": [{"id": "x", "kind": "upload", "path": path}]}
    assert client.post("/api/items", json=body, headers=auth("alice")).status_code == 400


def test_files_served(client):
    path = upload_item_image(client)
    prefix = get_settings().files_url_prefix
    r = client.get(f"{prefix}{path}")
    assert r.status_code == 200 and r.headers["content-type"] == "image/jpeg"


def test_photo_upload_is_capped_at_nine(client):
    from app.routers.me import MAX_PHOTOS

    for _ in range(MAX_PHOTOS):
        r = client.post("/api/me/photos", files={"file": ("p.jpg", jpeg(), "image/jpeg")}, headers=auth("alice"))
        assert r.status_code == 200, r.text
    assert len(r.json()["photos"]) == MAX_PHOTOS

    over = client.post("/api/me/photos", files={"file": ("p.jpg", jpeg(), "image/jpeg")}, headers=auth("alice"))
    assert over.status_code == 409
    assert len(client.get("/api/me", headers=auth("alice")).json()["photos"]) == MAX_PHOTOS

    # 删一张就又能加了
    first = client.get("/api/me", headers=auth("alice")).json()["photos"][0]
    assert client.request("DELETE", "/api/me/photos", json={"path": first}, headers=auth("alice")).status_code == 200
    again = client.post("/api/me/photos", files={"file": ("p.jpg", jpeg(), "image/jpeg")}, headers=auth("alice"))
    assert again.status_code == 200


def test_items_keep_manual_order_and_new_items_go_first(client):
    a = create_item(client, "内搭", "A")
    b = create_item(client, "下装", "B")
    c = create_item(client, "鞋", "C")
    other = create_item(client, "内搭", "别人的", user="bob")

    def order(user="alice"):
        return [it["id"] for it in client.get("/api/items", headers=auth(user)).json()]

    assert order() == [c["id"], b["id"], a["id"]]  # 新的在前

    r = client.post("/api/items/reorder", json={"ids": [a["id"], c["id"], b["id"]]}, headers=auth("alice"))
    assert r.status_code == 200, r.text
    assert order() == [a["id"], c["id"], b["id"]]

    # 排好之后再加一件，还是排最前，已排的相对顺序不变
    d = create_item(client, "外套", "D")
    assert order() == [d["id"], a["id"], c["id"], b["id"]]
    assert order("bob") == [other["id"]]


def test_reorder_must_be_exactly_my_items(client):
    a = create_item(client, "内搭", "A")
    b = create_item(client, "下装", "B")
    other = create_item(client, "内搭", "别人的", user="bob")

    def post(ids):
        return client.post("/api/items/reorder", json={"ids": ids}, headers=auth("alice")).status_code

    assert post([a["id"]]) == 400  # 少了
    assert post([a["id"], b["id"], other["id"]]) == 400  # 混进别人的
    assert post([a["id"], a["id"]]) == 400  # 重复
    assert post([b["id"], a["id"]]) == 200


def test_batch_delete_is_all_or_nothing_and_owner_only(client):
    a = create_item(client, "内搭", "A")
    b = create_item(client, "下装", "B")
    c = create_item(client, "鞋", "C")
    other = create_item(client, "内搭", "别人的", user="bob")

    def ids(user="alice"):
        return {it["id"] for it in client.get("/api/items", headers=auth(user)).json()}

    # 混进别人的单品：整批拒绝，自己的一件都不删
    r = client.post("/api/items/batch-delete", json={"ids": [a["id"], other["id"]]}, headers=auth("alice"))
    assert r.status_code == 404
    assert ids() == {a["id"], b["id"], c["id"]} and ids("bob") == {other["id"]}

    assert client.post("/api/items/batch-delete", json={"ids": []}, headers=auth("alice")).status_code == 422

    r = client.post("/api/items/batch-delete", json={"ids": [a["id"], b["id"], a["id"]]}, headers=auth("alice"))
    assert r.status_code == 200, r.text
    assert ids() == {c["id"]}
    assert not get_storage().exists(a["images"][0]["path"])
