"""drop wishlist

Revision ID: 82f0c56b2dcc
Revises: 046833640979
Create Date: 2026-09-25 01:42:31.029606
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '82f0c56b2dcc'
down_revision: Union[str, None] = '046833640979'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('item', schema=None) as batch_op:
        batch_op.drop_column('is_in_wishlist')


def downgrade() -> None:
    # 已有行需要默认值，否则 NOT NULL 列加不上
    with op.batch_alter_table('item', schema=None) as batch_op:
        batch_op.add_column(
            sa.Column('is_in_wishlist', sa.BOOLEAN(), nullable=False, server_default=sa.false())
        )
