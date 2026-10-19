"""CRM ↔ R&D channel: assignee, due date and response per Technical Offer Request

Revision ID: e4a7c1d9b2f3
Revises: c2d4e6f8a0b1
Create Date: 2026-10-06
"""
from alembic import op
import sqlalchemy as sa

revision = "e4a7c1d9b2f3"
down_revision = "c2d4e6f8a0b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "crm_rnd_requests" in inspector.get_table_names():
        return
    op.create_table(
        "crm_rnd_requests",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=False),
        sa.Column("movement_log_id", sa.Integer(), sa.ForeignKey("audit_logs.id"), nullable=True),
        sa.Column("offer_number", sa.String(length=50), nullable=True),
        sa.Column("assigned_to_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("crm_remarks", sa.Text(), nullable=True),
        sa.Column("requested_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
        sa.Column("response_remarks", sa.Text(), nullable=True),
        sa.Column("delay_reason", sa.Text(), nullable=True),
        sa.Column("responded_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_crm_rnd_requests_record_id", "crm_rnd_requests", ["record_id"])
    op.create_index("ix_crm_rnd_requests_movement_log_id", "crm_rnd_requests", ["movement_log_id"])
    op.create_index("ix_crm_rnd_requests_assigned_to_id", "crm_rnd_requests", ["assigned_to_id"])


def downgrade() -> None:
    op.drop_index("ix_crm_rnd_requests_assigned_to_id", table_name="crm_rnd_requests")
    op.drop_index("ix_crm_rnd_requests_movement_log_id", table_name="crm_rnd_requests")
    op.drop_index("ix_crm_rnd_requests_record_id", table_name="crm_rnd_requests")
    op.drop_table("crm_rnd_requests")
