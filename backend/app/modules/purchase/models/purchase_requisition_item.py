from __future__ import annotations
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Float, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.modules.purchase.models.purchase_requisition import PurchaseRequisition


class PurchaseRequisitionItem(Base, TimestampMixin):
    """One material line item within a PurchaseRequisition — a snapshot taken
    from `ServiceMaterial` at the moment the PR was raised, kept in sync on
    quantity_received/item_status as the Service Request side marks receipts.

    Quantity/receiving tracking only — this module doesn't track cost."""

    __tablename__ = "purchase_requisition_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    purchase_requisition_id: Mapped[int] = mapped_column(Integer, ForeignKey("purchase_requisitions.id"), nullable=False)
    service_material_id: Mapped[int] = mapped_column(Integer, ForeignKey("erp_service_materials.id"), nullable=False)

    material_name: Mapped[str] = mapped_column(String(255), nullable=False)
    part_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    unit: Mapped[str] = mapped_column(String(20), default="pcs")
    quantity_requested: Mapped[float] = mapped_column(Float, default=1)
    quantity_received: Mapped[float] = mapped_column(Float, default=0)
    item_status: Mapped[str] = mapped_column(String(20), default="pending")  # pending | partial | received

    purchase_requisition: Mapped["PurchaseRequisition"] = relationship("PurchaseRequisition", back_populates="items")
