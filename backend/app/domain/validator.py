"""校验 LLM 输出。

把校验拆成一条条具名检查项，每条返回 ok / 说明，方便前端逐条
打勾或叉。这一步对应 PRD 里「把校验过程展示出来」。
"""
import json
import re

# 有些模型即使要求纯 JSON 也会包一层 ```json 围栏，先剥掉再解析
_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")


def validate_output(raw_content: str, valid_ids: set[str]) -> dict:
    """对模型原始输出做逐项校验。

    返回 {parsed, checks, passed}：
      parsed —— 解析出来的 JSON（失败为 None）
      checks —— [{name, ok, detail}] 逐条结果
      passed —— 是否全部通过
    """
    checks: list[dict] = []
    parsed = None

    # 1. 能否解析成 JSON
    try:
        parsed = json.loads(_FENCE.sub("", (raw_content or "").strip()))
        checks.append({"name": "JSON 可解析", "ok": True, "detail": "输出是合法 JSON"})
    except (TypeError, ValueError) as e:
        checks.append({"name": "JSON 可解析", "ok": False, "detail": f"解析失败：{e}"})
        return {"parsed": None, "checks": checks, "passed": False}
    if not isinstance(parsed, dict):
        checks.append({"name": "JSON 可解析", "ok": False, "detail": "输出不是 JSON 对象"})
        return {"parsed": None, "checks": checks, "passed": False}

    # 2. 必填字段存在
    has_outfit = isinstance(parsed.get("outfit"), list)
    checks.append({
        "name": "字段 outfit 存在且为数组",
        "ok": has_outfit,
        "detail": "ok" if has_outfit else "缺少 outfit 或类型不对",
    })
    has_reason = bool(parsed.get("reason"))
    checks.append({
        "name": "字段 reason 存在",
        "ok": has_reason,
        "detail": "ok" if has_reason else "缺少 reason",
    })

    # 3. outfit 里的 id 必须都在衣橱里（防止模型瞎编 id）
    outfit = parsed.get("outfit") or []
    unknown = [i for i in outfit if i not in valid_ids]
    ids_ok = has_outfit and len(outfit) > 0 and not unknown
    if not has_outfit:
        detail = "outfit 不是数组，跳过"
    elif not outfit:
        detail = "outfit 为空，没挑出单品"
    elif unknown:
        detail = f"这些 id 不在衣橱里：{unknown}"
    else:
        detail = f"全部 {len(outfit)} 个 id 都真实存在"
    checks.append({"name": "outfit 的 id 都真实存在", "ok": ids_ok, "detail": detail})

    passed = all(c["ok"] for c in checks)
    return {"parsed": parsed, "checks": checks, "passed": passed}
