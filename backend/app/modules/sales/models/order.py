"""Sales Order — the contract record between CRM (the pursuit) and
Production / Finance / Store (execution). See docs/02-modules/sales/plan.md §4.

Statuses and types are coded tuples (D8). Transitions happen only through the
action endpoints in routes/orders.py — never a generic status PATCH. Money
uses the Accounts Money / Rate / Percent / Quantity column types so totals
match the invoice to the paisa."""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import String, Integer, Boolean, Date, DateTime, Text, ForeignKey, JSON, UniqueConstraint, Index, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base
from app.db.mixins import TimestampMixin, SoftDeleteMixin
from app.modules.accounts.models._types import Money, Quantity, Rate, Percent

# draft → pending_approval → confirmed → in_execution → partially_delivered →
# delivered → closed; on_hold ⇄ (confirmed / in_execution / partially_delivered);
# cancelled (draft / pending_approval / confirmed with nothing built);
# short_closed (in_execution / partially_delivered).
SALES_ORDER_STATUSES = (
    "draft", "pending_approval", "confirmed", "in_execution", "partially_delivered",
    "delivered", "closed", "on_hold", "cancelled", "short_closed",
)
# Live = counts towards "one SO per source" and PO uniqueness.
SALES_ORDER_LIVE_STATUSES = (
    "draft", "pending_approval", "confirmed", "in_execution", "partially_delivered", "delivered", "closed", "on_hold",
)
# Confirmed and still being executed — the order book.
SALES_ORDER_OPEN_STATUSES = ("confirmed", "in_execution", "partially_delivered", "on_hold")
SALES_ORDER_HOLDABLE_STATUSES = ("confirmed", "in_execution", "partially_delivered")
SALES_ORDER_AMENDABLE_STATUSES = ("confirmed", "in_execution", "partially_delivered", "on_hold")

SALES_ORDER_TYPES = ("road_rail_vehicle", "rail_bound_vehicle", "accessories", "other")
SALES_DEFAULT_ORDER_TYPE = "road_rail_vehicle"
# One place for the labels (forms, documents, validation messages).
SALES_ORDER_TYPE_LABELS = {"road_rail_vehicle": "Road Rail Vehicle", "rail_bound_vehicle": "Rail Bound Vehicle",
                           "accessories": "Accessories", "other": "Others"}
# Both vehicle types behave as the old "RRV supply"; accessories / others as the old spares / other.
SALES_VEHICLE_ORDER_TYPES = ("road_rail_vehicle", "rail_bound_vehicle")

# Order currency is a LABEL only: no conversion, GST / billing / invoices / Finance treat the numbers as given.
SALES_DEFAULT_CURRENCY = "INR"
SALES_CURRENCIES = (
    {"code": "INR", "name": "Indian Rupee", "symbol": "₹"}, {"code": "USD", "name": "US Dollar", "symbol": "$"},
    {"code": "EUR", "name": "Euro", "symbol": "€"}, {"code": "GBP", "name": "Pound Sterling", "symbol": "£"},
    {"code": "AED", "name": "UAE Dirham", "symbol": "AED"}, {"code": "SGD", "name": "Singapore Dollar", "symbol": "S$"},
    {"code": "AUD", "name": "Australian Dollar", "symbol": "A$"}, {"code": "CAD", "name": "Canadian Dollar", "symbol": "C$"},
    {"code": "JPY", "name": "Japanese Yen", "symbol": "¥"}, {"code": "CNY", "name": "Chinese Yuan", "symbol": "CN¥"},
    {"code": "SAR", "name": "Saudi Riyal", "symbol": "SAR"}, {"code": "QAR", "name": "Qatari Riyal", "symbol": "QAR"},
    {"code": "KWD", "name": "Kuwaiti Dinar", "symbol": "KWD"}, {"code": "OMR", "name": "Omani Rial", "symbol": "OMR"},
    {"code": "BDT", "name": "Bangladeshi Taka", "symbol": "৳"}, {"code": "LKR", "name": "Sri Lankan Rupee", "symbol": "Rs"},
    {"code": "NPR", "name": "Nepalese Rupee", "symbol": "Rs"}, {"code": "ZAR", "name": "South African Rand", "symbol": "R"},
)
SALES_CURRENCY_CODES = tuple(c["code"] for c in SALES_CURRENCIES)
SALES_SOURCE_TYPES = ("inquiry", "tender", "direct")
SALES_PRICE_BASES = ("ex_works", "for_destination", "for_dispatch")
SALES_LD_PERIODS = ("week", "day")
SALES_LD_BASES = ("delayed_value", "contract_value")
SALES_WARRANTY_RULES = ("from_delivery", "from_commissioning", "earlier_of", "later_of")
# Deviation flags computed at submit; any of them escalates to a Partner.
SALES_DEVIATION_FLAGS = ("ld_uncapped", "ld_cap_above_standard", "warranty_above_standard", "advance_below_standard",
                         "price_below_list")
# Approval chain, lowest first. required_approval_level is the top one needed.
SALES_APPROVAL_LEVELS = ("sales_head", "director", "partner")

SALES_LINE_TYPES = ("rrv", "spares", "service", "freight", "other")

# open → build_planned → in_production → ready → dispatched → delivered →
# commissioned; cancelled. Derived by service.refresh_schedule_status — never set by hand.
SALES_SCHEDULE_STATUSES = (
    "open", "build_planned", "in_production", "ready", "dispatched", "delivered", "commissioned", "cancelled",
)
SALES_SCHEDULE_UNDELIVERED = ("open", "build_planned", "in_production", "ready", "dispatched")

SALES_MILESTONE_TYPES = (
    "advance", "drawing_approval", "inspection", "dispatch", "delivery", "commissioning", "retention_release", "other",
)
SALES_BILLING_STATUSES = ("not_due", "due", "proforma_issued", "invoice_requested", "invoiced", "settled", "cancelled")


class SalesOrder(Base, TimestampMixin, SoftDeleteMixin):
    """One customer contract (one PO / LOA). `so_number` is issued only at
    confirmation; a draft is shown as "Draft #<id>"."""

    __tablename__ = "sales_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # SM12 optimistic lock (core/optimistic_lock.py): bumped on every UPDATE;
    # a save carrying an older X-Lock-Version gets 409 "changed by X at T".
    lock_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    lock_changed_by_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    __mapper_args__ = {"version_id_col": lock_version}
    so_number: Mapped[str | None] = mapped_column(String(50), unique=True, index=True, nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="draft", index=True, nullable=False)
    order_type: Mapped[str] = mapped_column(String(20), default="road_rail_vehicle", nullable=False)

    customer_id: Mapped[int] = mapped_column(Integer, ForeignKey("crm_organizations.id"), index=True, nullable=False)
    customer_contact_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_org_contacts.id"), nullable=True)

    source_type: Mapped[str] = mapped_column(String(20), default="direct", nullable=False)
    source_inquiry_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_inquiries.id"), index=True, nullable=True)
    source_tender_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_tenders.id"), index=True, nullable=True)
    source_quotation_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_quotations.id"), nullable=True)
    source_quotation_number: Mapped[str | None] = mapped_column(String(100), nullable=True)

    customer_po_number: Mapped[str | None] = mapped_column(String(100), index=True, nullable=True)
    customer_po_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    customer_po_received_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    loa_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    loa_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    contract_reference: Mapped[str | None] = mapped_column(String(150), nullable=True)
    purchaser_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    paying_authority: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Snapshot from the organisation at confirmation (editable before it).
    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    billing_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    customer_gstin: Mapped[str | None] = mapped_column(String(30), nullable=True)
    place_of_supply_state_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    customer_state: Mapped[str | None] = mapped_column(String(100), nullable=True)

    currency: Mapped[str] = mapped_column(String(3), default="INR", nullable=False)
    price_basis: Mapped[str] = mapped_column(String(20), default="for_destination", nullable=False)
    freight_terms: Mapped[str | None] = mapped_column(String(255), nullable=True)
    insurance_terms: Mapped[str | None] = mapped_column(String(255), nullable=True)
    payment_terms_label: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Server-computed from lines (service.recompute_totals). Never typed.
    subtotal: Mapped[float] = mapped_column(Money, default=0, nullable=False)
    discount_total: Mapped[float] = mapped_column(Money, default=0, nullable=False)
    taxable_total: Mapped[float] = mapped_column(Money, default=0, nullable=False)
    gst_total: Mapped[float] = mapped_column(Money, default=0, nullable=False)
    grand_total: Mapped[float] = mapped_column(Money, default=0, nullable=False)

    inspection_agency: Mapped[str | None] = mapped_column(String(30), nullable=True)
    third_party_inspection_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    ld_applicable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    ld_rate_percent: Mapped[float | None] = mapped_column(Percent, nullable=True)
    ld_rate_period: Mapped[str | None] = mapped_column(String(10), nullable=True)
    ld_basis: Mapped[str | None] = mapped_column(String(20), nullable=True)
    ld_max_percent: Mapped[float | None] = mapped_column(Percent, nullable=True)  # None = uncapped

    warranty_months_from_delivery: Mapped[int | None] = mapped_column(Integer, nullable=True)
    warranty_months_from_commissioning: Mapped[int | None] = mapped_column(Integer, nullable=True)
    warranty_rule: Mapped[str | None] = mapped_column(String(30), nullable=True)
    warranty_terms_text: Mapped[str | None] = mapped_column(Text, nullable=True)

    pbg_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    pbg_percent: Mapped[float | None] = mapped_column(Percent, nullable=True)
    pbg_due_days: Mapped[int | None] = mapped_column(Integer, nullable=True)

    delivery_terms_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    special_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)

    sales_owner_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    branch_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("branches.id"), nullable=True)

    deviation_flags: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    required_approval_level: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Bumped on every submit, so approvals from an earlier (returned) round don't count.
    approval_round: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    confirmed_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    oa_issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    oa_issued_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    amendment_no: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    held_from_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    hold_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancel_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    short_close_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    close_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    return_comment: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    lines: Mapped[list["SalesOrderLine"]] = relationship(
        back_populates="order", cascade="all, delete-orphan", order_by="SalesOrderLine.line_number",
    )
    schedules: Mapped[list["SalesOrderSchedule"]] = relationship(
        back_populates="order", cascade="all, delete-orphan", order_by="SalesOrderSchedule.sequence",
    )
    billing_lines: Mapped[list["SalesBillingPlanLine"]] = relationship(
        back_populates="order", cascade="all, delete-orphan", order_by="SalesBillingPlanLine.sequence",
    )

    @property
    def display_number(self) -> str:
        return self.so_number or f"Draft #{self.id}"


class SalesOrderLine(Base, TimestampMixin):
    """What was sold. `qty_*` progress columns are maintained by the service."""

    __tablename__ = "sales_order_lines"
    __table_args__ = (UniqueConstraint("so_id", "line_number", name="uq_sales_order_line_number"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    so_id: Mapped[int] = mapped_column(Integer, ForeignKey("sales_orders.id", ondelete="CASCADE"), index=True, nullable=False)
    line_number: Mapped[int] = mapped_column(Integer, nullable=False)
    line_type: Mapped[str] = mapped_column(String(20), default="rrv", nullable=False)
    crm_product_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_products.id"), nullable=True)  # legacy, read-only history
    product_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("products.id", ondelete="SET NULL"), nullable=True, index=True)
    # Pricing conditions (VK11): price the conditions gave, the record used, and the reason
    # when a different price / higher discount was typed (sales/pricing.py).
    list_price: Mapped[float | None] = mapped_column(Rate, nullable=True)
    price_condition_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("product_price_conditions.id", ondelete="SET NULL"), nullable=True)
    price_override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    product_item_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("store_items.id"), nullable=True)
    rrv_model: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    specification: Mapped[str | None] = mapped_column(Text, nullable=True)
    customer_line_ref: Mapped[str | None] = mapped_column(String(150), nullable=True)
    hsn_sac_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    uom: Mapped[str] = mapped_column(String(20), default="NOS", nullable=False)
    quantity: Mapped[float] = mapped_column(Quantity, default=1, nullable=False)
    unit_price: Mapped[float] = mapped_column(Rate, default=0, nullable=False)
    discount_percent: Mapped[float] = mapped_column(Percent, default=0, nullable=False)
    discount_amount: Mapped[float] = mapped_column(Money, default=0, nullable=False)
    taxable_amount: Mapped[float] = mapped_column(Money, default=0, nullable=False)
    gst_rate: Mapped[float] = mapped_column(Percent, default=18, nullable=False)
    gst_amount: Mapped[float] = mapped_column(Money, default=0, nullable=False)
    line_total: Mapped[float] = mapped_column(Money, default=0, nullable=False)

    qty_scheduled: Mapped[float] = mapped_column(Quantity, default=0, nullable=False)
    qty_dispatched: Mapped[float] = mapped_column(Quantity, default=0, nullable=False)
    qty_delivered: Mapped[float] = mapped_column(Quantity, default=0, nullable=False)
    qty_invoiced: Mapped[float] = mapped_column(Quantity, default=0, nullable=False)
    qty_cancelled: Mapped[float] = mapped_column(Quantity, default=0, nullable=False)

    order: Mapped[SalesOrder] = relationship(back_populates="lines")


class SalesOrderSchedule(Base, TimestampMixin):
    """One delivery lot — for `rrv` lines one row per vehicle (qty 1), each with
    its own date, build, LD and warranty."""

    __tablename__ = "sales_order_schedules"
    # One build sits on at most one live delivery row (race-proof link_build; migration e7b2c4f9a1d3).
    __table_args__ = (
        Index("uq_sales_schedule_live_build", "rrv_build_id", unique=True,
              postgresql_where=text("rrv_build_id IS NOT NULL AND status <> 'cancelled'"),
              sqlite_where=text("rrv_build_id IS NOT NULL AND status <> 'cancelled'")),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    so_id: Mapped[int] = mapped_column(Integer, ForeignKey("sales_orders.id", ondelete="CASCADE"), index=True, nullable=False)
    so_line_id: Mapped[int] = mapped_column(Integer, ForeignKey("sales_order_lines.id"), index=True, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    quantity: Mapped[float] = mapped_column(Quantity, default=1, nullable=False)

    consignee_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    consignee_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    consignee_gstin: Mapped[str | None] = mapped_column(String(30), nullable=True)
    consignee_state_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    consignee_contact_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    consignee_contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # The customer's ship-to / consignee address (CRM organisation › Addresses) the
    # consignee_* snapshot above was filled from — null = typed by hand.
    ship_to_address_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("crm_org_addresses.id", ondelete="SET NULL"), nullable=True)

    contract_delivery_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    current_delivery_date: Mapped[date | None] = mapped_column(Date, index=True, nullable=True)
    committed_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    rrv_build_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("production_rrv_builds.id"), index=True, nullable=True)
    erp_project_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("erp_projects.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="open", index=True, nullable=False)

    dispatched_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    delivered_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    commissioned_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    # Derived from the row's live SalesDeliveryEvents (sales/delivery.py) — never typed.
    qty_dispatched: Mapped[float] = mapped_column(Quantity, default=0, server_default="0", nullable=False)
    qty_delivered: Mapped[float] = mapped_column(Quantity, default=0, server_default="0", nullable=False)
    dispatch_reference: Mapped[str | None] = mapped_column(String(150), nullable=True)
    delivery_reference: Mapped[str | None] = mapped_column(String(150), nullable=True)
    commissioning_reference: Mapped[str | None] = mapped_column(String(150), nullable=True)

    ld_weeks: Mapped[int | None] = mapped_column(Integer, nullable=True)  # periods (weeks or days per ld_rate_period)
    ld_amount: Mapped[float | None] = mapped_column(Money, nullable=True)
    ld_computed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ld_waived: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)  # full waiver (not set by DP extensions)
    # A DP extension granted "without LD": no LD accrues up to this date; after it LD
    # counts normally from this date. "With LD" leaves it alone (LD from the contract date).
    ld_free_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    risk_flag: Mapped[str | None] = mapped_column(String(20), nullable=True)  # None / at_risk / overdue (daily job)

    warranty_start: Mapped[date | None] = mapped_column(Date, nullable=True)
    warranty_end: Mapped[date | None] = mapped_column(Date, nullable=True)

    order: Mapped[SalesOrder] = relationship(back_populates="schedules")


class SalesBillingPlanLine(Base, TimestampMixin):
    """One payment / billing milestone. Percentages of an SO must add up to 100."""

    __tablename__ = "sales_billing_plan_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    so_id: Mapped[int] = mapped_column(Integer, ForeignKey("sales_orders.id", ondelete="CASCADE"), index=True, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    milestone_type: Mapped[str] = mapped_column(String(30), nullable=False)
    description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    percent: Mapped[float] = mapped_column(Percent, default=0, nullable=False)
    amount: Mapped[float] = mapped_column(Money, default=0, nullable=False)
    per_unit: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    due_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    recovers_advance_percent: Mapped[float | None] = mapped_column(Percent, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="not_due", nullable=False)
    triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    invoiced_amount: Mapped[float] = mapped_column(Money, default=0, nullable=False)
    # Sales -> Accounts handoff from the billing due list (VF04).
    invoice_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    invoice_requested_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)

    order: Mapped[SalesOrder] = relationship(back_populates="billing_lines")
