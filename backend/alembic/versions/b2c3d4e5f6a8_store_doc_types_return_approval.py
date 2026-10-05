"""Store configurable doc types, material return approval, quarantine bucket

Revision ID: b2c3d4e5f6a8
Revises: a1b2c3d4e5f7
Create Date: 2026-10-05

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b2c3d4e5f6a8"
down_revision = "a1b2c3d4e5f7"
branch_labels = None
depends_on = None

# Mirrors STORE_DOC_TYPE_DEFAULTS in app/modules/store/models/doc_type.py
# (copied, not imported, so this migration never changes if the model does).
_DEFAULTS = [
    ("stock_entry", "receipt", "Receipt", "in", False, "none"),
    ("stock_entry", "issue", "Issue", "out", False, "none"),
    ("stock_entry", "damage", "Damage / write-off", "out", False, "none"),
    ("issue", "production", "Production", None, False, "none"),
    ("issue", "maintenance", "Maintenance", None, False, "none"),
    ("issue", "project", "Project / Site", None, False, "none"),
    ("issue", "general", "General / Office", None, False, "none"),
    ("return_source", "issue", "Against a Material Issue", None, True, "none"),
    ("return_source", "other", "Other (no issue reference)", None, False, "warehouse_manager"),
    ("return_condition", "good", "Good", "usable", False, "none"),
    ("return_condition", "damaged", "Damaged", "quarantine", False, "department_head"),
    ("return_condition", "rejected", "Rejected (quality)", "quarantine", False, "specific_users"),
]


def upgrade() -> None:
    doc_types = op.create_table(
        "store_doc_types",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("kind", sa.String(30), nullable=False),
        sa.Column("value", sa.String(50), nullable=False),
        sa.Column("label", sa.String(100), nullable=False),
        sa.Column("stock_effect", sa.String(20), nullable=True),
        sa.Column("requires_issue", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("approver_rule", sa.String(30), nullable=False, server_default="none"),
        sa.Column("approver_user_ids", postgresql.JSONB(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.UniqueConstraint("kind", "value", name="uq_store_doc_type_kind_value"),
    )
    op.create_index("ix_store_doc_types_kind", "store_doc_types", ["kind"])
    op.bulk_insert(doc_types, [
        {"kind": k, "value": v, "label": l, "stock_effect": e, "requires_issue": r, "approver_rule": a, "approver_user_ids": []}
        for k, v, l, e, r, a in _DEFAULTS
    ])

    op.add_column("store_material_issues", sa.Column("issue_type", sa.String(50), nullable=True))

    op.add_column("store_stock_transactions", sa.Column("entry_type", sa.String(50), nullable=True))
    op.add_column("store_stock_balances", sa.Column("quarantine_qty", sa.Float(), nullable=False, server_default="0"))

    op.alter_column("store_material_returns", "source_type", type_=sa.String(50), existing_type=sa.String(20))
    op.alter_column("store_material_return_items", "condition", type_=sa.String(50), existing_type=sa.String(20))
    op.add_column("store_material_returns", sa.Column("department_id", sa.Integer(), sa.ForeignKey("departments.id"), nullable=True))
    # Existing returns were posted immediately — they're already "approved".
    op.add_column("store_material_returns", sa.Column("status", sa.String(20), nullable=False, server_default="approved"))
    op.add_column("store_material_returns", sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("store_material_returns", sa.Column("rejected_reason", sa.Text(), nullable=True))

    op.create_table(
        "store_material_return_approvals",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("return_id", sa.Integer(), sa.ForeignKey("store_material_returns.id"), nullable=False),
        sa.Column("rule", sa.String(30), nullable=False),
        sa.Column("label", sa.String(200), nullable=False),
        sa.Column("approver_user_ids", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("acted_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("acted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    )
    op.create_index("ix_store_material_return_approvals_return_id", "store_material_return_approvals", ["return_id"])


def downgrade() -> None:
    op.drop_index("ix_store_material_return_approvals_return_id", table_name="store_material_return_approvals")
    op.drop_table("store_material_return_approvals")
    op.drop_column("store_material_returns", "rejected_reason")
    op.drop_column("store_material_returns", "decided_at")
    op.drop_column("store_material_returns", "status")
    op.drop_column("store_material_returns", "department_id")
    op.alter_column("store_material_return_items", "condition", type_=sa.String(20), existing_type=sa.String(50))
    op.alter_column("store_material_returns", "source_type", type_=sa.String(20), existing_type=sa.String(50))
    op.drop_column("store_stock_balances", "quarantine_qty")
    op.drop_column("store_stock_transactions", "entry_type")
    op.drop_column("store_material_issues", "issue_type")
    op.drop_index("ix_store_doc_types_kind", table_name="store_doc_types")
    op.drop_table("store_doc_types")
