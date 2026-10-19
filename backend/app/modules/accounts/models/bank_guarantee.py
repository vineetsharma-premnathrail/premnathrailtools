from __future__ import annotations
from datetime import date
from sqlalchemy import String, Integer, Date, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money, Percent

# Bank guarantees, letters of credit, EMD and security deposits (treasury-lite).
#
# direction
#   issued    we give it (PBG / ABG / EMD to Indian Railways and other customers)
#   received  we hold it (a supplier's ABG against our advance, a PBG on a PO)
BG_DIRECTIONS = ("issued", "received")
BG_INSTRUMENT_TYPES: dict[str, str] = {
    "pbg": "Performance bank guarantee (PBG)",
    "abg": "Advance bank guarantee (ABG)",
    "emd": "Earnest money deposit (EMD)",
    "security_deposit": "Security deposit (SD)",
    "bid_bond": "Bid bond",
    "warranty": "Warranty / defect-liability guarantee",
    "lc": "Letter of credit (LC)",
}
# form — how the instrument is funded:
#   bank_guarantee  bank issues a BG against a margin (lien FD / cash margin)
#   lc              bank opens an LC against a margin
#   deposit         money itself is deposited with the beneficiary (EMD/SD by
#                   DD, NEFT or a pledged FDR) — the full amount is the "margin"
BG_FORMS = ("bank_guarantee", "lc", "deposit")
# Issued: draft -> submitted (approval: Finance approver, then Partner) ->
# approved -> active (bank issued it) -> released / invoked. Received: active
# from the start. cancelled = abandoned before it was issued.
BG_STATUSES = ("draft", "submitted", "approved", "active", "released", "invoked", "cancelled")
BG_OPEN_STATUSES = ("draft", "submitted", "approved", "active")
# none     no money blocked (received instruments, or a BG with 0% margin)
# placed   margin / deposit moved out of the bank (voucher posted)
# released margin / deposit came back (voucher posted)
# consumed adjusted against an invocation / forfeited
BG_MARGIN_STATUSES = ("none", "placed", "released", "consumed")
BG_EVENT_TYPES = ("created", "submitted", "approved", "rejected", "issued", "extended", "margin_placed",
                  "margin_released", "commission", "released", "invoked", "cancelled", "document")


class BankGuarantee(Base, TimestampMixin):
    __tablename__ = "accounts_bank_guarantees"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bg_number: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    direction: Mapped[str] = mapped_column(String(10), nullable=False, default="issued")
    instrument_type: Mapped[str] = mapped_column(String(20), nullable=False)
    instrument_form: Mapped[str] = mapped_column(String(20), nullable=False, default="bank_guarantee")
    # The bank's own BG / LC / DD / FDR number, known once issued.
    instrument_number: Mapped[str | None] = mapped_column(String(80), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft", index=True)

    # Our bank account the instrument is issued from (issued) — margin,
    # commission and refunds move through it.
    bank_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("bank_accounts.id"), nullable=True)
    # The issuing bank as printed on the instrument (received ones, or a bank
    # we hold no account with).
    issuing_bank_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    issuing_bank_branch: Mapped[str | None] = mapped_column(String(150), nullable=True)

    customer_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_organizations.id"), nullable=True, index=True)
    vendor_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("vendors.id"), nullable=True, index=True)
    sales_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("sales_orders.id"), nullable=True, index=True)
    tender_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_tenders.id"), nullable=True, index=True)
    purchase_order_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("p2p_purchase_orders.id"), nullable=True)
    # Beneficiary (issued) / applicant (received) as named on the instrument,
    # e.g. "Principal Chief Materials Manager, Central Railway".
    counterparty_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    amount: Mapped[float] = mapped_column(Money, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), nullable=False, default="INR")
    issue_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Last day the beneficiary may still lodge a claim (expiry + claim period).
    claim_expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    margin_percent: Mapped[float | None] = mapped_column(Percent, nullable=True)
    margin_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    margin_status: Mapped[str] = mapped_column(String(20), nullable=False, default="none")
    # Ledger the margin / deposit sits on; blank = the ledger role default
    # (margin_money for BG/LC, emd_security_deposit for deposits).
    margin_gl_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=True)
    commission_rate: Mapped[float | None] = mapped_column(Percent, nullable=True)
    commission_total: Mapped[float] = mapped_column(Money, nullable=False, default=0)

    purpose: Mapped[str | None] = mapped_column(String(300), nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    document_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    document_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)

    closed_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    invoked_amount: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    closure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    approved_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    events: Mapped[list["BankGuaranteeEvent"]] = relationship(
        "BankGuaranteeEvent", back_populates="guarantee", cascade="all, delete-orphan", order_by="BankGuaranteeEvent.id",
    )


class BankGuaranteeEvent(Base, TimestampMixin):
    """History of one instrument: issue, each extension (old -> new expiry),
    margin and commission postings, release, invocation."""

    __tablename__ = "accounts_bank_guarantee_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    guarantee_id: Mapped[int] = mapped_column(Integer, ForeignKey("accounts_bank_guarantees.id"), nullable=False, index=True)
    event_type: Mapped[str] = mapped_column(String(20), nullable=False)
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[float | None] = mapped_column(Money, nullable=True)
    old_expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    new_expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    old_claim_expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    new_claim_expiry_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    payment_transaction_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("payment_transactions.id"), nullable=True)
    journal_entry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    guarantee: Mapped["BankGuarantee"] = relationship("BankGuarantee", back_populates="events")
