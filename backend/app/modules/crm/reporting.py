"""CRM reports (CRM › Reports tab) for the shared reports framework
(app/core/reporting): ready-made dashboards for management - how many leads
came in, month by month, from where, for which products, how many were won or
lost and why, and what was quoted.

Two datasets, computed in Python over narrow-column selects:

    lead       one row per live inquiry (an inquiry is the CRM lead), scoped
               with apply_scope like the Inquiries list
    quotation  one row per quotation of a scoped, live inquiry

Money (expected value, quoted value) needs CRM › Inquiries & Tenders › Prices &
margins. Per-person figures (leads per BD owner) need CRM › Reports › People &
performance; without it the Sales team page shows only the viewer's own leads.
Quoted value is kept apart per currency: Domestic quotations in rupees, Export
quotations in US dollars - the two are never added together.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Iterable

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.data_scope import apply_scope
import app.modules.crm.access  # noqa: F401 — registers the CRM data-scope models (Inquiry)
from app.core.reporting import (
    DashboardDef, DashboardPage, DateField, DetailColumn, Dimension, FilterDef, Measure, ReportDataset, ReportDef,
    VisualSpec, register_dashboard, register_dataset, register_report, token,
)
from app.modules.crm.models.inquiry import Inquiry, Quotation, QuotationLineItem
from app.modules.crm.models.organization import Organization
from app.modules.crm.services.opportunity import LOST_REASONS, is_lost, is_won
from app.modules.main.models.user import User

IST = timezone(timedelta(hours=5, minutes=30))
INQUIRY_PAGE = "/dashboard/crm/inquiries"
_MONEY = ("crm", "inquiries_tenders", "prices")

OUTCOME_LABELS = {"open": "Open", "won": "Won (ordered)", "lost": "Lost (not ordered)"}
AGE_LABELS = {"b1": "0-7 days", "b2": "8-30 days", "b3": "31-90 days", "b4": "91-180 days", "b5": "Over 180 days"}
QUOT_STATUS_LABELS = {"draft": "Draft", "submitted": "Waiting for approval", "approved": "Approved", "sent": "Sent to customer",
                      "accepted": "Accepted", "lost": "Lost", "expired": "Expired"}
NOT_SET = "Not set"


def _ist_date(dt: datetime | None) -> date | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST).date()


def _age_bucket(days: int) -> str:
    return "b1" if days <= 7 else "b2" if days <= 30 else "b3" if days <= 90 else "b4" if days <= 180 else "b5"


def _text(v: Any) -> str:
    return (str(v).strip() if v is not None else "") or NOT_SET


def _quote_total(q: Quotation, items: list[QuotationLineItem]) -> float:
    """Grand total as printed on the quotation (quotation_pdf.py): lump sum = price + GST;
    item-wise = sum of line totals minus the discount."""
    if q.pricing_mode == "lumpsum":
        gst = 0 if q.quotation_type == "Export" else (q.lump_sum_gst_percent or 0)
        return float(q.price or 0) * (1 + gst / 100)
    total = sum(float(it.total or 0) for it in items)
    if q.discount:
        total -= total * q.discount / 100 if q.discount_type == "percent" else q.discount
    return total


# ── Loading (every read starts from the viewer's CRM data scope) ────────────

_LEAD_COLS = (
    Inquiry.id, Inquiry.universal_id, Inquiry.created_at, Inquiry.closed_at, Inquiry.org_id, Organization.name,
    Inquiry.railway_zone, Inquiry.division, Inquiry.lead_source, Inquiry.product, Inquiry.product_category,
    Inquiry.current_stage, Inquiry.status, Inquiry.priority, Inquiry.bd_owner_id, Inquiry.bd_owner,
    Inquiry.expected_value, Inquiry.probability, Inquiry.expected_order_date, Inquiry.lost_reason_code,
    Inquiry.lost_to_competitor, Inquiry.next_followup_date,
)


def _load_leads(db: Session, user: Any, today: date) -> list[dict]:
    """Lead rows (scoped live inquiries) with their quotation count - one count query,
    the quotations themselves are read only for the quotation dataset."""
    q = (db.query(*_LEAD_COLS, Inquiry.updated_at).select_from(Inquiry).join(Organization, Organization.id == Inquiry.org_id)
         .filter(Inquiry.is_deleted == False))  # noqa: E712
    scoped = apply_scope(q, user, Inquiry, db)
    raw = scoped.all()
    owner_ids = {r[14] for r in raw if r[14]}
    names = {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(owner_ids)).all()} if owner_ids else {}
    ids_q = apply_scope(db.query(Inquiry.id).filter(Inquiry.is_deleted == False), user, Inquiry, db)  # noqa: E712
    counts = dict(db.query(Quotation.inquiry_id, func.count(Quotation.id))
                  .filter(Quotation.inquiry_id.in_(ids_q.statement)).group_by(Quotation.inquiry_id).all()) if raw else {}

    leads: list[dict] = []
    for (iid, number, created_at, closed_at, org_id, org_name, zone, division, source, product, category, stage, status,
         priority, owner_id, owner_text, expected_value, probability, expected_order, lost_code, competitor, next_fu,
         updated_at) in raw:
        won, lost = is_won(stage, status), is_lost(stage, status)
        outcome = "won" if won else "lost" if lost else "open"
        created_on = _ist_date(created_at)
        # Older / imported won-lost leads may have no close time: the last change stands in for it.
        closed_on = _ist_date(closed_at or updated_at) if outcome != "open" else None
        age = (today - created_on).days if created_on and outcome == "open" else None
        n_quots = counts.get(iid, 0)
        leads.append({
            "inquiry_id": iid, "number": number, "created_on": created_on, "closed_on": closed_on,
            "customer_id": org_id, "customer": org_name or NOT_SET,
            "zone": _text(zone), "division": _text(division), "source": _text(source),
            "product": _text(product), "category": _text(category),
            "stage": _text(stage), "status": _text(status), "priority": _text(priority),
            "owner_id": owner_id, "owner": names.get(owner_id) or (owner_text or "No BD owner"),
            "outcome": outcome, "is_open": outcome == "open", "is_won": won, "is_lost": lost,
            "lost_reason": LOST_REASONS.get(lost_code or "", NOT_SET) if lost else None,
            "competitor": (competitor or "").strip() or (NOT_SET if lost else None),
            "expected_value": float(expected_value) if expected_value is not None else None,
            "won_value": float(expected_value) if (won and expected_value is not None) else None,
            "open_value": float(expected_value) if (outcome == "open" and expected_value is not None) else None,
            "probability": probability, "expected_order_date": expected_order,
            "days_to_close": (closed_on - created_on).days if closed_on and created_on else None,
            "age_days": age, "age_bucket": _age_bucket(age) if age is not None else None,
            "followup_overdue": bool(outcome == "open" and next_fu and next_fu < today),
            "quoted": n_quots > 0, "quotation_count": n_quots,
        })
    return leads


def _load_quotations(db: Session, user: Any, today: date) -> list[dict]:
    """Quotation rows: quotations of scoped live inquiries only, lead fields copied in."""
    by_id = {r["inquiry_id"]: r for r in _load_leads(db, user, today)}
    quots = db.query(Quotation).filter(Quotation.inquiry_id.in_(list(by_id))).all() if by_id else []
    items: dict[int, list[QuotationLineItem]] = {}
    if quots:
        for it in db.query(QuotationLineItem).filter(QuotationLineItem.quotation_id.in_([x.id for x in quots])).all():
            items.setdefault(it.quotation_id, []).append(it)
    quotations: list[dict] = []
    for x in quots:
        lead = by_id[x.inquiry_id]
        total = _quote_total(x, items.get(x.id, []))
        export = x.quotation_type == "Export"
        quotations.append({
            "quotation_id": x.id, "inquiry_id": x.inquiry_id, "quot_number": x.quot_number or f"#{x.id}",
            "inquiry_number": lead["number"], "quote_date": x.quote_date or _ist_date(x.created_at),
            "customer_id": lead["customer_id"], "customer": lead["customer"], "zone": lead["zone"],
            "source": lead["source"], "category": lead["category"],
            "owner_id": lead["owner_id"], "owner": lead["owner"],
            "quot_status": x.status or "draft", "quotation_type": x.quotation_type or "Domestic",
            "pricing_mode": "Lump sum" if x.pricing_mode == "lumpsum" else "Item-wise",
            "revisions": x.revision_number or 0, "item_count": len(items.get(x.id, [])),
            "value_inr": None if export else total, "value_usd": total if export else None,
            "accepted_inr": None if export or x.status != "accepted" else total,
        })
    return quotations


def load_lead_rows(ctx: Any, window: Any = None) -> list[dict]:
    """Dataset `lead`: every live inquiry in the viewer's scope (the engine applies
    the date window, filters and search)."""
    return _load_leads(ctx.db, ctx.user, ctx.today)


def load_quotation_rows(ctx: Any, window: Any = None) -> list[dict]:
    """Dataset `quotation`: quotations of scoped live inquiries only."""
    return _load_quotations(ctx.db, ctx.user, ctx.today)


# ── Filters and lookups ─────────────────────────────────────────────────────

def _in(field: str) -> Callable[[dict, Any], bool]:
    def match(row: dict, value: Any) -> bool:
        want = {str(v).strip() for v in value} if isinstance(value, (list, tuple, set)) else \
            {s.strip() for s in str(value or "").split(",") if s.strip()}
        return not want or token(row.get(field)) in want
    return match


def _lookup(ctx: Any, q: str, pairs: Callable[[list[dict]], Iterable[tuple[Any, str]]]) -> list[dict]:
    leads = _load_leads(ctx.db, ctx.user, ctx.today)
    seen: dict[str, str] = {}
    for value, label in pairs(leads):
        if value is not None and label is not None:
            seen.setdefault(str(value), str(label))
    needle = (q or "").strip().lower()
    out = [{"value": v, "label": lbl} for v, lbl in seen.items() if not needle or needle in lbl.lower()]
    out.sort(key=lambda i: (i["label"].lower(), i["value"]))
    return out[:50]


def _owner_options(ctx: Any, q: str) -> list[dict]:
    """BD owners inside the scope; without People & performance only "Me"."""
    if not ctx.sees_people:
        return [{"value": str(ctx.user.id), "label": f"Me ({ctx.user.name or ctx.user.email})"}]
    return _lookup(ctx, q, lambda rows: ((r["owner_id"], r["owner"]) for r in rows if r["owner_id"]))


def _customer_options(ctx: Any, q: str) -> list[dict]:
    return _lookup(ctx, q, lambda rows: ((r["customer_id"], r["customer"]) for r in rows))


def _distinct(field: str) -> Callable[[Any, str], list[dict]]:
    return lambda ctx, q: _lookup(ctx, q, lambda rows: ((r[field], r[field]) for r in rows))


# ── Declarations ────────────────────────────────────────────────────────────

def _dim(key: str, label: str, field: str | None = None, *, label_of: Callable[[dict], str] | None = None,
         people: bool = False, bucket: str | None = None, order: str = "label") -> Dimension:
    f = field or key
    return Dimension(key=key, label=label, value=(lambda r, f=f: r.get(f)), label_of=label_of, people=people,
                     order=order, time_bucket=bucket)


def _m(key: str, label: str, type: str, agg: str, *, field: str | None = None, where: Callable[[dict], bool] | None = None,
       ratio: tuple[str, str] | None = None, money: bool = False, drill: dict[str, str] | None = None,
       better: str | None = None, people: bool = False) -> Measure:
    group = "Money" if money else "Time" if type == "days" else "Counts"
    return Measure(key=key, label=label, type=type, agg=agg, field=field, where=where, ratio=ratio, money=money,
                   people=people, drill_filter=drill, better=better, group=group)


_TIME_DIMS = (
    _dim("period_week", "Week", None, bucket="week", order="value"),
    _dim("period_month", "Month", None, bucket="month", order="value"),
    _dim("period_quarter", "Quarter", None, bucket="quarter", order="value"),
    _dim("period_fy", "Financial year", None, bucket="fy", order="value"),
)

LEAD_DIMENSIONS = (
    _dim("owner", "BD owner", "owner_id", label_of=lambda r: r["owner"], people=True),
    _dim("customer", "Customer", "customer_id", label_of=lambda r: r["customer"]),
    _dim("zone", "Railway zone"), _dim("division", "Division"), _dim("source", "Lead source"),
    _dim("category", "Product category"), _dim("product", "Product"),
    _dim("stage", "Stage"), _dim("status", "Status"), _dim("priority", "Priority"),
    _dim("outcome", "Open / won / lost", label_of=lambda r: OUTCOME_LABELS[r["outcome"]]),
    _dim("lost_reason", "Lost reason"), _dim("competitor", "Lost to (competitor)"),
    _dim("age_bucket", "Age of open lead", label_of=lambda r: AGE_LABELS.get(r["age_bucket"] or "", "Closed"), order="value"),
    _dim("quoted", "Quotation made", label_of=lambda r: "Quoted" if r["quoted"] else "Not quoted yet"),
    *_TIME_DIMS,
)

LEAD_MEASURES = (
    _m("count", "Leads", "int", "count"),
    _m("customers", "Customers", "int", "count_distinct", field="customer_id"),
    _m("open", "Open", "int", "count", where=lambda r: r["is_open"], drill={"f_outcome": "open"}),
    _m("won", "Won", "int", "count", where=lambda r: r["is_won"], drill={"f_outcome": "won"}, better="up"),
    _m("lost", "Lost", "int", "count", where=lambda r: r["is_lost"], drill={"f_outcome": "lost"}, better="down"),
    _m("closed", "Closed (won + lost)", "int", "count", where=lambda r: not r["is_open"], drill={"f_outcome": "won,lost"}),
    _m("win_rate", "Win rate %", "percent", "ratio", ratio=("won", "closed"), better="up"),
    _m("quoted_n", "Quoted", "int", "count", where=lambda r: r["quoted"], drill={"f_quoted": "1"}),
    _m("quote_rate", "Leads quoted %", "percent", "ratio", ratio=("quoted_n", "count"), better="up"),
    _m("followup_overdue", "Follow-up overdue", "int", "count", where=lambda r: r["followup_overdue"], better="down"),
    _m("owners", "BD owners with leads", "int", "count_distinct", field="owner_id", people=True),
    _m("days_to_close.avg", "Avg days to close", "days", "avg", field="days_to_close", better="down"),
    _m("age_days.avg", "Avg age of open leads (days)", "days", "avg", field="age_days", better="down"),
    _m("age_days.max", "Oldest open lead (days)", "days", "max", field="age_days", better="down"),
    _m("expected_value", "Expected value (₹)", "money", "sum", field="expected_value", money=True),
    _m("open_value", "Open pipeline value (₹)", "money", "sum", field="open_value", money=True),
    _m("won_value", "Won value (₹)", "money", "sum", field="won_value", money=True, better="up"),
)

LEAD_FILTERS = (
    FilterDef("owner", "BD owner", "user", options_fn=_owner_options, match=_in("owner_id"), people=True),
    FilterDef("customer", "Customer", "entity", options_fn=_customer_options, match=_in("customer_id")),
    *(FilterDef(k, lbl, "multi_select", options_fn=_distinct(k), match=_in(k)) for k, lbl in (
        ("zone", "Railway zone"), ("division", "Division"), ("source", "Lead source"), ("category", "Product category"),
        ("product", "Product"), ("stage", "Stage"), ("status", "Status"), ("priority", "Priority"))),
    FilterDef("outcome", "Open / won / lost", "multi_select", options=tuple(OUTCOME_LABELS.items()), match=_in("outcome")),
    FilterDef("quoted", "Quotation made", "bool", match=lambda r, v: r["quoted"] is bool(v) if v is not None else True),
)


def _col(key: str, label: str, type: str = "text", default: bool = False, **kw: Any) -> DetailColumn:
    return DetailColumn(key=key, label=label, type=type, default=default, **kw)


LEAD_LINK = ("inquiry_id", INQUIRY_PAGE)
LEAD_COLUMNS = (
    _col("number", "Inquiry No", default=True, link=LEAD_LINK, searchable=True),
    _col("created_on", "Received on", "date", True),
    _col("customer", "Customer", "text", True, searchable=True),
    _col("zone", "Railway zone", "text", True), _col("division", "Division"),
    _col("source", "Lead source", "text", True),
    _col("category", "Product category", "text", True), _col("product", "Product", searchable=True),
    _col("stage", "Stage", "status", True), _col("status", "Status", "status"),
    _col("priority", "Priority", "status"), _col("owner", "BD owner", "text", True, searchable=True),
    _col("quotation_count", "Quotations", "int", True, total="sum"),
    _col("expected_value", "Expected value (₹)", "money", True, money=True, total="sum"),
    _col("probability", "Probability %", "int"),
    _col("expected_order_date", "Expected order date", "date"),
    _col("closed_on", "Closed on", "date"), _col("days_to_close", "Days to close", "int"),
    _col("age_days", "Age (days)", "int"),
    _col("lost_reason", "Lost reason"), _col("competitor", "Lost to"),
)

LEAD_DATE_FIELDS = (
    DateField("received", "Received date", lambda r: r["created_on"]),
    DateField("closed", "Closed date (won or lost)", lambda r: r["closed_on"]),
    DateField("expected_order", "Expected order date", lambda r: r["expected_order_date"]),
    DateField("none", "All dates", None),
)

QUOT_DIMENSIONS = (
    _dim("owner", "BD owner", "owner_id", label_of=lambda r: r["owner"], people=True),
    _dim("customer", "Customer", "customer_id", label_of=lambda r: r["customer"]),
    _dim("zone", "Railway zone"), _dim("source", "Lead source"), _dim("category", "Product category"),
    _dim("quot_status", "Quotation status", label_of=lambda r: QUOT_STATUS_LABELS.get(r["quot_status"], r["quot_status"])),
    _dim("quotation_type", "Domestic / Export"), _dim("pricing_mode", "Pricing"),
    *_TIME_DIMS,
)

QUOT_MEASURES = (
    _m("count", "Quotations", "int", "count"),
    _m("leads", "Leads quoted", "int", "count_distinct", field="inquiry_id"),
    _m("sent", "Sent to customer", "int", "count", where=lambda r: r["quot_status"] in ("sent", "accepted", "lost", "expired"),
       drill={"f_quot_status": "sent,accepted,lost,expired"}),
    _m("accepted", "Accepted", "int", "count", where=lambda r: r["quot_status"] == "accepted",
       drill={"f_quot_status": "accepted"}, better="up"),
    _m("lost", "Lost", "int", "count", where=lambda r: r["quot_status"] == "lost", drill={"f_quot_status": "lost"}, better="down"),
    _m("decided", "Accepted + lost", "int", "count", where=lambda r: r["quot_status"] in ("accepted", "lost")),
    _m("accept_rate", "Acceptance %", "percent", "ratio", ratio=("accepted", "decided"), better="up"),
    _m("value_inr", "Quoted value (₹, Domestic)", "money", "sum", field="value_inr", money=True),
    _m("value_usd", "Quoted value ($, Export)", "money", "sum", field="value_usd", money=True),
    _m("accepted_inr", "Accepted value (₹, Domestic)", "money", "sum", field="accepted_inr", money=True, better="up"),
)

QUOT_FILTERS = (
    FilterDef("owner", "BD owner", "user", options_fn=_owner_options, match=_in("owner_id"), people=True),
    FilterDef("customer", "Customer", "entity", options_fn=_customer_options, match=_in("customer_id")),
    FilterDef("quot_status", "Quotation status", "multi_select", options=tuple(QUOT_STATUS_LABELS.items()), match=_in("quot_status")),
    FilterDef("quotation_type", "Domestic / Export", "multi_select", options=(("Domestic", "Domestic"), ("Export", "Export")),
              match=_in("quotation_type")),
    *(FilterDef(k, lbl, "multi_select", options_fn=_distinct(k), match=_in(k)) for k, lbl in (
        ("zone", "Railway zone"), ("source", "Lead source"), ("category", "Product category"))),
)

QUOT_COLUMNS = (
    _col("quot_number", "Quotation No", default=True, link=LEAD_LINK, searchable=True),
    _col("quote_date", "Quote date", "date", True),
    _col("inquiry_number", "Inquiry No", "text", True, searchable=True),
    _col("customer", "Customer", "text", True, searchable=True),
    _col("quot_status", "Status", "status", True), _col("quotation_type", "Domestic / Export", "text", True),
    _col("pricing_mode", "Pricing"), _col("item_count", "Items", "int"), _col("revisions", "Revisions", "int"),
    _col("owner", "BD owner", "text", True, searchable=True), _col("zone", "Railway zone"),
    _col("value_inr", "Value (₹)", "money", True, money=True, total="sum"),
    _col("value_usd", "Value ($)", "money", True, money=True, total="sum"),
)

QUOT_DATE_FIELDS = (
    DateField("quote_date", "Quote date", lambda r: r["quote_date"]),
    DateField("none", "All dates", None),
)

_DEFINITIONS = (
    ("Lead", "An inquiry in CRM › Inquiries & Tenders (deleted inquiries are left out). Received date = the day it was created, Indian time."),
    ("Won", "Inquiry at stage Order Received or status Closed - Ordered."),
    ("Closed date", "When the lead was marked won or lost; older or imported leads without that time use their last change date."),
    ("Lost", "Inquiry at stage / status Closed - Not Ordered. Lost reason and competitor come from the inquiry."),
    ("Win rate %", "Won divided by won + lost (open leads are not counted)."),
    ("Expected value", "The expected order value typed on the inquiry, in rupees. Needs Prices & margins."),
    ("Quoted value", "Grand total of the quotation as printed (after discount; lump sum includes GST). Domestic in ₹ and Export in $ are kept apart."),
    ("Acceptance %", "Accepted quotations divided by accepted + lost."),
    ("BD owner", "The BD owner on the inquiry now. Without People & performance you see only your own leads on the Sales team page."),
)


def register_datasets() -> None:
    register_dataset(ReportDataset(
        module="crm", key="lead", label="Leads (inquiries)", record_noun="leads",
        date_fields=LEAD_DATE_FIELDS, default_date_field="received", dimensions=LEAD_DIMENSIONS,
        measures=LEAD_MEASURES, filters=LEAD_FILTERS, columns=LEAD_COLUMNS, default_sort=("number", "asc"),
        load=load_lead_rows, money_feature=_MONEY, id_keys=("inquiry_id",)))
    register_dataset(ReportDataset(
        module="crm", key="quotation", label="Quotations", record_noun="quotations",
        date_fields=QUOT_DATE_FIELDS, default_date_field="quote_date", dimensions=QUOT_DIMENSIONS,
        measures=QUOT_MEASURES, filters=QUOT_FILTERS, columns=QUOT_COLUMNS, default_sort=("quot_number", "asc"),
        load=load_quotation_rows, money_feature=_MONEY, id_keys=("inquiry_id", "quotation_id")))


def register_reports() -> None:
    """Explorer reports: the "Show data" records popup and the Detailed data tab use them."""
    for key, label, ds, date_field, order in (("lead_explorer", "Lead list", "lead", "received", 1),
                                              ("quotation_explorer", "Quotation list", "quotation", "quote_date", 2)):
        register_report(ReportDef(
            module="crm", key=key, label=label, description=f"Every {label.split()[0].lower()} with any column, filter and date.",
            section="Explore", order=order, kind="pivot", dataset=ds,
            defaults={"preset": "this_fy", "date_field": date_field, "level": "detail"}, definitions=_DEFINITIONS,
            self_only_without_management=False, self_filter="owner"))


# ── Dashboard ───────────────────────────────────────────────────────────────

def _k(id: str, title: str, measure: str, definition: str, better: str | None = None, **kw: Any) -> VisualSpec:
    return VisualSpec(id=f"k_{id}", kind="kpi", title=title, measure=measure, definition=definition, better=better, **kw)


def _v(id: str, kind: str, title: str, definition: str, group_by: str | None = None, measure: str | None = None,
       **kw: Any) -> VisualSpec:
    return VisualSpec(id=id, kind=kind, title=title, definition=definition, group_by=group_by, measure=measure, **kw)


_SLICERS = ("owner", "customer", "zone", "source", "category", "stage", "priority")
_RECEIVED = "Counts the leads received in the chosen period. "
_CLOSED = "Counts the leads closed (won or lost) in the chosen period. "

# Only the Leads page (owner, 2026-10-27: Open pipeline, Won & Lost, Quotations, Sales team,
# Detailed data, Win rate and Expected value removed from CRM › Reports).
CRM_PAGES = (
    DashboardPage(
        key="overview", label="Leads", dataset="lead", date_field="received", slicers=_SLICERS,
        hint="How many leads came in, month by month, from where and for which products.",
        kpis=(
            _k("total", "Leads received", "count", _RECEIVED + "Every inquiry created, whatever its stage."),
            _k("customers", "Customers", "customers", _RECEIVED + "Different customers who sent a lead."),
            _k("open", "Still open", "open", _RECEIVED + "Of those, leads not yet won or lost."),
            _k("won", "Won", "won", _RECEIVED + "Of those, leads that became an order.", "up"),
            _k("lost", "Lost", "lost", _RECEIVED + "Of those, leads closed as not ordered.", "down"),
            _k("quoted", "Leads quoted %", "quote_rate", _RECEIVED + "Share of leads that got at least one quotation.", "up"),
        ),
        visuals=(
            _v("by_month", "column", "Leads by month", "Leads received each month over the last 12 months.", "period_month", "count",
               time_window="last_12_months", span=2),
            _v("source", "donut", "Leads by source", "Where the leads came from (website, referral, exhibition ...).", "source", "count"),
            _v("won_lost", "line", "Received, won and lost by month", "For each month: leads received and how many of those were won or lost.",
               "period_month", None, measures=("count", "won", "lost"), time_window="last_12_months", span=2),
            _v("stage", "donut", "Leads by stage", "Where the leads of the period stand now.", "stage", "count"),
            _v("category", "hbar", "Leads by product category", "Product categories asked for most.", "category", "count", top_n=10),
            _v("zone", "column", "Leads by railway zone", "Railway zones the leads came from.", "zone", "count", top_n=12),
            _v("customers", "hbar", "Top 10 customers", "Customers who sent the most leads.", "customer", "count", top_n=10),
        ),
    ),
)


def register_crm_dashboard() -> None:
    register_dashboard(DashboardDef(module="crm", key="crm", label="CRM dashboard", order=1, pages=CRM_PAGES))


register_datasets()
register_reports()
register_crm_dashboard()
