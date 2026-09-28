from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Date, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class PmProjectResource(Base, TimestampMixin):
    """A user's resource assignment to a Project Management module project.
    Table `pm_project_resources`, FK'd to `pm_projects.id` and `users.id`.
    No status field — this is a simple assignment row; allocation changes
    are handled as delete + re-add (or a PATCH of role/allocation/end_date)."""

    __tablename__ = "pm_project_resources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("pm_projects.id"), nullable=False, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    role: Mapped[str | None] = mapped_column(String(150), nullable=True)
    allocation_percent: Mapped[int | None] = mapped_column(Integer, nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
