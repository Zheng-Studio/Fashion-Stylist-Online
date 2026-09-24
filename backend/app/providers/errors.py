class ProviderError(RuntimeError):
    """外部模型服务不可用 / 未配置 / 返回异常。上层转成 502/503 给前端可读提示。"""
