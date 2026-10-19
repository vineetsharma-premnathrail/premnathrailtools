"""Roles: assign-to rules (roles.assignee_rules) — who a role's members may
pick in an "Assign to" field (core/assignee_rules.py).

Revision ID: f1b6d3a8c472
Revises: e7a3c9d1f582
"""
from alembic import op
import sqlalchemy as sa

revision = "f1b6d3a8c472"
down_revision = "e7a3c9d1f582"
branch_labels = None
depends_on = None


def upgrade() -> None:
    cols = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("roles")}
    if "assignee_rules" not in cols:
        with op.batch_alter_table("roles") as batch:
            batch.add_column(sa.Column("assignee_rules", sa.JSON(), nullable=False, server_default="{}"))


def downgrade() -> None:
    with op.batch_alter_table("roles") as batch:
        batch.drop_column("assignee_rules")
