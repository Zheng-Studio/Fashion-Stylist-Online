import io
import json

from PIL import Image
from sqlalchemy import select

from app.db import SessionLocal
from app.models import ChargeRecord, OutfitItem
from app.storage import get_storage
from tests.conftest import auth, create_item, jpeg, recommend_reply


def _charges():
    with SessionLocal() as db:
        return [(c.action, c.ref_id) for c in db.scalars(select(ChargeRecord))]


def _stock(client, user="alice"):
    """补一件上衣和一件下装，让衣橱达到开始搭配的标准（≥4 套）。建在后面，不影响前面单品的句柄。"""
    create_item(client, "内搭", "备用T恤", user=user)
    create_item(client, "下装", "备用牛仔裤", user=user)


def test_recommend_maps_handles_to_items(client, llm):
    top = create_item(client, "内搭", "白衬衫")
    bottom = create_item(client, "下装", "黑裤")
    _stock(client)
    create_item(client, "内搭", "别人的衬衫", user="bob")  # 别人的单品不进候选
    llm.replies = [recommend_reply(["内搭1", "下装1"])]

    r = client.post("/api/recommend", json={"need": "通勤，四季"}, headers=auth("alice")).json()
    assert r["passed"] is True
    assert [it["id"] for it in r["enriched"]["items"]] == [top["id"], bottom["id"]]
    assert "别人的衬衫" not in r["prompt"]["user"]
    assert llm.calls[0]["schema"] is not None


def test_recommend_retries_on_invalid_structure(client, llm):
    create_item(client, "内搭", "白衬衫")
    create_item(client, "下装", "黑裤")
    create_item(client, "整身", "连衣裙")
    _stock(client)
    # 第一次：下装 + 整身同时出现，结构校验不过；第二次修正
    llm.replies = [recommend_reply(["内搭1", "下装1", "整身1"]), recommend_reply(["整身1"])]
    r = client.post("/api/recommend", json={"need": "约会，四季"}, headers=auth("alice")).json()
    assert r["retried"] is True and r["passed"] is True
    assert len(llm.calls) == 2
    # 纠错消息里带着没过的检查项
    assert "下身" in llm.calls[1]["messages"][-1]["content"]


def test_recommend_rejects_made_up_handles(client, llm):
    create_item(client, "内搭", "白衬衫")
    create_item(client, "下装", "黑裤")
    _stock(client)
    llm.replies = [recommend_reply(["内搭9"]), recommend_reply(["内搭9"])]
    r = client.post("/api/recommend", json={"need": "随便，四季"}, headers=auth("alice")).json()
    assert r["passed"] is False and r["enriched"] is None


def test_start_standard_is_at_least_four_outfits(client, llm):
    def readiness(user="alice"):
        return client.get("/api/recommend/readiness", headers=auth(user)).json()

    empty = readiness()
    assert empty["ready"] is False and empty["item_count"] == 0
    assert empty["outfits"] == {"have": 0, "need": 4}
    assert empty["missing"] == ["上衣 2 件", "下装 2 件"]

    create_item(client, "鞋", "白鞋")  # 鞋帽配饰不影响套数
    create_item(client, "内搭", "白衬衫")
    create_item(client, "下装", "黑裤")
    r = readiness()
    assert r["outfits"]["have"] == 1 and r["item_count"] == 3
    assert r["missing"] == ["上衣 1 件", "下装 1 件"]

    # 没达到标准就不调模型，直接 409，和引导是同一条线。
    r = client.post("/api/recommend", json={"need": "通勤"}, headers=auth("alice"))
    assert r.status_code == 409 and r.json()["detail"] == "衣橱里的单品还不够，再添加一些就能开始 AI 搭配"
    assert llm.calls == []

    create_item(client, "外套", "风衣")  # 外套也算上衣：2×1 = 2
    assert readiness()["missing"] == ["下装 1 件"]
    create_item(client, "下装", "半身裙")  # 2×2 = 4
    r = readiness()
    assert r["ready"] is True and r["outfits"]["have"] == 4 and r["missing"] == []
    assert (r["tops"], r["bottoms"], r["one_pieces"]) == (2, 2, 0)


def test_one_piece_counts_as_one_outfit(client):
    def readiness():
        return client.get("/api/recommend/readiness", headers=auth("bob")).json()

    # 只算自己的衣橱；整身只能单独成套，一件算一套。
    for name in ("连衣裙", "连体裤"):
        create_item(client, "整身", name, user="bob")
    r = readiness()
    assert r["outfits"]["have"] == 2 and r["ready"] is False
    create_item(client, "内搭", "T恤", user="bob")
    create_item(client, "下装", "短裤", user="bob")
    r = readiness()
    assert r["outfits"]["have"] == 3 and r["missing"] == ["上衣 1 件"]
    create_item(client, "内搭", "衬衫", user="bob")  # 2×1 + 2 = 4
    assert readiness()["ready"] is True


def test_auto_tag(client, llm):
    llm.replies = [
        "不是 JSON",  # 第一次不合规，带错误重问
        "```json\n" + json.dumps({"name": "白衬衫", "gender": "女", "category": "内搭",
                                  "color": ["白"], "season": ["春", "盛夏"], "description": "d"}, ensure_ascii=False) + "\n```",
    ]
    r = client.post("/api/items/auto-tag", files={"file": ("a.jpg", jpeg(), "image/jpeg")}, headers=auth("alice"))
    assert r.status_code == 200, r.text
    assert r.json() == {"name": "白衬衫", "gender": "female", "category": "内搭",
                        "color": ["白"], "season": ["春"], "description": "d"}
    # 图片随同一个 LLM_MODEL 的请求发出（模型须多模态），不再走单独的视觉模型
    assert any(part.get("type") == "image_url" for part in llm.calls[0]["messages"][0]["content"])


def _outfit(client, *items):
    r = client.post("/api/outfits", json={"item_ids": [i["id"] for i in items]}, headers=auth("alice"))
    assert r.status_code == 200, r.text
    return r.json()


def _add_photo(client):
    client.post("/api/me/photos", files={"file": ("me.jpg", jpeg(), "image/jpeg")}, headers=auth("alice"))


def test_generation_single_mode(client, image_gen):
    coat = create_item(client, "外套", "风衣")
    top = create_item(client, "内搭", "衬衫")
    outfit = _outfit(client, coat, top)
    _add_photo(client)

    r = client.post("/api/generations", json={"outfit_id": outfit["id"]}, headers=auth("alice"))
    assert r.status_code == 200, r.text
    gen = client.get(f"/api/generations/{r.json()['id']}", headers=auth("alice")).json()
    assert gen["status"] == "done", gen
    assert get_storage().exists(gen["result_path"])
    # 一次调用：人物 + 两件单品；提示词里内搭在外套之前（从内到外）
    assert image_gen.calls[0]["n_images"] == 3
    p = image_gen.calls[0]["prompt"]
    assert p.index("衬衫") < p.index("风衣")
    assert _charges() == [("tryon", gen["id"])]



def test_generation_requires_photo(client, image_gen):
    outfit = _outfit(client, create_item(client, "内搭", "衬衫"))
    r = client.post("/api/generations", json={"outfit_id": outfit["id"]}, headers=auth("alice"))
    assert r.status_code == 400 and "照片" in r.json()["detail"]
    assert image_gen.calls == [] and _charges() == []


def test_generation_failure_not_charged(client, image_gen):
    def boom(images, prompt):
        from app.providers.errors import ProviderError
        raise ProviderError("生图服务挂了")

    image_gen.edit = boom
    _add_photo(client)
    outfit = _outfit(client, create_item(client, "内搭", "衬衫"))
    gen_id = client.post("/api/generations", json={"outfit_id": outfit["id"]}, headers=auth("alice")).json()["id"]
    gen = client.get(f"/api/generations/{gen_id}", headers=auth("alice")).json()
    assert gen["status"] == "failed" and "挂了" in gen["params"]["error"]
    assert _charges() == []


def test_image_normalize_is_padded_and_charged(client, image_gen):
    r = client.post(
        "/api/images/generate",
        files={"source": ("s.jpg", jpeg(), "image/jpeg")},
        data={"kind": "item_normalize"},
        headers=auth("alice"),
    )
    assert r.status_code == 200
    assert Image.open(io.BytesIO(r.content)).size == (1280, 1280)
    assert [a for a, _ in _charges()] == ["image_normalize"]


def test_image_edit_requires_prompt(client, image_gen):
    r = client.post("/api/images/generate", files={"source": ("s.jpg", jpeg(), "image/jpeg")},
                    data={"kind": "item_edit", "prompt": "  "}, headers=auth("alice"))
    assert r.status_code == 400 and image_gen.calls == []


def test_deleting_item_keeps_outfit(client):
    top = create_item(client, "内搭", "衬衫")
    bottom = create_item(client, "下装", "裤子")
    outfit = _outfit(client, top, bottom)
    client.delete(f"/api/items/{top['id']}", headers=auth("alice"))
    got = client.get(f"/api/outfits/{outfit['id']}", headers=auth("alice")).json()
    assert [i["id"] for i in got["items"]] == [bottom["id"]]
    with SessionLocal() as db:  # 外键级联真的生效了，没有悬空关联行
        assert db.scalars(select(OutfitItem).where(OutfitItem.item_id == top["id"])).all() == []
