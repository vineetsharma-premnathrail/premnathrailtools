"""HR employee documents: files for employees without a portal account
(user_documents.hr_profile_id, user_id nullable) and the checklist item a
file satisfies (checklist_key). The hand-ticked documents_received list on
the profile goes — a document counts as received once its file is uploaded.

Revision ID: f5b1d8c3a926
Revises: e2c9a4b7d351
"""
from alembic import op
import sqlalchemy as sa

revision = "f5b1d8c3a926"
down_revision = "e2c9a4b7d351"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    doc_cols = {c["name"] for c in inspector.get_columns("user_documents")}
    with op.batch_alter_table("user_documents") as batch:
        if "hr_profile_id" not in doc_cols:
            batch.add_column(sa.Column("hr_profile_id", sa.Integer(), sa.ForeignKey("hr_employee_profiles.id"), nullable=True))
        if "checklist_key" not in doc_cols:
            batch.add_column(sa.Column("checklist_key", sa.String(30), nullable=True))
        batch.alter_column("user_id", existing_type=sa.Integer(), nullable=True)
    if "ix_user_documents_hr_profile_id" not in {i["name"] for i in inspector.get_indexes("user_documents")}:
        op.create_index("ix_user_documents_hr_profile_id", "user_documents", ["hr_profile_id"])
    if "documents_received" in {c["name"] for c in inspector.get_columns("hr_employee_profiles")}:
        with op.batch_alter_table("hr_employee_profiles") as batch:
            batch.drop_column("documents_received")


def downgrade() -> None:
    with op.batch_alter_table("hr_employee_profiles") as batch:
        batch.add_column(sa.Column("documents_received", sa.JSON(), nullable=True))
    # Files of records without an account can't survive user_id NOT NULL.
    op.execute("DELETE FROM user_documents WHERE user_id IS NULL")
    op.drop_index("ix_user_documents_hr_profile_id", table_name="user_documents")
    with op.batch_alter_table("user_documents") as batch:
        batch.alter_column("user_id", existing_type=sa.Integer(), nullable=False)
        batch.drop_column("checklist_key")
        batch.drop_column("hr_profile_id")
