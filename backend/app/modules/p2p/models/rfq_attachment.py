from __future__ import annotations
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.modules.p2p.models.rfq import RFQ


class RFQAttachment(Base, TimestampMixin):
    """A vendor quotation file uploaded against an RFQ, tagged with which
    vendor tier (L1-L4) it belongs to — stored in SharePoint like every
    other P2P attachment (only the pointer/metadata lives here)."""

    __tablename__ = "rfq_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rfq_id: Mapped[int] = mapped_column(Integer, ForeignKey("rfqs.id"), nullable=False)
    vendor_tier: Mapped[str] = mapped_column(String(2), nullable=False)
    # Vendor details entered alongside the quotation upload for this tier —
    # every tier (Vendor 1-4) can carry its own vendor identity, not just L1.
    vendor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    vendor_contact: Mapped[str | None] = mapped_column(String(50), nullable=True)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sharepoint_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)

    rfq: Mapped["RFQ"] = relationship("RFQ", back_populates="attachments")
