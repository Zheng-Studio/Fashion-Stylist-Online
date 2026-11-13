"""档案估计的解析：值可缺省、可越界丢弃，但坏 JSON 要能被上层识别。"""
import pytest

from app.domain.profile import parse_profile_output
from app.domain.prompt_builder import format_profile


def test_parses_fenced_json_and_numeric_strings():
    out = parse_profile_output(
        '```json\n{"gender": "Female", "age": "27", "height_cm": 168.0}\n```'
    )
    assert out == {"gender": "female", "age": 27, "height_cm": 168}


def test_accepts_chinese_gender_and_keeps_unknown_blank():
    assert parse_profile_output('{"gender": "男"}')["gender"] == "male"
    assert parse_profile_output('{"gender": "unknown"}')["gender"] == ""
    assert parse_profile_output("{}") == {"gender": "", "age": None, "height_cm": None}


def test_out_of_range_or_non_integer_estimates_are_dropped():
    out = parse_profile_output('{"age": 300, "height_cm": "168cm"}')
    assert out["age"] is None and out["height_cm"] is None
    assert parse_profile_output('{"age": true}')["age"] is None


def test_rejects_non_json_output():
    with pytest.raises(ValueError):
        parse_profile_output("看起来像二十多岁")


def test_profile_text_only_includes_known_fields():
    assert format_profile(None) == ""
    assert format_profile({"gender": "female", "age": None, "height_cm": 170}) == "女，身高约 170 cm"
    assert format_profile({"gender": "", "age": 28, "height_cm": None}) == "28 岁"
