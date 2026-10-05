from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Date, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

# Source types and line conditions are configurable masters
# (StoreDocType kinds return_source / return_condition, Store → Settings).
# A condition's stock_effect decides where the quantity lands on approval:
# usable → on-hand (return_in), quarantine → the warehouse's quarantine
# bucket (quarantine_in), cleared later by scrap / vendor return / release.

# Maker-checker: a return whose source/conditions need no approval is
# `approved` (and posted) at once; otherwise it waits as pending_approval
# with one StoreMaterialReturnApproval step per required approver group,
# and posts only once every step is approved.
STORE_RETURN_STATUSES = ("pending_approval", "approved", "rejected")


class StoreMaterialReturn(Base, TimestampMixin):
    __tablename__ = "store_material_returns"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    return_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    location_id: Mapped[int] = mapped_column(ForeignKey("store_locations.id"), nullable=False)

    source_type: Mapped[str] = mapped_column(String(50), nullable=False, default="issue")
    source_issue_id: Mapped[int | None] = mapped_column(ForeignKey("store_material_issues.id"), nullable=True)
    source_description: Mapped[str | None] = mapped_column(String(255), nullable=True)

    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    return_date: Mapped[date] = mapped_column(Date, nullable=False)
    returned_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Whose material this was — drives the department_head approver rule.
    # Defaults from the source issue's department.
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), nullable=True)

    status: Mapped[str] = mapped_column(String(20), nullable=False, default="approved", server_default="approved")
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    items: Mapped[list["StoreMaterialReturnItem"]] = relationship(
        "StoreMaterialReturnItem", back_populates="material_return", cascade="all, delete-orphan"
    )
    approvals: Mapped[list["StoreMaterialReturnApproval"]] = relationship(
        "StoreMaterialReturnApproval", back_populates="material_return", cascade="all, delete-orphan",
        order_by="StoreMaterialReturnApproval.id",
    )


class StoreMaterialReturnItem(Base, TimestampMixin):
    __tablename__ = "store_material_return_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    return_id: Mapped[int] = mapped_column(ForeignKey("store_material_returns.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    condition: Mapped[str] = mapped_column(String(50), nullable=False, default="good")
    batch_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    material_return: Mapped["StoreMaterialReturn"] = relationship("StoreMaterialReturn", back_populates="items")


class StoreMaterialReturnApproval(Base, TimestampMixin):
    """One approver group a return needs (e.g. "Department head — Damaged").
    Any one user in approver_user_ids decides the step; the return posts
    when every step is approved and is rejected by any single rejection."""

    __tablename__ = "store_material_return_approvals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    return_id: Mapped[int] = mapped_column(ForeignKey("store_material_returns.id"), nullable=False, index=True)
    rule: Mapped[str] = mapped_column(String(30), nullable=False)
    label: Mapped[str] = mapped_column(String(200), nullable=False)
    approver_user_ids: Mapped[list[int]] = mapped_column(JSONB, nullable=False, default=list)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")  # pending | approved | rejected
    acted_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    acted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    material_return: Mapped["StoreMaterialReturn"] = relationship("StoreMaterialReturn", back_populates="approvals")
