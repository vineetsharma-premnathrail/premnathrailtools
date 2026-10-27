"""CRM customer engagements (meetings, calls, visits, discussions) on an organization.

New table crm_engagements; nothing existing changes.

Revision ID: f1c8a4e6b2d9
Revises: d5b9e2c7a4f1
"""
from alembic import op
import sqlalchemy as sa

revision = "f1c8a4e6b2d9"
down_revision = "d5b9e2c7a4f1"
branch_labels = None
depends_on = None


def upgrade():
    if sa.inspect(op.get_bind()).has_table("crm_engagements"):
        return
    op.create_table(
        "crm_engagements",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("org_id", sa.Integer(), sa.ForeignKey("crm_organizations.id"), nullable=False),
        sa.Column("org_contact_id", sa.Integer(), sa.ForeignKey("crm_org_contacts.id"), nullable=False),
        sa.Column("engagement_date", sa.Date(), nullable=False),
        sa.Column("engagement_type", sa.String(30), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("outcome", sa.String(30), nullable=False),
        sa.Column("next_followup_date", sa.Date(), nullable=True),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )
    op.create_index("ix_crm_engagements_org_id", "crm_engagements", ["org_id"])
    op.create_index("ix_crm_engagements_created_by_id", "crm_engagements", ["created_by_id"])


def downgrade():
    op.drop_index("ix_crm_engagements_created_by_id", table_name="crm_engagements")
    op.drop_index("ix_crm_engagements_org_id", table_name="crm_engagements")
    op.drop_table("crm_engagements")
