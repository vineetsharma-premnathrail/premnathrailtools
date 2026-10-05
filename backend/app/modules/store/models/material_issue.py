from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Float, Date, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin


class StoreMaterialIssue(Base, TimestampMixin):
    """Material issued out of a warehouse to a department/project — posts an
    'issue' stock transaction per line as soon as it's created (no separate
    draft/confirm step, matching how this module's other single-step docs
    work)."""

    __tablename__ = "store_material_issues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    issue_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    location_id: Mapped[int] = mapped_column(ForeignKey("store_locations.id"), nullable=False)

    requested_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), nullable=True)
    project_or_work_order: Mapped[str | None] = mapped_column(String(150), nullable=True)
    # Set when this issue was created from the P2P "issue from stock" action
    # on an approved PR, instead of the standalone Material Issue form.
    p2p_request_id: Mapped[int | None] = mapped_column(ForeignKey("p2p_requests.id"), nullable=True)

    # StoreDocType kind "issue" (Store → Settings → Issue Types).
    issue_type: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Delivery challan accompanying the material. Mandatory only when the
    # issue type or warehouse is listed under Store → Settings → Challan Rules.
    challan_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Outside party the material goes to (job work / rework vendor).
    # Mandatory only for issue types ticked under Store → Settings → Issue Rules.
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # When the material is due back (sent out for machining / rework etc.).
    # Mandatory only for issue types ticked under Store → Settings → Issue Rules.
    expected_return_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    issue_date: Mapped[date] = mapped_column(Date, nullable=False)
    issued_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    items: Mapped[list["StoreMaterialIssueItem"]] = relationship(
        "StoreMaterialIssueItem", back_populates="issue", cascade="all, delete-orphan"
    )


class StoreMaterialIssueItem(Base, TimestampMixin):
    __tablename__ = "store_material_issue_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    issue_id: Mapped[int] = mapped_column(ForeignKey("store_material_issues.id"), nullable=False)
    item_id: Mapped[int] = mapped_column(ForeignKey("store_items.id"), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    batch_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    issue: Mapped["StoreMaterialIssue"] = relationship("StoreMaterialIssue", back_populates="items")
