"""R&D tasks: priority, start date, work status and checklist.

Added to both requirement tasks and project tasks (they share one task board).

Revision ID: c9a4e2f7b1d3
Revises: b7e3c1d9f4a2
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa

revision = "c9a4e2f7b1d3"
down_revision = "b7e3c1d9f4a2"
branch_labels = None
depends_on = None

TABLES = ("rnd_requirement_tasks", "rnd_project_tasks")


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table in TABLES:
        cols = {c["name"] for c in inspector.get_columns(table)}
        with op.batch_alter_table(table) as batch:
            if "priority" not in cols:
                batch.add_column(sa.Column("priority", sa.String(10), nullable=False, server_default="medium"))
            if "start_date" not in cols:
                batch.add_column(sa.Column("start_date", sa.Date(), nullable=True))
            if "work_status" not in cols:
                batch.add_column(sa.Column("work_status", sa.String(20), nullable=False, server_default="not_started"))
            if "checklist" not in cols:
                batch.add_column(sa.Column("checklist", sa.JSON(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table in TABLES:
        cols = {c["name"] for c in inspector.get_columns(table)}
        with op.batch_alter_table(table) as batch:
            for name in ("checklist", "work_status", "start_date", "priority"):
                if name in cols:
                    batch.drop_column(name)
