"""add rnd module: projects, experiments, prototypes, feasibility

Revision ID: 284fe3a833c2
Revises: b7d2e4f6a8c1
Create Date: 2026-09-29 00:00:00.000000

Turns R&D from a calculators-only area into a full module (SAP mapping
Dept 4): R&D projects with a stage lifecycle, experiments/test data,
prototypes with a BOM, and a per-project feasibility study.
"""
from alembic import op
import sqlalchemy as sa

revision = "284fe3a833c2"
down_revision = "b7d2e4f6a8c1"
branch_labels = None
depends_on = None


def _timestamps():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    ]


def _soft_delete():
    return [
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    ]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "rnd_projects" not in tables:
        op.create_table(
            "rnd_projects",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("project_number", sa.String(length=50), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("project_type", sa.String(length=30), nullable=False, server_default="new_product"),
            sa.Column("priority", sa.String(length=20), nullable=False, server_default="medium"),
            sa.Column("stage", sa.String(length=20), nullable=False, server_default="initiation"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
            sa.Column("objective", sa.Text(), nullable=False),
            sa.Column("scope", sa.Text(), nullable=True),
            sa.Column("lead_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("team_member_ids", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("start_date", sa.Date(), nullable=True),
            sa.Column("target_end_date", sa.Date(), nullable=True),
            sa.Column("actual_end_date", sa.Date(), nullable=True),
            sa.Column("budget_amount", sa.Float(), nullable=True),
            sa.Column("handover_specs_final", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("handover_bom_approved", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("handover_process_documented", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("handover_quality_standards", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("handover_notes", sa.Text(), nullable=True),
            sa.Column("handed_over_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(),
            *_soft_delete(),
            sa.UniqueConstraint("project_number", name="uq_rnd_projects_project_number"),
        )
        op.create_index("ix_rnd_projects_project_number", "rnd_projects", ["project_number"])

    if "rnd_prototypes" not in tables:
        op.create_table(
            "rnd_prototypes",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("prototype_number", sa.String(length=50), nullable=False),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("rnd_projects.id"), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("version", sa.String(length=20), nullable=False, server_default="v1"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="design"),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("build_date", sa.Date(), nullable=True),
            sa.Column("findings", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(),
            *_soft_delete(),
            sa.UniqueConstraint("prototype_number", name="uq_rnd_prototypes_prototype_number"),
        )
        op.create_index("ix_rnd_prototypes_prototype_number", "rnd_prototypes", ["prototype_number"])
        op.create_index("ix_rnd_prototypes_project_id", "rnd_prototypes", ["project_id"])

    if "rnd_prototype_bom_items" not in tables:
        op.create_table(
            "rnd_prototype_bom_items",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("prototype_id", sa.Integer(), sa.ForeignKey("rnd_prototypes.id", ondelete="CASCADE"), nullable=False),
            sa.Column("store_item_id", sa.Integer(), sa.ForeignKey("store_items.id"), nullable=True),
            sa.Column("item_code", sa.String(length=100), nullable=True),
            sa.Column("item_name", sa.String(length=255), nullable=False),
            sa.Column("quantity", sa.Float(), nullable=False, server_default="1"),
            sa.Column("uom", sa.String(length=20), nullable=True),
            sa.Column("unit_cost", sa.Float(), nullable=True),
            sa.Column("remarks", sa.Text(), nullable=True),
            *_timestamps(),
        )
        op.create_index("ix_rnd_prototype_bom_items_prototype_id", "rnd_prototype_bom_items", ["prototype_id"])

    if "rnd_experiments" not in tables:
        op.create_table(
            "rnd_experiments",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("experiment_number", sa.String(length=50), nullable=False),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("rnd_projects.id"), nullable=False),
            sa.Column("prototype_id", sa.Integer(), sa.ForeignKey("rnd_prototypes.id"), nullable=True),
            sa.Column("title", sa.String(length=255), nullable=False),
            sa.Column("experiment_type", sa.String(length=20), nullable=False, server_default="lab_test"),
            sa.Column("status", sa.String(length=20), nullable=False, server_default="planned"),
            sa.Column("result", sa.String(length=20), nullable=True),
            sa.Column("objective", sa.Text(), nullable=True),
            sa.Column("method", sa.Text(), nullable=True),
            sa.Column("experiment_date", sa.Date(), nullable=True),
            sa.Column("conducted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("parameters", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("observations", sa.Text(), nullable=True),
            sa.Column("conclusion", sa.Text(), nullable=True),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            *_timestamps(),
            *_soft_delete(),
            sa.UniqueConstraint("experiment_number", name="uq_rnd_experiments_experiment_number"),
        )
        op.create_index("ix_rnd_experiments_experiment_number", "rnd_experiments", ["experiment_number"])
        op.create_index("ix_rnd_experiments_project_id", "rnd_experiments", ["project_id"])

    if "rnd_feasibility_studies" not in tables:
        op.create_table(
            "rnd_feasibility_studies",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("project_id", sa.Integer(), sa.ForeignKey("rnd_projects.id"), nullable=False),
            sa.Column("material_cost", sa.Float(), nullable=True),
            sa.Column("labour_cost", sa.Float(), nullable=True),
            sa.Column("overhead_cost", sa.Float(), nullable=True),
            sa.Column("target_selling_price", sa.Float(), nullable=True),
            sa.Column("costing_rating", sa.String(length=20), nullable=True),
            sa.Column("costing_notes", sa.Text(), nullable=True),
            sa.Column("sourcing_rating", sa.String(length=20), nullable=True),
            sa.Column("sourcing_notes", sa.Text(), nullable=True),
            sa.Column("process_rating", sa.String(length=20), nullable=True),
            sa.Column("process_notes", sa.Text(), nullable=True),
            sa.Column("quality_rating", sa.String(length=20), nullable=True),
            sa.Column("quality_notes", sa.Text(), nullable=True),
            sa.Column("recommendation", sa.String(length=20), nullable=True),
            sa.Column("decision_notes", sa.Text(), nullable=True),
            sa.Column("reviewed_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
            sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
            *_timestamps(),
            sa.UniqueConstraint("project_id", name="uq_rnd_feasibility_studies_project_id"),
        )
        op.create_index("ix_rnd_feasibility_studies_project_id", "rnd_feasibility_studies", ["project_id"])


def downgrade() -> None:
    op.drop_table("rnd_feasibility_studies")
    op.drop_table("rnd_experiments")
    op.drop_table("rnd_prototype_bom_items")
    op.drop_table("rnd_prototypes")
    op.drop_table("rnd_projects")
