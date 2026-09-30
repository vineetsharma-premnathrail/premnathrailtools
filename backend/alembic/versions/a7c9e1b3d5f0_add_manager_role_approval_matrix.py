"""add manager-role approval matrix for P2P

The PR/PO approval flow moves to a manager-role matrix keyed on whether the
request is for an existing or a new project (see PR_APPROVAL_ROLE_SETS /
PO_APPROVAL_ROLE_SETS in p2p_request.py):

- users gain the manager-role flags the pickers and PO fan-out read;
- p2p_requests gains project_type plus the any-one-approves PO approval stamp;
- p2p_request_approvals holds the per-role PR approver slots (legacy PRs keep
  using the old head columns, which stay in place untouched).

Revision ID: a7c9e1b3d5f0
Revises: 9b88b67d6fcb
Create Date: 2026-09-30 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'a7c9e1b3d5f0'
down_revision = '9b88b67d6fcb'
branch_labels = None
depends_on = None

_USER_FLAGS = (
    "is_design_manager",
    "is_rnd_manager",
    "is_production_manager",
    "is_project_manager",
    "is_store_manager",
    "is_purchase_manager",
)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())

    user_columns = {c["name"] for c in inspector.get_columns("users")}
    missing_flags = [f for f in _USER_FLAGS if f not in user_columns]
    if missing_flags:
        with op.batch_alter_table("users") as batch_op:
            for flag in missing_flags:
                batch_op.add_column(sa.Column(flag, sa.Boolean(), nullable=False, server_default=sa.false()))

    pr_columns = {c["name"] for c in inspector.get_columns("p2p_requests")}
    with op.batch_alter_table("p2p_requests") as batch_op:
        if "project_type" not in pr_columns:
            batch_op.add_column(sa.Column("project_type", sa.String(length=10), nullable=True))
        if "po_approved_by_id" not in pr_columns:
            batch_op.add_column(sa.Column("po_approved_by_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=True))
        if "po_approved_by_name" not in pr_columns:
            batch_op.add_column(sa.Column("po_approved_by_name", sa.String(length=150), nullable=True))
        if "po_approved_role" not in pr_columns:
            batch_op.add_column(sa.Column("po_approved_role", sa.String(length=30), nullable=True))
        if "po_approved_at" not in pr_columns:
            batch_op.add_column(sa.Column("po_approved_at", sa.DateTime(timezone=True), nullable=True))
        if "po_approval_comment" not in pr_columns:
            batch_op.add_column(sa.Column("po_approval_comment", sa.Text(), nullable=True))

    if "p2p_request_approvals" not in inspector.get_table_names():
        op.create_table(
            "p2p_request_approvals",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("p2p_request_id", sa.Integer(), sa.ForeignKey("p2p_requests.id"), nullable=False, index=True),
            sa.Column("role", sa.String(length=30), nullable=False),
            sa.Column("approver_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
            sa.Column("approver_name", sa.String(length=150), nullable=True),
            sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("comment", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )


def downgrade() -> None:
    op.drop_table("p2p_request_approvals")
    with op.batch_alter_table("p2p_requests") as batch_op:
        batch_op.drop_column("po_approval_comment")
        batch_op.drop_column("po_approved_at")
        batch_op.drop_column("po_approved_role")
        batch_op.drop_column("po_approved_by_name")
        batch_op.drop_column("po_approved_by_id")
        batch_op.drop_column("project_type")
    with op.batch_alter_table("users") as batch_op:
        for flag in reversed(_USER_FLAGS):
            batch_op.drop_column(flag)
