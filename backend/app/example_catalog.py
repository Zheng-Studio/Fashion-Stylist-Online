"""Versioned example garments and fixed first-run outfits. No user wardrobe rows."""
import json
from functools import lru_cache
from pathlib import Path

CATALOG_PATH = Path(__file__).resolve().parent.parent / "sample" / "example_items.json"

SCENES = {
    "female": [
        {"id": "casual", "name": "轻松日常", "hint": "条纹长袖 · 牛仔裤 · 运动鞋", "item_ids": ["W04", "W08", "W13"]},
        {"id": "work", "name": "利落通勤", "hint": "衬衫 · 短西装 · 西裤 · 乐福鞋", "item_ids": ["W02", "W07", "W09", "W14"]},
        {"id": "date", "name": "温柔约会", "hint": "针织衫 · A 字裙 · 短靴", "item_ids": ["W01", "W10", "W15"]},
    ],
    "male": [
        {"id": "casual", "name": "轻松日常", "hint": "T 恤 · 牛仔裤 · 运动鞋", "item_ids": ["M02", "M08", "M13"]},
        {"id": "work", "name": "利落通勤", "hint": "衬衫 · 西裤 · 德比鞋", "item_ids": ["M01", "M09", "M14"]},
        {"id": "outdoor", "name": "城市户外", "hint": "T 恤 · 工装夹克 · 卡其裤 · 运动鞋", "item_ids": ["M02", "M06", "M10", "M13"]},
    ],
}


@lru_cache
def catalog() -> dict[str, dict]:
    return {item["id"]: item for item in json.loads(CATALOG_PATH.read_text(encoding="utf-8"))}


def scene_for(gender: str, scene_id: str) -> dict | None:
    return next((scene for scene in SCENES.get(gender, []) if scene["id"] == scene_id), None)


def scene_list(gender: str, need: str = "") -> list[dict]:
    scenes = SCENES.get(gender, [])
    needle = need.strip()
    preferred = "work" if any(w in needle for w in ("通勤", "上班", "工作")) else (
        "date" if gender == "female" and any(w in needle for w in ("约会", "见面")) else (
            "outdoor" if gender == "male" and any(w in needle for w in ("户外", "出行")) else "casual"
        )
    )
    return [
        {**scene, "items": [catalog()[item_id] for item_id in scene["item_ids"]], "recommended": scene["id"] == preferred}
        for scene in scenes
    ]
