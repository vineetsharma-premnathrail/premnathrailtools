"""Purchase requisitions raised from a maintenance work order (SAP IW32
external services / components → ME51N from the order).

purpose:
  spares            out-of-stock spare parts — received into Store by the
                    GRN, then issued on the work order (cost = spares_cost)
  external_service  outside repair / service by a vendor — no Store stock;
                    the posted vendor invoice lines of the PO's service
                    lines flow back to the work order as procured_cost."""
from __future__ import annotations
from sqlalchemy import String, Integer, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

MAINTENANCE_WO_PR_PURPOSES = ("spares", "external_service")


class MaintenanceWorkOrderPurchaseRequest(Base, TimestampMixin):
    __tablename__ = "maintenance_wo_purchase_requests"
    __table_args__ = (UniqueConstraint("p2p_request_id", name="uq_maintenance_wo_pr_request"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    work_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("maintenance_work_orders.id", ondelete="CASCADE"), index=True, nullable=False)
    p2p_request_id: Mapped[int] = mapped_column(Integer, ForeignKey("p2p_requests.id"), nullable=False)
    purpose: Mapped[str] = mapped_column(String(20), default="spares", nullable=False)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
