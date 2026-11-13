"""image job (item background generation)

Revision ID: 9c4e7b2d1a55
Revises: 3f8d21a6c0b4
Create Date: 2026-11-13 18:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '9c4e7b2d1a55'
down_revision: Union[str, None] = '3f8d21a6c0b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "image_job",
        sa.Column("id", sa.String(length=32), nullable=False),
        sa.Column("user_id", sa.String(length=32), nullable=False),
        sa.Column("item_id", sa.String(length=32), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("source_image_id", sa.String(length=32), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("error", sa.Text(), nullable=False),
        sa.Column("dismissed", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["item_id"], ["item.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_image_job_item_id"), "image_job", ["item_id"], unique=False)
    op.create_index(op.f("ix_image_job_user_id"), "image_job", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_image_job_user_id"), table_name="image_job")
    op.drop_index(op.f("ix_image_job_item_id"), table_name="image_job")
    op.drop_table("image_job")
