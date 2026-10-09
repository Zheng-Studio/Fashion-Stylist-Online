"""文件存储。

业务代码只认 key（如 u/<user_id>/items/<uuid>.jpg），不认磁盘路径或 URL：
- 本地开发用 LocalStorage，文件由后端挂在 FILES_URL_PREFIX（默认 /files/）下；
- 上线换对象存储（OSS/COS/S3）时新增一个实现即可，前端按「前缀 + key」拼 URL。

key 一律带 uuid、写入后不再原地修改（旋转等操作都写新 key），所以 URL 天然不可变，
缓存/CDN 不会拿到旧图——家庭版为了原地覆盖的图专门搞过一套 mtime 版本号，这里不需要了。
"""
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from app.config import get_settings


class Storage(Protocol):
    def put(self, key: str, data: bytes) -> None: ...
    def get(self, key: str) -> bytes: ...
    def exists(self, key: str) -> bool: ...
    def delete(self, key: str) -> None: ...


def new_key(user_id: str, kind: str, ext: str = "jpg") -> str:
    """kind: items / photos / generations"""
    return f"u/{user_id}/{kind}/{uuid.uuid4().hex}.{ext}"


def owned_by(key: str, user_id: str) -> bool:
    return isinstance(key, str) and key.startswith(f"u/{user_id}/")


class LocalStorage:
    def __init__(self, root: Path):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root not in p.parents:
            raise ValueError(f"非法的存储 key：{key}")
        return p

    def put(self, key: str, data: bytes) -> None:
        p = self._path(key)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)

    def get(self, key: str) -> bytes:
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError as e:
            raise FileNotFoundError(f"文件不存在：{key}") from e

    def exists(self, key: str) -> bool:
        try:
            return self._path(key).is_file()
        except ValueError:
            return False

    def delete(self, key: str) -> None:
        try:
            self._path(key).unlink(missing_ok=True)
        except ValueError:
            pass


@lru_cache
def get_storage() -> Storage:
    return LocalStorage(get_settings().storage_dir)
