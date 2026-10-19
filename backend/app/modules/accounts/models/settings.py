from __future__ import annotations
from sqlalchemy import String, Integer, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from app.db.base import Base
from app.db.mixins import TimestampMixin
from app.modules.accounts.models._types import Percent

# Every ledger the system posts to on its own, with the seeded chart-of-
# accounts code used when Finance hasn't picked one yet. This is SAP's
# "automatic account determination" — the posting code asks for a role
# ("cgst_input"), never a hard-coded account code.
LEDGER_ROLES: dict[str, tuple[str, str]] = {
    "ap_control": ("2010", "Sundry Creditors control (Accounts Payable)"),
    "ar_control": ("1130", "Sundry Debtors control (Accounts Receivable)"),
    "cgst_input": ("1151", "CGST Input Credit"),
    "sgst_input": ("1152", "SGST Input Credit"),
    "igst_input": ("1153", "IGST Input Credit"),
    "cgst_output": ("2021", "CGST Output"),
    "sgst_output": ("2022", "SGST Output"),
    "igst_output": ("2023", "IGST Output"),
    "rcm_payable": ("2024", "GST Payable under Reverse Charge"),
    "round_off": ("5800", "Round Off"),
    "purchase_default": ("5001", "Purchases (default purchase ledger)"),
    "sales_default": ("4000", "Sales (default sales ledger)"),
    "stock_in_hand": ("1140", "Closing Stock (Balance Sheet — Stock-in-Hand)"),
    "stock_change": ("5050", "Changes in Inventories (P&L — opening/closing stock)"),
    "wip_in_hand": ("1141", "Work-in-Progress (Balance Sheet — open production orders at period end)"),
    "retained_earnings": ("3010", "Retained Earnings (year-end P&L transfer)"),
    "depreciation_expense": ("5400", "Depreciation expense"),
    "accumulated_depreciation": ("1030", "Accumulated Depreciation"),
    "asset_disposal_gain": ("4120", "Profit on Sale of Fixed Assets"),
    "asset_disposal_loss": ("5610", "Loss on Sale of Fixed Assets"),
    # Down payments (special-GL style) — party-tagged control ledgers kept
    # apart from AR/AP so Schedule III shows them under their own heads.
    "customer_advance": ("2080", "Advances from Customers (Other Current Liabilities)"),
    "supplier_advance": ("1170", "Advances to Suppliers (Short-term Loans and Advances)"),
    # Payment differences at receipt / payment (F-28 / F-53 residuals).
    "ld_recovered_by_customer": ("5620", "Liquidated Damages deducted by customers"),
    "penalty_by_customer": ("5621", "Penalties deducted by customers"),
    "bank_charges": ("5510", "Bank Charges"),
    "write_off_small_differences": ("5630", "Short payments & small differences written off"),
    "ld_recovered_from_vendor": ("4130", "LD / penalties recovered from vendors"),
    "discount_received": ("4140", "Cash discount received"),
    "discount_allowed": ("5640", "Cash discount allowed to customers"),
    # Asset accounting (ABZON / ABAON / AIBU) and foreign currency.
    "cwip": ("1040", "Capital Work-in-Progress (assets under construction)"),
    "asset_sale_clearing": ("1190", "Asset Sale Clearing (sale value until the buyer's invoice is posted)"),
    "fx_gain": ("4150", "Foreign exchange gain — realised"),
    "fx_loss": ("5650", "Foreign exchange loss — realised"),
    "fx_unrealised_gain": ("4151", "Foreign exchange gain — unrealised (month-end revaluation)"),
    "fx_unrealised_loss": ("5651", "Foreign exchange loss — unrealised (month-end revaluation)"),
    # Treasury: bank statement bookings and the bank guarantee / EMD register.
    "bank_interest_income": ("4110", "Interest received from the bank (statement credits)"),
    "margin_money": ("1185", "Margin Money with Banks (BG / LC lien)"),
    "emd_security_deposit": ("1186", "EMD & Security Deposits with customers"),
    "bg_commission": ("5515", "Bank guarantee / LC commission"),
    "bg_invocation_loss": ("5660", "Bank guarantees invoked / EMD forfeited"),
    # HR expense claims (PR05): Dr expense on approval / Cr employee payable;
    # payment voucher Dr payable / Cr bank (hr/services/expense_posting.py).
    "employee_reimbursement_payable": ("2085", "Employee reimbursements payable (approved expense claims)"),
    "staff_travel_expense": ("5250", "Travelling expenses — staff (travel, lodging)"),
    "staff_conveyance_expense": ("5251", "Local conveyance & fuel — staff"),
    "staff_meals_expense": ("5252", "Staff welfare — meals on duty"),
    "staff_telephone_expense": ("5253", "Telephone & internet — staff"),
    "staff_other_expense": ("5254", "Miscellaneous staff expenses"),
}


class AccountDetermination(Base, TimestampMixin):
    """Which ledger the system uses for one LEDGER_ROLES role. One row per
    role, seeded with the default code above; Finance can repoint it under
    Finance > Masters > Ledger Settings."""

    __tablename__ = "account_determinations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    role: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    gl_account_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("gl_accounts.id"), nullable=True)


class NumberSeries(Base, TimestampMixin):
    """Last number issued per series key ("JV/2026-27", "SI/2026-27", ...).
    Read with a row lock and incremented — never MAX(number)+1, which breaks
    once the padded width overflows and races under concurrent posting."""

    __tablename__ = "accounts_number_series"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    series_key: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    last_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class GSTRate(Base, TimestampMixin):
    """GST rate master. The total rate is stored; intra-state supplies split
    it equally into CGST + SGST, inter-state supplies charge it all as IGST
    (see services/gst.py). Rates are Government-notified, so they're data
    Finance maintains, not code — the 12%/28% slabs were withdrawn from
    22-Sep-2025 and are seeded inactive."""

    __tablename__ = "gst_rates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    rate: Mapped[float] = mapped_column(Percent, unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(String(200), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
