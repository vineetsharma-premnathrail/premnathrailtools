from __future__ import annotations
from sqlalchemy import String, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin

# Fixed in code (no admin customization).
VENDOR_DOC_TYPES = {
    "catalog": "Catalog / price list",
    "gst_certificate": "GST certificate",
    "pan": "PAN card",
    "msme": "MSME / Udyam certificate",
    "cancelled_cheque": "Cancelled cheque",
    "iso": "ISO / quality certificate",
    "other": "Other",
}


class VendorDocument(Base, TimestampMixin):
    """A file kept on a vendor (catalog PDF, GST certificate, …), stored in
    SharePoint like every other upload."""

    __tablename__ = "vendor_documents"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    vendor_id: Mapped[int] = mapped_column(Integer, ForeignKey("vendors.id", ondelete="CASCADE"), nullable=False, index=True)
    doc_type: Mapped[str] = mapped_column(String(30), nullable=False, default="other")
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sharepoint_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    file_size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(150), nullable=True)
    uploaded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    uploaded_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
