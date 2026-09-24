"""选款结果的 JSON Schema。

这一份 schema 同时被两处使用：
1. LLM_JSON_MODE=json_schema 时作为 response_format 传给模型，强制按结构吐 JSON；
2. 校验阶段作为"字段是否完整、类型是否正确"的判断依据。

供应商不支持 json_schema 时（json_object / none），靠 SCHEMA_HINT 写进 system prompt 约定结构，
再由 validator 兜底校验。

LLM 只负责挑 id 和给理由；单品的完整信息由后端 enrich 阶段回填。
"""

# 通用 JSON Schema。故意保持精简，字段越少模型越稳。
RECOMMEND_SCHEMA = {
    "type": "object",
    "properties": {
        "analysis": {
            "type": "string",
            "description": "先复述需求要点（场合/风格/颜色/硬约束），想清楚再选款",
        },
        "outfit": {
            "type": "array",
            "description": "选中单品的 id 列表，必须来自给定的候选清单",
            "items": {"type": "string"},
        },
        "reason": {
            "type": "string",
            "description": "为什么这样搭配的一句话说明",
        },
        "confidence": {
            "type": "number",
            "description": "0~1 之间的自信度",
        },
    },
    # analysis 放最前并设为必填，引导模型「先分析后选款」。
    "required": ["analysis", "outfit", "reason"],
}

# 不走 json_schema 模式时，把结构用文字告诉模型（json_object 模式还要求 prompt 里出现 "JSON" 字样）。
SCHEMA_HINT = (
    "输出一个 JSON 对象，字段：\n"
    "- analysis（字符串）：先复述需求要点（场合/风格/颜色/硬约束）\n"
    "- outfit（字符串数组）：选中单品的编号，只能来自候选清单\n"
    "- reason（字符串）：一句中文说明搭配思路\n"
    "- confidence（数字，0~1，可选）：自信度\n"
    '示例：{"analysis": "...", "outfit": ["内搭1", "下装2", "鞋1"], "reason": "...", "confidence": 0.8}'
)
