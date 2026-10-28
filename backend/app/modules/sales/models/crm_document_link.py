from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SalesOrderCrmDocument(Base):
    """A CRM document (of the order's source inquiry / tender) linked to a sales
    order. Only the link is stored - the file stays in CRM / SharePoint, so the
    order always shows the current file and nothing is copied (owner, 2026-10-27)."""

    __tablename__ = "sales_order_crm_documents"
    __table_args__ = (UniqueConstraint("sales_order_id", "crm_document_id", name="uq_sales_order_crm_document"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sales_order_id: Mapped[int] = mapped_column(Integer, ForeignKey("sales_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    crm_document_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_documents.id", ondelete="CASCADE"), nullable=False, index=True)
    linked_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    linked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
