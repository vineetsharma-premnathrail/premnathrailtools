"""add PO approval roles and fields

Revision ID: a7c9e2f4b6d1
Revises: a1c5e8d3f7b2
"""
from alembic import op
import sqlalchemy as sa

revision = "a7c9e2f4b6d1"
down_revision = "a1c5e8d3f7b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    user_columns = {c["name"] for c in inspector.get_columns("users")}
    for name in ("is_purchase_head", "is_director", "is_md"):
        if name not in user_columns:
            op.add_column("users", sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.false()))

    request_columns = {c["name"] for c in inspector.get_columns("p2p_requests")}
    for name in ("purchase_head_approved_at", "director_approved_at", "md_approved_at"):
        if name not in request_columns:
            op.add_column("p2p_requests", sa.Column(name, sa.DateTime(timezone=True), nullable=True))
    for name in ("purchase_head_comment", "director_comment", "md_comment"):
        if name not in request_columns:
            op.add_column("p2p_requests", sa.Column(name, sa.Text(), nullable=True))

    op.execute(sa.text("""
        UPDATE p2p_requests
        SET status = 'po_raised', rfq_number = rfqs.rfq_number
        FROM rfqs
        WHERE rfqs.p2p_request_id = p2p_requests.id
          AND rfqs.status = 'locked'
          AND p2p_requests.status = 'approved'
    """))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    request_columns = {c["name"] for c in inspector.get_columns("p2p_requests")}
    for name in ("md_comment", "director_comment", "purchase_head_comment", "md_approved_at", "director_approved_at", "purchase_head_approved_at"):
        if name in request_columns:
            op.drop_column("p2p_requests", name)
    user_columns = {c["name"] for c in inspector.get_columns("users")}
    for name in ("is_md", "is_director", "is_purchase_head"):
        if name in user_columns:
            op.drop_column("users", name)