from __future__ import annotations

from sqlalchemy import String, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

SALES_ATTACHMENT_ENTITIES = ("sales_order", "sales_amendment", "sales_extension")
SALES_ATTACHMENT_DOC_TYPES = (
    "customer_po", "loa", "amendment_letter", "dp_extension_letter", "pod", "inspection_certificate",
    "bank_guarantee", "other",
)
# A PO or an LOA document satisfies the "PO attachment" submit check.
SALES_PO_DOC_TYPES = ("customer_po", "loa")


class SalesAttachment(Base, TimestampMixin, SoftDeleteMixin):
    """Polymorphic attachments for orders, amendments and DP extensions.
    Bytes live in SharePoint under Sales-Orders."""

    __tablename__ = "sales_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(30), index=True, nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    doc_type: Mapped[str] = mapped_column(String(30), default="other", nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sharepoint_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
