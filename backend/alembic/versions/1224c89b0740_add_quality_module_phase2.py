"""add quality module phase2

Revision ID: 1224c89b0740
Revises: 1da47fa70f0e
Create Date: 2026-09-25 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "1224c89b0740"
down_revision = "1da47fa70f0e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "quality_ncrs" not in tables:
        op.create_table(
            "quality_ncrs",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("ncr_number", sa.String(length=50), nullable=False),
            sa.Column("source", sa.String(length=20), nullable=False),
            sa.Column("severity", sa.String(length=20), nullable=False, server_default="minor"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
            sa.Column("inspection_id", sa.Integer(), sa.ForeignKey("quality_inspections.id"), nullable=True),
            sa.Column("item_name", sa.String(length=255), nullable=False),
            sa.Column("item_code", sa.String(length=100), nullable=True),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("root_cause", sa.Text(), nullable=True),
            sa.Column("raised_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("ncr_date", sa.Date(), nullable=False),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("ncr_number", name="uq_quality_ncrs_ncr_number"),
        )
        op.create_index("ix_quality_ncrs_ncr_number", "quality_ncrs", ["ncr_number"])

    if "quality_rejections" not in tables:
        op.create_table(
            "quality_rejections",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("rejection_number", sa.String(length=50), nullable=False),
            sa.Column("ncr_id", sa.Integer(), sa.ForeignKey("quality_ncrs.id"), nullable=True),
            sa.Column("inspection_id", sa.Integer(), sa.ForeignKey("quality_inspections.id"), nullable=True),
            sa.Column("item_name", sa.String(length=255), nullable=False),
            sa.Column("item_code", sa.String(length=100), nullable=True),
            sa.Column("quantity", sa.Float(), nullable=True),
            sa.Column("disposition", sa.String(length=30), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="open"),
            sa.Column("vendor_id", sa.Integer(), nullable=True),
            sa.Column("vendor_name", sa.String(length=255), nullable=True),
            sa.Column("rejection_date", sa.Date(), nullable=False),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("rejection_number", name="uq_quality_rejections_rejection_number"),
        )
        op.create_index("ix_quality_rejections_rejection_number", "quality_rejections", ["rejection_number"])

    if "quality_capas" not in tables:
        op.create_table(
            "quality_capas",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("capa_number", sa.String(length=50), nullable=False),
            sa.Column("action_type", sa.String(length=20), nullable=False),
            sa.Column("ncr_id", sa.Integer(), sa.ForeignKey("quality_ncrs.id"), nullable=True),
            # No FK — quality_customer_complaints doesn't exist until Phase 3.
            sa.Column("complaint_id", sa.Integer(), nullable=True),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("root_cause", sa.Text(), nullable=True),
            sa.Column("action_plan", sa.Text(), nullable=False),
            sa.Column("responsible_user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("verification_notes", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="open"),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("capa_number", name="uq_quality_capas_capa_number"),
        )
        op.create_index("ix_quality_capas_capa_number", "quality_capas", ["capa_number"])


def downgrade() -> None:
    op.drop_table("quality_capas")
    op.drop_table("quality_rejections")
    op.drop_table("quality_ncrs")
