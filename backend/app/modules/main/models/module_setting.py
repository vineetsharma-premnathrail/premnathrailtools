"""One admin-tuned value of a module setting (see app/core/settings_framework.py).

Only values that differ from the code default are stored: a missing row means
"use the code default", so a later change to the default in code stays live
until an admin actually overrides it. The *set of keys*, their types and
meanings are coded in each module's ModuleSettingsDef — admins never add keys
(no metadata customization)."""
from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, ForeignKey, Index, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin


class ModuleSetting(Base, TimestampMixin):
    __tablename__ = "module_settings"
    __table_args__ = (
        UniqueConstraint("module_key", "key", "branch_id", name="uq_module_settings_key"),
        # NULLs are distinct in a UNIQUE constraint, so the company-wide row
        # (branch_id NULL) needs its own partial unique index.
        Index(
            "uq_module_settings_global", "module_key", "key", unique=True,
            postgresql_where=text("branch_id IS NULL"), sqlite_where=text("branch_id IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    module_key: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    key: Mapped[str] = mapped_column(String(100), nullable=False)
    # NULL = company-wide value; set only for specs marked per_plant.
    branch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("branches.id"), nullable=True)
    value: Mapped[Any] = mapped_column(JSON().with_variant(JSONB, "postgresql"), nullable=True)
    updated_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
