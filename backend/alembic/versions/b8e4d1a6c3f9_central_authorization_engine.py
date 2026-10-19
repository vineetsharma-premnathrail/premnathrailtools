"""Central authorization: approval engine, delegations, organization settings,
session IP / revoke reason.

Revision ID: b8e4d1a6c3f9
Revises: a1d7e3c9f5b2
Create Date: 2026-10-08
"""
from alembic import op
import sqlalchemy as sa

revision = "b8e4d1a6c3f9"
down_revision = "a1d7e3c9f5b2"
branch_labels = None
depends_on = None


def _ts():
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
    ]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names())

    cols = {c["name"] for c in inspector.get_columns("user_sessions")}
    if "ip_address" not in cols:
        op.add_column("user_sessions", sa.Column("ip_address", sa.String(length=64), nullable=True))
    if "revoked_reason" not in cols:
        op.add_column("user_sessions", sa.Column("revoked_reason", sa.String(length=30), nullable=True))
    # Guarded: a1d7e3c9f5b2 normally adds these two already.
    if "last_login_at" not in {c["name"] for c in inspector.get_columns("users")}:
        op.add_column("users", sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True))
    if "data_scopes" not in {c["name"] for c in inspector.get_columns("roles")}:
        op.add_column("roles", sa.Column("data_scopes", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))

    if "approval_workflows" not in existing:
        op.create_table(
            "approval_workflows",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("key", sa.String(length=80), nullable=False),
            sa.Column("module_key", sa.String(length=40), nullable=False),
            sa.Column("name", sa.String(length=150), nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
            sa.Column("allow_self_approval", sa.Boolean(), server_default="false", nullable=False),
            sa.Column("distinct_approvers", sa.Boolean(), server_default="false", nullable=False),
            sa.Column("require_permission", sa.Boolean(), server_default="true", nullable=False),
            sa.Column("updated_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_approval_workflows_key", "approval_workflows", ["key"], unique=True)

    if "approval_workflow_stages" not in existing:
        op.create_table(
            "approval_workflow_stages",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("workflow_id", sa.Integer(), sa.ForeignKey("approval_workflows.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("approver_rule", sa.String(length=30), nullable=False),
            sa.Column("rule_config", sa.JSON(), nullable=False),
            sa.Column("approval_mode", sa.String(length=10), server_default="any", nullable=False),
            sa.Column("conditions", sa.JSON(), nullable=False),
            sa.Column("skip_if_no_approver", sa.Boolean(), server_default="false", nullable=False),
            sa.Column("escalate_after_hours", sa.Integer(), nullable=True),
            sa.Column("escalation_rule", sa.String(length=30), nullable=True),
            sa.Column("escalation_config", sa.JSON(), nullable=False),
        )
        op.create_index("ix_approval_workflow_stages_workflow_id", "approval_workflow_stages", ["workflow_id"])

    if "approval_requests" not in existing:
        op.create_table(
            "approval_requests",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("workflow_key", sa.String(length=80), nullable=False),
            sa.Column("module_key", sa.String(length=40), nullable=False),
            sa.Column("entity_type", sa.String(length=60), nullable=False),
            sa.Column("entity_id", sa.Integer(), nullable=False),
            sa.Column("title", sa.String(length=300), nullable=False),
            sa.Column("reference", sa.String(length=100), nullable=True),
            sa.Column("amount", sa.Numeric(18, 2), nullable=True),
            sa.Column("context", sa.JSON(), nullable=False),
            sa.Column("requester_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("branch_id", sa.Integer(), sa.ForeignKey("branches.id", ondelete="SET NULL"), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.Column("current_sequence", sa.Integer(), nullable=True),
            sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
            sa.Column("submitted_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            *_ts(),
        )
        op.create_index("ix_approval_requests_workflow_key", "approval_requests", ["workflow_key"])
        op.create_index("ix_approval_requests_requester_id", "approval_requests", ["requester_id"])
        op.create_index("ix_approval_requests_status", "approval_requests", ["status"])
        op.create_index("ix_approval_requests_entity", "approval_requests", ["entity_type", "entity_id"])

    if "approval_request_steps" not in existing:
        op.create_table(
            "approval_request_steps",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("request_id", sa.Integer(), sa.ForeignKey("approval_requests.id", ondelete="CASCADE"), nullable=False),
            sa.Column("sequence", sa.Integer(), nullable=False),
            sa.Column("stage_name", sa.String(length=120), nullable=False),
            sa.Column("approval_mode", sa.String(length=10), nullable=False),
            sa.Column("approver_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.Column("escalated_to_ids", sa.JSON(), nullable=False),
            sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("due_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("escalated_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("escalate_after_hours", sa.Integer(), nullable=True),
            sa.Column("escalation_rule", sa.String(length=30), nullable=True),
            sa.Column("escalation_config", sa.JSON(), nullable=False),
            sa.Column("decided_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("via", sa.String(length=20), nullable=True),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("comment", sa.Text(), nullable=True),
        )
        op.create_index("ix_approval_request_steps_request_id", "approval_request_steps", ["request_id"])
        op.create_index("ix_approval_request_steps_approver_id", "approval_request_steps", ["approver_id"])
        op.create_index("ix_approval_request_steps_decided_by_id", "approval_request_steps", ["decided_by_id"])

    if "approval_delegations" not in existing:
        op.create_table(
            "approval_delegations",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("delegator_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("delegate_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("start_date", sa.Date(), nullable=False),
            sa.Column("end_date", sa.Date(), nullable=False),
            sa.Column("module_key", sa.String(length=40), nullable=True),
            sa.Column("workflow_key", sa.String(length=80), nullable=True),
            sa.Column("reason", sa.String(length=300), nullable=True),
            sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
            sa.Column("created_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            *_ts(),
        )
        op.create_index("ix_approval_delegations_delegator_id", "approval_delegations", ["delegator_id"])
        op.create_index("ix_approval_delegations_delegate_id", "approval_delegations", ["delegate_id"])

    if "organization_settings" not in existing:
        op.create_table(
            "organization_settings",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("key", sa.String(length=80), nullable=False),
            sa.Column("value", sa.JSON(), nullable=True),
            sa.Column("updated_by_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            *_ts(),
            sa.UniqueConstraint("key", name="uq_organization_settings_key"),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = set(inspector.get_table_names())
    for t in ("organization_settings", "approval_delegations", "approval_request_steps", "approval_requests",
              "approval_workflow_stages", "approval_workflows"):
        if t in existing:
            op.drop_table(t)
    cols = {c["name"] for c in inspector.get_columns("user_sessions")}
    for c in ("revoked_reason", "ip_address"):
        if c in cols:
            op.drop_column("user_sessions", c)
