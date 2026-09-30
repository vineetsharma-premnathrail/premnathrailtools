from __future__ import annotations
from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import String, Integer, Text, Date, DateTime, Numeric, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.base import Base
from app.db.mixins import TimestampMixin

EXPENSE_CLAIM_STATUSES = ("draft", "submitted", "approved", "rejected", "paid", "cancelled")
EXPENSE_CATEGORIES = ("travel", "lodging", "food", "local_conveyance", "fuel", "phone", "other")


class HrExpenseClaim(Base, TimestampMixin):
    """EXP-YYYY-NNNN reimbursement claim. The reimbursement itself is paid
    outside the portal; `paid_on`/`payment_reference` only record it."""

    __tablename__ = "hr_expense_claims"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    claim_no: Mapped[str] = mapped_column(String(30), unique=True, index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True, nullable=False)
    travel_request_id: Mapped[int | None] = mapped_column(ForeignKey("hr_travel_requests.id"), index=True, nullable=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    claim_date: Mapped[date] = mapped_column(Date, nullable=False)
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=0, server_default="0", nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="draft", server_default="draft", index=True, nullable=False)
    approver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decided_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    paid_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    payment_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    paid_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)

    items: Mapped[list["HrExpenseClaimItem"]] = relationship(
        "HrExpenseClaimItem", back_populates="claim", cascade="all, delete-orphan",
        order_by="HrExpenseClaimItem.expense_date",
    )


class HrExpenseClaimItem(Base, TimestampMixin):
    __tablename__ = "hr_expense_claim_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    claim_id: Mapped[int] = mapped_column(ForeignKey("hr_expense_claims.id", ondelete="CASCADE"), index=True, nullable=False)
    expense_date: Mapped[date] = mapped_column(Date, nullable=False)
    category: Mapped[str] = mapped_column(String(20), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    receipt_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    receipt_path: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    receipt_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)

    claim: Mapped["HrExpenseClaim"] = relationship("HrExpenseClaim", back_populates="items")
