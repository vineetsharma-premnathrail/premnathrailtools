"""R&D Technical Offer: maker-checker + revision requests (2026-10-22).

A creator "Sends" a draft to the R&D head (status 'submitted', frozen); the
head approves it to the BD team (released) or returns it with a reason. After
release a creator asks for a revision; the R&D head approves (a new draft
revision opens for the requester) or declines it.

Revision ID: e5a1c9d3f7b2
Revises: c8f2a5d3e7b1
"""
from alembic import op
import sqlalchemy as sa

revision = "e5a1c9d3f7b2"
down_revision = "c8f2a5d3e7b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("rnd_technical_offers") as t:
        t.add_column(sa.Column("submitted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))
        t.add_column(sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=True))
        t.add_column(sa.Column("returned_reason", sa.Text(), nullable=True))
        t.add_column(sa.Column("revision_request_reason", sa.Text(), nullable=True))
        t.add_column(sa.Column("revision_requested_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))
        t.add_column(sa.Column("revision_requested_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("rnd_technical_offers") as t:
        for col in ("revision_requested_at", "revision_requested_by_id", "revision_request_reason",
                    "returned_reason", "submitted_at", "submitted_by_id"):
            t.drop_column(col)
