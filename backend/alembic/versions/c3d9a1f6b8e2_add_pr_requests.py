"""add standalone purchase requisition (pr_requests) tables

Revision ID: c3d9a1f6b8e2
Revises: a5d2f8c1e4b7
Create Date: 2026-08-13 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c3d9a1f6b8e2'
down_revision: Union[str, Sequence[str], None] = 'a5d2f8c1e4b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    inspector = sa.inspect(op.get_bind())
    existing_tables = set(inspector.get_table_names())

    if "pr_requests" not in existing_tables:
        op.create_table(
            "pr_requests",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("pr_number", sa.String(length=50), nullable=False),
            sa.Column("category_code", sa.String(length=10), nullable=False),

            sa.Column("project_label", sa.String(length=255), nullable=True),
            sa.Column("required_date", sa.Date(), nullable=True),
            sa.Column("requirement_type", sa.String(length=50), nullable=True),
            sa.Column("request_date", sa.Date(), nullable=False),
            sa.Column("department", sa.String(length=100), nullable=True),
            sa.Column("requested_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),

            sa.Column("priority", sa.String(length=10), nullable=False, server_default="medium"),
            sa.Column("approver_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("approver_name", sa.String(length=150), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),

            sa.Column("status", sa.String(length=30), nullable=False, server_default="submitted"),
            sa.Column("approved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("rejected_reason", sa.Text(), nullable=True),
            sa.Column("cancelled_reason", sa.Text(), nullable=True),
            sa.Column("closed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),

            sa.Column("assigned_buyer_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("assignment_date", sa.Date(), nullable=True),

            sa.Column("vendor", sa.String(length=255), nullable=True),
            sa.Column("rfq_number", sa.String(length=100), nullable=True),
            sa.Column("quotation", sa.String(length=255), nullable=True),
            sa.Column("quotation_date", sa.Date(), nullable=True),
            sa.Column("vendor_comparison", sa.Text(), nullable=True),
            sa.Column("selected_vendor", sa.String(length=255), nullable=True),

            sa.Column("po_number", sa.String(length=100), nullable=True),
            sa.Column("po_date", sa.Date(), nullable=True),
            sa.Column("po_value", sa.Float(), nullable=True),
            sa.Column("expected_delivery", sa.Date(), nullable=True),

            sa.Column("ordered_quantity", sa.Float(), nullable=True),
            sa.Column("received_quantity", sa.Float(), nullable=True),
            sa.Column("receipt_status", sa.String(length=20), nullable=True),
            sa.Column("grn_number", sa.String(length=100), nullable=True),
            sa.Column("receipt_date", sa.Date(), nullable=True),
            sa.Column("receiving_remarks", sa.Text(), nullable=True),

            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_pr_requests_pr_number", "pr_requests", ["pr_number"], unique=True)

    if "pr_request_items" not in existing_tables:
        op.create_table(
            "pr_request_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("pr_request_id", sa.Integer(), sa.ForeignKey("pr_requests.id"), nullable=False),
            sa.Column("item_name", sa.String(length=255), nullable=False),
            sa.Column("part_code", sa.String(length=100), nullable=True),
            sa.Column("model_number", sa.String(length=100), nullable=True),
            sa.Column("unit", sa.String(length=20), nullable=True),
            sa.Column("quantity", sa.Float(), nullable=False, server_default="1"),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("estimated_budget", sa.Float(), nullable=True),
            sa.Column("reason", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )

    if "pr_request_attachments" not in existing_tables:
        op.create_table(
            "pr_request_attachments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("pr_request_id", sa.Integer(), sa.ForeignKey("pr_requests.id"), nullable=False),
            sa.Column("doc_type", sa.String(length=20), nullable=False, server_default="supporting"),
            sa.Column("filename", sa.String(length=255), nullable=False),
            sa.Column("content_type", sa.String(length=255), nullable=True),
            sa.Column("size", sa.Integer(), nullable=True),
            sa.Column("sharepoint_path", sa.String(length=1000), nullable=True),
            sa.Column("sharepoint_url", sa.String(length=1000), nullable=True),
            sa.Column("created_by_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table("pr_request_attachments")
    op.drop_table("pr_request_items")
    op.drop_index("ix_pr_requests_pr_number", table_name="pr_requests")
    op.drop_table("pr_requests")
