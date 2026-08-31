from __future__ import annotations
from datetime import datetime
from typing import TYPE_CHECKING
from sqlalchemy import String, Integer, Boolean, Text, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

if TYPE_CHECKING:
    from app.modules.p2p.models.rfq_attachment import RFQAttachment
    from app.modules.p2p.models.vendor_quotation import VendorQuotation

# draft: still being filled in, editable by its creator/purchase team.
# locked: submitted — read-only for everyone except an admin override.
RFQ_STATUSES = ("draft", "locked")

RFQ_VENDOR_TIERS = ("L1", "L2", "L3", "L4")


class RFQ(Base, TimestampMixin):
    """A Request-for-Quotation raised against an approved P2PRequest. Carries
    up to 4 vendor quotation attachments (L1-L4, see RFQAttachment) plus the
    commercial terms agreed with the selected vendor. Once submitted
    (status='locked') it becomes read-only — see routes/rfq.py — except for
    an admin override edit, matching the rest of P2P's status-gated lock
    pattern (see close_p2p_request in routes/p2p_requests.py)."""

    __tablename__ = "rfqs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rfq_number: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    p2p_request_id: Mapped[int] = mapped_column(Integer, ForeignKey("p2p_requests.id"), nullable=False)

    status: Mapped[str] = mapped_column(String(10), default="draft", nullable=False)

    is_single_quotation: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    single_quotation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    comments: Mapped[str | None] = mapped_column(Text, nullable=True)

    # When true, vendor quotations must pass a Technical Evaluation stage
    # before Commercial Evaluation opens; when false, that stage is skipped
    # entirely — see routes/rfq.py start_technical_evaluation /
    # start_commercial_evaluation.
    requires_technical_evaluation: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    payment_terms: Mapped[str | None] = mapped_column(Text, nullable=True)
    delivery_lead_time: Mapped[str | None] = mapped_column(String(100), nullable=True)
    ld_clause: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    locked_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    attachments: Mapped[list["RFQAttachment"]] = relationship(
        "RFQAttachment", back_populates="rfq", cascade="all, delete-orphan"
    )
    vendor_quotations: Mapped[list["VendorQuotation"]] = relationship(
        "VendorQuotation", back_populates="rfq", cascade="all, delete-orphan"
    )
