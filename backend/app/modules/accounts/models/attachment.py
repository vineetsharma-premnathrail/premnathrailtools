from __future__ import annotations
from sqlalchemy import String, Integer, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin

# The Finance documents a supporting file (voucher proof) can sit on, and the
# Permission Matrix tab each one follows. A party note's tab depends on its
# type (debit_notes / credit_notes) and is resolved per record.
FINANCE_ATTACHMENT_ENTITIES = {
    "vendor_invoice": "purchase_invoices",
    "party_note": None,
    "ar_transaction": "sales_invoices",
    "journal": "journal_vouchers",
    "payment": "payments",
}

# Fixed in code (no admin customization).
FINANCE_ATTACHMENT_DOC_TYPES = {
    "bill": "Bill / tax invoice",
    "bank_proof": "Bank advice / UTR proof",
    "working": "Working / calculation",
    "approval": "Approval mail / note",
    "customer_po": "Customer PO",
    "delivery_proof": "Signed delivery / LR copy",
    "other": "Other",
}


class FinanceAttachment(Base, TimestampMixin, SoftDeleteMixin):
    """A supporting document (voucher proof) on a Finance document: the
    vendor's bill on a purchase invoice, the working behind a journal, the
    bank advice on a receipt. Bytes live in SharePoint under Finance-media.

    entity_id is NULL while a file is staged for a payment voucher that is
    not saved yet (the voucher posts on save, so a required proof has to be
    uploaded first); creating the voucher links it."""

    __tablename__ = "accounts_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(20), index=True, nullable=False)
    entity_id: Mapped[int | None] = mapped_column(Integer, index=True, nullable=True)
    doc_type: Mapped[str] = mapped_column(String(20), default="other", nullable=False)
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    size: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sharepoint_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    sharepoint_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    created_by_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
