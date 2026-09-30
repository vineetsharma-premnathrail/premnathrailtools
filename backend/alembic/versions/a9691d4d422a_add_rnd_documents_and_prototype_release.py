"""add rnd documents and prototype release-to-production tracking

Revision ID: a9691d4d422a
Revises: a7c3e5f9b2d6
Create Date: 2026-09-29 00:00:00.000000

- rnd_documents: SharePoint-backed files attached to an R&D project,
  optionally narrowed to one experiment or prototype.
- rnd_prototypes.production_bom_id / released_at / released_by_id: set when
  a validated prototype's BOM is released to Production as a draft BOM.
"""
from alembic import op
import sqlalchemy as sa

revision = "a9691d4d422a"
down_revision = "a7c3e5f9b2d6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "rnd_documents" not in tables:
        op.create_table(
            "rnd_documents",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("rnd_projects.id"), nullable=False),
            sa.Column("experiment_id", sa.Integer(), sa.ForeignKey("rnd_experiments.id"), nullable=True),
            sa.Column("prototype_id", sa.Integer(), sa.ForeignKey("rnd_prototypes.id"), nullable=True),
            sa.Column("doc_type", sa.String(length=30), nullable=False, server_default="other"),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("version", sa.String(length=20), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("file_name", sa.String(length=255), nullable=False),
            sa.Column("sharepoint_path", sa.String(length=1000), nullable=True),
            sa.Column("sharepoint_url", sa.String(length=1000), nullable=True),
            sa.Column("file_size", sa.Integer(), nullable=True),
            sa.Column("mime_type", sa.String(length=255), nullable=True),
            sa.Column("uploaded_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("uploaded_by_name", sa.String(length=150), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_rnd_documents_project_id", "rnd_documents", ["project_id"])
        op.create_index("ix_rnd_documents_experiment_id", "rnd_documents", ["experiment_id"])
        op.create_index("ix_rnd_documents_prototype_id", "rnd_documents", ["prototype_id"])

    columns = {c["name"] for c in inspector.get_columns("rnd_prototypes")}
    with op.batch_alter_table("rnd_prototypes") as batch:
        if "production_bom_id" not in columns:
            batch.add_column(sa.Column("production_bom_id", sa.Integer(), nullable=True))
            batch.create_foreign_key("fk_rnd_prototypes_production_bom_id", "production_boms", ["production_bom_id"], ["id"])
        if "released_at" not in columns:
            batch.add_column(sa.Column("released_at", sa.DateTime(timezone=True), nullable=True))
        if "released_by_id" not in columns:
            batch.add_column(sa.Column("released_by_id", sa.Integer(), nullable=True))
            batch.create_foreign_key("fk_rnd_prototypes_released_by_id", "users", ["released_by_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("rnd_prototypes") as batch:
        batch.drop_constraint("fk_rnd_prototypes_released_by_id", type_="foreignkey")
        batch.drop_constraint("fk_rnd_prototypes_production_bom_id", type_="foreignkey")
        batch.drop_column("released_by_id")
        batch.drop_column("released_at")
        batch.drop_column("production_bom_id")
    op.drop_table("rnd_documents")
