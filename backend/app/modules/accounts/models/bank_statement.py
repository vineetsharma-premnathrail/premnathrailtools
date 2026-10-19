from __future__ import annotations
from datetime import date, datetime
from sqlalchemy import String, Integer, Date, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Money

# Electronic bank statement (SAP FF67 / FEBAN). A statement file is uploaded
# into an in-progress bank reconciliation; each line is then matched to the
# voucher(s) it clears, or booked as a new voucher (bank charges, interest).
#
# unmatched  nothing in the books yet explains this line
# matched    cleared one or more posted vouchers (auto or manual)
# booked     a bank charge / interest / other voucher was created from it
STATEMENT_LINE_STATUSES = ("unmatched", "matched", "booked")
# How a line was matched: utr (bank reference = voucher UTR), cheque (cheque
# number), amount_date (unique voucher with the same amount close before the
# value date), manual (picked by a user), booked (voucher created from it).
MATCH_METHODS = ("utr", "cheque", "amount_date", "manual", "booked")


class BankStatement(Base, TimestampMixin):
    """One uploaded statement file for one bank account, read through a coded
    column-mapping template (services/bank_statement_formats.py)."""

    __tablename__ = "accounts_bank_statements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    bank_account_id: Mapped[int] = mapped_column(Integer, ForeignKey("bank_accounts.id"), nullable=False, index=True)
    bank_reconciliation_id: Mapped[int] = mapped_column(Integer, ForeignKey("bank_reconciliations.id"), nullable=False, index=True)
    statement_format: Mapped[str] = mapped_column(String(30), nullable=False)
    file_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    from_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    to_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Balance column of the first / last line, when the file has one.
    opening_balance: Mapped[float | None] = mapped_column(Money, nullable=True)
    closing_balance: Mapped[float | None] = mapped_column(Money, nullable=True)
    line_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    skipped_duplicates: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    uploaded_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    lines: Mapped[list["BankStatementLine"]] = relationship(
        "BankStatementLine", back_populates="statement", cascade="all, delete-orphan", order_by="BankStatementLine.line_number",
    )


class BankStatementLine(Base, TimestampMixin):
    """One row of a bank statement. debit = money out of our account,
    credit = money in (the bank's view of OUR account)."""

    __tablename__ = "accounts_bank_statement_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    statement_id: Mapped[int] = mapped_column(Integer, ForeignKey("accounts_bank_statements.id"), nullable=False, index=True)
    bank_account_id: Mapped[int] = mapped_column(Integer, ForeignKey("bank_accounts.id"), nullable=False, index=True)
    bank_reconciliation_id: Mapped[int] = mapped_column(Integer, ForeignKey("bank_reconciliations.id"), nullable=False, index=True)
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    txn_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    value_date: Mapped[date] = mapped_column(Date, nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    reference: Mapped[str | None] = mapped_column(String(120), nullable=True)
    cheque_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    debit: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    credit: Mapped[float] = mapped_column(Money, nullable=False, default=0)
    balance: Mapped[float | None] = mapped_column(Money, nullable=True)
    # Same bank account + date + amount + reference/description: a re-upload
    # of an overlapping statement skips lines already imported.
    dedup_key: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    match_status: Mapped[str] = mapped_column(String(20), nullable=False, default="unmatched")
    match_method: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # [{"payment_id": 12, "side": "main"|"counter"}] — one bulk bank debit can
    # clear several vouchers (e.g. a payment run's vouchers).
    matched_payments: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # The voucher created from this line by "Book" (bank charges, interest...).
    booked_payment_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("payment_transactions.id"), nullable=True)
    matched_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    matched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    statement: Mapped["BankStatement"] = relationship("BankStatement", back_populates="lines")

    @property
    def amount(self) -> float:
        return round(float(self.debit or 0) or float(self.credit or 0), 2)

    @property
    def direction(self) -> str:
        return "out" if float(self.debit or 0) > 0 else "in"
