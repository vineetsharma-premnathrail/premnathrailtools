"""add purchase requisitions module

Revision ID: 96f882353283
Revises: 6f8a8c6a60c7
Create Date: 2026-07-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '96f882353283'
down_revision: Union[str, Sequence[str], None] = '6f8a8c6a60c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Creates `purchase_requisitions` and `purchase_requisition_items` (both
    # brand new, and both long since dropped again by
    # b8e2f4a6c1d9_migrate_purchase_requisitions_to_p2p — the whole
    # `purchase` module was replaced by P2PRequest). This can no longer
    # reflect off Base.metadata.tables[...] like it originally did, because
    # that model doesn't exist in the codebase at all anymore, so a fresh
    # database replaying every migration in order got a KeyError here. The
    # exact shape below is preserved from b8e2f4a6c1d9's own downgrade(),
    # which recreates these same two tables in their final, pre-drop form —
    # it's dead schema either way, alive for exactly one migration.
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())

    if "purchase_requisitions" not in existing_tables:
        op.create_table(
            "purchase_requisitions",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("pr_number", sa.String(length=50), nullable=False, unique=True, index=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("erp_projects.id"), nullable=False, index=True),
            sa.Column("service_request_id", sa.Integer(), sa.ForeignKey("erp_service_requests.id"), nullable=False, index=True),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="submitted"),
            sa.Column("raised_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("priority", sa.String(length=10), nullable=False, server_default="medium"),
            sa.Column("required_by_date", sa.Date(), nullable=True),
            sa.Column("purchase_reason", sa.Text(), nullable=True),
            sa.Column("category_code", sa.String(length=10), nullable=True),
            sa.Column("requirement_type", sa.String(length=50), nullable=True),
            sa.Column("approver_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("approver_name", sa.String(length=150), nullable=True),
            sa.Column("vendor", sa.String(length=255), nullable=True),
            sa.Column("po_number", sa.String(length=100), nullable=True),
            sa.Column("po_date", sa.Date(), nullable=True),
            sa.Column("expected_delivery_date", sa.Date(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("closed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )

    if "purchase_requisition_items" not in existing_tables:
        op.create_table(
            "purchase_requisition_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("purchase_requisition_id", sa.Integer(), sa.ForeignKey("purchase_requisitions.id"), nullable=False),
            sa.Column("service_material_id", sa.Integer(), sa.ForeignKey("erp_service_materials.id"), nullable=False),
            sa.Column("material_name", sa.String(length=255), nullable=False),
            sa.Column("part_number", sa.String(length=100), nullable=True),
            sa.Column("unit", sa.String(length=20), nullable=False, server_default="pcs"),
            sa.Column("quantity_requested", sa.Float(), nullable=False, server_default="1"),
            sa.Column("quantity_received", sa.Float(), nullable=False, server_default="0"),
            sa.Column("item_status", sa.String(length=20), nullable=False, server_default="pending"),
            sa.Column("remarks", sa.String(length=1000), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        )

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
