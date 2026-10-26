"""Business rules for the Sales module (docs/02-modules/sales/plan.md):
number series, totals, deviation flags and approval routing, LD maths,
schedule-status derivation, the RRV build link, and amendment diff / apply.

Plain functions so they are unit-testable and so there is exactly one place
that writes each derived value. Raise SalesError(status, message) for
business-rule failures; routes turn it into an HTTPException."""
from __future__ import annotations

import logging
import math
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.permission_registry import can_perform
from app.modules.main.models.user import User
from app.modules.sales.models.order import (
    SalesOrder, SalesOrderLine, SalesOrderSchedule, SalesBillingPlanLine,
    SALES_ORDER_LIVE_STATUSES, SALES_APPROVAL_LEVELS, SALES_LINE_TYPES, SALES_MILESTONE_TYPES,
    SALES_ORDER_TYPES, SALES_ORDER_TYPE_LABELS, SALES_CURRENCY_CODES, SALES_PRICE_BASES, SALES_LD_PERIODS, SALES_LD_BASES, SALES_WARRANTY_RULES,
    SALES_SCHEDULE_UNDELIVERED,
)
from app.modules.sales.models.approval import SalesApproval
from app.modules.sales.models.attachment import SalesAttachment, SALES_PO_DOC_TYPES
from app.modules.sales.settings import get_setting
from app.utils.notifications import notify_user, broadcast_notification

logger = logging.getLogger("sales")

_IST = timezone(timedelta(hours=5, minutes=30))

LEVEL_LABEL = {"sales_head": "Sales Head", "director": "Director", "partner": "Partner"}
STATUS_LABEL = {
    "draft": "Draft", "pending_approval": "Pending approval", "confirmed": "Confirmed", "in_execution": "In execution",
    "partially_delivered": "Partially delivered", "delivered": "Delivered", "closed": "Closed", "on_hold": "On hold",
    "cancelled": "Cancelled", "short_closed": "Short-closed",
}
DEVIATION_LABEL = {
    "ld_uncapped": "LD has no cap",
    "ld_cap_above_standard": "LD cap above the standard",
    "warranty_above_standard": "Warranty longer than the standard",
    "advance_below_standard": "Advance below the standard minimum",
}

# Header fields a customer amendment may change (plan §6.4). Everything else
# (customer, source, numbering, approval data) is fixed once confirmed.
AMENDABLE_HEADER = (
    "customer_po_number", "customer_po_date", "loa_number", "loa_date", "contract_reference",
    "purchaser_name", "paying_authority", "billing_address", "customer_gstin", "place_of_supply_state_code",
    "price_basis", "freight_terms", "insurance_terms", "payment_terms_label",
    "inspection_agency", "third_party_inspection_required",
    "ld_applicable", "ld_rate_percent", "ld_rate_period", "ld_basis", "ld_max_percent",
    "warranty_months_from_delivery", "warranty_months_from_commissioning", "warranty_rule", "warranty_terms_text",
    "pbg_required", "pbg_percent", "pbg_due_days", "delivery_terms_text", "special_conditions",
)
_DATE_FIELDS = {"customer_po_date", "loa_date", "customer_po_received_date", "contract_delivery_date", "committed_date",
                "customer_amendment_date"}

LINE_FIELDS = ("line_type", "crm_product_id", "product_item_id", "rrv_model", "description", "specification",
               "customer_line_ref", "hsn_sac_code", "uom", "quantity", "unit_price", "discount_percent", "gst_rate")
SCHEDULE_FIELDS = ("quantity", "consignee_name", "consignee_address", "consignee_gstin", "consignee_state_code",
                   "consignee_contact_name", "consignee_contact_phone", "contract_delivery_date", "committed_date",
                   "ship_to_address_id")
BILLING_FIELDS = ("milestone_type", "description", "percent", "per_unit", "due_days", "recovers_advance_percent")
# Rows that need their full quantity scheduled with dates before submit.
SCHEDULED_LINE_TYPES = ("rrv", "spares")


class SalesError(Exception):
    def __init__(self, status_code: int, detail):
        super().__init__(detail if isinstance(detail, str) else "; ".join(detail))
        self.status_code = status_code
        self.detail = detail


# ---------------------------------------------------------------- basics

def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def today_ist() -> date:
    return datetime.now(_IST).date()


def _aware(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def user_names(db: Session, ids) -> dict[int, str]:
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    return {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(wanted)).all()}


def inr(v: float | None) -> str:
    """₹ with Indian digit grouping: 12345678.5 -> ₹1,23,45,678.50."""
    v = float(v or 0)
    neg = v < 0
    whole, frac = f"{abs(v):.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        if head:
            groups.insert(0, head)
        whole = ",".join(groups + [tail])
    return f"{'-' if neg else ''}₹{whole}.{frac}"


def generate_so_number(db: Session, on: date | None = None) -> str:
    """SO/<FY>/<NNNN> from the Accounts FY number series (advisory lock +
    row lock — two confirmations at the same moment never share a number)."""
    from app.modules.accounts.services.fiscal import next_number
    try:
        return next_number(db, "SO", on or today_ist())
    except ValueError as e:
        raise SalesError(409, f"Can't issue a sales order number: {e}")


# ---------------------------------------------------------------- amounts

def line_amounts(quantity, unit_price, discount_percent, gst_rate) -> dict:
    qty = float(quantity or 0)
    price = float(unit_price or 0)
    gross = round(qty * price, 2)
    discount = round(gross * float(discount_percent or 0) / 100, 2)
    taxable = round(gross - discount, 2)
    gst = round(taxable * float(gst_rate or 0) / 100, 2)
    return {"gross": gross, "discount_amount": discount, "taxable_amount": taxable, "gst_amount": gst,
            "line_total": round(taxable + gst, 2)}


def totals_of(lines: list[dict]) -> dict:
    t = {"subtotal": 0.0, "discount_total": 0.0, "taxable_total": 0.0, "gst_total": 0.0, "grand_total": 0.0}
    for ln in lines:
        a = line_amounts(ln.get("quantity"), ln.get("unit_price"), ln.get("discount_percent"), ln.get("gst_rate"))
        t["subtotal"] += a["gross"]
        t["discount_total"] += a["discount_amount"]
        t["taxable_total"] += a["taxable_amount"]
        t["gst_total"] += a["gst_amount"]
        t["grand_total"] += a["line_total"]
    return {k: round(v, 2) for k, v in t.items()}


def recompute_totals(so: SalesOrder) -> None:
    for ln in so.lines:
        a = line_amounts(ln.quantity, ln.unit_price, ln.discount_percent, ln.gst_rate)
        ln.discount_amount, ln.taxable_amount = a["discount_amount"], a["taxable_amount"]
        ln.gst_amount, ln.line_total = a["gst_amount"], a["line_total"]
    t = totals_of([{f: getattr(ln, f) for f in LINE_FIELDS} for ln in so.lines])
    for k, v in t.items():
        setattr(so, k, v)
    for b in so.billing_lines:
        b.amount = round(so.grand_total * float(b.percent or 0) / 100, 2)
    # Rounding each milestone to the paisa can leave the plan a paisa or two off the
    # order total — put the remainder on the last open milestone so they sum exactly.
    live = [b for b in so.billing_lines if b.status != "cancelled"]
    if live and abs(round(sum(round(float(b.percent or 0), 3) for b in live), 3) - 100) < 0.0005:
        editable = [b for b in live if b.status in ("not_due", "due")]
        if editable:
            last = max(editable, key=lambda b: (b.sequence or 0, b.id or 0))
            last.amount = round(float(so.grand_total or 0) - sum(float(b.amount or 0) for b in live if b is not last), 2)
    refresh_line_quantities(so)


def refresh_line_quantities(so: SalesOrder) -> None:
    for ln in so.lines:
        rows = [r for r in so.schedules if r.so_line_id == ln.id]
        live = [r for r in rows if r.status != "cancelled"]
        ln.qty_scheduled = round(sum(float(r.quantity or 0) for r in live), 4)
        # A row counts in full once its status says so; a partly dispatched / delivered
        # spares lot counts what its delivery events booked (sales/delivery.py).
        ln.qty_delivered = round(sum(float(r.quantity or 0) if r.status in ("delivered", "commissioned")
                                     else min(float(r.qty_delivered or 0), float(r.quantity or 0)) for r in live), 4)
        ln.qty_dispatched = round(sum(float(r.quantity or 0) if r.status in ("dispatched", "delivered", "commissioned")
                                      else min(float(r.qty_dispatched or 0), float(r.quantity or 0)) for r in live), 4)
        ln.qty_cancelled = round(sum(float(r.quantity or 0) for r in rows if r.status == "cancelled"), 4)


# ---------------------------------------------------------------- validation helpers

def _iso(v):
    return v.isoformat() if isinstance(v, (date, datetime)) else v


def _to_date(v):
    if v in (None, ""):
        return None
    if isinstance(v, date):
        return v
    try:
        return date.fromisoformat(str(v)[:10])
    except ValueError:
        raise SalesError(422, f"'{v}' is not a valid date — use YYYY-MM-DD.")


def po_number(so: SalesOrder) -> str | None:
    """The customer's PO number is THE order number (LOA and PO are one document);
    older orders that only have an LOA number fall back to it."""
    return (so.customer_po_number or "").strip() or (so.loa_number or "").strip() or None


def po_date(so: SalesOrder):
    return so.customer_po_date or so.loa_date


def validate_header(data: dict) -> None:
    checks = (("order_type", SALES_ORDER_TYPES, "Order type"), ("price_basis", SALES_PRICE_BASES, "Price basis"),
              ("ld_rate_period", SALES_LD_PERIODS, "LD period"), ("ld_basis", SALES_LD_BASES, "LD basis"),
              ("warranty_rule", SALES_WARRANTY_RULES, "Warranty rule"))
    if data.get("order_type") not in (None, "") and data["order_type"] not in SALES_ORDER_TYPES:
        raise SalesError(422, f"Order type must be one of: {', '.join(SALES_ORDER_TYPE_LABELS[t] for t in SALES_ORDER_TYPES)}.")
    for key, allowed, label in checks:
        if key == "order_type":
            continue
        if data.get(key) not in (None, "") and data[key] not in allowed:
            raise SalesError(422, f"{label} '{data[key]}' isn't valid — use one of: {', '.join(allowed)}.")
    for key in ("ld_rate_percent", "ld_max_percent", "pbg_percent"):
        if data.get(key) is not None and not (0 <= float(data[key]) <= 100):
            raise SalesError(422, f"{key.replace('_', ' ').capitalize()} must be between 0 and 100.")
    for key in ("warranty_months_from_delivery", "warranty_months_from_commissioning", "pbg_due_days"):
        if data.get(key) is not None and int(data[key]) < 0:
            raise SalesError(422, f"{key.replace('_', ' ').capitalize()} can't be negative.")
    if data.get("currency") not in (None, ""):
        code = str(data["currency"]).strip().upper()
        if code not in SALES_CURRENCY_CODES:
            raise SalesError(422, f"Currency '{data['currency']}' is not supported. Choose one of: {', '.join(SALES_CURRENCY_CODES)}.")
        data["currency"] = code


def validate_line_dict(i: int, ln: dict) -> None:
    label = f"Line {ln.get('line_number') or i}"
    if ln.get("line_type", "rrv") not in SALES_LINE_TYPES:
        raise SalesError(422, f"{label}: line type '{ln.get('line_type')}' isn't valid — use one of: {', '.join(SALES_LINE_TYPES)}.")
    if not str(ln.get("description") or "").strip():
        raise SalesError(422, f"{label}: description is required (use the customer's PO wording).")
    qty = float(ln.get("quantity") or 0)
    if qty < 0:
        raise SalesError(422, f"{label}: quantity can't be negative.")
    if ln.get("line_type", "rrv") == "rrv" and qty != int(qty):
        raise SalesError(422, f"{label}: an RRV line is counted in whole vehicles — {qty:g} isn't a whole number.")
    if float(ln.get("unit_price") or 0) < 0:
        raise SalesError(422, f"{label}: unit price can't be negative.")
    if not (0 <= float(ln.get("discount_percent") or 0) <= 100):
        raise SalesError(422, f"{label}: discount must be between 0 and 100%.")
    if not (0 <= float(ln.get("gst_rate") if ln.get("gst_rate") is not None else 18) <= 28):
        raise SalesError(422, f"{label}: GST rate must be between 0 and 28%.")


def validate_billing_dicts(items: list[dict]) -> None:
    for i, b in enumerate(items, start=1):
        if b.get("milestone_type") not in SALES_MILESTONE_TYPES:
            raise SalesError(422, f"Billing milestone {i}: type '{b.get('milestone_type')}' isn't valid — use one of: {', '.join(SALES_MILESTONE_TYPES)}.")
        pct = float(b.get("percent") or 0)
        if not (0 < pct <= 100):
            raise SalesError(422, f"Billing milestone {i} ({b.get('milestone_type')}): percent must be more than 0 and at most 100.")
        if abs(pct * 1000 - round(pct * 1000)) > 1e-6:
            raise SalesError(422, f"Billing milestone {i} ({b.get('milestone_type')}): {pct:g}% has more than 3 decimals — percentages are "
                                  f"stored to 3 decimals (e.g. {round(pct, 3):g}). For a 1/3 split use 33.333 + 33.333 + 33.334.")


def billing_percent_problem(items: list[dict]) -> str | None:
    # Same precision as storage (Percent = Numeric(7, 3)): 33.3333 x3 must not pass here and fail later.
    total = round(sum(round(float(b.get("percent") or 0), 3) for b in items), 3)
    if not items:
        return "There is no billing plan — add the payment milestones (e.g. 20% advance, 70% on delivery, 10% on commissioning) so they add up to 100%."
    if abs(total - 100) >= 0.0005:
        gap = round(100 - total, 3)
        if gap > 0:
            return (f"Billing plan adds up to {total:g}% — {gap:g}% is not scheduled. "
                    f"Add a retention or commissioning milestone, or correct a percentage.")
        return f"Billing plan adds up to {total:g}% — {-gap:g}% too much. Correct a percentage so the milestones add up to 100%."
    return None


def schedule_problems(lines: list[dict], schedule: list[dict]) -> list[str]:
    """Every rrv / spares line fully scheduled with dates; rrv rows are one vehicle each."""
    problems = []
    for ln in lines:
        rows = [r for r in schedule if r.get("line_number") == ln.get("line_number")]
        qty = float(ln.get("quantity") or 0)
        label = f"Line {ln.get('line_number')} ({str(ln.get('description') or '')[:40]})"
        if ln.get("line_type") == "rrv":
            bad = [r for r in rows if float(r.get("quantity") or 0) != 1]
            if bad:
                problems.append(f"{label}: every RRV delivery row must be exactly 1 vehicle — split the row so each vehicle has its own date and build.")
        if ln.get("line_type") in SCHEDULED_LINE_TYPES or rows:
            scheduled = round(sum(float(r.get("quantity") or 0) for r in rows), 4)
            if abs(scheduled - qty) > 1e-6:
                problems.append(f"{label}: {scheduled:g} of {qty:g} scheduled — the delivery schedule must cover the full quantity.")
            undated = [r for r in rows if not r.get("contract_delivery_date")]
            if undated:
                problems.append(f"{label}: {len(undated)} delivery row(s) have no contractual delivery date.")
    return problems


# ---------------------------------------------------------------- snapshots (dict form of an SO)

def line_dict(ln: SalesOrderLine) -> dict:
    d = {"id": ln.id, "line_number": ln.line_number}
    d.update({f: _iso(getattr(ln, f)) for f in LINE_FIELDS})
    return d


def schedule_dict(so: SalesOrder, r: SalesOrderSchedule) -> dict:
    line_no = next((ln.line_number for ln in so.lines if ln.id == r.so_line_id), None)
    d = {"id": r.id, "line_number": line_no, "sequence": r.sequence, "status": r.status, "rrv_build_id": r.rrv_build_id}
    d.update({f: _iso(getattr(r, f)) for f in SCHEDULE_FIELDS})
    return d


def billing_dict(b: SalesBillingPlanLine) -> dict:
    d = {"id": b.id, "sequence": b.sequence, "status": b.status}
    d.update({f: _iso(getattr(b, f)) for f in BILLING_FIELDS})
    return d


def snapshot(so: SalesOrder) -> dict:
    return {
        "header": {f: _iso(getattr(so, f)) for f in AMENDABLE_HEADER},
        "lines": [line_dict(ln) for ln in so.lines],
        "schedule": [schedule_dict(so, r) for r in so.schedules if r.status != "cancelled"],
        "billing_plan": [billing_dict(b) for b in so.billing_lines if b.status != "cancelled"],
    }


# ---------------------------------------------------------------- deviations & approval routing

def deviation_flags(db: Session, header: dict, billing: list[dict]) -> list[str]:
    flags = []
    if header.get("ld_applicable"):
        cap = header.get("ld_max_percent")
        if cap is None:
            flags.append("ld_uncapped")
        elif float(cap) > float(get_setting(db, "standard_ld_max_percent")):
            flags.append("ld_cap_above_standard")
    max_w = int(get_setting(db, "standard_warranty_months_max"))
    if any(int(header.get(k) or 0) > max_w for k in ("warranty_months_from_delivery", "warranty_months_from_commissioning")):
        flags.append("warranty_above_standard")
    min_adv = float(get_setting(db, "standard_min_advance_percent") or 0)
    if min_adv > 0:
        adv = sum(float(b.get("percent") or 0) for b in billing if b.get("milestone_type") == "advance")
        if adv < min_adv:
            flags.append("advance_below_standard")
    return flags


# Routing (which levels an order needs) moved to the central approval engine —
# sales/approvals.py. The level helpers below only finish records submitted
# before the move (their required_approval_level is stored on the record).

def levels_up_to(level: str) -> tuple[str, ...]:
    return SALES_APPROVAL_LEVELS[: SALES_APPROVAL_LEVELS.index(level) + 1]


def _sales_users(db: Session) -> list[User]:
    return [u for u in db.query(User).filter(User.is_active == True).all() if "sales" in u.get_apps()]  # noqa: E712


def sales_head_ids(db: Session) -> list[int]:
    """The `sales_head_id` setting, else the head(s) of the Sales / BD department."""
    sid = get_setting(db, "sales_head_id")
    if sid:
        return [int(sid)]
    heads = db.query(User).filter(User.is_active == True, User.is_department_head == True).all()  # noqa: E712
    out = []
    for u in heads:
        dept = (u.department or "").strip().lower()
        if "sales" in dept or dept in ("bd", "business development", "sales/bd", "sales & bd"):
            out.append(u.id)
    return out


def level_holders(db: Session, level: str, cache: dict | None = None) -> list[User]:
    """Active users who hold the role for `level` and can open the Sales module.
    `cache` (any dict) memoises the lookup across a list response."""
    if cache is not None:
        key = ("level_holders", level)
        if key not in cache:
            cache[key] = level_holders(db, level)
        return cache[key]
    if level == "sales_head":
        ids = sales_head_ids(db)
        users = db.query(User).filter(User.id.in_(ids), User.is_active == True).all() if ids else []  # noqa: E712
        return [u for u in users if "sales" in u.get_apps()]
    flag = User.is_director if level == "director" else User.is_partner
    return [u for u in db.query(User).filter(flag == True, User.is_active == True).all() if "sales" in u.get_apps()]  # noqa: E712


def holds_level(db: Session, user: User, level: str) -> bool:
    if level == "sales_head":
        return user.id in sales_head_ids(db)
    if level == "director":
        return bool(user.is_director)
    return bool(user.is_partner)


def is_sales_head(db: Session, user: User) -> bool:
    return user.role == "admin" or user.id in sales_head_ids(db)


def _id_set(ids) -> set[int]:
    if ids is None:
        return set()
    if isinstance(ids, int):
        return {ids}
    return {i for i in ids if i}


def order_makers(so: SalesOrder) -> set[int]:
    """Four-eyes: whoever created, submitted or owns the order can't approve it."""
    return _id_set([so.created_by_id, so.submitted_by_id, so.sales_owner_id])


def amendment_makers(a, so: SalesOrder | None) -> set[int]:
    return _id_set([a.created_by_id, a.submitted_by_id, so.sales_owner_id if so else None])


def can_approve_sales(user: User) -> bool:
    return can_perform(user, "sales", "orders", "approve")


def eligible_approvers(db: Session, level: str, exclude=None, cache: dict | None = None) -> list[User]:
    """Holders of `level` who may actually approve: not a maker / earlier approver,
    and with 'approve' on Sales › Orders."""
    ex = _id_set(exclude)
    return [u for u in level_holders(db, level, cache) if u.id not in ex and can_approve_sales(u)]


def distinct_assignment(candidates: dict[str, list[int]]) -> dict[str, int] | None:
    """One different person per level (each approval level must be a different
    person), or None if no such assignment exists. At most 3 levels — backtracking."""
    levels = sorted(candidates, key=lambda lv: len(candidates[lv]))

    def go(i: int, used: frozenset) -> dict[str, int] | None:
        if i == len(levels):
            return {}
        for uid in candidates[levels[i]]:
            if uid in used:
                continue
            rest = go(i + 1, used | {uid})
            if rest is not None:
                return {levels[i]: uid, **rest}
        return None

    return go(0, frozenset())


def approvals_in_round(db: Session, entity_type: str, entity_id: int, rnd: int) -> list[SalesApproval]:
    return db.query(SalesApproval).filter(
        SalesApproval.entity_type == entity_type, SalesApproval.entity_id == entity_id, SalesApproval.revision == rnd,
    ).order_by(SalesApproval.id).all()


def next_level(db: Session, entity_type: str, entity_id: int, rnd: int, required: str | None) -> str | None:
    """Legacy chain only (orders / amendments submitted before the move to the
    central approval engine). Engine-routed records have no required level → None."""
    if required not in SALES_APPROVAL_LEVELS:
        return None
    done = {a.level for a in approvals_in_round(db, entity_type, entity_id, rnd) if a.decision == "approved"}
    for level in levels_up_to(required):
        if level not in done:
            return level
    return None


def check_approver(db: Session, user: User, *, entity_type: str, entity_id: int, rnd: int, level: str,
                   maker_id=None, comment: str | None, what: str, required: str | None = None) -> bool:
    """Raises 403 unless `user` may decide `level`. Returns True for an admin stand-in.
    `maker_id` is one id or a set — creator, submitter and sales owner all count.
    With `required` (an approval, not a return / reject), also refuses a step that
    would leave a later level with nobody different left to approve it."""
    makers = _id_set(maker_id)
    if not can_perform(user, "sales", "orders", "approve"):
        raise SalesError(403, "You don't have 'approve' permission on Sales › Orders. Ask an admin to grant it in Users › Permission Matrix.")
    if user.id in makers:
        raise SalesError(403, f"You created, submitted or own {what}, so you can't approve it (four-eyes rule) — "
                              f"another {LEVEL_LABEL[level]} has to approve it.")
    approved = [a for a in approvals_in_round(db, entity_type, entity_id, rnd) if a.decision == "approved"]
    earlier = [a for a in approved if a.approver_id == user.id]
    if earlier:
        raise SalesError(403, f"You already approved {what} as {LEVEL_LABEL[earlier[0].level]} — each approval level must be a different person.")
    if holds_level(db, user, level):
        if required:
            _check_leaves_later_levels(db, user, level, required, makers, approved, what)
        return False
    if user.role == "admin":
        if not (comment or "").strip():
            raise SalesError(422, f"You're approving as an admin stand-in for the {LEVEL_LABEL[level]} — add a comment saying why.")
        return True
    names = ", ".join(u.name or u.email for u in eligible_approvers(db, level, makers)) or "nobody is set up yet"
    raise SalesError(403, f"{what} is waiting for the {LEVEL_LABEL[level]}'s approval ({names}). "
                          f"You aren't the {LEVEL_LABEL[level]}, so you can't approve this step.")


def _check_leaves_later_levels(db: Session, user: User, level: str, required: str, makers: set[int],
                               approved: list[SalesApproval], what: str) -> None:
    """Someone holding two roles (e.g. Sales Head and Director) approving the lower
    level when they are the only one who can take a higher level would leave the
    order stuck — refuse and say who should take this step instead."""
    done = {a.level for a in approved} | {level}
    later = [lv for lv in levels_up_to(required) if lv not in done]
    if not later:
        return
    used = makers | {a.approver_id for a in approved}
    before = {lv: [u.id for u in eligible_approvers(db, lv, used)] for lv in later}
    if distinct_assignment(before) is None:
        return  # already infeasible without this user — nothing to protect
    after = {lv: [i for i in ids if i != user.id] for lv, ids in before.items()}
    if distinct_assignment(after) is not None:
        return
    blocked = next((lv for lv in later if not after[lv]), later[-1])
    others = ", ".join(u.name or u.email for u in eligible_approvers(db, level, used | {user.id})) or "an admin stand-in"
    raise SalesError(409, f"If you approve {what} as {LEVEL_LABEL[level]}, nobody different would be left for the {LEVEL_LABEL[blocked]} step "
                          f"(each level must be a different person, and you're needed there). Let {others} approve the "
                          f"{LEVEL_LABEL[level]} step, then approve as {LEVEL_LABEL[blocked]}.")


def notify_level(db: Session, level: str, maker_id, title: str, message: str, ntype: str,
                 entity_type: str, entity_id: int) -> None:
    """Approval request → Teams + bell (teams=True). `maker_id`: one id or a set."""
    for u in eligible_approvers(db, level, maker_id):
        notify_user(db, u.id, title, message, ntype, entity_type=entity_type, entity_id=entity_id, teams=True)


def notify_bell(db: Session, user_ids, title: str, message: str, ntype: str, entity_type: str, entity_id: int,
                exclude_user_id: int | None = None) -> None:
    for uid in {u for u in user_ids if u and u != exclude_user_id}:
        notify_user(db, uid, title, message, ntype, entity_type=entity_type, entity_id=entity_id)


# ---------------------------------------------------------------- submit checks

def submit_problems(db: Session, so: SalesOrder) -> list[str]:
    from app.modules.crm.models.organization import Organization
    problems = []
    org = db.query(Organization).filter(Organization.id == so.customer_id).first()
    if not org:
        problems.append(f"Customer #{so.customer_id} no longer exists in CRM — pick the customer again.")
    elif not ((so.customer_gstin or org.gst_number) or (so.customer_state or org.state)):
        problems.append(f"{org.name} has neither a GSTIN nor a state in CRM, so the order couldn't be invoiced later — "
                        f"add the GSTIN (or the state for an unregistered customer) on the CRM organisation.")
    if not po_number(so) or not po_date(so):
        problems.append("Enter the customer's PO number and PO date (from the PO / LOA).")
    has_po_file = db.query(SalesAttachment.id).filter(
        SalesAttachment.entity_type == "sales_order", SalesAttachment.entity_id == so.id,
        SalesAttachment.doc_type.in_(SALES_PO_DOC_TYPES), SalesAttachment.is_deleted == False,  # noqa: E712
    ).first()
    if not has_po_file:
        problems.append("Attach the customer's PO (or LOA) document — Documents tab, type 'Customer PO'.")
    lines = [line_dict(ln) for ln in so.lines]
    if not lines:
        problems.append("Add at least one order line.")
    problems += schedule_problems(lines, [schedule_dict(so, r) for r in so.schedules if r.status != "cancelled"])
    bp = billing_percent_problem([billing_dict(b) for b in so.billing_lines if b.status != "cancelled"])
    if bp:
        problems.append(bp)
    if so.ld_applicable and (so.ld_rate_percent is None or not so.ld_rate_period or not so.ld_basis):
        problems.append("LD applies, so enter the LD rate, the period (per week / per day) and the basis — or untick 'LD applicable'.")
    if not so.warranty_rule:
        problems.append("Pick the warranty rule (from delivery / from commissioning / whichever earlier / later).")
    else:
        if so.warranty_rule in ("from_delivery", "earlier_of", "later_of") and not so.warranty_months_from_delivery:
            problems.append("Enter the warranty months from delivery.")
        if so.warranty_rule in ("from_commissioning", "earlier_of", "later_of") and not so.warranty_months_from_commissioning:
            problems.append("Enter the warranty months from commissioning.")
    if lines and float(so.grand_total or 0) <= 0:
        problems.append("The order value is zero — enter the unit prices.")
    return problems


def po_duplicate(db: Session, so: SalesOrder) -> SalesOrder | None:
    if not so.customer_po_number:
        return None
    return db.query(SalesOrder).filter(
        SalesOrder.id != so.id, SalesOrder.customer_id == so.customer_id, SalesOrder.is_deleted == False,  # noqa: E712
        SalesOrder.status.in_(SALES_ORDER_LIVE_STATUSES),
        SalesOrder.customer_po_number == so.customer_po_number.strip(),
    ).first()


def live_order_for_source(db: Session, inquiry_id: int | None, tender_id: int | None, exclude_id: int | None = None) -> SalesOrder | None:
    if not inquiry_id and not tender_id:
        return None
    q = db.query(SalesOrder).filter(SalesOrder.is_deleted == False, SalesOrder.status.in_(SALES_ORDER_LIVE_STATUSES))  # noqa: E712
    q = q.filter(SalesOrder.source_inquiry_id == inquiry_id) if inquiry_id else q.filter(SalesOrder.source_tender_id == tender_id)
    if exclude_id:
        q = q.filter(SalesOrder.id != exclude_id)
    return q.first()


def snapshot_customer(db: Session, so: SalesOrder) -> None:
    from app.modules.crm.models.organization import Organization
    org = db.query(Organization).filter(Organization.id == so.customer_id).first()
    if not org:
        return
    so.customer_name = org.name
    so.customer_gstin = so.customer_gstin or org.gst_number
    so.customer_state = so.customer_state or org.state
    if not so.billing_address:
        so.billing_address = ", ".join(p for p in (org.address, org.city, org.state, org.pin_code) if p) or None
    if not so.place_of_supply_state_code and so.customer_gstin and len(so.customer_gstin) >= 2 and so.customer_gstin[:2].isdigit():
        so.place_of_supply_state_code = so.customer_gstin[:2]
    if not so.place_of_supply_state_code and getattr(org, "gst_state_code", None):
        # Customer master GST state (CRM organisation) — the default place of supply.
        so.place_of_supply_state_code = org.gst_state_code


def credit_position(db: Session, so: SalesOrder) -> dict | None:
    """Credit position of the customer (Finance credit management, FD32/UKM —
    accounts/services/credit.py): exposure = open AR + unbilled delivered +
    open order value - unapplied credits, vs the CRM credit limit, plus
    invoices overdue beyond the credit days. `exceeded` = over the limit;
    `blocked` = this order's confirmation is on credit hold in 'block' mode
    (over the limit or overdue, and no Finance credit release in force).
    None when the customer has no limit and nothing overdue."""
    from app.modules.accounts.services.credit import credit_check
    pos = credit_check(db, so.customer_id, "so_confirmation", sales_order=so)
    if pos["credit_limit"] is None and not pos["overdue_amount"]:
        return None
    mode = get_setting(db, "credit_check_mode")
    return {"credit_limit": pos["credit_limit"] or 0.0, "open_order_value": round(pos["open_order_value"] + pos["unbilled_delivered"], 2),
            "ar_outstanding": pos["open_ar"], "unapplied_credits": pos["unapplied_credits"], "exposure": pos["exposure"],
            "exceeded": pos["over_limit"], "overdue_amount": pos["overdue_amount"], "max_days_overdue": pos["max_days_overdue"],
            "block_reasons": pos["block_reasons"], "release": pos["release"], "pending_release": pos["pending_release"],
            "mode": mode, "blocked": mode == "block" and pos["blocked"], "customer_id": so.customer_id}


def credit_block_detail(so: SalesOrder, credit: dict) -> str:
    """409 text when Sales › Settings blocks approval on a credit hold."""
    tail = (f" Credit release {credit['pending_release']['release_number']} is waiting for a Finance approver."
            if credit.get("pending_release") else
            " Use 'Request credit release' on the order (a Finance approver releases it), collect the overdue amount, "
            "raise the limit in CRM, or switch the credit check to 'warn' in Sales › Settings.")
    return (f"{so.customer_name} is on credit hold — {'; '.join(credit.get('block_reasons') or [])} — and Sales › Settings "
            f"blocks approval.{tail}")


# ---------------------------------------------------------------- LD (plan §6.6)

def unit_value(so: SalesOrder, row: SalesOrderSchedule) -> float:
    line = next((ln for ln in so.lines if ln.id == row.so_line_id), None)
    if not line or not float(line.quantity or 0):
        return 0.0
    return round(float(line.taxable_amount or 0) / float(line.quantity) * float(row.quantity or 0), 2)


def ld_for(so: SalesOrder, row: SalesOrderSchedule, reckon: date | None) -> tuple[int, float]:
    """(periods, amount) for a delivery on `reckon` against current_delivery_date.
    "Per week or part thereof": 8 days late = 2 weeks. Capped at ld_max_percent
    of the delayed value (or contract value, per ld_basis); None = uncapped."""
    due = row.current_delivery_date
    if not so.ld_applicable or row.ld_waived or row.status == "cancelled" or not due or not reckon:
        return 0, 0.0
    delay = (reckon - due).days
    if delay <= 0:
        return 0, 0.0
    periods = math.ceil(delay / 7) if (so.ld_rate_period or "week") == "week" else delay
    uv = unit_value(so, row)
    amount = float(so.ld_rate_percent or 0) / 100 * periods * uv
    if so.ld_max_percent is not None:
        basis = uv if (so.ld_basis or "delayed_value") == "delayed_value" else float(so.taxable_total or 0)
        amount = min(amount, float(so.ld_max_percent) / 100 * basis)
    return periods, round(amount, 2)


def order_ld_cap(so: SalesOrder) -> float | None:
    """Order-level LD ceiling. With ld_basis 'contract_value' the cap is
    ld_max_percent of the whole contract, shared by every late vehicle — the
    per-row cap in ld_for() alone would let 3 late vehicles reach 3× the cap.
    None = no order-level cap (delayed-value basis caps each row instead)."""
    if not so.ld_applicable or so.ld_max_percent is None or (so.ld_basis or "delayed_value") != "contract_value":
        return None
    return round(float(so.ld_max_percent) / 100 * float(so.taxable_total or 0), 2)


def clamp_order_ld(so: SalesOrder, amount: float) -> float:
    """An order's summed LD (accrued or forecast), clamped at order_ld_cap()."""
    cap = order_ld_cap(so)
    return round(min(float(amount or 0), cap) if cap is not None else float(amount or 0), 2)


def order_open_ld(so: SalesOrder, accrued: float, forecast: float, as_of: date | None = None) -> tuple[float, float]:
    """LD (accrued, forecast) of an order's OPEN (undelivered) vehicles, clamped
    at what is left of the contract-value cap after the LD already accrued on
    its delivered/commissioned vehicles. Dashboard tiles, the LD exposure report
    and the overdue reminder only see open rows, so clamping them at the full
    cap would overstate exposure versus the order page (views.order_response)."""
    cap = order_ld_cap(so)
    acc, fc = float(accrued or 0), float(forecast or 0)
    if cap is None:
        return round(acc, 2), round(fc, 2)
    as_of = as_of or today_ist()
    used = sum(ld_accrued(so, r, as_of)[1] for r in so.schedules
               if r.status != "cancelled" and r.status not in SALES_SCHEDULE_UNDELIVERED)
    remaining = max(cap - used, 0.0)
    return round(min(acc, remaining), 2), round(min(fc, remaining), 2)


def reckoning_date(so: SalesOrder, row: SalesOrderSchedule) -> date | None:
    """POD date for FOR-destination orders; dispatch date otherwise."""
    if so.price_basis == "for_destination":
        return row.delivered_on
    return row.dispatched_on or row.delivered_on


def ld_accrued(so: SalesOrder, row: SalesOrderSchedule, as_of: date) -> tuple[int, float]:
    return ld_for(so, row, reckoning_date(so, row) or as_of)


def ld_forecast(so: SalesOrder, row: SalesOrderSchedule) -> tuple[int, float]:
    if reckoning_date(so, row):
        return 0, 0.0
    return ld_for(so, row, row.committed_date)


# ---------------------------------------------------------------- schedule status & build link

def _build(db: Session, build_id: int | None):
    if not build_id:
        return None
    from app.modules.production.models.rrv_build import ProductionRrvBuild
    return db.query(ProductionRrvBuild).filter(ProductionRrvBuild.id == build_id).first()


def build_reached_final_inspection(db: Session, build) -> bool:
    if build.status in ("completed", "handed_over"):
        return True
    from app.modules.production.models.rrv_build import ProductionRrvBuildStage
    st = db.query(ProductionRrvBuildStage).filter(
        ProductionRrvBuildStage.build_id == build.id, ProductionRrvBuildStage.stage_key == "final_inspection",
    ).first()
    return bool(st and st.status in ("in_progress", "completed", "not_applicable"))


def derive_row_status(db: Session, row: SalesOrderSchedule) -> str:
    if row.status == "cancelled":
        return "cancelled"
    if row.commissioned_on:
        return "commissioned"
    if row.delivered_on:
        return "delivered"
    if row.dispatched_on:
        return "dispatched"
    build = _build(db, row.rrv_build_id)
    if not build or build.status == "cancelled":
        return "open"
    if build.status == "planned":
        return "build_planned"
    if build.status in ("in_progress", "on_hold"):
        return "in_production"
    return "ready"


def refresh_order(db: Session, so: SalesOrder, as_of: date | None = None) -> None:
    """Re-derives every row's status, committed date and LD, the line
    quantities and the order's execution status. Idempotent."""
    as_of = as_of or today_ist()
    for row in so.schedules:
        row.status = derive_row_status(db, row)
        build = _build(db, row.rrv_build_id)
        if build and build.target_handover_date:
            row.committed_date = build.target_handover_date
        periods, amount = ld_accrued(so, row, as_of)
        row.ld_weeks, row.ld_amount, row.ld_computed_at = periods, amount, now_utc()
    refresh_line_quantities(so)
    # 'delivered' is re-derived too: an admin reversing a POD moves the order back.
    if so.status in ("confirmed", "in_execution", "partially_delivered", "delivered"):
        live = [r for r in so.schedules if r.status != "cancelled"]
        delivered = [r for r in live if r.status in ("delivered", "commissioned")]
        if live and len(delivered) == len(live):
            so.status = "delivered"
        elif delivered or any(float(r.qty_delivered or 0) > 0 for r in live):
            so.status = "partially_delivered"
        elif so.status in ("partially_delivered", "delivered"):
            so.status = "in_execution"
        elif so.status == "confirmed" and any(r.status in ("in_production", "ready", "dispatched") or float(r.qty_dispatched or 0) > 0
                                              for r in live):
            so.status = "in_execution"
    # Billing milestones fall due on these events (VF04) and invoiced amounts
    # are re-derived from the linked AR invoices (VF01 document flow).
    from app.modules.accounts.services import billing
    billing.sync_order(db, so, as_of=as_of)


def risk_of(db: Session, so: SalesOrder, row: SalesOrderSchedule, as_of: date, window_days: int) -> str | None:
    if row.status not in SALES_SCHEDULE_UNDELIVERED or not row.current_delivery_date or so.status not in (
            "confirmed", "in_execution", "partially_delivered", "on_hold"):
        return None
    if as_of > row.current_delivery_date:
        return "overdue"
    if row.committed_date and row.committed_date > row.current_delivery_date:
        return "at_risk"
    if (row.current_delivery_date - as_of).days <= window_days:
        build = _build(db, row.rrv_build_id)
        if not build or not build_reached_final_inspection(db, build):
            return "at_risk"
    return None


def link_build(db: Session, so: SalesOrder, row: SalesOrderSchedule, build_id: int) -> None:
    from app.modules.production.models.rrv_build import ProductionRrvBuild
    if so.status not in ("confirmed", "in_execution", "partially_delivered", "on_hold"):
        raise SalesError(409, f"Builds are linked to confirmed orders only — {so.display_number} is {STATUS_LABEL[so.status]}.")
    line = next((ln for ln in so.lines if ln.id == row.so_line_id), None)
    if not line or line.line_type != "rrv":
        raise SalesError(409, "Only RRV delivery rows get an RRV build — this row is for a non-vehicle line.")
    if row.status == "cancelled":
        raise SalesError(409, "This delivery row is cancelled, so it can't take a build.")
    if row.rrv_build_id and row.rrv_build_id != build_id:
        current = _build(db, row.rrv_build_id)
        raise SalesError(409, f"Vehicle {row.sequence} is already linked to {current.build_number if current else 'a build'} — unlink it first.")
    build = db.query(ProductionRrvBuild).filter(ProductionRrvBuild.id == build_id, ProductionRrvBuild.is_deleted == False).first()  # noqa: E712
    if not build:
        raise SalesError(404, f"RRV build #{build_id} not found — it may have been deleted. Pick the build again.")
    if build.status == "cancelled":
        raise SalesError(409, f"{build.build_number} is cancelled — link an active build.")
    if build.sales_schedule_id and build.sales_schedule_id != row.id:
        other = db.query(SalesOrderSchedule).filter(SalesOrderSchedule.id == build.sales_schedule_id).first()
        other_so = db.query(SalesOrder).filter(SalesOrder.id == other.so_id).first() if other else None
        raise SalesError(409, f"{build.build_number} already belongs to {other_so.display_number if other_so else 'another order'}"
                              f"{f' vehicle {other.sequence}' if other else ''} — unlink it there first, or pick another build.")
    row.rrv_build_id = build.id
    build.sales_order_id = so.id
    build.sales_order_line_id = line.id
    build.sales_schedule_id = row.id
    build.customer_id = so.customer_id
    build.customer_name = so.customer_name or build.customer_name
    build.customer_po_number = so.customer_po_number
    build.customer_po_date = so.customer_po_date
    build.order_reference = so.so_number
    if not build.target_handover_date and row.current_delivery_date:
        build.target_handover_date = row.current_delivery_date
    db.flush()


def unlink_build(db: Session, row: SalesOrderSchedule, *, force_reason: str | None = None) -> str | None:
    build = _build(db, row.rrv_build_id)
    if build and build.status not in ("planned", "cancelled") and not force_reason:
        raise SalesError(409, f"{build.build_number} has already started ({build.status.replace('_', ' ')}), so it stays with this order. "
                              f"Production must decide first (cancel the build or re-assign it).")
    number = build.build_number if build else None
    if build:
        build.sales_order_id = None
        build.sales_order_line_id = None
        build.sales_schedule_id = None
    row.rrv_build_id = None
    db.flush()
    return number


# ---------------------------------------------------------------- applying lines / schedule / billing

def _clean(data: dict, fields) -> dict:
    out = {}
    for f in fields:
        if f in data:
            v = data[f]
            out[f] = _to_date(v) if f in _DATE_FIELDS else (v.strip() if isinstance(v, str) else v)
    return out


def _check_line_refs(db: Session, items: list[dict]) -> None:
    """A line's product / stock item must exist — an unknown id would otherwise only
    fail at commit (foreign key) with a bare 500, or silently point at nothing."""
    from app.modules.crm.models.product import Product as CrmProduct
    from app.modules.store.models.item import StoreItem
    for i, ln in enumerate(items, start=1):
        label = f"Line {ln.get('line_number') or i}"
        pid = ln.get("crm_product_id")
        q = db.query(CrmProduct.id).filter(CrmProduct.id == pid)
        if not ln.get("id"):  # an existing line may keep a product deleted since; a new line may not pick one
            q = q.filter(CrmProduct.is_deleted == False)  # noqa: E712
        if pid and not q.first():
            raise SalesError(422, f"{label}: product #{pid} isn't in the CRM product list any more (deleted?) — pick the product again.")
        fpid = ln.get("product_id")
        if fpid:
            from app.modules.products.models.product import FinishedProduct
            fp = db.get(FinishedProduct, fpid)
            if fp is None:
                raise SalesError(422, f"{label}: product #{fpid} isn't in the product master — pick the product again.")
            if not ln.get("id") and fp.status in ("development", "discontinued"):
                raise SalesError(422, f"{label}: {fp.code} is {fp.status.replace('_', ' ')} — only active (or phased-out, for spares / "
                                      "service) products can be sold. Change its status in Sales › Products first.")
        iid = ln.get("product_item_id")
        if iid and not db.query(StoreItem.id).filter(StoreItem.id == iid).first():
            raise SalesError(422, f"{label}: stock item #{iid} doesn't exist in the Item Master — pick the item again.")


from app.modules.sales import pricing as _pricing  # noqa: E402 — line pricing (VK11)


def apply_lines(db: Session, so: SalesOrder, items: list[dict], *, mode: str) -> None:
    """Upsert lines by id. In `draft` mode missing lines are deleted; in
    `amend` mode a line can't be dropped (set its quantity to 0 instead)."""
    for i, ln in enumerate(items, start=1):
        validate_line_dict(i, ln)
    _check_line_refs(db, items)
    by_id = {ln.id: ln for ln in so.lines}
    keep = set()
    used_numbers = {int(x["line_number"]) for x in items if x.get("line_number")}
    next_no = max([0, *used_numbers, *(ln.line_number for ln in so.lines)]) + 1
    for data in items:
        lid = data.get("id")
        if lid:
            ln = by_id.get(lid)
            if not ln:
                raise SalesError(404, f"Line #{lid} isn't on {so.display_number} — reload the order and try again.")
        else:
            ln = SalesOrderLine(line_number=int(data.get("line_number") or next_no))
            if not data.get("line_number"):
                next_no += 1
            data["line_number"] = ln.line_number
            so.lines.append(ln)
        was = None if not lid else (ln.unit_price, ln.discount_percent, _pricing.price_key(ln))
        for k, v in _clean(data, LINE_FIELDS).items():
            setattr(ln, k, v)
        if data.get("product_id"):  # product master (COMMPR01); not in LINE_FIELDS so amendment snapshots stay as they were.
            ln.product_id = data["product_id"]  # a payload without it (older screens) keeps the line's product
        if ln.gst_rate is None:
            ln.gst_rate = 18
        ln.line_type = ln.line_type or "rrv"
        # Pricing conditions (VK11): default price / discount, manual override needs a reason.
        problem = _pricing.apply_line_pricing(db, so, ln, data, was=was, label=f"Line {ln.line_number}")
        if problem:
            raise SalesError(422, problem)
        keep.add(id(ln))
    for ln in list(so.lines):
        if id(ln) in keep:
            continue
        if mode == "amend":
            raise SalesError(422, f"Line {ln.line_number} can't be removed by an amendment — set its quantity to 0 (its open deliveries are then cancelled).")
        for r in [r for r in so.schedules if r.so_line_id == ln.id]:
            so.schedules.remove(r)
        so.lines.remove(ln)
    nums = [ln.line_number for ln in so.lines]
    if len(nums) != len(set(nums)):
        raise SalesError(422, "Two lines have the same line number — renumber them.")
    db.flush()


def fill_consignee_from_address(db: Session, so: SalesOrder, row: SalesOrderSchedule) -> None:
    """Consignee snapshot from the customer's ship-to / consignee address (CRM
    organisation › Addresses). Fields typed on the row win over the address."""
    from app.modules.crm.models.organization import OrgAddress
    addr = db.get(OrgAddress, row.ship_to_address_id)
    if not addr or addr.org_id != so.customer_id:
        raise SalesError(422, f"Ship-to address #{row.ship_to_address_id} isn't an address of {so.customer_name or 'this customer'} — "
                              f"pick one from the customer's addresses (CRM › Organization › Addresses).")
    if not addr.is_active:
        raise SalesError(422, f"Ship-to address '{addr.name}' is deactivated in CRM — pick an active one, or reactivate it there.")
    row.consignee_name = row.consignee_name or addr.name
    row.consignee_address = row.consignee_address or ", ".join(p for p in (addr.address, addr.city, addr.state, addr.pin_code) if p)
    row.consignee_gstin = row.consignee_gstin or addr.gstin
    row.consignee_state_code = row.consignee_state_code or addr.state_code
    row.consignee_contact_phone = row.consignee_contact_phone or addr.phone


def apply_schedule(db: Session, so: SalesOrder, items: list[dict], *, mode: str) -> list[str]:
    """Upsert delivery rows by id (rows point at their line by line_number).
    Draft: missing rows are deleted. Amend: missing rows are cancelled (a
    started build blocks it); a new contractual date moves both the contract
    and the current date. Returns notes (e.g. builds unlinked)."""
    notes = []
    by_line_no = {ln.line_number: ln for ln in so.lines}
    by_id = {r.id: r for r in so.schedules}
    keep = set()
    for data in items:
        line = by_line_no.get(int(data.get("line_number") or 0))
        if not line:
            raise SalesError(422, f"A delivery row points at line {data.get('line_number')}, which isn't on the order.")
        if float(data.get("quantity") or 0) <= 0:
            raise SalesError(422, f"A delivery row for line {line.line_number} has no quantity.")
        rid = data.get("id")
        if rid:
            row = by_id.get(rid)
            if not row or row.status == "cancelled":
                raise SalesError(404, f"Delivery row #{rid} isn't an open row of {so.display_number} — reload the order.")
        else:
            row = SalesOrderSchedule(status="open", so_line_id=line.id)
            so.schedules.append(row)
        row.so_line_id = line.id
        old_contract = row.contract_delivery_date
        for k, v in _clean(data, SCHEDULE_FIELDS).items():
            setattr(row, k, v)
        if mode == "draft" or not rid or row.contract_delivery_date != old_contract:
            row.current_delivery_date = row.contract_delivery_date
        if row.ship_to_address_id:
            fill_consignee_from_address(db, so, row)
        if not row.consignee_name:
            row.consignee_name = so.customer_name
        keep.add(id(row))
    for row in list(so.schedules):
        if id(row) in keep or row.status == "cancelled":
            continue
        if mode == "draft":
            so.schedules.remove(row)
            continue
        if row.status in ("dispatched", "delivered", "commissioned"):
            raise SalesError(409, f"Vehicle / lot {row.sequence} is already {row.status} — it can't be removed by an amendment.")
        if row.rrv_build_id:
            number = unlink_build(db, row)
            if number:
                notes.append(f"{number} was unlinked (it hadn't started) — Production should cancel it or re-assign it to another order.")
        row.status = "cancelled"
    # Re-sequence per line so vehicles read 1..n.
    for ln in so.lines:
        rows = [r for r in so.schedules if r.so_line_id == ln.id]
        rows.sort(key=lambda r: (r.status == "cancelled", r.contract_delivery_date or date.max, r.id or 0))
        for i, r in enumerate(rows, start=1):
            r.sequence = i
    db.flush()
    return notes


def _same(a, b) -> bool:
    """Equal for change detection: numbers within 0.0005 (Numeric vs float), blanks alike."""
    if a in (None, "") and b in (None, ""):
        return True
    try:
        return abs(float(a) - float(b)) < 0.0005
    except (TypeError, ValueError):
        return _norm(_iso(a)) == _norm(_iso(b))


def apply_billing(db: Session, so: SalesOrder, items: list[dict]) -> None:
    validate_billing_dicts(items)
    by_id = {b.id: b for b in so.billing_lines}
    # A milestone with any invoice raised against it (draft or posted) is fixed, whatever its status.
    from app.modules.accounts.services.billing import milestones_with_invoices
    billed = milestones_with_invoices(db, [b.id for b in so.billing_lines if b.id])
    keep = set()
    for i, data in enumerate(items, start=1):
        bid = data.get("id")
        if bid:
            b = by_id.get(bid)
            if not b:
                raise SalesError(404, f"Billing milestone #{bid} isn't on {so.display_number} — reload the order.")
            if b.status not in ("not_due", "due") or b.id in billed:
                # An amendment carries every milestone along (snapshot) — an invoiced one
                # passed back unchanged is fine; only a real change to it is refused.
                changed = [f for f, v in _clean(data, BILLING_FIELDS).items() if not _same(v, getattr(b, f))]
                if changed:
                    raise SalesError(409, f"Billing milestone {b.sequence} is already "
                                          f"{'invoiced (in part)' if b.status in ('not_due', 'due') else b.status.replace('_', ' ')}, so its "
                                          f"{', '.join(changed)} can't be changed — leave it as it is and adjust an open milestone.")
                keep.add(id(b))
                continue
        else:
            b = SalesBillingPlanLine(status="not_due")
            so.billing_lines.append(b)
        for k, v in _clean(data, BILLING_FIELDS).items():
            setattr(b, k, v)
        b.sequence = i
        keep.add(id(b))
    for b in list(so.billing_lines):
        if id(b) not in keep:
            if b.status not in ("not_due", "due", "cancelled") or b.id in billed:
                raise SalesError(409, f"Billing milestone {b.sequence} already has an invoice ({b.status.replace('_', ' ')}) and can't be "
                                      f"removed — cancel the draft invoice or raise a credit note in Finance first.")
            so.billing_lines.remove(b)
    db.flush()


def generate_schedule_rows(so: SalesOrder) -> None:
    """One open row per vehicle for every rrv line that has none (no dates)."""
    for ln in so.lines:
        if ln.line_type != "rrv" or any(r.so_line_id == ln.id for r in so.schedules):
            continue
        for i in range(int(float(ln.quantity or 0))):
            so.schedules.append(SalesOrderSchedule(so_line_id=ln.id, sequence=i + 1, quantity=1, status="open",
                                                   consignee_name=so.customer_name))


# ---------------------------------------------------------------- amendments

def amendment_diff(old: dict, new: dict) -> list[dict]:
    changes = []
    for f in AMENDABLE_HEADER:
        o, n = old["header"].get(f), new["header"].get(f)
        if _norm(o) != _norm(n):
            changes.append({"area": "header", "ref": f, "field": f, "old": o, "new": n})
    for area, fields, key in (("lines", LINE_FIELDS, "line_number"), ("schedule", SCHEDULE_FIELDS, "id"),
                              ("billing_plan", BILLING_FIELDS, "id")):
        olds = {x["id"]: x for x in old[area]}
        seen = set()
        for x in new[area]:
            ref = _ref(area, x)
            if x.get("id") and x["id"] in olds:
                seen.add(x["id"])
                o = olds[x["id"]]
                for f in fields:
                    if _norm(o.get(f)) != _norm(x.get(f)):
                        changes.append({"area": area, "ref": ref, "field": f, "old": o.get(f), "new": x.get(f)})
            else:
                changes.append({"area": area, "ref": ref, "field": None, "old": None, "new": "added"})
        for oid, o in olds.items():
            if oid not in seen:
                changes.append({"area": area, "ref": _ref(area, o), "field": None, "old": "present", "new": "removed"})
    return changes


def _ref(area: str, x: dict) -> str:
    if area == "lines":
        return f"Line {x.get('line_number') or 'new'}"
    if area == "schedule":
        return f"Line {x.get('line_number')} delivery {x.get('sequence') or 'new'}"
    return f"Milestone {x.get('sequence') or 'new'} ({x.get('milestone_type')})"


def _norm(v):
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, str):
        s = v.strip()
        try:
            f = float(s)
            return int(f) if f.is_integer() else f
        except ValueError:
            return s or None
    return v


def proposal_problems(db: Session, proposed: dict) -> list[str]:
    problems = []
    lines = proposed["lines"]
    for i, ln in enumerate(lines, start=1):
        try:
            validate_line_dict(i, ln)
        except SalesError as e:
            problems.append(e.detail)
    problems += schedule_problems(lines, proposed["schedule"])
    bp = billing_percent_problem(proposed["billing_plan"])
    if bp:
        problems.append(bp)
    try:
        validate_billing_dicts(proposed["billing_plan"])
        validate_header(proposed["header"])
    except SalesError as e:
        problems.append(e.detail)
    return problems


def check_removed_rows_buildable(db: Session, so: SalesOrder, proposed: dict) -> None:
    keep_ids = {x.get("id") for x in proposed["schedule"] if x.get("id")}
    for row in so.schedules:
        if row.status == "cancelled" or row.id in keep_ids or not row.rrv_build_id:
            continue
        build = _build(db, row.rrv_build_id)
        if build and build.status not in ("planned", "cancelled"):
            raise SalesError(409, f"The amendment removes vehicle {row.sequence}, but its build {build.build_number} has already started. "
                                  f"Production must decide first — cancel the build or re-assign it to another order.")


def apply_amendment(db: Session, so: SalesOrder, proposed: dict) -> list[str]:
    check_removed_rows_buildable(db, so, proposed)
    header = _clean(proposed["header"], AMENDABLE_HEADER)
    for k, v in header.items():
        setattr(so, k, v)
    apply_lines(db, so, [dict(x) for x in proposed["lines"]], mode="amend")
    notes = apply_schedule(db, so, [dict(x) for x in proposed["schedule"]], mode="amend")
    apply_billing(db, so, [dict(x) for x in proposed["billing_plan"]])
    recompute_totals(so)
    so.amendment_no = (so.amendment_no or 0) + 1
    refresh_order(db, so)
    # Order Project: vehicles added / cancelled by the amendment (sales/order_projects.py).
    from app.modules.sales.order_projects import ensure_order_project
    ensure_order_project(db, so, None)
    return notes


# ---------------------------------------------------------------- notifications helpers

def production_planners(db: Session) -> list[int]:
    return [u.id for u in db.query(User).filter(User.is_active == True, User.is_production_manager == True).all()  # noqa: E712
            if "production" in u.get_apps()]


def confirm_order(db: Session, so: SalesOrder, user: User) -> None:
    """Final approval → SO number, confirmed, CRM source marked won, people told.
    Called by the legacy chain and by the approval engine's on_decided."""
    snapshot_customer(db, so)
    so.so_number = generate_so_number(db)
    so.status = "confirmed"
    so.confirmed_at, so.confirmed_by_id = now_utc(), user.id
    refresh_order(db, so)
    # Execution project (OP-YYYY-NNN) for orders that build RRVs (sales/order_projects.py).
    from app.modules.sales.order_projects import ensure_order_project
    ensure_order_project(db, so, user)
    # CRM → Sales handoff (plan §6.1): close the source inquiry / tender as ordered.
    from app.modules.crm.services.won import mark_won
    mark_won(db, so, user)
    notify_confirmed(db, so, user.id)


def withdraw_approval(db: Session, entity_type: str, entity_id: int, user: User, reason: str) -> None:
    """Close the live approval-engine request of a record that is being
    cancelled / closed. A cascade (e.g. the Sales Head cancelling an order whose
    amendment someone else submitted) must not fail on the engine's "only the
    submitter may withdraw" rule, so it falls back to withdrawing it in the
    submitter's name — the reason says who really closed it."""
    from fastapi import HTTPException
    from app.modules.organization.services import approval_engine as engine
    req = engine.latest_request(db, entity_type, entity_id)
    if not req or req.status != "pending":
        return
    try:
        engine.cancel(db, req.id, user, reason)
    except HTTPException as e:
        if e.status_code != 403 or req.requester is None:
            raise
        engine.cancel(db, req.id, req.requester, f"{reason} (closed by {user.name or user.email})")


def close_followups(db: Session, so: SalesOrder, user: User, outcome: str) -> str:
    """When an order ends (cancelled / rejected / short-closed / closed), its open
    amendment and pending DP-extension requests can no longer apply — close them
    so nobody can approve them onto a dead order. Returns a note for the reason."""
    from app.modules.sales.models.amendment import SalesOrderAmendment, SALES_AMENDMENT_OPEN_STATUSES
    from app.modules.sales.models.extension import SalesDeliveryExtension
    amends = db.query(SalesOrderAmendment).filter(SalesOrderAmendment.so_id == so.id,
                                                  SalesOrderAmendment.status.in_(SALES_AMENDMENT_OPEN_STATUSES)).all()
    for a in amends:
        withdraw_approval(db, "sales_amendment", a.id, user, f"{so.display_number} was {outcome}")
        a.status = "cancelled"
    exts = db.query(SalesDeliveryExtension).filter(SalesDeliveryExtension.so_id == so.id,
                                                   SalesDeliveryExtension.status == "requested").all()
    for e in exts:
        e.status = "refused"
        e.decision_remarks = f"Closed without a decision — {so.display_number} was {outcome}."
        e.decided_at, e.decided_by_id = now_utc(), user.id
    parts = []
    if amends:
        parts.append(f"open amendment {', '.join(str(a.amendment_no) for a in amends)} cancelled")
    if exts:
        parts.append(f"{len(exts)} pending DP-extension request(s) closed")
    return f" [{'; '.join(parts)}]" if parts else ""


def notify_order_rejected(db: Session, so: SalesOrder, actor, comment: str, *, returned: bool, told) -> None:
    """Role event `sales.order_rejected` (rejected or returned); `told` = people
    who already got the direct bell notice."""
    from app.modules.sales import events as sales_events
    what = "returned for changes" if returned else "rejected"
    sales_events.order_event(
        db, None, "order_rejected", so, title=f"{so.display_number} {what}",
        message=f"{actor.name or actor.email} {what} {so.display_number} ({so.customer_name or 'customer'}): {comment}",
        actor=actor, skip_user_ids=told,
    )


def notify_confirmed(db: Session, so: SalesOrder, actor_id: int) -> None:
    msg = (f"{so.customer_name}: PO {so.customer_po_number}, value {inr(so.grand_total)}. "
           f"Its Order Project and a planned RRV build per vehicle are created automatically — see Sales › Order Projects.")
    from app.modules.sales import events as sales_events
    sales_events.order_event(
        db, None, "order_confirmed", so, title=f"Sales order {so.so_number} confirmed",
        message=f"{so.customer_name}: PO {so.customer_po_number} is confirmed as {so.so_number}. "
                f"Its Order Project and a planned build per vehicle are created automatically (Sales › Order Projects).",
        skip_user_ids={actor_id, so.created_by_id, so.submitted_by_id, so.sales_owner_id, *production_planners(db)},
    )
    notify_bell(db, [so.created_by_id, so.submitted_by_id, so.sales_owner_id], f"{so.so_number} confirmed", msg,
                "sales_order_confirmed", "sales_order", so.id, exclude_user_id=actor_id)
    notify_bell(db, production_planners(db), f"New order {so.so_number} — plan the builds", msg,
                "sales_order_confirmed", "sales_order", so.id, exclude_user_id=actor_id)
    try:
        broadcast_notification(db, f"Sales order {so.so_number} confirmed", f"{so.customer_name}: {inr(so.grand_total)}.",
                               "sales_order_confirmed", entity_type="sales_order", entity_id=so.id,
                               exclude_user_id=actor_id, app_name="accounts")
    except Exception:  # pragma: no cover — a notification must never block confirmation
        logger.exception("Failed to broadcast confirmation of %s", so.so_number)
