"""add quality module phase3

Revision ID: bc9bd9ce0076
Revises: 1224c89b0740
Create Date: 2026-09-25 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = "bc9bd9ce0076"
down_revision = "1224c89b0740"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "quality_customer_complaints" not in tables:
        op.create_table(
            "quality_customer_complaints",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("complaint_number", sa.String(length=50), nullable=False),
            sa.Column("customer_name", sa.String(length=255), nullable=False),
            sa.Column("customer_org_id", sa.Integer(), nullable=True),
            sa.Column("item_name", sa.String(length=255), nullable=True),
            sa.Column("item_code", sa.String(length=100), nullable=True),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("severity", sa.String(length=20), nullable=False, server_default="minor"),
            sa.Column("status", sa.String(length=30), nullable=False, server_default="open"),
            sa.Column("complaint_date", sa.Date(), nullable=False),
            sa.Column("received_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("resolution_notes", sa.Text(), nullable=True),
            sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("complaint_number", name="uq_quality_customer_complaints_complaint_number"),
        )
        op.create_index(
            "ix_quality_customer_complaints_complaint_number",
            "quality_customer_complaints",
            ["complaint_number"],
        )

    if "quality_supplier_scorecards" not in tables:
        op.create_table(
            "quality_supplier_scorecards",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("vendor_id", sa.Integer(), nullable=True),
            sa.Column("vendor_name", sa.String(length=255), nullable=False),
            sa.Column("period", sa.String(length=20), nullable=False),
            sa.Column("quality_score", sa.Float(), nullable=True),
            sa.Column("on_time_delivery_score", sa.Float(), nullable=True),
            sa.Column("rejection_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("ncr_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(length=10), nullable=False, server_default="draft"),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )

    # quality_capas.complaint_id was added in Phase 2 without an FK, since
    # quality_customer_complaints didn't exist yet — add it now that the
    # target table exists.
    existing_fks = {fk["name"] for fk in inspector.get_foreign_keys("quality_capas")}
    if "fk_quality_capas_complaint_id_quality_customer_complaints" not in existing_fks:
        op.create_foreign_key(
            "fk_quality_capas_complaint_id_quality_customer_complaints",
            "quality_capas",
            "quality_customer_complaints",
            ["complaint_id"],
            ["id"],
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing_fks = {fk["name"] for fk in inspector.get_foreign_keys("quality_capas")}
    if "fk_quality_capas_complaint_id_quality_customer_complaints" in existing_fks:
        op.drop_constraint(
            "fk_quality_capas_complaint_id_quality_customer_complaints",
            "quality_capas",
            type_="foreignkey",
        )
    op.drop_table("quality_supplier_scorecards")
    op.drop_table("quality_customer_complaints")
