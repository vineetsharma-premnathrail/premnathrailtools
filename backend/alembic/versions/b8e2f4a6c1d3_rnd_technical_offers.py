"""R&D Technical Offers on a requirement, and the quotation's link to the
technical offer it quotes against.

Revision ID: b8e2f4a6c1d3
Revises: a4d1e7c3f9b2
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa

revision = "b8e2f4a6c1d3"
down_revision = "a4d1e7c3f9b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "rnd_technical_offers" not in inspector.get_table_names():
        op.create_table(
            "rnd_technical_offers",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("source", sa.String(length=20), nullable=False),
            sa.Column("record_id", sa.Integer(), nullable=False),
            sa.Column("offer_number_base", sa.String(length=60), nullable=False),
            sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("offer_number", sa.String(length=80), nullable=False),
            sa.Column("offer_date", sa.Date(), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("scope", sa.Text(), nullable=True),
            sa.Column("technical_details", sa.Text(), nullable=True),
            sa.Column("deviations", sa.Text(), nullable=True),
            sa.Column("exclusions", sa.Text(), nullable=True),
            sa.Column("revision_reason", sa.Text(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="draft"),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("released_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("released_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("offer_number", name="uq_rnd_technical_offer_number"),
        )
        op.create_index("ix_rnd_technical_offers_record_id", "rnd_technical_offers", ["record_id"])

    cols = {c["name"] for c in inspector.get_columns("crm_quotations")}
    if "technical_offer_id" not in cols:
        op.add_column("crm_quotations", sa.Column("technical_offer_id", sa.Integer(), sa.ForeignKey("rnd_technical_offers.id"), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    cols = {c["name"] for c in inspector.get_columns("crm_quotations")}
    if "technical_offer_id" in cols:
        with op.batch_alter_table("crm_quotations") as batch:
            batch.drop_column("technical_offer_id")
    if "rnd_technical_offers" in inspector.get_table_names():
        op.drop_index("ix_rnd_technical_offers_record_id", table_name="rnd_technical_offers")
        op.drop_table("rnd_technical_offers")
