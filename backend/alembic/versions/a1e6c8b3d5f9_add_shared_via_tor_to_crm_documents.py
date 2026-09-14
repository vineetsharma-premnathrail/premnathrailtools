"""add shared_via_tor to crm documents

Revision ID: a1e6c8b3d5f9
Revises: c57afa1b908f
Create Date: 2026-09-12 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'a1e6c8b3d5f9'
down_revision = 'c57afa1b908f'
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {c["name"] for c in inspector.get_columns("crm_documents")}
    if "shared_via_tor" not in columns:
        op.add_column(
            "crm_documents",
            sa.Column("shared_via_tor", sa.Boolean(), nullable=False, server_default=sa.false()),
        )

    # Previously-sent Technical Offer Request PDFs relied on the old (overly
    # broad) related_id-based check to stay reachable via their emailed
    # links — flag them so they keep working under the new, narrower check.
    # The specific reference documents chosen for past TORs can't be
    # recovered (that selection was never persisted), so those older emailed
    # links will 403 going forward; only the TOR PDF itself is backfilled.
    op.execute(
        "UPDATE crm_documents SET shared_via_tor = true "
        "WHERE doc_category = 'technical_offer_request' AND is_deleted = false"
    )


def downgrade() -> None:
    op.drop_column("crm_documents", "shared_via_tor")
