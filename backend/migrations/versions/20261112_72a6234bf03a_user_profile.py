"""user profile

Revision ID: 72a6234bf03a
Revises: 7b4e2c91
Create Date: 2026-11-12 17:26:44.502151
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '72a6234bf03a'
down_revision: Union[str, None] = '7b4e2c91'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 两项都可为空：老用户没有估计值，用户也可以清空。
    with op.batch_alter_table("user") as batch:
        batch.add_column(sa.Column("age", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("height_cm", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("user") as batch:
        batch.drop_column("height_cm")
        batch.drop_column("age")
