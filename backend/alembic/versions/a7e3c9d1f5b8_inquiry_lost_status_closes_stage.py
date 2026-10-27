"""Inquiries closed as not ordered also close their pipeline stage.

Data only: an inquiry whose status is 'Closed - Not Ordered' but whose stage was
left behind (the status was changed without the stage) gets the stage
'Closed – Not Ordered'. From now on PATCH /crm/inquiries does this itself.

Revision ID: a7e3c9d1f5b8
Revises: c2f7a1d9e4b3
"""
from alembic import op
import sqlalchemy as sa

revision = "a7e3c9d1f5b8"
down_revision = "c2f7a1d9e4b3"
branch_labels = None
depends_on = None

LOST_STATUS = "Closed - Not Ordered"
LOST_STAGE = "Closed – Not Ordered"


def upgrade():
    if not sa.inspect(op.get_bind()).has_table("crm_inquiries"):
        return
    op.get_bind().execute(
        sa.text("UPDATE crm_inquiries SET current_stage = :stage "
                "WHERE status = :status AND (current_stage IS NULL OR current_stage <> :stage)"),
        {"stage": LOST_STAGE, "status": LOST_STATUS},
    )


def downgrade():
    pass  # the old (inconsistent) stage is not kept; nothing to restore
