"""PM: more than one responsible person on a milestone —
pm_project_tasks.co_owner_ids (JSON list of user ids, besides assignee_id).

Revision ID: e3b9f2a6c814
Revises: b8e4c1d6f372
"""
from alembic import op
import sqlalchemy as sa

revision = "e3b9f2a6c814"
down_revision = "b8e4c1d6f372"
branch_labels = None
depends_on = None

_TABLE = "pm_project_tasks"


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns(_TABLE)}
    if "co_owner_ids" not in existing:
        with op.batch_alter_table(_TABLE) as batch:
            batch.add_column(sa.Column("co_owner_ids", sa.JSON(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table(_TABLE) as batch:
        batch.drop_column("co_owner_ids")
