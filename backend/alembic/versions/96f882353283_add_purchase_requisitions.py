"""add purchase requisitions module

Revision ID: 96f882353283
Revises: 6f8a8c6a60c7
Create Date: 2026-07-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from app.db.base import Base


# revision identifiers, used by Alembic.
revision: str = '96f882353283'
down_revision: Union[str, Sequence[str], None] = '6f8a8c6a60c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Creates `purchase_requisitions` and `purchase_requisition_items` (both
    # brand new). Idempotent/checkfirst like the baseline migration, so it's
    # a no-op for tables that already exist (e.g. re-running on a database
    # that was provisioned after these models existed).
    Base.metadata.create_all(bind=op.get_bind(), tables=[
        Base.metadata.tables["purchase_requisitions"],
        Base.metadata.tables["purchase_requisition_items"],
    ])

    # create_all() only creates brand-new tables, it can't ALTER an existing
    # one — so the new PR-linkage columns on `erp_service_materials` need to
    # be added explicitly, guarded so this stays a no-op if they're already
    # there (e.g. a fresh DB provisioned straight from the current models).
    inspector = sa.inspect(op.get_bind())
    existing_columns = {c["name"] for c in inspector.get_columns("erp_service_materials")}

    def add_column_if_missing(column: sa.Column) -> None:
        if column.name not in existing_columns:
            op.add_column("erp_service_materials", column)

    add_column_if_missing(sa.Column("pr_id", sa.Integer(), sa.ForeignKey("purchase_requisitions.id"), nullable=True))
    add_column_if_missing(sa.Column("pr_number", sa.String(length=50), nullable=True))
    add_column_if_missing(sa.Column("pr_status", sa.String(length=30), nullable=True))
    add_column_if_missing(sa.Column("received_quantity", sa.Float(), server_default=sa.text("0"), nullable=False))
    add_column_if_missing(sa.Column("receiving_status", sa.String(length=20), server_default=sa.text("'pending'"), nullable=False))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("erp_service_materials", "receiving_status")
    op.drop_column("erp_service_materials", "received_quantity")
    op.drop_column("erp_service_materials", "pr_status")
    op.drop_column("erp_service_materials", "pr_number")
    op.drop_column("erp_service_materials", "pr_id")
    op.drop_table("purchase_requisition_items")
    op.drop_table("purchase_requisitions")
