from __future__ import annotations
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.modules.p2p.models.p2p_request import P2PRequest


class P2PRequestPOApprover(Base, TimestampMixin):
    """A person the requester picked on the New PR form to approve this PR's
    PO for one manager role (e.g. 'purchase_manager'). The PO goes to every
    picked person plus every user flagged Director; any ONE approval
    approves it (see approve_po)."""

    __tablename__ = "p2p_request_po_approvers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    p2p_request_id: Mapped[int] = mapped_column(Integer, ForeignKey("p2p_requests.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(30), nullable=False)
    approver_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    approver_name: Mapped[str | None] = mapped_column(String(150), nullable=True)

    p2p_request: Mapped["P2PRequest"] = relationship("P2PRequest", back_populates="po_approvers")
