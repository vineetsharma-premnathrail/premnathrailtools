"""ME22N purchase order amendment with re-release.

A released PO (final approval done) is changed only through an amendment:
quantity / price / tax / delivery-date edits, new lines, deleted lines and
the header delivery date / terms. The amendment is approved on the central
approval engine as transaction type `p2p.po_amendment` (first seeded from the
PO workflow's stages, so the same picked PO approvers then any one Partner);
only on approval are the changes applied, the PO's amendment_no and revision
bumped (the Word PO is rebuilt as "Amendment N") and the info records
updated. Floors, checked on submit AND again at approval:

- a line's quantity can't go below what was received or invoiced on it;
- a line's price/tax can't change once Finance has invoiced against it (the
  difference is then a debit/credit note, not a PO change);
- a line with any receipt, service entry or invoice can't be deleted.

A quantity reduction needs no extra step: what a PO no longer orders is simply open to order again on
its requisition line (open quantity is computed from the live PO lines). Anything that ADDS requisition
quantity to a PO (a new line, a raised quantity) is checked against what is still open while holding the
requisition lock (po_split.lock_pr), on submit and again on approval, so two buyers can't both take the
same last units.
"""
from __future__ import annotations

from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest, ApprovalWorkflow
from app.modules.organization.services import approval_engine as engine
from app.modules.organization.services.approval_engine import StageDef, TransactionType, register_transaction
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.po_amendment import P2PPOAmendment
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem

AMEND_KEY = "p2p.po_amendment"
AMEND_ENTITY = "p2p_po_amendment"
_EDITABLE_FIELDS = ("quantity", "unit_price", "tax_rate", "delivery_date")


# ── Snapshots ────────────────────────────────────────────────────────────

def _iso(v):
    return v.isoformat() if isinstance(v, (date, datetime)) else v


def line_snapshot(i: P2PPurchaseOrderItem) -> dict:
    return {"po_item_id": i.id, "store_item_id": i.store_item_id, "item_code": i.item_code, "item_name": i.item_name,
            "pr_item_id": i.pr_item_id, "unit": i.unit, "quantity": i.quantity, "unit_price": i.unit_price, "tax_rate": i.tax_rate,
            "line_total": i.line_total, "delivery_date": _iso(i.delivery_date)}


def po_snapshot(po: P2PPurchaseOrder) -> dict:
    return {"po_number": po.po_number, "amendment_no": po.amendment_no or 0, "vendor_name": po.vendor_name,
            "expected_delivery": _iso(po.expected_delivery), "delivery_terms": po.delivery_terms, "total_value": po.total_value,
            "lines": [line_snapshot(i) for i in sorted(po.items, key=lambda x: x.id or 0)]}


def _line_total(qty, price, tax) -> float | None:
    from app.modules.p2p.service import compute_line_total
    return compute_line_total(qty, price, tax)


# ── Floors ───────────────────────────────────────────────────────────────

def floors(db: Session, po: P2PPurchaseOrder) -> tuple[dict[int, float], dict[int, float], set[int]]:
    """(received per line, invoiced per line, lines with any service entry).
    Received counts goods physically in (incl. a GRN still in inspection)."""
    from app.modules.accounts.services.po_match import invoiced_by_po_item, received_by_po_item
    from app.modules.p2p.models.service_entry import P2PServiceEntry
    from app.modules.p2p.routes.goods_receipts import _received_by_po_item

    a = _received_by_po_item(db, po.id)
    b = received_by_po_item(db, po)
    received = {k: max(a.get(k, 0), b.get(k, 0)) for k in set(a) | set(b)}
    invoiced = invoiced_by_po_item(db, {i.id for i in po.items})
    ses = {pid for (pid,) in db.query(P2PServiceEntry.po_item_id).filter(
        P2PServiceEntry.purchase_order_id == po.id, P2PServiceEntry.status != "cancelled").all()}
    return received, invoiced, ses


def _check_floors(db: Session, po: P2PPurchaseOrder, changes: list[dict]) -> list[str]:
    """Raise 409 for a change below a floor; return soft warnings."""
    received, invoiced, ses = floors(db, po)
    lines = {i.id: i for i in po.items}
    warnings = []
    for c in changes:
        pid = c.get("po_item_id")
        line = lines.get(pid) if pid else None
        if c["op"] in ("change", "delete") and line is None:
            raise HTTPException(status_code=409, detail=f"Line #{pid} is no longer on PO {po.po_number} — reload the PO and amend again.")
        name = line.item_name if line else ""
        got, billed = received.get(pid, 0), invoiced.get(pid, 0)
        if c["op"] == "delete":
            if got > 0 or billed > 0 or pid in ses:
                what = "received" if got > 0 else ("invoiced" if billed > 0 else "confirmed on a service entry")
                raise HTTPException(status_code=409, detail=(
                    f"'{name}' can't be deleted from PO {po.po_number}: part of it has already been {what}. "
                    f"Reduce its quantity to {max(got, billed):g} instead (short-close the balance)."))
        elif c["op"] == "change" and c["field"] == "quantity":
            floor = max(got, billed)
            if c["new"] < floor - 1e-6:
                basis = "received" if got >= billed else "invoiced by Finance"
                raise HTTPException(status_code=409, detail=(
                    f"'{name}': quantity can't go below {floor:g} {line.unit or ''} — that much has already been {basis}. "
                    f"Set it to {floor:g} or more."))
        elif c["op"] == "change" and c["field"] in ("unit_price", "tax_rate"):
            if billed > 0:
                raise HTTPException(status_code=409, detail=(
                    f"'{name}': the {'price' if c['field'] == 'unit_price' else 'GST rate'} can't change — Finance has already "
                    f"booked an invoice for {billed:g} {line.unit or ''} at the current rate. Settle the difference with a debit / "
                    "credit note in Finance instead."))
            if got > 0 and c["field"] == "unit_price":
                warnings.append(f"'{name}': {got:g} {line.unit or ''} was already received and valued in stock at the old price "
                                f"({c['old']}); the new price applies to the invoice match and the rest of the quantity.")
    return warnings


# ── Build / validate ─────────────────────────────────────────────────────

def build_changes(db: Session, po: P2PPurchaseOrder, pr: P2PRequest | None, payload) -> tuple[list[dict], dict]:
    """Change list + the PO as it would be after the amendment (snapshot)."""
    from app.modules.p2p.item_link import purchasable_item

    lines = {i.id: i for i in po.items}
    changes: list[dict] = []
    deleted = set(payload.delete_po_item_ids or [])
    for pid in deleted:
        if pid not in lines:
            raise HTTPException(status_code=422, detail=f"Line #{pid} is not on PO {po.po_number} — reload the PO and try again.")
        changes.append({"op": "delete", "po_item_id": pid, "old": line_snapshot(lines[pid])})
    seen = set()
    for ch in payload.changes or []:
        line = lines.get(ch.po_item_id)
        if line is None:
            raise HTTPException(status_code=422, detail=f"Line #{ch.po_item_id} is not on PO {po.po_number} — reload the PO and try again.")
        if ch.po_item_id in deleted:
            raise HTTPException(status_code=422, detail=f"'{line.item_name}' is both changed and deleted — pick one.")
        if ch.po_item_id in seen:
            raise HTTPException(status_code=422, detail=f"'{line.item_name}' is listed twice — put all its changes in one row.")
        seen.add(ch.po_item_id)
        for f in _EDITABLE_FIELDS:
            if f not in ch.model_fields_set:
                continue
            new, old = getattr(ch, f), getattr(line, f)
            if f == "quantity" and (new is None or new <= 0):
                raise HTTPException(status_code=422, detail=f"'{line.item_name}': quantity must be more than 0 — to drop the line, delete it.")
            if f == "unit_price" and (new is None or new <= 0):
                raise HTTPException(status_code=422, detail=f"'{line.item_name}': enter a unit price above 0.")
            same = abs((new or 0) - (old or 0)) < 1e-9 if f == "quantity" else (new if new is not None else None) == old
            if same:
                continue
            changes.append({"op": "change", "po_item_id": line.id, "field": f, "old": _iso(old), "new": _iso(new)})
    adds_by_pr: dict[int, float] = {}
    for n, add in enumerate(payload.add_lines or [], start=1):
        item = purchasable_item(db, add.store_item_id, f"New line {n}")
        if add.pr_item_id:
            if pr is None or add.pr_item_id not in {i.id for i in pr.items}:
                raise HTTPException(status_code=422, detail=f"New line {n}: PR line #{add.pr_item_id} is not on this PO's requisition.")
            pr_line = next(i for i in pr.items if i.id == add.pr_item_id)
            if pr_line.store_item_id and pr_line.store_item_id != item.id:
                raise HTTPException(status_code=422, detail=(
                    f"New line {n}: PR line '{pr_line.item_name}' is for {pr_line.item_code}, not {item.item_code} — pick the same Item Master item."))
            adds_by_pr[add.pr_item_id] = adds_by_pr.get(add.pr_item_id, 0) + add.quantity
        changes.append({"op": "add", "line": {
            "store_item_id": item.id, "pr_item_id": add.pr_item_id, "quantity": add.quantity, "unit_price": add.unit_price,
            "tax_rate": add.tax_rate, "delivery_date": _iso(add.delivery_date), "specification": add.specification,
            "item_name": item.item_name, "item_code": item.item_code, "unit": item.uom,
        }})
    # Quantity increases on lines tied to a PR line must still fit the PR.
    if pr is not None:
        wanted = dict(adds_by_pr)
        for c in changes:
            if c["op"] == "change" and c["field"] == "quantity":
                line = lines[c["po_item_id"]]
                if line.pr_item_id and c["new"] > c["old"]:
                    wanted[line.pr_item_id] = wanted.get(line.pr_item_id, 0) + (c["new"] - c["old"])
        if wanted:
            from app.modules.p2p.po_split import open_qty_by_pr_item
            left = open_qty_by_pr_item(db, pr)
            for pid, extra in wanted.items():
                if extra - left.get(pid, 0) > 1e-6:
                    pr_line = next(i for i in pr.items if i.id == pid)
                    raise HTTPException(status_code=409, detail=(
                        f"'{pr_line.item_name}': the amendment adds {extra:g} {pr_line.unit or ''} but only {left.get(pid, 0):g} is "
                        f"left un-ordered on {pr.p2p_number}. Raise a new requisition for the extra quantity."))
    header = {}
    for f in ("expected_delivery", "delivery_terms"):
        if f in payload.model_fields_set:
            new, old = getattr(payload, f), getattr(po, f)
            if f == "delivery_terms":
                new = (new or "").strip() or None
            if new != old:
                changes.append({"op": "header", "field": f, "old": _iso(old), "new": _iso(new)})
                header[f] = new
    if not changes:
        raise HTTPException(status_code=422, detail="Nothing changes — edit a quantity, price, GST rate or delivery date, add or delete a line, and then submit the amendment.")
    return changes, _after_snapshot(po, changes)


def _after_snapshot(po: P2PPurchaseOrder, changes: list[dict]) -> dict:
    snap = po_snapshot(po)
    by_id = {l["po_item_id"]: l for l in snap["lines"]}
    for c in changes:
        if c["op"] == "delete":
            by_id.pop(c["po_item_id"], None)
        elif c["op"] == "change":
            by_id[c["po_item_id"]][c["field"]] = c["new"]
        elif c["op"] == "header":
            snap[c["field"]] = c["new"]
    lines = list(by_id.values())
    for c in changes:
        if c["op"] == "add":
            lines.append({**c["line"], "po_item_id": None})
    for l in lines:
        l["line_total"] = _line_total(l["quantity"], l["unit_price"], l["tax_rate"])
    snap["lines"] = lines
    totals = [l["line_total"] for l in lines]
    snap["total_value"] = round(sum(totals), 2) if lines and all(t is not None for t in totals) else None
    snap["amendment_no"] = (po.amendment_no or 0) + 1
    return snap


def _quantity_added(changes: list[dict], lines: dict[int, P2PPurchaseOrderItem]) -> dict[int, float]:
    """pr_item_id -> extra quantity the changes would put on the PO (new lines and raised quantities)."""
    wanted: dict[int, float] = {}
    for c in changes:
        if c["op"] == "add" and c["line"].get("pr_item_id"):
            pid = c["line"]["pr_item_id"]
            wanted[pid] = wanted.get(pid, 0) + (c["line"].get("quantity") or 0)
        elif c["op"] == "change" and c["field"] == "quantity":
            line = lines.get(c["po_item_id"])
            if line is not None and line.pr_item_id and c["new"] > (line.quantity or 0) + 1e-9:
                wanted[line.pr_item_id] = wanted.get(line.pr_item_id, 0) + (c["new"] - (line.quantity or 0))
    return wanted


# ── Apply on approval ────────────────────────────────────────────────────

def apply_amendment(db: Session, am: P2PPOAmendment, actor: User) -> None:
    from app.modules.p2p.info_records import upsert_from_po
    from app.modules.p2p.item_link import item_category_for
    from app.modules.store.models.item import StoreItem

    po = db.get(P2PPurchaseOrder, am.purchase_order_id)
    if po is None or po.status == "cancelled":
        raise HTTPException(status_code=409, detail="The PO was cancelled after this amendment was raised, so it can't be applied — reject it.")
    _check_floors(db, po, am.changes)  # receipts / invoices may have moved since submit
    lines = {i.id: i for i in po.items}
    # Added / raised requisition quantity must still be open now (another PO may have taken it since submit).
    wanted = _quantity_added(am.changes, lines)
    if wanted and po.p2p_request_id:
        from app.modules.p2p.po_split import ensure_qty_fits, lock_pr
        ensure_qty_fits(db, lock_pr(db, po.p2p_request_id), wanted)
        lines = {i.id: i for i in po.items}
    for c in am.changes:
        if c["op"] == "delete":
            line = lines.get(c["po_item_id"])
            if line is not None:
                po.items.remove(line)
                db.delete(line)
        elif c["op"] == "change":
            line = lines[c["po_item_id"]]
            val = c["new"]
            if c["field"] == "delivery_date":
                val = date.fromisoformat(val) if val else None
            setattr(line, c["field"], val)
            if c["field"] == "unit_price":
                line.price_source = "manual"
                line.price_override_reason = f"Amendment {am.amendment_no}: {am.reason}"[:2000]
            line.line_total = _line_total(line.quantity, line.unit_price, line.tax_rate)
        elif c["op"] == "add":
            d = c["line"]
            item = db.get(StoreItem, d["store_item_id"])
            po.items.append(P2PPurchaseOrderItem(
                store_item_id=item.id, item_name=item.item_name, part_code=item.part_number or item.manufacturer_part_number,
                unit=item.uom, quantity=d["quantity"], unit_price=d["unit_price"], tax_rate=d["tax_rate"],
                line_total=_line_total(d["quantity"], d["unit_price"], d["tax_rate"]), pr_item_id=d.get("pr_item_id"),
                delivery_date=date.fromisoformat(d["delivery_date"]) if d.get("delivery_date") else None,
                specification=(d.get("specification") or None), item_category=item_category_for(db, item.id),
                price_source="manual", price_override_reason=f"Added by amendment {am.amendment_no}",
            ))
        elif c["op"] == "header":
            val = c["new"]
            if c["field"] == "expected_delivery":
                val = date.fromisoformat(val) if val else None
            setattr(po, c["field"], val)
    db.flush()
    totals = [i.line_total for i in po.items]
    po.total_value = round(sum(totals), 2) if po.items and all(t is not None for t in totals) else None
    po.amendment_no = am.amendment_no
    po.revision = (po.revision or 0) + 1
    am.after = po_snapshot(po)
    am.new_total = po.total_value
    upsert_from_po(db, po)
    if po.p2p_request_id:
        pr = db.get(P2PRequest, po.p2p_request_id)
        if pr is not None:
            from app.modules.p2p.po_split import live_pos
            pos = live_pos(db, pr.id)
            vals = [p.total_value for p in pos]
            pr.po_value = round(sum(v for v in vals if v), 2) if any(vals) else pr.po_value
    # Re-derive the PO's fulfilment from receipts vs the amended quantities.
    from app.modules.p2p.routes.goods_receipts import _sync_po_and_pr_status
    if po.status not in ("draft", "cancelled"):
        _sync_po_and_pr_status(db, po, actor.id)


# ── Approval engine type ─────────────────────────────────────────────────

def _decided(db: Session, req: ApprovalRequest, outcome: str, actor: User) -> None:
    from app.modules.p2p.approvals import _deciding_step

    am = db.get(P2PPOAmendment, req.entity_id)
    if am is None or am.status != "pending_approval":
        return
    step = _deciding_step(req)
    comment = step.comment if step else None
    who = actor.name or actor.email
    po = db.get(P2PPurchaseOrder, am.purchase_order_id)
    if outcome == "approved":
        apply_amendment(db, am, actor)
        am.status = "approved"
        summary = (f"Amendment {am.amendment_no} of PO '{po.po_number}' approved by {who} and applied "
                   f"(value {am.old_total or 0:,.2f} → {am.new_total or 0:,.2f}).")
    else:
        am.status = {"rejected": "rejected", "returned": "returned"}.get(outcome, "withdrawn")
        summary = f"Amendment {am.amendment_no} of PO '{po.po_number}' was {am.status} by {who}; the PO is unchanged." + (
            f" Comment: {comment}" if comment else "")
    am.decided_by_id = actor.id
    am.decided_at = datetime.now(timezone.utc)
    am.decision_comment = comment
    if po is not None and po.p2p_request_id:
        db.add(AuditLog(entity_type="p2p_request", entity_id=po.p2p_request_id, action=f"po_amendment_{am.status}",
                        performed_by_id=actor.id, summary=summary))
    if po is not None:
        db.add(AuditLog(entity_type="p2p_purchase_order", entity_id=po.id, action=f"amendment_{am.status}", module_key="p2p",
                        subtab_key="purchase_orders", performed_by_id=actor.id, summary=summary,
                        old_value=_json(am.before), new_value=_json(am.after)))


def _json(v) -> str:
    import json
    return json.dumps(v, default=str)


register_transaction(TransactionType(
    key=AMEND_KEY, module_key="p2p", subtab_key="purchase_orders", label="Purchase order amendment",
    entity_type=AMEND_ENTITY, url="/dashboard/p2p/purchase-orders/amendments/{id}",
    description="A change to a released PO (quantity, price, delivery date, added/deleted lines). Seeded from the "
                "Purchase order workflow: the PO approvers, then any one Partner.",
    context_fields={"vendor_name": {"label": "Vendor", "type": "text"},
                    "value_change": {"label": "Value change", "type": "number"}},
    default_stages=[StageDef("Partner (final approval)", "partner")],
    require_permission=False, allow_self_approval=False, distinct_approvers=True,
    comment_required_on_approve=True,
    on_decided=_decided,
))


def seed_workflow(db: Session) -> None:
    """First use: copy the PO workflow's stages so an amendment re-releases
    through exactly the people who released the PO. Flushes, never commits."""
    from app.modules.p2p import approvals as p2p_approvals

    if db.query(ApprovalWorkflow.id).filter(ApprovalWorkflow.key == AMEND_KEY).first() is not None:
        return
    p2p_approvals.seed_workflows(db)
    po_wf = engine.ensure_workflow(db, p2p_approvals.PO_KEY)
    tt = engine.get_type(AMEND_KEY)
    static = tt.default_stages
    tt.default_stages = [StageDef(s.name, s.approver_rule, dict(s.rule_config or {}), s.approval_mode, list(s.conditions or []),
                                  s.skip_if_no_approver, s.escalate_after_hours, s.escalation_rule, dict(s.escalation_config or {}))
                         for s in po_wf.stages] or static
    try:
        engine.ensure_workflow(db, AMEND_KEY)
    finally:
        tt.default_stages = static


def submit(db: Session, po: P2PPurchaseOrder, pr: P2PRequest | None, payload, user: User) -> tuple[P2PPOAmendment, list[str]]:
    from app.modules.p2p.info_records import ensure_source_allowed
    from app.modules.p2p.po_split import po_is_released

    if po.status in ("draft", "cancelled"):
        raise HTTPException(status_code=409, detail=(
            f"PO {po.po_number} is {po.status} — a draft is edited directly on the PO page, and a cancelled PO can't be amended."))
    if not po_is_released(db, po):
        raise HTTPException(status_code=409, detail=(
            f"PO {po.po_number} is still waiting for its approval. Ask the approver to return it for changes instead of amending it."))
    pending = db.query(P2PPOAmendment).filter(P2PPOAmendment.purchase_order_id == po.id,
                                              P2PPOAmendment.status == "pending_approval").first()
    if pending:
        raise HTTPException(status_code=409, detail=(
            f"Amendment {pending.amendment_no} of PO {po.po_number} is still waiting for approval. Withdraw it, or wait for its decision, "
            "before raising another."))
    reason = (payload.reason or "").strip()
    if len(reason) < 5:
        raise HTTPException(status_code=422, detail="Write why the PO is being amended (e.g. 'Vendor revised price per letter dt. 10-10-2026').")
    if pr is not None and (payload.add_lines or any("quantity" in c.model_fields_set for c in payload.changes or [])):
        # Take the requisition lock while the open-quantity check runs (committed with the amendment).
        from app.modules.p2p.po_split import lock_pr
        pr = lock_pr(db, pr.id)
    changes, after = build_changes(db, po, pr, payload)
    warnings = _check_floors(db, po, changes)
    adds = [c["line"]["store_item_id"] for c in changes if c["op"] == "add"]
    if adds:
        ensure_source_allowed(db, po.vendor_id, adds, date.today(), po.vendor_name)
    last_no = max((a.amendment_no for a in db.query(P2PPOAmendment).filter(P2PPOAmendment.purchase_order_id == po.id).all()),
                  default=po.amendment_no or 0)
    am = P2PPOAmendment(purchase_order_id=po.id, amendment_no=max(last_no, po.amendment_no or 0) + 1, reason=reason,
                        status="pending_approval", changes=changes, before=po_snapshot(po), after=after,
                        old_total=po.total_value, new_total=after["total_value"], requested_by_id=user.id)
    after["amendment_no"] = am.amendment_no
    db.add(am)
    db.flush()
    seed_workflow(db)
    from app.modules.p2p.approvals import _pr_context
    ctx = {**(_pr_context(pr) if pr else {}), "vendor_name": po.vendor_name,
           "value_change": round((am.new_total or 0) - (am.old_total or 0), 2)}
    req = engine.submit(db, AMEND_KEY, entity_id=am.id, requester=user,
                  title=f"PO {po.po_number} amendment {am.amendment_no}" + (f" — {po.vendor_name}" if po.vendor_name else ""),
                  reference=f"{po.po_number}-A{am.amendment_no}", amount=am.new_total, context=ctx,
                  branch_id=getattr(user, "branch_id", None))
    from app.modules.p2p import notify as p2p_notify
    from app.modules.p2p.approvals import _AfterDecisionTasks
    p2p_notify.po_amendment_submitted(db, _AfterDecisionTasks(), po, am, user, req)
    if pr is not None:
        db.add(AuditLog(entity_type="p2p_request", entity_id=pr.id, action="po_amendment_submitted", performed_by_id=user.id,
                        summary=f"{user.name or user.email} raised amendment {am.amendment_no} of PO '{po.po_number}' "
                                f"({len(changes)} change(s)): {reason}"))
    return am, warnings
