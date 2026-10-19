"""R&D projects: multiple project leads (lead_ids JSON list), backfilled
from the single lead_id.

Revision ID: a9d3e5f7b1c2
Revises: f4b8d2c6a1e9
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa

revision = "a9d3e5f7b1c2"
down_revision = "f4b8d2c6a1e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("rnd_projects")}
    if "lead_ids" not in cols:
        op.add_column("rnd_projects", sa.Column("lead_ids", sa.JSON(), nullable=False, server_default="[]"))
    op.execute(
        "UPDATE rnd_projects SET lead_ids = json_build_array(lead_id) "
        "WHERE lead_id IS NOT NULL AND (lead_ids IS NULL OR lead_ids::text = '[]')"
    )


def downgrade() -> None:
    op.drop_column("rnd_projects", "lead_ids")
