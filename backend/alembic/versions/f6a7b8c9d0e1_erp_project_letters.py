"""ERP projects: free-form letters on company letterhead

Letters created from a machine's Documents tab ("Created" documents). Only
content is stored; the PDF/Word file is rendered on demand.

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-10-06

"""
from alembic import op
import sqlalchemy as sa

revision = "f6a7b8c9d0e1"
down_revision = "e5f6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "erp_project_letters" in inspector.get_table_names():
        return
    op.create_table(
        "erp_project_letters",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("project_id", sa.Integer(), sa.ForeignKey("erp_projects.id"), nullable=False),
        sa.Column("seq", sa.Integer(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("letter_no", sa.String(length=150), nullable=False),
        sa.Column("letter_date", sa.Date(), nullable=False),
        sa.Column("recipient", sa.Text(), nullable=False),
        sa.Column("subject", sa.String(length=300), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("signatory_name", sa.String(length=150), nullable=True),
        sa.Column("signatory_designation", sa.String(length=150), nullable=True),
        sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("project_id", "seq", name="uq_erp_project_letters_project_seq"),
    )
    op.create_index("ix_erp_project_letters_project_id", "erp_project_letters", ["project_id"])


def downgrade() -> None:
    op.drop_index("ix_erp_project_letters_project_id", table_name="erp_project_letters")
    op.drop_table("erp_project_letters")
