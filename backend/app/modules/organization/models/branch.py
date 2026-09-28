from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Text, ForeignKey, Date, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin


class Branch(Base, TimestampMixin):
    """Branch = "Plant" in the UI. Column names stayed as `branch*`/`Branch`
    since that's the existing table/FK name (Department.branch_id, User.branch_id,
    Warehouse.branch_id all point here) — only the user-facing label changed."""

    __tablename__ = "branches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    code: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id"), nullable=True)
    plant_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # active / inactive / under_maintenance / under_construction / closed
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="active")
    industry_function: Mapped[str | None] = mapped_column(String(100), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # "Plant Head" — the original single head field, kept distinct from the
    # newer manager_user_id ("Plant Manager") since the two are different roles.
    head_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    manager_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    established_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    active_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Points at store_locations, the Store module's live warehouse/location
    # entity — the separate legacy `warehouses` table has no ORM model and
    # nothing in the app reads/writes it.
    default_warehouse_id: Mapped[int | None] = mapped_column(ForeignKey("store_locations.id"), nullable=True)
    default_cost_center_id: Mapped[int | None] = mapped_column(ForeignKey("cost_centers.id"), nullable=True)
    default_profit_center: Mapped[str | None] = mapped_column(String(100), nullable=True)
    working_calendar: Mapped[str | None] = mapped_column(String(100), nullable=True)
    working_days: Mapped[str | None] = mapped_column(String(100), nullable=True)
    working_hours: Mapped[str | None] = mapped_column(String(100), nullable=True)
    timezone: Mapped[str | None] = mapped_column(String(60), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(10), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
