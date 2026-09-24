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
    assert item["is_in_wishlist"] is False
    old_path = item["primary_path"]

    # 换一张图：旧图文件应被清掉
    new_path = upload_item_image(client)
    body = {**item, "images": [{"id": "img2", "kind": "upload", "path": new_path}], "primary_image_id": "img2"}
    r = client.put(f"/api/items/{item['id']}", json=body, headers=h)
    assert r.status_code == 200 and r.json()["primary_path"] == new_path
    assert not get_storage().exists(old_path)

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


def test_rotate_writes_new_key(client):
    path = upload_item_image(client)
    r = client.post("/api/images/rotate", json={"path": path}, headers=auth("alice"))
    assert r.status_code == 200
    new = r.json()["path"]
    assert new != path and get_storage().exists(new)
    # 别人的图不能转
    assert client.post("/api/images/rotate", json={"path": path}, headers=auth("bob")).status_code == 404
