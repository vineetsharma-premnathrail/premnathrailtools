"""Roles: UI visibility rules (roles.visibility_rules) — which sections,
dropdown values and table columns a role's members see (core/visibility.py).

Revision ID: a4e7c1b9d306
Revises: b8d2f6a1c3e5
"""
from alembic import op
import sqlalchemy as sa

revision = "a4e7c1b9d306"
down_revision = "b8d2f6a1c3e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("roles")}
    if "visibility_rules" not in cols:
        with op.batch_alter_table("roles") as batch:
            batch.add_column(sa.Column("visibility_rules", sa.JSON(), nullable=False, server_default="{}"))


def downgrade() -> None:
    with op.batch_alter_table("roles") as batch:
        batch.drop_column("visibility_rules")
