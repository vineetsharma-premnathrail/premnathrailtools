from __future__ import annotations
from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.modules.p2p.models.p2p_request import P2PRequest


class P2PRequestApproval(Base, TimestampMixin):
    """One assigned PR approver slot under the manager-role approval matrix
    (see PR_APPROVAL_ROLE_SETS in p2p_request.py): `role` is a manager role
    key such as 'design_manager', and the named user must approve before the
    PR can move on — every row must carry an approved_at for the PR to be
    approved. PRs created before this matrix have no rows here and keep
    their approvals on the legacy P2PRequest.approver_id/project_head_id/
    plant_head_id columns instead."""

    __tablename__ = "p2p_request_approvals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    p2p_request_id: Mapped[int] = mapped_column(Integer, ForeignKey("p2p_requests.id"), nullable=False, index=True)
    role: Mapped[str] = mapped_column(String(30), nullable=False)
    approver_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    # Snapshot for display — the live name is still resolved from users where
    # it matters, this just keeps the trail readable if the user is renamed.
    approver_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    p2p_request: Mapped["P2PRequest"] = relationship("P2PRequest", back_populates="approvals")
