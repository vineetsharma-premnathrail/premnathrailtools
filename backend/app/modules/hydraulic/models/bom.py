from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Float, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# draft → released → obsolete. Only a draft can be edited; changing a
# released BOM means raising its next revision.
HYD_BOM_STATUSES = ("draft", "released", "obsolete")


class HydBom(Base, TimestampMixin, SoftDeleteMixin):
    """Bill of materials for a hydraulic/pneumatic system — the component
    list, each line tagged with its circuit symbol reference (P1, V3, CYL2…)
    so it reads straight against the circuit diagram. Lines point at the
    component master, so cost rolls up from component unit costs."""

    __tablename__ = "hyd_boms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bom_number: Mapped[str] = mapped_column(String(50), index=True, nullable=False)
    revision: Mapped[str] = mapped_column(String(10), default="A", nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    system_type: Mapped[str] = mapped_column(String(20), default="hydraulic", nullable=False)
    system_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("hyd_systems.id"), index=True, nullable=True)
    circuit_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("hyd_circuits.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="draft", nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    released_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    released_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    items: Mapped[list["HydBomItem"]] = relationship(
        "HydBomItem", back_populates="bom", cascade="all, delete-orphan", order_by="HydBomItem.sort_order",
    )


class HydBomItem(Base, TimestampMixin):
    __tablename__ = "hyd_bom_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bom_id: Mapped[int] = mapped_column(Integer, ForeignKey("hyd_boms.id"), index=True, nullable=False)
    component_id: Mapped[int] = mapped_column(Integer, ForeignKey("hyd_components.id"), index=True, nullable=False)
    tag_number: Mapped[str | None] = mapped_column(String(30), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    uom: Mapped[str] = mapped_column(String(20), default="NOS", nullable=False)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    bom: Mapped["HydBom"] = relationship("HydBom", back_populates="items")
