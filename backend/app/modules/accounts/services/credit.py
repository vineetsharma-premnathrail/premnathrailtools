"""Credit management (SAP FD32 / UKM): credit exposure, the credit block on
sales order confirmation and on dispatch, and its release through the central
approval engine (accounts.credit_release — Finance approver, Partner on top
for large excesses).

Exposure (what the customer could owe us if everything ordered is billed):

    open AR            posted sales invoices still due (disputed included —
                       it is owed until the dispute is resolved)
  + unbilled delivered value dispatched to the customer but not yet invoiced
  + open order value   ordered, not yet dispatched and not yet invoiced
  - unapplied credits  receipts on account / advances / credit notes not yet
                       set off (money we already hold)

Block reasons (either one blocks):
  * exposure above Organization.credit_limit (no limit set = no limit check);
  * any invoice overdue — past its due date (= invoice date + the customer's
    credit days) by more than Finance › Settings overdue grace — on its
    undisputed part.

A block is lifted only by a released AccountsCreditRelease for the customer,
the checkpoint (SO confirmation / dispatch) and the order (or any order),
valid until its valid_until date.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.modules.accounts.models.ar_transaction import ARTransaction
from app.modules.accounts.models.collections import AccountsCreditRelease, CREDIT_CHECKPOINTS

OPEN_SO_STATUSES = ("pending_approval", "confirmed", "in_execution", "partially_delivered", "on_hold")
# Delivered / short-closed orders can still hold delivered-but-unbilled value.
UNBILLED_SO_STATUSES = OPEN_SO_STATUSES + ("delivered", "short_closed")


class CreditBlocked(Exception):
    """The credit check stops this order / dispatch. str() = the real reason + how to get past it."""

    def __init__(self, message: str, position: dict):
        super().__init__(message)
        self.position = position


def _inr(v: float) -> str:
    return f"₹{v:,.2f}"


def _org(db: Session, customer_id: int):
    from app.modules.crm.models.organization import Organization
    return db.query(Organization).filter(Organization.id == customer_id).first()


def _order_values(db: Session, customer_id: int, extra_so=None) -> tuple[float, float, list[dict]]:
    """(unbilled delivered, open order value, per-order rows) over the customer's live orders."""
    from app.modules.accounts.models.ar_transaction import ARTransaction as AR
    from app.modules.sales.models.delivery import SalesInvoiceLink
    from app.modules.sales.models.order import SalesOrder

    orders = db.query(SalesOrder).filter(SalesOrder.customer_id == customer_id, SalesOrder.is_deleted == False,  # noqa: E712
                                         SalesOrder.status.in_(UNBILLED_SO_STATUSES)).all()
    if extra_so is not None and extra_so.id not in {o.id for o in orders} and extra_so.status not in ("cancelled", "closed"):
        orders.append(extra_so)
    invoiced: dict[int, float] = {}
    if orders:
        for so_id, taxable, gst in db.query(SalesInvoiceLink.so_id, SalesInvoiceLink.taxable_amount, SalesInvoiceLink.gst_amount) \
                .join(AR, AR.id == SalesInvoiceLink.ar_transaction_id) \
                .filter(SalesInvoiceLink.so_id.in_([o.id for o in orders]), AR.status == "posted").all():
            invoiced[so_id] = invoiced.get(so_id, 0.0) + float(taxable or 0) + float(gst or 0)
    unbilled_total, open_total, rows = 0.0, 0.0, []
    for o in orders:
        grand = float(o.grand_total or 0)
        delivered = 0.0
        for ln in o.lines or []:
            q = float(ln.quantity or 0)
            if q:
                delivered += float(ln.line_total or 0) / q * min(float(ln.qty_dispatched or 0), q)
        billed = invoiced.get(o.id, 0.0)
        unbilled = max(delivered - billed, 0.0)
        open_value = max(grand - max(delivered, billed), 0.0) if (o.status in OPEN_SO_STATUSES or o is extra_so) else 0.0
        unbilled_total += unbilled
        open_total += open_value
        if unbilled > 0.005 or open_value > 0.005:
            rows.append({"sales_order_id": o.id, "so_number": o.so_number or f"Draft #{o.id}", "status": o.status,
                         "grand_total": round(grand, 2), "delivered_value": round(delivered, 2), "invoiced_value": round(billed, 2),
                         "unbilled_delivered": round(unbilled, 2), "open_order_value": round(open_value, 2)})
    return round(unbilled_total, 2), round(open_total, 2), rows


def credit_exposure(db: Session, customer_id: int, *, sales_order=None, as_of: date | None = None) -> dict:
    """Credit position of one customer. `sales_order` — an order being
    confirmed that isn't yet counted (a draft) is added to open order value."""
    from app.modules.accounts.services.disputes import disputed_by_invoice
    from app.modules.accounts.services.outstanding import open_credits
    from app.modules.accounts.settings import get_setting

    today = as_of or date.today()
    org = _org(db, customer_id)
    invs = db.query(ARTransaction).filter(ARTransaction.customer_id == customer_id, ARTransaction.status == "posted",
                                          ARTransaction.amount_due > 0.005).all()
    disputed = disputed_by_invoice(db, [i.id for i in invs])
    grace = int(get_setting(db, "credit_overdue_grace_days") or 0)
    open_ar = round(sum(float(i.amount_due or 0) for i in invs), 2)
    overdue_amount, max_days, overdue_items = 0.0, 0, []
    for i in invs:
        days = (today - i.due_date).days
        undisputed = round(float(i.amount_due or 0) - min(disputed.get(i.id, 0.0), float(i.amount_due or 0)), 2)
        if days > grace and undisputed > 0.005:
            overdue_amount += undisputed
            max_days = max(max_days, days)
            overdue_items.append({"ar_transaction_id": i.id, "invoice_number": i.invoice_number, "due_date": i.due_date,
                                  "days_overdue": days, "amount": undisputed})
    unbilled, open_orders, order_rows = _order_values(db, customer_id, sales_order)
    credits = round(sum(c["available"] for c in open_credits(db, party_type="customer", party_id=customer_id)), 2)
    exposure = round(open_ar + unbilled + open_orders - credits, 2)
    limit = float(org.credit_limit) if org and org.credit_limit else None
    reasons = []
    if limit is not None and exposure > limit + 0.005:
        reasons.append(f"credit exposure {_inr(exposure)} is above the credit limit {_inr(limit)} "
                       f"(by {_inr(exposure - limit)})")
    if overdue_amount > 0.005:
        reasons.append(f"{len(overdue_items)} invoice(s) totalling {_inr(overdue_amount)} are overdue — the oldest by "
                       f"{max_days} days past due (credit days {org.credit_days if org and org.credit_days is not None else 0}"
                       + (f", grace {grace} days" if grace else "") + ")")
    return {
        "customer_id": customer_id, "customer_name": org.name if org else "—",
        "credit_limit": limit, "credit_days": org.credit_days if org else None,
        "open_ar": open_ar, "disputed": round(sum(min(disputed.get(i.id, 0.0), float(i.amount_due or 0)) for i in invs), 2),
        "unbilled_delivered": unbilled, "open_order_value": open_orders, "unapplied_credits": credits,
        "exposure": exposure, "available": round(limit - exposure, 2) if limit is not None else None,
        "over_limit": limit is not None and exposure > limit + 0.005,
        "overdue_amount": round(overdue_amount, 2), "max_days_overdue": max_days, "overdue_items": overdue_items,
        "orders": order_rows, "block_reasons": reasons, "would_block": bool(reasons), "as_of": today,
    }


def active_release(db: Session, customer_id: int, checkpoint: str, sales_order_id: int | None) -> AccountsCreditRelease | None:
    today = date.today()
    q = db.query(AccountsCreditRelease).filter(AccountsCreditRelease.customer_id == customer_id,
                                               AccountsCreditRelease.checkpoint == checkpoint,
                                               AccountsCreditRelease.status == "released",
                                               AccountsCreditRelease.valid_until >= today)
    for r in q.order_by(AccountsCreditRelease.id.desc()).all():
        if r.sales_order_id is None or r.sales_order_id == sales_order_id:
            return r
    return None


def credit_check(db: Session, customer_id: int, checkpoint: str, *, sales_order=None) -> dict:
    """Position + whether this checkpoint is blocked now (a released block passes)."""
    pos = credit_exposure(db, customer_id, sales_order=sales_order)
    rel = active_release(db, customer_id, checkpoint, sales_order.id if sales_order is not None else None) if pos["would_block"] else None
    pos["checkpoint"] = checkpoint
    pos["release"] = ({"id": rel.id, "release_number": rel.release_number, "valid_until": rel.valid_until} if rel else None)
    pos["blocked"] = pos["would_block"] and rel is None
    pending = None
    if pos["blocked"]:
        q = db.query(AccountsCreditRelease).filter(AccountsCreditRelease.customer_id == customer_id,
                                                   AccountsCreditRelease.checkpoint == checkpoint,
                                                   AccountsCreditRelease.status == "pending_approval")
        if sales_order is not None:
            q = q.filter((AccountsCreditRelease.sales_order_id == sales_order.id) | (AccountsCreditRelease.sales_order_id.is_(None)))
        pending = q.order_by(AccountsCreditRelease.id.desc()).first()
    pos["pending_release"] = {"id": pending.id, "release_number": pending.release_number} if pending else None
    return pos


def block_message(pos: dict, what: str) -> str:
    reasons = "; ".join(pos["block_reasons"])
    tail = (f" Release {pos['pending_release']['release_number']} is waiting for a Finance approver."
            if pos.get("pending_release") else
            " Ask Finance to release the credit block: 'Request credit release' on this screen, or Finance › Outstanding › "
            "Credit — or collect the overdue amount / raise the limit in CRM first.")
    return f"{what} is on credit hold for {pos['customer_name']} — {reasons}.{tail}"


def ensure_credit_ok(db: Session, customer_id: int, checkpoint: str, *, sales_order=None, what: str) -> dict:
    pos = credit_check(db, customer_id, checkpoint, sales_order=sales_order)
    if pos["blocked"]:
        raise CreditBlocked(block_message(pos, what), pos)
    return pos


# ── Dispatch hook ────────────────────────────────────────────────────────

def dispatch_orders(db: Session, *, sales_order_id: int | None, items: list[dict], erp_project_id: int | None) -> list:
    """The sales order(s) a Store dispatch goes against — named on the issue,
    on its lines (delivery rows), or the one open delivery row of the machine."""
    from app.modules.sales.models.order import SalesOrder, SalesOrderSchedule

    so_ids = set()
    if sales_order_id:
        so_ids.add(sales_order_id)
    row_ids = {it.get("sales_schedule_id") for it in items if it.get("sales_schedule_id")}
    if row_ids:
        so_ids |= {so for (so,) in db.query(SalesOrderSchedule.so_id).filter(SalesOrderSchedule.id.in_(row_ids)).all()}
    if not so_ids and erp_project_id:
        try:
            from app.modules.sales.legacy import rows_for_machine
            rows = [r for r in rows_for_machine(db, erp_project_id) if float(r.quantity or 0) - float(r.qty_dispatched or 0) > 1e-6]
            if len(rows) == 1:
                so_ids.add(rows[0].so_id)
        except Exception:  # noqa: BLE001 — machine without a sales link: nothing to check
            pass
    if not so_ids:
        return []
    return db.query(SalesOrder).filter(SalesOrder.id.in_(so_ids)).all()


def ensure_dispatch_credit_ok(db: Session, *, sales_order_id: int | None, items: list[dict], erp_project_id: int | None) -> None:
    from app.modules.accounts.settings import get_setting
    if not get_setting(db, "credit_check_at_dispatch"):
        return
    for so in dispatch_orders(db, sales_order_id=sales_order_id, items=items, erp_project_id=erp_project_id):
        ensure_credit_ok(db, so.customer_id, "dispatch", sales_order=so, what=f"Dispatch against {so.so_number or f'order #{so.id}'}")


# ── Release requests ─────────────────────────────────────────────────────

def _next_number(db: Session, on: date) -> str:
    prefix = f"CR-{on.year}-"
    last = db.query(AccountsCreditRelease.release_number).filter(AccountsCreditRelease.release_number.like(f"{prefix}%")) \
        .order_by(AccountsCreditRelease.release_number.desc()).first()
    seq = int(last[0].rsplit("-", 1)[1]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


def request_release(db: Session, *, customer_id: int, checkpoint: str, sales_order_id: int | None, reason: str,
                    user_id: int | None) -> AccountsCreditRelease:
    from app.modules.sales.models.order import SalesOrder

    if checkpoint not in CREDIT_CHECKPOINTS:
        raise ValueError(f"Checkpoint must be one of: {', '.join(CREDIT_CHECKPOINTS)}.")
    if not (reason or "").strip():
        raise ValueError("Say why the order / dispatch should go ahead despite the credit block (e.g. 'payment of ₹12 L "
                         "confirmed by the customer's accounts for 20-Oct, UTR to follow').")
    so = None
    if sales_order_id:
        so = db.query(SalesOrder).filter(SalesOrder.id == sales_order_id, SalesOrder.is_deleted == False).first()  # noqa: E712
        if not so:
            raise ValueError(f"Sales order #{sales_order_id} not found — refresh and pick the order again.")
        if so.customer_id != customer_id:
            raise ValueError(f"{so.so_number or 'That order'} belongs to another customer.")
    pos = credit_check(db, customer_id, checkpoint, sales_order=so)
    if not pos["would_block"]:
        raise ValueError(f"{pos['customer_name']} is within credit (exposure {_inr(pos['exposure'])}, nothing overdue) — "
                         "no release is needed.")
    if pos["release"]:
        raise ValueError(f"The credit block is already released ({pos['release']['release_number']}, valid until "
                         f"{pos['release']['valid_until']:%d-%m-%Y}).")
    if pos["pending_release"]:
        raise ValueError(f"Release {pos['pending_release']['release_number']} is already waiting for a Finance approver.")
    rel = AccountsCreditRelease(
        release_number=_next_number(db, date.today()), customer_id=customer_id, sales_order_id=sales_order_id,
        checkpoint=checkpoint, status="pending_approval", credit_limit=pos["credit_limit"], exposure=pos["exposure"],
        overdue_amount=pos["overdue_amount"], max_days_overdue=pos["max_days_overdue"],
        block_reasons="; ".join(pos["block_reasons"]), request_reason=reason.strip(), requested_by_id=user_id)
    db.add(rel)
    db.flush()
    return rel


def excess_amount(rel: AccountsCreditRelease) -> float:
    over = max(float(rel.exposure or 0) - float(rel.credit_limit or 0), 0.0) if rel.credit_limit is not None else 0.0
    return round(max(over, float(rel.overdue_amount or 0)), 2)


def decide_release(db: Session, rel: AccountsCreditRelease, outcome: str, actor_id: int, comment: str | None) -> None:
    from app.modules.accounts.settings import get_setting
    if rel.status != "pending_approval":
        return
    rel.decided_by_id = actor_id
    rel.decided_at = datetime.now(timezone.utc)
    rel.decision_comment = comment
    if outcome == "approved":
        rel.status = "released"
        rel.valid_until = date.today() + timedelta(days=int(get_setting(db, "credit_release_validity_days") or 7))
    elif outcome in ("rejected", "returned"):
        rel.status = "rejected"
    else:
        rel.status = "withdrawn"
    db.flush()
