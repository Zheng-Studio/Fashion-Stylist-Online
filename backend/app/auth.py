"""登录：从请求里认出「是哪个平台用户」。

前端从 Lucimix 拿到 token 后，每个请求带 `Authorization: Bearer <token>`
（iframe 里是第三方上下文，cookie 会被浏览器拦，所以不用 cookie）。

- dev 模式：token 本身就当作用户标识，不带则用 DEV_DEFAULT_USER。本地开发、测试用。
- lucimix 模式：拿 token 去平台校验换用户信息。接口规格确定后在 LucimixAuth 里实现。
"""
from dataclasses import dataclass
from functools import lru_cache
from typing import Protocol

from fastapi import HTTPException, Request

from app.config import get_settings


@dataclass
class Identity:
    external_id: str
    name: str | None = None


class AuthProvider(Protocol):
    def authenticate(self, request: Request) -> Identity: ...


def bearer_token(request: Request) -> str:
    h = request.headers.get("Authorization", "")
    return h[7:].strip() if h.lower().startswith("bearer ") else ""


class DevAuth:
    def __init__(self, default_user: str):
        self.default_user = default_user

    def authenticate(self, request: Request) -> Identity:
        uid = bearer_token(request) or self.default_user
        if not uid:
            raise HTTPException(401, "未登录")
        return Identity(external_id=uid[:128])


class LucimixAuth:
    """TODO：Lucimix 登录接口规格确定后实现——用 token 调平台接口换用户 id / 昵称。"""

    def authenticate(self, request: Request) -> Identity:
        if not bearer_token(request):
            raise HTTPException(401, "未登录")
        raise HTTPException(501, "Lucimix 登录尚未接入")


@lru_cache
def get_auth_provider() -> AuthProvider:
    s = get_settings()
    if s.auth_mode == "dev":
        return DevAuth(s.dev_default_user)
    if s.auth_mode == "lucimix":
        return LucimixAuth()
    raise RuntimeError(f"未知的 AUTH_MODE：{s.auth_mode}")
