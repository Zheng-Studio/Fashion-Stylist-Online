"""first-run state and example outfits

Revision ID: 7b4e2c91
Revises: 1c3a9d7e
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "7b4e2c91"
down_revision: Union[str, None] = "1c3a9d7e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("user") as batch:
        batch.add_column(sa.Column("gender", sa.String(length=16), nullable=False, server_default=""))
        batch.add_column(sa.Column("onboarding_completed", sa.Boolean(), nullable=False, server_default=sa.false()))
    # Existing accounts keep their current workspace. Only accounts created after this migration enter onboarding.
    user = sa.table("user", sa.column("onboarding_completed", sa.Boolean()))
    op.execute(user.update().values(onboarding_completed=True))
    with op.batch_alter_table("outfit") as batch:
        batch.add_column(sa.Column("example_item_ids", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("outfit") as batch:
        batch.drop_column("example_item_ids")
    with op.batch_alter_table("user") as batch:
        batch.drop_column("onboarding_completed")
        batch.drop_column("gender")
