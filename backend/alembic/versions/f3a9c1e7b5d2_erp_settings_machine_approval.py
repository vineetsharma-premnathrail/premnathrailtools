"""Service settings: machine approval columns on erp_projects
(approval_status / approved_by_id / approved_at / approval_remarks /
created_by_id). Existing machines are backfilled 'approved' via the server
default, so nothing already in use gets blocked.

Revision ID: f3a9c1e7b5d2
Revises: e7b2c4f9a1d3
Create Date: 2026-10-07 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision = "f3a9c1e7b5d2"
down_revision = "e7b2c4f9a1d3"
branch_labels = None
depends_on = None

_TABLE = "erp_projects"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in set(inspector.get_table_names()):
        return
    columns = {c["name"] for c in inspector.get_columns(_TABLE)}
    with op.batch_alter_table(_TABLE) as batch:
        if "approval_status" not in columns:
            batch.add_column(sa.Column("approval_status", sa.String(length=20), nullable=False, server_default="approved"))
        if "approved_by_id" not in columns:
            batch.add_column(sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_erp_projects_approved_by"), nullable=True))
        if "approved_at" not in columns:
            batch.add_column(sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True))
        if "approval_remarks" not in columns:
            batch.add_column(sa.Column("approval_remarks", sa.Text(), nullable=True))
        if "created_by_id" not in columns:
            batch.add_column(sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL", name="fk_erp_projects_created_by"), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if _TABLE not in set(inspector.get_table_names()):
        return
    columns = {c["name"] for c in inspector.get_columns(_TABLE)}
    with op.batch_alter_table(_TABLE) as batch:
        for col in ("created_by_id", "approval_remarks", "approved_at", "approved_by_id", "approval_status"):
            if col in columns:
                batch.drop_column(col)
