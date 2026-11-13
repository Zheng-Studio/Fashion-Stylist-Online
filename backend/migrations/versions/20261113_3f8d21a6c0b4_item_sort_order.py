"""item sort order

Revision ID: 3f8d21a6c0b4
Revises: 72a6234bf03a
Create Date: 2026-11-13 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '3f8d21a6c0b4'
down_revision: Union[str, None] = '72a6234bf03a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("item") as batch:
        batch.add_column(sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"))

    # 回填：保持迁移前衣橱的默认顺序（创建时间新 → 旧），每个用户从 0 开始编号。
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, user_id FROM item ORDER BY user_id, created_at DESC, id")).fetchall()
    counters: dict[str, int] = {}
    for item_id, user_id in rows:
        n = counters.get(user_id, 0)
        conn.execute(sa.text("UPDATE item SET sort_order = :n WHERE id = :id"), {"n": n, "id": item_id})
        counters[user_id] = n + 1


def downgrade() -> None:
    with op.batch_alter_table("item") as batch:
        batch.drop_column("sort_order")
