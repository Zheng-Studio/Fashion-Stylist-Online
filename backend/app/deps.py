"""FastAPI 依赖：当前用户 + 各个可替换实现（测试里用 dependency_overrides 换成假的）。"""
from functools import lru_cache

from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import AuthProvider, get_auth_provider
from app.billing import Billing, get_billing  # noqa: F401  （给路由统一从这里取）
from app.config import get_settings
from app.db import get_db
from app.models import User
from app.providers.image import ImageGen, OpenAICompatImage
from app.providers.llm import LLM, OpenAICompatLLM
from app.storage import Storage, get_storage  # noqa: F401


@lru_cache
def get_llm() -> LLM:
    return OpenAICompatLLM(get_settings())


@lru_cache
def get_image_gen() -> ImageGen:
    return OpenAICompatImage(get_settings())


def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
    auth: AuthProvider = Depends(get_auth_provider),
) -> User:
    """认出平台用户；第一次来就建一条 user 记录。"""
    ident = auth.authenticate(request)
    user = db.scalar(select(User).where(User.external_id == ident.external_id))
    if user is None:
        user = User(external_id=ident.external_id, name=ident.name or "", photos=[])
        db.add(user)
        try:
            db.commit()
        except IntegrityError:  # 同一用户并发首访，另一个请求先建好了
            db.rollback()
            user = db.scalar(select(User).where(User.external_id == ident.external_id))
    return user
