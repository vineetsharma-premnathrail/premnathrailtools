"""Central approval engine tables (Organization › Workflows).

A *transaction type* ("p2p.purchase_requisition", "hr.leave") is declared in
code by its module (organization/services/approval_engine.py
register_transaction) — what it is, which permission tab it belongs to, the
context fields its conditions can test and its default stages. The admin
edits the stages here; every module submits and decides through the engine
instead of keeping its own approver logic.

    ApprovalWorkflow  1─*  ApprovalWorkflowStage      (the definition)
    ApprovalRequest   1─*  ApprovalRequestStep        (one submission of a record)
    ApprovalDelegation                                 (out-of-office hand-over)
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.mixins import TimestampMixin

# Who approves a stage. Resolved to concrete users at submission.
APPROVER_RULES = {
    "reporting_manager": "Requester's reporting manager",
    "department_head": "Requester's department head",
    "plant_head": "Plant head (the record's plant, else the requester's)",
    "partner": "Any company Partner",
    "director": "Any Director",
    "user_flag": "Users with an approval flag (e.g. Finance manager)",
    "specific_users": "Specific users",
    "role": "Holders of a role",
    "permission": "Holders of a permission",
    "record_field": "Person named on the record (e.g. chosen approver, project head)",
}
# User boolean flags a `user_flag` stage may use.
APPROVER_FLAGS = {
    "is_department_head": "Department head", "is_project_head": "Project head", "is_plant_head": "Plant head",
    "is_purchase_head": "Purchase head", "is_director": "Director", "is_partner": "Partner",
    "is_design_manager": "Design manager", "is_rnd_manager": "R&D manager", "is_production_manager": "Production manager",
    "is_project_manager": "Project manager", "is_store_manager": "Store manager", "is_purchase_manager": "Purchase manager",
    "is_finance_manager": "Finance manager",
}
ESCALATION_RULES = {
    "approver_manager": "The late approver's reporting manager",
    "department_head": "Requester's department head",
    "partner": "Any company Partner",
    "director": "Any Director",
    "specific_users": "Specific users",
}
CONDITION_OPS = {
    "eq": "=", "ne": "≠", "gt": ">", "gte": "≥", "lt": "<", "lte": "≤", "in": "is one of", "not_in": "is not one of",
    "true": "is yes", "false": "is no",
}
REQUEST_STATUSES = ("pending", "approved", "rejected", "returned", "cancelled")
STEP_STATUSES = ("waiting", "pending", "approved", "rejected", "returned", "skipped", "cancelled")


class ApprovalWorkflow(Base, TimestampMixin):
    __tablename__ = "approval_workflows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(80), unique=True, index=True, nullable=False)
    module_key: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    # The requester may not approve their own record (four-eyes).
    allow_self_approval: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    # One person may approve only one stage of the same request.
    distinct_approvers: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    # The resolved approver must ALSO hold the tab's approve/reject permission.
    # Off for flows where being the named approver is itself the authority
    # (e.g. a reporting manager deciding leave).
    require_permission: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    stages: Mapped[list["ApprovalWorkflowStage"]] = relationship(
        back_populates="workflow", cascade="all, delete-orphan", order_by="ApprovalWorkflowStage.sequence",
    )


class ApprovalWorkflowStage(Base):
    __tablename__ = "approval_workflow_stages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workflow_id: Mapped[int] = mapped_column(ForeignKey("approval_workflows.id", ondelete="CASCADE"), nullable=False, index=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    approver_rule: Mapped[str] = mapped_column(String(30), nullable=False)
    # {"user_ids": [..]} | {"role_id": n} | {"permission": "m:t:a"} | {"flag": "is_x"} | {"field": "ctx_field"}
    rule_config: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    approval_mode: Mapped[str] = mapped_column(String(10), default="any", server_default="any", nullable=False)  # any | all
    # [{"field": "amount", "op": "gt", "value": 5000000}] — all must hold; empty = always.
    conditions: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    # Nobody resolvable (or only the requester) → skip the stage instead of refusing the submission.
    skip_if_no_approver: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    escalate_after_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    escalation_rule: Mapped[str | None] = mapped_column(String(30), nullable=True)
    escalation_config: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    workflow: Mapped[ApprovalWorkflow] = relationship(back_populates="stages")


class ApprovalRequest(Base, TimestampMixin):
    __tablename__ = "approval_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    workflow_key: Mapped[str] = mapped_column(String(80), index=True, nullable=False)
    module_key: Mapped[str] = mapped_column(String(40), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(60), nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    amount: Mapped[float | None] = mapped_column(Numeric(18, 2, asdecimal=False), nullable=True)
    context: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    requester_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False, index=True)
    current_sequence: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 1 for the first submission; a resubmission after Return/Reject is a new
    # request with revision + 1 (the old one stays as history).
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    submitted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    steps: Mapped[list["ApprovalRequestStep"]] = relationship(
        back_populates="request", cascade="all, delete-orphan", order_by="[ApprovalRequestStep.sequence, ApprovalRequestStep.id]",
    )
    requester = relationship("User", foreign_keys=[requester_id])


class ApprovalRequestStep(Base):
    """One approver slot of one stage. `approver_id` is who the rule resolved
    to; `decided_by_id` is who actually acted — the approver, their delegate,
    an escalation target or an admin stand-in (`via`)."""

    __tablename__ = "approval_request_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("approval_requests.id", ondelete="CASCADE"), nullable=False, index=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    stage_name: Mapped[str] = mapped_column(String(120), nullable=False)
    approval_mode: Mapped[str] = mapped_column(String(10), default="any", nullable=False)
    approver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="waiting", nullable=False)
    # Extra people who may act for this slot after it escalated.
    escalated_to_ids: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    activated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    escalated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    escalate_after_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    escalation_rule: Mapped[str | None] = mapped_column(String(30), nullable=True)
    escalation_config: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    decided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    via: Mapped[str | None] = mapped_column(String(20), nullable=True)  # direct | delegation | escalation | admin
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    request: Mapped[ApprovalRequest] = relationship(back_populates="steps")
    approver = relationship("User", foreign_keys=[approver_id])
    decided_by = relationship("User", foreign_keys=[decided_by_id])


class ApprovalDelegation(Base, TimestampMixin):
    """While active (today within start..end), the delegate may decide any
    approval step addressed to the delegator — all modules, or one module /
    one transaction type."""

    __tablename__ = "approval_delegations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    delegator_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    delegate_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    module_key: Mapped[str | None] = mapped_column(String(40), nullable=True)
    workflow_key: Mapped[str | None] = mapped_column(String(80), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(300), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    delegator = relationship("User", foreign_keys=[delegator_id])
    delegate = relationship("User", foreign_keys=[delegate_id])


class OrganizationSetting(Base, TimestampMixin):
    """Key/value settings of the Organization admin (security policy etc.)."""

    __tablename__ = "organization_settings"
    __table_args__ = (UniqueConstraint("key", name="uq_organization_settings_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    value: Mapped[dict | list | int | str | bool | None] = mapped_column(JSON, nullable=True)
    updated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
