from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Date, Boolean, JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class BranchUserAssignment(Base, TimestampMixin):
    """Assigns a user to a branch with a role/access level for that
    assignment. A user can hold multiple assignments across branches; at
    most one should be flagged `is_primary_branch` per user (enforced at the
    route layer, not the DB)."""

    __tablename__ = "branch_user_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    branch_id: Mapped[int] = mapped_column(Integer, ForeignKey("branches.id"), nullable=False)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    employee_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    department_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("departments.id"), nullable=True)
    designation: Mapped[str | None] = mapped_column(String(100), nullable=True)
    role: Mapped[str | None] = mapped_column(String(100), nullable=True)
    access_level: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_primary_branch: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    additional_branch_access: Mapped[list | None] = mapped_column(JSON, nullable=True)
    effective_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="active")
