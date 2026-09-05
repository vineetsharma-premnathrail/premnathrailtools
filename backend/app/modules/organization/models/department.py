from __future__ import annotations
from sqlalchemy import String, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class Department(Base, TimestampMixin):
    """Department master. Replaces the free-text `User.department` string as
    the source of truth going forward — existing string values are left
    alone on User (still used for display/legacy matching) but new
    department-head assignment should go through `head_user_id` here."""

    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    branch_id: Mapped[int | None] = mapped_column(ForeignKey("branches.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    head_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    # Set when the same department (same name/branch) is auto-provisioned
    # for two people who each have a different Azure manager — rather than
    # arbitrarily keeping only the first one, both are kept and shown
    # joined as "Name A / Name B" (see DepartmentResponse.head_user_name in
    # routes/department.py). A single `head_user_id` remains the primary/
    # first-seen head; this is the second one, not a general multi-head list.
    secondary_head_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
