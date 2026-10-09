"""全部配置走环境变量（或 backend/.env），部署时由运维注入，代码里不写死任何地址/密钥/模型名。"""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    database_url: str = f"sqlite:///{(BACKEND_DIR / 'data' / 'app.db').as_posix()}"

    # 大模型（OpenAI 兼容）
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = ""  # 选款和自动打标共用，须支持看图（多模态）
    llm_json_mode: str = "json_object"  # json_schema / json_object / none
    llm_timeout: float = 120

    # 生图（OpenAI 兼容 images/generations + images）；base_url / key 为空则沿用 LLM 的
    image_base_url: str = ""
    image_api_key: str = ""
    image_model: str = ""
    image_size: str = ""  # 空 = 不传，由接口默认
    image_timeout: float = 300

    # 文件存储（本地实现；以后换对象存储只换 storage 实现）
    storage_dir: Path = BACKEND_DIR / "data" / "files"
    files_url_prefix: str = "/files/"

    # 登录 / 扣费
    auth_mode: str = "dev"  # dev / lucimix
    dev_default_user: str = "dev"
    billing_mode: str = "ledger"  # ledger（只记流水）/ lucimix

    # 后台任务并发（生图）
    task_workers: int = 2

    cors_origins: list[str] = ["*"]

    @property
    def image_base(self) -> str:
        return self.image_base_url or self.llm_base_url

    @property
    def image_key(self) -> str:
        return self.image_api_key or self.llm_api_key


@lru_cache
def get_settings() -> Settings:
    return Settings()
