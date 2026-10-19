"""R&D requirement worked on together with the departments it is shared with:
each task records whose work it is (R&D / Design / Electrical / Hydraulic),
and each uploaded requirement document records the uploading department and
whether the other departments may see it.

Revision ID: d7a3f1c9e5b2
Revises: c4e9a2f7d3b8
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa

revision = "d7a3f1c9e5b2"
down_revision = "c4e9a2f7d3b8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    task_cols = {c["name"] for c in inspector.get_columns("rnd_requirement_tasks")}
    if "department" not in task_cols:
        op.add_column("rnd_requirement_tasks", sa.Column("department", sa.String(20), nullable=False, server_default="rnd"))
    if "rnd_requirement_doc_visibility" not in set(inspector.get_table_names()):
        op.create_table(
            "rnd_requirement_doc_visibility",
            sa.Column("document_id", sa.Integer(), sa.ForeignKey("crm_documents.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("department", sa.String(20), nullable=False),
            sa.Column("shared_with_all", sa.Boolean(), nullable=False, server_default="true"),
            sa.Column("updated_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )


def downgrade() -> None:
    op.drop_table("rnd_requirement_doc_visibility")
    op.drop_column("rnd_requirement_tasks", "department")
