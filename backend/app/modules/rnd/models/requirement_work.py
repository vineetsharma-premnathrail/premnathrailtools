"""R&D work on a CRM requirement (Inquiry / Tender sent via "Send Technical
Offer Request to R&D"): who is on the R&D team, who may do what on each
requirement, and the tasks the R&D head hands out.

A requirement is addressed by (source, record_id) — the CRM record stays the
single source of truth, so nothing about the requirement itself is copied here.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin

RND_TEAM_ROLES = ("head", "member")
RND_TASK_STATUSES = ("open", "submitted", "closed", "cancelled")


class RndTeamMember(Base, TimestampMixin):
    """R&D › Settings: who may create Technical Offers and who may only see
    them. Module access comes from Organization; R&D heads are the R&D
    department's heads in Organization › Department (`role` is legacy and
    no longer read)."""

    __tablename__ = "rnd_team_members"
    __table_args__ = (UniqueConstraint("user_id", name="uq_rnd_team_member_user"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="member")
    # Head picks who may create Technical Offers (heads always can) and who
    # may only see every requirement and its offers (no create/edit).
    can_create_technical_offer: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    can_view_technical_offer: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")


class RndRequirementAccess(Base, TimestampMixin):
    """What one person may do on one requirement, granted by the R&D head.
    Heads and admins always have everything; nobody else sees a requirement
    without a row here (a task assignment adds one automatically)."""

    __tablename__ = "rnd_requirement_access"
    __table_args__ = (UniqueConstraint("source", "record_id", "user_id", name="uq_rnd_requirement_access"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False)  # "inquiry" | "tender"
    record_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    can_view: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    can_download: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    can_upload: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    can_respond: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    granted_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)


class RndRequirementTask(Base, TimestampMixin):
    """A piece of work the R&D head assigns on a requirement.

    open → submitted (assignee marks done) → closed (head accepts), or
    submitted → open again (head reopens with a reason). The head can cancel
    an open task. Past its due date an open task needs a reason and a new
    completion date from the assignee, which becomes the new due date;
    original_due_date keeps the first commitment for on-time reporting.
    The assignee can split an open task into sub-tasks (parent_task_id) for
    other R&D people; the creator of a task reviews and can edit it."""

    __tablename__ = "rnd_requirement_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    record_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    parent_task_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("rnd_requirement_tasks.id", ondelete="CASCADE"), index=True, nullable=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_to_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    created_by_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    original_due_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open", server_default="open")
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Planning fields (services/task_fields.py): priority, start date, the
    # assignee's work status while open, and the checklist (definition of done).
    priority: Mapped[str] = mapped_column(String(10), nullable=False, default="medium", server_default="medium")
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    work_status: Mapped[str] = mapped_column(String(20), nullable=False, default="not_started", server_default="not_started")
    checklist: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # Whose work it is: "rnd" or a department the requirement is shared with
    # (design / electrical / hydraulic) — the assignee's side when assigned.
    # Drives the department chips on the requirement's task list.
    department: Mapped[str] = mapped_column(String(20), nullable=False, default="rnd", server_default="rnd")
    # The milestone this task sits in (rnd_requirement_milestones); NULL = "No milestone".
    milestone_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("rnd_requirement_milestones.id", ondelete="SET NULL"), index=True, nullable=True)


class RndTaskEvent(Base):
    """Everything that happened to a task, in order: created, extended
    (reason + old/new due date), submitted, closed, reopened, cancelled."""

    __tablename__ = "rnd_task_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    task_id: Mapped[int] = mapped_column(Integer, ForeignKey("rnd_requirement_tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    old_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    new_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    user_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class RndRequirementProjectLink(Base):
    """An existing R&D (Prototype / Research) project linked to a CRM
    requirement by the R&D head — "this requirement is being worked on in
    project RND-…". Many-to-many: one requirement can need several projects,
    and one prototype can serve several customers' requirements."""

    __tablename__ = "rnd_requirement_project_links"
    __table_args__ = (UniqueConstraint("source", "record_id", "project_id", name="uq_rnd_requirement_project_link"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    record_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("rnd_projects.id", ondelete="CASCADE"), nullable=False, index=True)
    linked_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


RND_SHARE_DEPARTMENTS = ("design", "electrical", "hydraulic")
RND_SHARE_STATUSES = ("open", "responded", "replaced")
RND_SHARE_RESPONSES = ("feasible", "feasible_with_changes", "not_feasible")


class RndRequirementShare(Base, TimestampMixin):
    """The R&D head sharing a requirement with an engineering department
    (Design, Electrical, Hydraulic & Pneumatic) for its feasibility input —
    the "R&D feasibility with Design + E/H/P" step before the technical offer.

    open → responded (the department's reply: feasible / feasible with
    changes / not feasible, remarks, files). Sharing again with the same
    department is a new row: a still-open earlier share becomes "replaced"
    (the department answers only the latest), and every earlier reply stays
    on record. There is no withdraw — the head corrects by sharing again."""

    __tablename__ = "rnd_requirement_shares"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    record_id: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    department: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    note: Mapped[str] = mapped_column(Text, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="open", server_default="open")
    shared_by_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    response: Mapped[str | None] = mapped_column(String(30), nullable=True)
    response_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    responded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    replaced_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("rnd_requirement_shares.id"), nullable=True)
    replaced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RndRequirementDocVisibility(Base, TimestampMixin):
    """Who may see a document uploaded to a requirement's Documents tab.

    Every department working on a requirement (R&D and the departments it is
    shared with) uploads under its own name and decides whether the other
    departments see the file (shared_with_all) or only its own people do.
    A requirement document without a row is R&D's and visible to all."""

    __tablename__ = "rnd_requirement_doc_visibility"

    document_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_documents.id", ondelete="CASCADE"), primary_key=True)
    department: Mapped[str] = mapped_column(String(20), nullable=False)
    shared_with_all: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    updated_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
