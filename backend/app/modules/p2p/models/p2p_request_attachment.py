from __future__ import annotations
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.modules.p2p.models.p2p_request import P2PRequest
    from app.modules.p2p.models.p2p_request_item import P2PRequestItem

# doc_type distinguishes the requester's supporting/spec uploads from the
# Purchase team's PO document, all stored the same way (SharePoint pointer).
P2P_ATTACHMENT_DOC_TYPES = ("supporting", "specification", "po_document")


class P2PRequestAttachment(Base, TimestampMixin):
    """A file uploaded against a P2PRequest, stored in SharePoint (only the
    pointer/metadata lives here — the actual bytes live in SharePoint).
    Optionally scoped to one line item (`item_id`) rather than the PR as a
    whole — e.g. a photo/spec sheet attached to a specific part row."""

    __tablename__ = "p2p_request_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    p2p_request_id: Mapped[int] = mapped_column(Integer, ForeignKey("p2p_requests.id"), nullable=False)
    item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("p2p_request_items.id"), nullable=True)
    doc_type: Mapped[str] = mapped_column(String(20), default="supporting", nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sharepoint_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    p2p_request: Mapped["P2PRequest"] = relationship("P2PRequest", back_populates="attachments")
    item: Mapped["P2PRequestItem | None"] = relationship("P2PRequestItem", back_populates="attachments")
