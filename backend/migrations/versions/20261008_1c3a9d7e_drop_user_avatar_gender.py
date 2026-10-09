"""drop user avatar and gender fields

Revision ID: 1c3a9d7e
Revises: 82f0c56b2dcc
Create Date: 2026-10-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "1c3a9d7e"
down_revision: Union[str, None] = "82f0c56b2dcc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.drop_column("avatar")
        batch_op.drop_column("gender")


def downgrade() -> None:
    with op.batch_alter_table("user", schema=None) as batch_op:
        batch_op.add_column(sa.Column("gender", sa.String(length=16), nullable=False, server_default=""))
        batch_op.add_column(sa.Column("avatar", sa.String(length=255), nullable=True))
