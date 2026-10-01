from __future__ import annotations
from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.modules.p2p.models.p2p_request import P2PRequest


class P2PRequestPOApprover(Base, TimestampMixin):
    """A person the requester picked on the New PR form to approve this PR's
    PO for one manager role (e.g. 'purchase_manager'). ALL named roles must
    approve (production_manager, purchase_manager, project_manager). Director
    role: ANY ONE director must approve (tracked in P2PRequest)."""

    __tablename__ = "p2p_request_po_approvers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    p2p_request_id: Mapped[int] = mapped_column(Integer, ForeignKey("p2p_requests.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(30), nullable=False)
    approver_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    approver_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    approved_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    p2p_request: Mapped["P2PRequest"] = relationship("P2PRequest", back_populates="po_approvers")
