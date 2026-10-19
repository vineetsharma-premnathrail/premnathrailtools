"""Technical Offer Request goes to the whole R&D team queue.

1. crm_rnd_requests.assigned_to_id becomes nullable — CRM no longer picks an
   engineer; any R&D user answers. Old rows keep their assignee.
2. TOR PDFs sent before the Internal Documents filing were stored as
   folder_type='technical_offer' / doc_category='technical_offer_request', so
   they never showed on the CRM Documents tab. Move them to Internal
   Documents under the current category. R&D response / discussion files
   (also folder 'technical_offer', but other categories) are left alone.

Revision ID: e7c3a9f1b2d4
Revises: d2f6a9c4e1b7
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa

revision = "e7c3a9f1b2d4"
down_revision = "d2f6a9c4e1b7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("crm_rnd_requests", "assigned_to_id", existing_type=sa.Integer(), nullable=True)
    op.execute(
        "UPDATE crm_documents SET folder_type = 'internal', doc_category = 'Technical Offer Request' "
        "WHERE folder_type = 'technical_offer' AND doc_category = 'technical_offer_request'"
    )


def downgrade() -> None:
    # Data move is not reversed (the old folder was simply invisible). Fails
    # if team-queue requests (no assignee) exist — assign them first.
    op.alter_column("crm_rnd_requests", "assigned_to_id", existing_type=sa.Integer(), nullable=False)
