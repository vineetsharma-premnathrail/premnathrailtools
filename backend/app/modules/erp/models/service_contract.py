"""Customer service contracts — AMC / CMC / extended warranty (SAP VA41–VA43
service contract with entitlement and a periodic billing plan).

  amc                labour and visits covered, spares billed
  cmc                comprehensive: labour, visits and spares covered
  extended_warranty  warranty extended past the standard period (as CMC)

Statuses (action endpoints only, never a generic PATCH):
  draft → pending_approval → active → expired / renewed / cancelled
  pending_approval → draft (rejected / returned / withdrawn)
A machine can be on only one active contract for any day (checked at
submit and at activation). Business rules: erp/contracts.py."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.mixins import SoftDeleteMixin, TimestampMixin
from app.modules.accounts.models._types import Money, Percent

SERVICE_CONTRACT_TYPES = ("amc", "cmc", "extended_warranty")
SERVICE_CONTRACT_TYPE_LABELS = {"amc": "AMC (labour & visits)", "cmc": "CMC (comprehensive)", "extended_warranty": "Extended warranty"}
SERVICE_CONTRACT_STATUSES = ("draft", "pending_approval", "active", "expired", "renewed", "cancelled")
SERVICE_CONTRACT_BILLING_FREQUENCIES = ("upfront", "monthly", "quarterly", "half_yearly", "annual")
FREQUENCY_MONTHS = {"monthly": 1, "quarterly": 3, "half_yearly": 6, "annual": 12}
SERVICE_CONTRACT_BILLING_STATUSES = ("planned", "invoiced", "cancelled")


class ServiceContract(Base, TimestampMixin, SoftDeleteMixin):
    __tablename__ = "erp_service_contracts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    contract_number: Mapped[str] = mapped_column(String(40), unique=True, index=True, nullable=False)
    contract_type: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_organizations.id"), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(30), default="draft", server_default="draft", nullable=False, index=True)

    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    contract_value: Mapped[float] = mapped_column(Money, default=0, nullable=False)  # taxable value for the whole period
    gst_rate: Mapped[float] = mapped_column(Percent, default=18, nullable=False)
    sac_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    billing_frequency: Mapped[str] = mapped_column(String(20), default="quarterly", nullable=False)
    # Bill each period on its first day (advance) or last day (arrears).
    bill_in_advance: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)

    # Entitlement: 0 = unlimited visits.
    visits_included: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    labour_covered: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    spares_covered: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sla_response_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sla_resolution_hours: Mapped[int | None] = mapped_column(Integer, nullable=True)

    customer_po_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    customer_po_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    terms: Mapped[str | None] = mapped_column(Text, nullable=True)
    renewed_from_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("erp_service_contracts.id", ondelete="SET NULL"), nullable=True)

    submitted_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approval_remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    machines: Mapped[list["ServiceContractMachine"]] = relationship(back_populates="contract", cascade="all, delete-orphan")
    billing_lines: Mapped[list["ServiceContractBilling"]] = relationship(
        back_populates="contract", cascade="all, delete-orphan", order_by="ServiceContractBilling.sequence")
    customer = relationship("Organization", foreign_keys=[customer_id], viewonly=True)


class ServiceContractMachine(Base):
    __tablename__ = "erp_service_contract_machines"
    __table_args__ = (UniqueConstraint("contract_id", "project_id", name="uq_erp_contract_machine"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    contract_id: Mapped[int] = mapped_column(Integer, ForeignKey("erp_service_contracts.id", ondelete="CASCADE"), nullable=False, index=True)
    project_id: Mapped[int] = mapped_column(Integer, ForeignKey("erp_projects.id"), nullable=False, index=True)

    contract: Mapped[ServiceContract] = relationship(back_populates="machines")
    project = relationship("Project", foreign_keys=[project_id], viewonly=True)


class ServiceContractBilling(Base, TimestampMixin):
    """One billing period of the plan; invoiced = an AR (sales) invoice drafted
    through accounts.service.create_ar_transaction."""

    __tablename__ = "erp_service_contract_billing"
    __table_args__ = (UniqueConstraint("contract_id", "sequence", name="uq_erp_contract_billing_seq"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    contract_id: Mapped[int] = mapped_column(Integer, ForeignKey("erp_service_contracts.id", ondelete="CASCADE"), nullable=False, index=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    period_start: Mapped[date] = mapped_column(Date, nullable=False)
    period_end: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Money, nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="planned", server_default="planned", nullable=False)
    ar_transaction_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("ar_transactions.id", ondelete="SET NULL"), nullable=True, index=True)
    invoiced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    contract: Mapped[ServiceContract] = relationship(back_populates="billing_lines")
