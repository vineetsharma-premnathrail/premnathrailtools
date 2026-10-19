"""R&D requirement shared with Design / Electrical / Hydraulic & Pneumatic
for their feasibility reply.

Revision ID: c4e9a2f7d3b8
Revises: e8b2d4f6a1c3
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa

revision = "c4e9a2f7d3b8"
down_revision = "e8b2d4f6a1c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "rnd_requirement_shares" in set(sa.inspect(op.get_bind()).get_table_names()):
        return
    op.create_table(
        "rnd_requirement_shares",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("record_id", sa.Integer(), nullable=False, index=True),
        sa.Column("department", sa.String(20), nullable=False, index=True),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="open"),
        sa.Column("shared_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("response", sa.String(30), nullable=True),
        sa.Column("response_remarks", sa.Text(), nullable=True),
        sa.Column("responded_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("responded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("replaced_by_id", sa.Integer(), sa.ForeignKey("rnd_requirement_shares.id"), nullable=True),
        sa.Column("replaced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("rnd_requirement_shares")
