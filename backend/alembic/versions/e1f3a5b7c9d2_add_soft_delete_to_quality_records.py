"""add soft delete to quality records

Quality records (NCRs, CAPAs, complaints, inspections, rejections, and the
controlled standards/checklists/plans/scorecards) were hard-deleted, so a
record could vanish without a trace. They now soft-delete via
SoftDeleteMixin and every change is written to audit_logs
(app/core/audit.py).

Revision ID: e1f3a5b7c9d2
Revises: d0e2f4a6b8c1
Create Date: 2026-09-29 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'e1f3a5b7c9d2'
down_revision = 'd0e2f4a6b8c1'
branch_labels = None
depends_on = None

_TABLES = (
    "quality_ncrs",
    "quality_capas",
    "quality_customer_complaints",
    "quality_inspections",
    "quality_inspection_plans",
    "quality_rejections",
    "quality_standards",
    "quality_checklists",
    "quality_supplier_scorecards",
)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table in _TABLES:
        columns = {c["name"] for c in inspector.get_columns(table)}
        with op.batch_alter_table(table) as batch:
            if "is_deleted" not in columns:
                batch.add_column(sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()))
            if "deleted_at" not in columns:
                batch.add_column(sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    for table in _TABLES:
        with op.batch_alter_table(table) as batch:
            batch.drop_column("deleted_at")
            batch.drop_column("is_deleted")
