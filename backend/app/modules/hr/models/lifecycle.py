from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Boolean, Text, Date, DateTime, JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

LIFECYCLE_EVENT_TYPES = ("joining", "confirmation", "transfer", "promotion", "exit")
LIFECYCLE_STATUSES = ("draft", "in_progress", "completed", "cancelled")
EXIT_TYPES = ("resignation", "termination", "retirement", "absconding", "contract_end", "death")
CHECKLIST_CATEGORIES = ("hr", "it", "admin", "finance", "manager", "store")
CHECKLIST_ITEM_STATUSES = ("pending", "done", "not_applicable")


class HrLifecycleEvent(Base, TimestampMixin):
    """Joiner / mover / leaver event (LC-YYYY-NNNN). `user_id` is nullable
    because a joining can be started before the Azure account exists — then
    candidate_name/candidate_email identify the person."""

    __tablename__ = "hr_lifecycle_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_no: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    event_type: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    candidate_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    candidate_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="in_progress", server_default="in_progress", index=True, nullable=False)
    effective_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    from_department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), nullable=True)
    to_department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), nullable=True)
    from_branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    to_branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    from_designation_id: Mapped[int | None] = mapped_column(ForeignKey("hr_designations.id"), nullable=True)
    to_designation_id: Mapped[int | None] = mapped_column(ForeignKey("hr_designations.id"), nullable=True)
    from_grade_id: Mapped[int | None] = mapped_column(ForeignKey("hr_grades.id"), nullable=True)
    to_grade_id: Mapped[int | None] = mapped_column(ForeignKey("hr_grades.id"), nullable=True)
    from_manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    to_manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    resignation_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    last_working_day: Mapped[date | None] = mapped_column(Date, nullable=True)
    exit_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    exit_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    notice_period_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    handover_to_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    completion_summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    completed_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    items: Mapped[list["HrChecklistItem"]] = relationship(
        "HrChecklistItem", back_populates="event", cascade="all, delete-orphan",
        order_by="HrChecklistItem.sort_order",
    )


class HrChecklistTemplate(Base, TimestampMixin):
    """Default checklist line copied into every new lifecycle event of the
    same `event_type`."""

    __tablename__ = "hr_checklist_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_type: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    default_owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)


class HrChecklistItem(Base, TimestampMixin):
    __tablename__ = "hr_checklist_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("hr_lifecycle_events.id", ondelete="CASCADE"), index=True, nullable=False)
    template_id: Mapped[int | None] = mapped_column(ForeignKey("hr_checklist_templates.id", ondelete="SET NULL"), nullable=True)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending", server_default="pending", index=True, nullable=False)
    done_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)

    event: Mapped["HrLifecycleEvent"] = relationship("HrLifecycleEvent", back_populates="items")
