from __future__ import annotations
from sqlalchemy import String, Integer, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# Display-metadata registry for the app keys assignable via User.assigned_apps.
# `key` values here should stay in sync with AVAILABLE_APPS in user.py, which
# remains the actual permission-validity gate — this table drives the admin
# UI's assignable-apps checklist so adding a department's label/icon is a
# data change, not a frontend code change. See
# docs/product/ADMIN_MODULE_EXTENSION_PLAN.md Phase 1.


class Module(Base, TimestampMixin):
    __tablename__ = "modules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(100), nullable=False)
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
