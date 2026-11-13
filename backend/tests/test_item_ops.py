"""单品页的单个操作（即时生效）+ 后台生成任务。"""
import io

from PIL import Image
from sqlalchemy import select

from app import tasks
from app.db import SessionLocal
from app.models import ChargeRecord, ImageJob
from app.providers.errors import ProviderError
from app.services import image_jobs
from app.storage import get_storage
from tests.conftest import auth, create_item, jpeg


def _charges():
    with SessionLocal() as db:
        return [(c.action, c.ref_id) for c in db.scalars(select(ChargeRecord))]


def _item(client, item_id, user="alice"):
    return client.get(f"/api/items/{item_id}", headers=auth(user))


# ---------------------------------------------------------------- 字段：PATCH 只改传了的

def test_patch_changes_only_given_fields_and_validates(client):
    it = create_item(client, "内搭", "白衬衫")
    url = f"/api/items/{it['id']}"

    r = client.patch(url, json={"name": "  米白衬衫  "}, headers=auth("alice"))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["name"] == "米白衬衫" and out["category"] == "内搭" and out["description"] == it["description"]
    assert out["jobs"] == []

    out = client.patch(url, json={"season": ["冬", "春", "春"], "color": [" 白 ", "", "米", "白", "灰", "黑"]},
                       headers=auth("alice")).json()
    assert out["season"] == ["春", "冬"]  # 去重、按春夏秋冬排
    assert out["color"] == ["白", "米", "灰"]  # 去空、去重、最多 3 个

    out = client.patch(url, json={"gender": "男"}, headers=auth("alice")).json()
    assert out["gender"] == "male"

    # 必填：品类、性别不能改成空或乱写
    assert client.patch(url, json={"category": "上衣"}, headers=auth("alice")).status_code == 400
    assert client.patch(url, json={"gender": ""}, headers=auth("alice")).status_code == 400
    assert client.patch(url, json={"season": ["梅雨季"]}, headers=auth("alice")).status_code == 400
    # 别人的单品：404
    assert client.patch(url, json={"name": "x"}, headers=auth("bob")).status_code == 404
    assert _item(client, it["id"], "bob").status_code == 404


# ---------------------------------------------------------------- 图：加 / 转 / 设主图 / 删

def test_add_rotate_primary_and_delete_images_take_effect_immediately(client):
    it = create_item(client, "下装", "黑裤")
    url = f"/api/items/{it['id']}"
    storage = get_storage()
    first = it["images"][0]

    r = client.post(f"{url}/images", files={"file": ("b.jpg", jpeg((20, 20, 200), (300, 500)), "image/jpeg")},
                    headers=auth("alice"))
    assert r.status_code == 200, r.text
    out = r.json()
    assert len(out["images"]) == 2 and out["primary_image_id"] == first["id"]  # 加图不改主图
    second = out["images"][1]
    assert Image.open(io.BytesIO(storage.get(second["path"]))).size == (300, 500)  # 按原样，不补成方图

    # 旋转：同一个 id，新 key，旧文件删掉；主图跟着 id 走
    r = client.post(f"{url}/images/{first['id']}/rotate", json={"direction": "ccw"}, headers=auth("alice"))
    assert r.status_code == 200, r.text
    rotated = r.json()["images"][0]
    assert rotated["id"] == first["id"] and rotated["path"] != first["path"]
    assert storage.exists(rotated["path"]) and not storage.exists(first["path"])
    assert r.json()["primary_path"] == rotated["path"]
    assert client.post(f"{url}/images/{first['id']}/rotate", json={"direction": "up"},
                       headers=auth("alice")).status_code == 400

    out = client.put(f"{url}/primary", json={"image_id": second["id"]}, headers=auth("alice")).json()
    assert out["primary_image_id"] == second["id"]
    assert client.put(f"{url}/primary", json={"image_id": "nope"}, headers=auth("alice")).status_code == 404

    # 删主图：回落到剩下的那张；文件删掉
    out = client.delete(f"{url}/images/{second['id']}", headers=auth("alice")).json()
    assert [im["id"] for im in out["images"]] == [first["id"]] and out["primary_image_id"] == first["id"]
    assert not storage.exists(second["path"])
    # 最后一张不能删
    assert client.delete(f"{url}/images/{first['id']}", headers=auth("alice")).status_code == 409

    # 别人不能动
    assert client.post(f"{url}/images/{first['id']}/rotate", json={}, headers=auth("bob")).status_code == 404


# ---------------------------------------------------------------- 后台生成任务

def test_standard_photo_job_appends_a_new_image_and_charges_after(client, image_gen):
    it = create_item(client, "下装", "黑色阔腿裤")
    src = it["images"][0]["id"]
    r = client.post(f"/api/items/{it['id']}/jobs", json={"kind": "item_normalize", "source_image_id": src},
                    headers=auth("alice"))
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]
    out = r.json()["item"]  # 测试里任务同步跑完了
    assert out["jobs"] == []
    new = out["images"][-1]
    assert new["id"] == job_id and new["kind"] == "normalized" and new["source_id"] == src
    assert out["primary_image_id"] == src  # 不改主图
    assert Image.open(io.BytesIO(get_storage().get(new["path"]))).size == (1280, 1280)
    # 点名要哪一件：用单品自己的名称和品类
    assert "「黑色阔腿裤」（下装" in image_gen.calls[-1]["prompt"]
    assert _charges() == [("image_normalize", job_id)]


def test_custom_edit_job_needs_an_instruction_and_records_it(client, image_gen):
    it = create_item(client, "内搭", "衬衫")
    src = it["images"][0]["id"]
    url = f"/api/items/{it['id']}/jobs"
    assert client.post(url, json={"kind": "item_edit", "source_image_id": src, "prompt": "  "},
                       headers=auth("alice")).status_code == 400
    assert client.post(url, json={"kind": "tryon", "source_image_id": src}, headers=auth("alice")).status_code == 400
    assert client.post(url, json={"kind": "item_normalize", "source_image_id": "nope"},
                       headers=auth("alice")).status_code == 404
    assert image_gen.calls == []

    r = client.post(url, json={"kind": "item_edit", "source_image_id": src, "prompt": " 去掉 衣架 "},
                    headers=auth("alice"))
    new = r.json()["item"]["images"][-1]
    assert new["kind"] == "edited" and new["prompt"] == "去掉 衣架"
    assert "「去掉 衣架」" in image_gen.calls[-1]["prompt"]
    assert _charges() == [("image_edit", r.json()["job_id"])]


def test_failed_job_is_shown_not_charged_and_can_be_dismissed(client, image_gen, monkeypatch):
    def boom(*a, **k):
        raise ProviderError("生图超时（>300s），请稍后重试。")

    monkeypatch.setattr(image_gen, "edit", boom)
    it = create_item(client, "内搭", "衬衫")
    r = client.post(f"/api/items/{it['id']}/jobs",
                    json={"kind": "item_normalize", "source_image_id": it["images"][0]["id"]}, headers=auth("alice"))
    job = r.json()["item"]["jobs"][0]
    assert job["status"] == "failed" and "超时" in job["error"]
    assert len(r.json()["item"]["images"]) == 1 and _charges() == []
    # 衣橱列表里也带着（卡片角标）
    listed = next(x for x in client.get("/api/items", headers=auth("alice")).json() if x["id"] == it["id"])
    assert listed["jobs"][0]["id"] == job["id"]

    assert client.delete(f"/api/items/{it['id']}/jobs/{job['id']}", headers=auth("bob")).status_code == 404
    out = client.delete(f"/api/items/{it['id']}/jobs/{job['id']}", headers=auth("alice")).json()
    assert out["jobs"] == []


def test_job_result_is_dropped_and_not_charged_if_the_item_was_deleted_meanwhile(client, image_gen, monkeypatch):
    captured = []
    monkeypatch.setattr(tasks, "submit", lambda fn, *args: captured.append((fn, args)))
    it = create_item(client, "内搭", "衬衫")
    r = client.post(f"/api/items/{it['id']}/jobs",
                    json={"kind": "item_normalize", "source_image_id": it["images"][0]["id"]}, headers=auth("alice"))
    assert r.json()["item"]["jobs"][0]["status"] == "pending"
    before = set(get_storage().root.rglob("*.jpg"))

    assert client.delete(f"/api/items/{it['id']}", headers=auth("alice")).status_code == 200
    fn, args = captured[0]
    fn(*args)  # 后台任务这时才跑完
    with SessionLocal() as db:
        assert db.scalar(select(ImageJob)) is None  # 随单品级联删除
    assert _charges() == []
    assert set(get_storage().root.rglob("*.jpg")) <= before  # 没留下结果图


def test_deleting_the_source_image_mid_job_does_not_break_it(client, image_gen, monkeypatch):
    captured = []
    monkeypatch.setattr(tasks, "submit", lambda fn, *args: captured.append((fn, args)))
    it = create_item(client, "内搭", "衬衫")
    url = f"/api/items/{it['id']}"
    client.post(f"{url}/images", files={"file": ("b.jpg", jpeg(), "image/jpeg")}, headers=auth("alice"))
    src = it["images"][0]["id"]
    job_id = client.post(f"{url}/jobs", json={"kind": "item_normalize", "source_image_id": src},
                         headers=auth("alice")).json()["job_id"]
    client.delete(f"{url}/images/{src}", headers=auth("alice"))  # 源图删了
    fn, args = captured[0]
    fn(*args)
    out = _item(client, it["id"]).json()
    assert out["images"][-1]["id"] == job_id and out["jobs"] == []


def test_each_user_can_run_at_most_three_generations_at_once(client, image_gen, monkeypatch):
    monkeypatch.setattr(tasks, "submit", lambda fn, *args: None)  # 任务都卡在 pending
    # 每件单品各跑一个（单件最多 5 张图，同一件上开太多会先撞到图片上限）
    items = [create_item(client, "内搭", f"衬衫{i}") for i in range(image_jobs.MAX_ACTIVE_PER_USER + 1)]

    def start(it):
        body = {"kind": "item_normalize", "source_image_id": it["images"][0]["id"]}
        return client.post(f"/api/items/{it['id']}/jobs", json=body, headers=auth("alice"))

    for it in items[:-1]:
        assert start(it).status_code == 200
    r = start(items[-1])
    assert r.status_code == 429 and "最多 3 个" in r.json()["detail"]
    # 进行中的不能关
    it = items[0]
    job_id = _item(client, it["id"]).json()["jobs"][0]["id"]
    assert client.delete(f"/api/items/{it['id']}/jobs/{job_id}", headers=auth("alice")).status_code == 409
    # 别人不受影响
    other = create_item(client, "内搭", "衬衫", user="bob")
    assert client.post(f"/api/items/{other['id']}/jobs",
                       json={"kind": "item_normalize", "source_image_id": other["images"][0]["id"]},
                       headers=auth("bob")).status_code == 200


def test_restart_marks_unfinished_item_jobs_failed(client, image_gen, monkeypatch):
    monkeypatch.setattr(tasks, "submit", lambda fn, *args: None)
    it = create_item(client, "内搭", "衬衫")
    client.post(f"/api/items/{it['id']}/jobs",
                json={"kind": "item_normalize", "source_image_id": it["images"][0]["id"]}, headers=auth("alice"))
    with SessionLocal() as db:
        assert tasks.fail_stale_generations(db) == 1
    job = _item(client, it["id"]).json()["jobs"][0]
    assert job["status"] == "failed" and "服务重启" in job["error"]


def test_an_item_holds_at_most_five_images_counting_running_jobs(client, image_gen, monkeypatch):
    from app.routers.items import MAX_IMAGES_PER_ITEM

    assert MAX_IMAGES_PER_ITEM == 5
    it = create_item(client, "内搭", "衬衫")
    url = f"/api/items/{it['id']}"
    for _ in range(3):
        assert client.post(f"{url}/images", files={"file": ("b.jpg", jpeg(), "image/jpeg")},
                           headers=auth("alice")).status_code == 200
    # 4 张 + 1 个生成中 = 满
    monkeypatch.setattr(tasks, "submit", lambda fn, *args: None)
    src = it["images"][0]["id"]
    assert client.post(f"{url}/jobs", json={"kind": "item_normalize", "source_image_id": src},
                       headers=auth("alice")).status_code == 200
    r = client.post(f"{url}/images", files={"file": ("c.jpg", jpeg(), "image/jpeg")}, headers=auth("alice"))
    assert r.status_code == 409 and "最多 5 张" in r.json()["detail"]
    r = client.post(f"{url}/jobs", json={"kind": "item_normalize", "source_image_id": src}, headers=auth("alice"))
    assert r.status_code == 409
