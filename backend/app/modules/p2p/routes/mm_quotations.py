"""ME47 line-level quotations, ME49 comparison / award, and the ME21N split
of one approved requisition into several POs by vendor.

    GET  /p2p/rfqs/{id}/line-quotations            quotes with their lines
    POST /p2p/rfqs/{id}/line-quotations            record a vendor's quote (per-line prices)
    PUT  /p2p/rfqs/{id}/line-quotations/{vq_id}    replace it (until a PO uses it)
    GET  /p2p/rfqs/{id}/comparison                 lines x vendors, landed cost, L1 per line + overall
    GET  /p2p/rfqs/{id}/comparison/export          the same as Excel
    POST /p2p/rfqs/{id}/awards                     line-level vendor choice by quantity (split across vendors; reason when not L1)
    GET  /p2p/rfqs/{id}/split-proposal             awarded lines grouped into one PO per vendor
    PATCH /p2p/rfqs/{id}/po-draft/{po_id}/details  plant / ship-to / per-line delivery dates on a draft
"""
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import GRANT_HINT, ensure_feature_action, ensure_tab_action, require_app_access
from app.modules.p2p.pricing import mask_for, sees_prices
from app.db.session import get_db
from app.modules.accounts.models.vendor import Vendor
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.p2p.models.p2p_request import P2PRequest
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.models.rfq import RFQ
from app.modules.p2p.models.vendor_quotation import VendorQuotation, VendorQuotationItem
from app.modules.p2p import po_split, quotation_compare
from app.modules.p2p.line_progress import line_progress
from app.modules.p2p.routes.p2p_requests import _write_audit as _write_pr_audit
from app.modules.p2p.routes.rfq import (
    _get_pr_for_rfq, _get_rfq_or_404, _live_po_qty_by_quote_line, _po_of_rfq, _reload_rfq, active_items, ensure_rfq_owner,
    ensure_rfq_readable,
)
from app.modules.p2p.schemas.mm_purchasing import (
    LineQuotationCreate, LineQuotationResponse, PODraftDetailsPayload, QuotationAwardPayload,
)
from app.modules.p2p.schemas.purchase_order import P2PPurchaseOrderResponse
from app.modules.store.models.location import StoreLocation

router = APIRouter(prefix="/p2p/rfqs", tags=["P2P - Quotations & PO split"])

_EPS = 1e-6


def _purchase_tab(tab: str, action: str):
    purchase_dep = require_app_access("purchase")

    def _dependency(user: User = Depends(purchase_dep)) -> User:
        ensure_tab_action(user, "p2p", tab, action)
        return user

    return _dependency


def _rfq_pr(db: Session, rfq_id: int, user: User) -> tuple[RFQ, P2PRequest]:
    rfq = _get_rfq_or_404(db, rfq_id, user)
    rfq = db.query(RFQ).options(selectinload(RFQ.vendor_quotations).selectinload(VendorQuotation.items),
                                selectinload(RFQ.attachments)).filter(RFQ.id == rfq.id).one()
    return rfq, _get_pr_for_rfq(db, rfq)


def _quote_out(vq: VendorQuotation) -> LineQuotationResponse:
    return LineQuotationResponse.model_validate(vq)


def _quote_gate(db: Session, rfq: RFQ, pr: P2PRequest, user: User, what: str) -> None:
    """Who may quote and when: the RFQ's own buyer (or the Purchase head), on a submitted RFQ of a
    requisition that is still being bought. The requisition's header status is not a gate."""
    ensure_rfq_owner(db, rfq, user, what)
    if rfq.status != "locked":
        raise HTTPException(status_code=409, detail=(
            f"RFQ {rfq.rfq_number} is still a draft. Quotes are recorded after the RFQ is submitted - submit it first."))
    if not po_split.is_procurement_open(pr):
        raise HTTPException(status_code=409, detail=(
            f"{pr.p2p_number} is {pr.status.replace('_', ' ')} - it is not being bought any more, so quotes can't be changed on RFQ {rfq.rfq_number}."))


def _release_quote_lines(db: Session, vq: VendorQuotation, rows: list[VendorQuotationItem]) -> None:
    """Quote lines about to be deleted: a live PO line on one blocks (409, name the PO); PO lines of
    cancelled POs (rejected / discarded) stop pointing at it so the database lets it go."""
    ids = [r.id for r in rows if r.id]
    if not ids:
        return
    live = (db.query(P2PPurchaseOrder.po_number).join(P2PPurchaseOrderItem, P2PPurchaseOrderItem.purchase_order_id == P2PPurchaseOrder.id)
            .filter(P2PPurchaseOrderItem.vendor_quotation_item_id.in_(ids), P2PPurchaseOrder.status != "cancelled").first())
    if live is not None:
        raise HTTPException(status_code=409, detail=(
            f"{vq.vendor_name}'s quote is already on PO {live[0]} - cancel or discard that PO before taking its line off the quote."))
    dead = (db.query(P2PPurchaseOrderItem).join(P2PPurchaseOrder, P2PPurchaseOrder.id == P2PPurchaseOrderItem.purchase_order_id)
            .filter(P2PPurchaseOrderItem.vendor_quotation_item_id.in_(ids), P2PPurchaseOrder.status == "cancelled").all())
    for line in dead:
        line.vendor_quotation_item_id = None
    db.flush()


def _apply_quote(db: Session, rfq: RFQ, pr: P2PRequest, vq: VendorQuotation, payload: LineQuotationCreate) -> None:
    vendor = db.get(Vendor, payload.vendor_id)
    if vendor is None:
        raise HTTPException(status_code=422, detail="Pick the vendor from the vendor master (Procurement › Vendors) — add it there first if it's new.")
    if vendor.status != "active":
        raise HTTPException(status_code=409, detail=f"{vendor.name} is {vendor.status} in the vendor master, so its quote can't be recorded. "
                                                    "Ask Finance / Procurement to reactivate it first.")
    dup = next((q for q in rfq.vendor_quotations if q.vendor_id == vendor.id and q.id != vq.id), None)
    if dup is not None:
        raise HTTPException(status_code=409, detail=f"{vendor.name} already has a quote on {rfq.rfq_number} — edit that one instead of adding another.")
    if not payload.items:
        raise HTTPException(status_code=422, detail="Enter a price for at least one requisition line the vendor quoted.")
    buy = po_split.buy_qty_by_pr_item(pr)
    lines = {i.id: i for i in pr.items}
    on_rfq = {i.pr_item_id: i for i in active_items(rfq)}
    seen = set()
    ask: dict[int, float] = {}
    for qi in payload.items:
        if qi.pr_item_id not in lines:
            raise HTTPException(status_code=422, detail=f"PR line #{qi.pr_item_id} is not on {pr.p2p_number} — reload the page.")
        name = lines[qi.pr_item_id].item_name
        if qi.pr_item_id not in on_rfq:
            raise HTTPException(status_code=422, detail=f"'{name}' is not on RFQ {rfq.rfq_number} — quote only the lines this RFQ asked for.")
        if qi.pr_item_id not in buy:
            raise HTTPException(status_code=409, detail=f"'{name}' has nothing left to buy (issued from store stock or short-closed) — it can't be quoted.")
        if qi.pr_item_id in seen:
            raise HTTPException(status_code=422, detail=f"'{name}' is priced twice — keep one row per line.")
        seen.add(qi.pr_item_id)
        # The RFQ asks for this much (never more than is still to buy); a vendor may offer less, never more.
        ceiling = min(on_rfq[qi.pr_item_id].quantity or buy[qi.pr_item_id], buy[qi.pr_item_id])
        qty = qi.quantity if qi.quantity is not None else ceiling
        if qty - ceiling > _EPS:
            raise HTTPException(status_code=422, detail=(
                f"'{name}': {vendor.name} can't quote {qty:g} {lines[qi.pr_item_id].unit or ''} — RFQ {rfq.rfq_number} asks for {ceiling:g}. "
                "Enter that quantity or less (a vendor that can supply less is fine; split the rest to another vendor)."))
        ask[qi.pr_item_id] = qty
    vq.vendor_id = vendor.id
    vq.vendor_name = vendor.name
    for f in ("quote_ref", "valid_until", "freight_total", "packing_total", "delivery_time", "payment_terms", "remarks"):
        setattr(vq, f, getattr(payload, f))
    # A re-recorded quote updates its lines IN PLACE (matched by requisition line): PO lines of cancelled /
    # rejected POs still point at their quote line, so a line is only deleted when it is no longer quoted -
    # and then the dead PO lines let go of it first. Awards stay on lines that are still quoted (capped at the
    # new quantity).
    existing = {qi.pr_item_id: qi for qi in vq.items}
    dropped = [row for pid, row in existing.items() if pid not in ask]
    if dropped:
        _release_quote_lines(db, vq, dropped)
        for row in dropped:
            vq.items.remove(row)
        db.flush()
    total = 0.0
    for qi in payload.items:
        line = lines[qi.pr_item_id]
        row = existing.get(line.id)
        if row is None:
            row = VendorQuotationItem(pr_item_id=line.id, store_item_id=line.store_item_id)
            vq.items.append(row)
        row.store_item_id = line.store_item_id
        row.quantity = ask[line.id]
        row.unit_price = qi.unit_price
        row.discount_pct = qi.discount_pct
        row.gst_rate = qi.gst_rate
        row.delivery_days = qi.delivery_days
        row.make_offered = (qi.make_offered or "").strip() or None
        row.remarks = (qi.remarks or "").strip() or None
        if (row.awarded_qty or 0) > 0:
            row.awarded_qty = min(row.awarded_qty, ask[line.id])
            row.is_awarded = row.awarded_qty > 0
            if not row.is_awarded:
                row.award_reason, row.awarded_by_id, row.awarded_at = None, None, None
        total += qi.unit_price * (1 - (qi.discount_pct or 0) / 100) * ask[line.id]
    vq.quoted_price = round(total + (payload.freight_total or 0) + (payload.packing_total or 0), 2)


@router.get("/{rfq_id}/line-quotations", response_model=list[LineQuotationResponse])
def list_line_quotations(rfq_id: int, db: Session = Depends(get_db), user: User = Depends(_purchase_tab("rfq", "view"))):
    ensure_feature_action(user, "p2p", "rfq", "vendor_quotes", "view")
    rfq, pr = _rfq_pr(db, rfq_id, user)
    ensure_rfq_readable(db, rfq, user, pr)
    return mask_for(user, "rfq", [_quote_out(vq) for vq in rfq.vendor_quotations])


@router.post("/{rfq_id}/line-quotations", response_model=LineQuotationResponse)
def add_line_quotation(rfq_id: int, payload: LineQuotationCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                       user: User = Depends(_purchase_tab("rfq", "edit"))):
    ensure_feature_action(user, "p2p", "rfq", "vendor_quotes", "create")
    rfq, pr = _rfq_pr(db, rfq_id, user)
    ensure_rfq_owner(db, rfq, user, "record quotes on")
    pr = po_split.lock_pr(db, pr.id)   # quotes are checked against the quantities left to buy: one change at a time
    rfq = _reload_rfq(db, rfq.id)
    _quote_gate(db, rfq, pr, user, "record quotes on")
    vq = VendorQuotation(rfq_id=rfq.id, p2p_request_id=pr.id, vendor_name="", created_by_id=user.id, submitted_at=date.today())
    db.add(vq)
    rfq.vendor_quotations.append(vq)
    _apply_quote(db, rfq, pr, vq, payload)
    _write_pr_audit(db, pr.id, "line_quotation_added", user,
                    summary=f"{user.name or user.email} recorded {vq.vendor_name}'s quote on {rfq.rfq_number}: "
                            f"{len(vq.items)} line(s), {vq.quoted_price:,.2f} before GST.")
    from app.modules.p2p import notify as p2p_notify
    p2p_notify.vendor_quote_received(db, background_tasks, rfq, pr, user, vq.vendor_name)
    db.commit()
    db.refresh(vq)
    return _quote_out(vq)


@router.put("/{rfq_id}/line-quotations/{vq_id}", response_model=LineQuotationResponse)
def replace_line_quotation(rfq_id: int, vq_id: int, payload: LineQuotationCreate, db: Session = Depends(get_db),
                           user: User = Depends(_purchase_tab("rfq", "edit"))):
    ensure_feature_action(user, "p2p", "rfq", "vendor_quotes", "edit")
    rfq, pr = _rfq_pr(db, rfq_id, user)
    ensure_rfq_owner(db, rfq, user, "change quotes on")
    pr = po_split.lock_pr(db, pr.id)   # one change at a time on this requisition
    rfq = _reload_rfq(db, rfq.id)
    vq = next((q for q in rfq.vendor_quotations if q.id == vq_id), None)
    if vq is None:
        raise HTTPException(status_code=404, detail="Quotation not found on this RFQ — refresh the page.")
    _quote_gate(db, rfq, pr, user, "change quotes on")
    used = db.query(P2PPurchaseOrderItem.id).join(P2PPurchaseOrder).filter(
        P2PPurchaseOrderItem.vendor_quotation_item_id.in_([qi.id for qi in vq.items]), P2PPurchaseOrder.status != "cancelled").first()
    if used:
        raise HTTPException(status_code=409, detail=f"{vq.vendor_name}'s quote is already on a PO — cancel that PO before changing the quote.")
    _apply_quote(db, rfq, pr, vq, payload)
    _write_pr_audit(db, pr.id, "line_quotation_updated", user,
                    summary=f"{user.name or user.email} updated {vq.vendor_name}'s quote on {rfq.rfq_number} ({vq.quoted_price:,.2f}).")
    db.commit()
    db.refresh(vq)
    return _quote_out(vq)


@router.get("/{rfq_id}/comparison")
def quotation_comparison(rfq_id: int, db: Session = Depends(get_db), user: User = Depends(_purchase_tab("rfq", "view"))):
    ensure_feature_action(user, "p2p", "rfq", "comparison", "view")
    rfq, pr = _rfq_pr(db, rfq_id, user)
    ensure_rfq_readable(db, rfq, user, pr)
    return mask_for(user, "rfq", quotation_compare.comparison(db, rfq, pr))


@router.get("/{rfq_id}/comparison/export")
def export_comparison(rfq_id: int, db: Session = Depends(get_db), user: User = Depends(_purchase_tab("rfq", "export"))):
    ensure_feature_action(user, "p2p", "rfq", "comparison", "export")
    if not sees_prices(user, "rfq"):
        raise HTTPException(status_code=403, detail=(
            "The comparison export is a sheet of quoted rates, and your role doesn't show prices on R.F.Q "
            f"(p2p:rfq.prices:view). {GRANT_HINT}"))
    from app.modules.erp.importing import xlsx_response

    rfq, pr = _rfq_pr(db, rfq_id, user)
    ensure_rfq_readable(db, rfq, user, pr)
    data = quotation_compare.comparison(db, rfq, pr)
    headers = ["Item code", "Item", "Qty", "Unit", "Last PO rate"]
    for v in data["vendors"]:
        headers += [f"{v['vendor_name']} — rate", f"{v['vendor_name']} — landed unit", f"{v['vendor_name']} — GST %",
                    f"{v['vendor_name']} — days", f"{v['vendor_name']} — rank"]
    headers += ["L1 vendor", "Awarded to"]
    names = {v["vendor_quotation_id"]: v["vendor_name"] for v in data["vendors"]}
    rows = []
    for r in data["lines"]:
        row = [r["item_code"] or "", r["item_name"], r["quantity"], r["unit"] or "", (r["last_po"] or {}).get("unit_price") or ""]
        for c in r["quotes"]:
            row += ([c["unit_price"], c["landed_unit"], c["gst_rate"] or 0, c["delivery_days"] or "", c["rank"] or "—"]
                    if c else ["", "", "", "", "not quoted"])
        row += [names.get(r["l1_vendor_quotation_id"], ""), names.get(r["awarded_vendor_quotation_id"], "")]
        rows.append(row)
    rows.append([])
    rows.append(["Total landed (excl. GST)", "", "", "", ""] + sum(
        ([v["landed_total"], "", "", "", v["overall_rank"] or ("incomplete" if not v["complete"] else v["ineligible_reason"] or "")]
         for v in data["vendors"]), []))
    return xlsx_response("Comparison", headers, rows, f"{rfq.rfq_number}_comparison.xlsx")


def _po_numbers_for_quote_line(db: Session, qi_id: int) -> str:
    rows = (db.query(P2PPurchaseOrder.po_number).join(P2PPurchaseOrderItem, P2PPurchaseOrderItem.purchase_order_id == P2PPurchaseOrder.id)
            .filter(P2PPurchaseOrderItem.vendor_quotation_item_id == qi_id, P2PPurchaseOrder.status != "cancelled")
            .order_by(P2PPurchaseOrder.id).all())
    return ", ".join(sorted({n for (n,) in rows})) or "a PO"


@router.post("/{rfq_id}/awards")
def award_lines(rfq_id: int, payload: QuotationAwardPayload, db: Session = Depends(get_db),
                user: User = Depends(_purchase_tab("rfq", "edit"))):
    """ME49 selection, per line, BY QUANTITY: the buyer says how much of each line goes to which vendor
    (a split across vendors is normal). quantity null = the whole remaining quantity of the line to that
    vendor (the line's other awards on this RFQ are cleared); more than 0 = a split award for that
    quantity; 0 = take that vendor's award back. Rules, under the requisition lock:
      - the awards of a line add up to at most what is still to order (plus what its awards already put
        on POs); no award is above what the vendor quoted or below what is already on a PO;
      - a vendor that is not the line's L1 needs a written reason (5+ characters)."""
    from app.modules.p2p.quotation_compare import awarded_qty_of

    ensure_feature_action(user, "p2p", "rfq", "award", "edit")
    first = _get_rfq_or_404(db, rfq_id, user)
    ensure_rfq_owner(db, first, user, "award lines on")
    pr = po_split.lock_pr(db, first.p2p_request_id)   # one award / upload at a time on this requisition
    rfq = _reload_rfq(db, first.id)
    if rfq.status != "locked":
        raise HTTPException(status_code=409, detail=f"RFQ {rfq.rfq_number} is still a draft - submit it and record the quotes before awarding.")
    if not po_split.is_procurement_open(pr):
        raise HTTPException(status_code=409, detail=f"{pr.p2p_number} is {pr.status.replace('_', ' ')} - lines can't be awarded now.")
    data = quotation_compare.comparison(db, rfq, pr)
    rows = {r["pr_item_id"]: r for r in data["lines"]}
    pr_lines = {i.id: i for i in pr.items}
    quote_items = {qi.id: (qi, vq) for vq in rfq.vendor_quotations for qi in vq.items}
    progress = line_progress(db, pr)
    on_po = _live_po_qty_by_quote_line(db, list(quote_items))

    by_line: dict[int, list] = {}
    for aw in payload.awards:
        by_line.setdefault(aw.pr_item_id, []).append(aw)

    plan: dict[int, dict[int, float]] = {}      # pr_item_id -> {quote line id -> new awarded qty}
    reasons: dict[int, str | None] = {}         # quote line id -> reason to store
    notes: list[str] = []
    cleared: list[str] = []
    for pid, awards in by_line.items():
        row = rows.get(pid)
        if row is None:
            nm = pr_lines[pid].item_name if pid in pr_lines else f"line #{pid}"
            raise HTTPException(status_code=422, detail=f"'{nm}' is not on RFQ {rfq.rfq_number} — award only the lines this RFQ asked quotes for. Reload the comparison.")
        name = row["item_name"]
        line_qis = [qi for qi, _vq in quote_items.values() if qi.pr_item_id == pid]
        cur = {qi.id: awarded_qty_of(qi) for qi in line_qis}
        floor = {qi.id: on_po.get(qi.id, 0.0) for qi in line_qis}
        lp = progress.get(pid)
        # What can be awarded on the line: what is still to order, plus what its awards already put on POs.
        budget = round((lp.open_to_order if lp is not None else 0.0) + sum(floor.values()), 6)
        new = dict(cur)
        for aw in awards:
            hit = quote_items.get(aw.vendor_quotation_item_id)
            if hit is None or hit[0].pr_item_id != pid:
                raise HTTPException(status_code=422, detail=f"That quote line doesn't belong to PR line #{pid} on {rfq.rfq_number} — reload the comparison.")
            qi, vq = hit
            if aw.quantity is not None and aw.quantity <= _EPS:
                if floor[qi.id] > _EPS:
                    raise HTTPException(status_code=409, detail=(
                        f"'{name}': {floor[qi.id]:g} of {vq.vendor_name}'s award is already on PO {_po_numbers_for_quote_line(db, qi.id)}. "
                        "Cancel or amend that PO first."))
                if new[qi.id] > _EPS:
                    cleared.append(f"'{name}': {vq.vendor_name}'s award of {new[qi.id]:g} withdrawn")
                new[qi.id] = 0.0
                continue
            if budget <= _EPS:
                raise HTTPException(status_code=409, detail=f"'{name}' has nothing left to order — it is already on POs or short-closed. Cancel a PO to award it again.")
            cell = next((c for c in row["quotes"] if c and c["vendor_quotation_item_id"] == qi.id), None)
            if cell is None or not cell["eligible"]:
                why = next((v["ineligible_reason"] for v in data["vendors"] if v["vendor_quotation_id"] == vq.id), None)
                raise HTTPException(status_code=409, detail=f"{vq.vendor_name}'s quote can't be awarded: {why or 'not eligible'}.")
            quoted = qi.quantity if qi.quantity is not None else row["quantity"]
            if aw.quantity is None:
                # The whole remaining quantity to this vendor: the line's other awards go (down to what is on POs).
                for k in new:
                    if k != qi.id:
                        new[k] = floor[k]
                target = min(quoted, budget - sum(floor[k] for k in new if k != qi.id))
                if target <= _EPS:
                    raise HTTPException(status_code=409, detail=(
                        f"'{name}': the quantity already on POs from other vendors leaves nothing to award to {vq.vendor_name}. "
                        "Cancel or amend those POs first."))
            else:
                target = aw.quantity
            if target - quoted > _EPS:
                raise HTTPException(status_code=409, detail=(
                    f"'{name}': {vq.vendor_name} quoted {quoted:g} {row['unit'] or ''} — an award of {target:g} is more than that. "
                    f"Award {quoted:g} or less to {vq.vendor_name} and give the rest to another vendor."))
            if target < floor[qi.id] - _EPS:
                raise HTTPException(status_code=409, detail=(
                    f"'{name}': {floor[qi.id]:g} of {vq.vendor_name}'s award is already on PO {_po_numbers_for_quote_line(db, qi.id)}. "
                    "Cancel or amend that PO first."))
            reason = (aw.reason or "").strip() or (qi.award_reason or "").strip()
            is_l1 = row["l1_vendor_quotation_item_id"] == qi.id
            if not is_l1 and len(reason) < 5:
                l1_name = next((v["vendor_name"] for v in data["vendors"] if v["vendor_quotation_id"] == row["l1_vendor_quotation_id"]), "the L1 vendor")
                raise HTTPException(status_code=422, detail=(
                    f"'{name}': {vq.vendor_name} is {cell['rank']}, not L1 ({l1_name} is lower) — write why it gets this line "
                    "(e.g. L1 can't deliver by the required date)."))
            new[qi.id] = target
            reasons[qi.id] = reason or None
            notes.append(f"'{name}' → {vq.vendor_name} {target:g} {row['unit'] or ''} ({cell['rank']})".replace("  ", " ")
                         + (f" — {reason}" if not is_l1 else ""))
        total = round(sum(new.values()), 6)
        if total - budget > _EPS:
            raise HTTPException(status_code=409, detail=(
                f"'{name}': awarded {total:g} {row['unit'] or ''} is more than the {budget:g} still to buy. "
                f"Reduce an award by {round(total - budget, 6):g}.".replace("  ", " ")))
        plan[pid] = new

    # Everything checked: write it.
    now = datetime.now(timezone.utc)
    for pid, new in plan.items():
        for qi in (q for q, _v in quote_items.values() if q.pr_item_id == pid):
            q = new.get(qi.id, 0.0)
            if abs(q - awarded_qty_of(qi)) <= _EPS and qi.id not in reasons:
                continue
            qi.awarded_qty = q
            qi.is_awarded = q > _EPS
            if q > _EPS:
                if qi.id in reasons:
                    qi.award_reason = reasons[qi.id]
                qi.awarded_by_id, qi.awarded_at = user.id, now
            else:
                qi.award_reason, qi.awarded_by_id, qi.awarded_at = None, None, None
    if notes:
        _write_pr_audit(db, pr.id, "lines_awarded", user, summary=f"{user.name or user.email} awarded on {rfq.rfq_number}: " + "; ".join(notes))
    if cleared:
        _write_pr_audit(db, pr.id, "award_cleared", user, summary=f"{user.name or user.email} on {rfq.rfq_number}: " + "; ".join(cleared))
    db.commit()
    return mask_for(user, "rfq", quotation_compare.comparison(db, rfq, pr))


@router.get("/{rfq_id}/split-proposal")
def split_proposal(rfq_id: int, db: Session = Depends(get_db), user: User = Depends(_purchase_tab("purchase_orders", "view"))):
    """One proposed PO per vendor from the awarded quote lines (each at the quantity awarded and not yet on
    a PO), plus this RFQ's lines still to order that have no award."""
    from app.modules.p2p.quotation_compare import awarded_qty_of

    rfq, pr = _rfq_pr(db, rfq_id, user)
    ensure_rfq_readable(db, rfq, user, pr)
    left = po_split.open_qty_by_pr_item(db, pr)
    lines = {i.id: i for i in pr.items}
    active = {i.pr_item_id for i in active_items(rfq)}
    on_po = _live_po_qty_by_quote_line(db, [qi.id for vq in rfq.vendor_quotations for qi in vq.items])
    groups: dict[int, dict] = {}
    awarded: dict[int, float] = {}
    for vq in rfq.vendor_quotations:
        for qi in vq.items:
            if qi.pr_item_id not in active or qi.pr_item_id not in left:
                continue
            remaining = round(awarded_qty_of(qi) - on_po.get(qi.id, 0.0), 6)
            if remaining <= _EPS:
                continue
            qty = min(remaining, left[qi.pr_item_id])
            awarded[qi.pr_item_id] = awarded.get(qi.pr_item_id, 0.0) + qty
            g = groups.setdefault(vq.id, {"vendor_id": vq.vendor_id, "vendor_name": vq.vendor_name, "vendor_quotation_id": vq.id,
                                          "delivery_terms": vq.payment_terms, "lines": []})
            line = lines[qi.pr_item_id]
            net = round(qi.unit_price * (1 - (qi.discount_pct or 0) / 100), 4)
            g["lines"].append({
                "pr_item_id": line.id, "item_code": line.item_code, "item_name": line.item_name, "unit": line.unit,
                "quantity": qty, "vendor_quotation_item_id": qi.id, "unit_price": net, "tax_rate": qi.gst_rate,
                "delivery_days": qi.delivery_days, "ship_to": line.ship_to,
                "delivery_date": (date.today() + timedelta(days=qi.delivery_days)).isoformat() if qi.delivery_days is not None else
                                 (pr.required_date.isoformat() if pr.required_date else None),
            })
    unawarded = [{"pr_item_id": pid, "item_code": lines[pid].item_code, "item_name": lines[pid].item_name, "unit": lines[pid].unit,
                  "quantity": round(qty - awarded.get(pid, 0.0), 6)} for pid, qty in left.items()
                 if pid in active and qty - awarded.get(pid, 0.0) > _EPS]
    pos = [{"id": p.id, "po_number": p.po_number, "vendor_name": p.vendor_name, "status": p.status, "total_value": p.total_value}
           for p in po_split.live_pos(db, pr.id) if p.rfq_id in (None, rfq.id)]
    return {"rfq_id": rfq.id, "p2p_request_id": pr.id, "p2p_number": pr.p2p_number, "groups": list(groups.values()),
            "unawarded": unawarded, "existing_pos": pos}


def _check_location(db: Session, loc_id: int | None, label: str) -> None:
    if loc_id and db.get(StoreLocation, loc_id) is None:
        raise HTTPException(status_code=422, detail=f"{label}: that store / ship-to location doesn't exist — pick it again.")


def _receiving_from_pr(db: Session, lines) -> tuple[int | None, int | None]:
    """Plant + store a PO receives at, taken from the requisition: its lines'
    Ship To names a plant as "Name (CODE)" (the PR form's plant pick). When all
    the lines name one plant, that plant and its first active store are used,
    so Create PO needs no Receiving question. A typed address or mixed plants
    give (None, None) and the buyer sets them on the draft."""
    targets = {(ln.ship_to or "").strip() for ln in lines} - {""}
    if len(targets) != 1:
        return None, None
    target = targets.pop()
    branch = next((b for b in db.query(Branch).all() if f"{b.name} ({b.code})" == target), None)
    if branch is None:
        return None, None
    store = (db.query(StoreLocation)
             .filter(StoreLocation.branch_id == branch.id, StoreLocation.is_active == True)  # noqa: E712
             .order_by(StoreLocation.name).first())
    return branch.id, store.id if store else None


@router.patch("/{rfq_id}/po-draft/{po_id}/details", response_model=P2PPurchaseOrderResponse)
def update_po_draft_details(rfq_id: int, po_id: int, payload: PODraftDetailsPayload, db: Session = Depends(get_db),
                            user: User = Depends(_purchase_tab("purchase_orders", "edit"))):
    rfq, pr = _rfq_pr(db, rfq_id, user)
    ensure_rfq_owner(db, rfq, user, "edit the PO draft of")
    po = _po_of_rfq(db, rfq, pr, po_id, with_items=True, user=user)
    if po is None:
        raise HTTPException(status_code=404, detail="Draft PO not found — refresh the page.")
    if po.status != "draft":
        raise HTTPException(status_code=409, detail=f"PO {po.po_number} has been sent for approval — change it with an amendment instead.")
    if "plant_branch_id" in payload.model_fields_set:
        if payload.plant_branch_id and db.get(Branch, payload.plant_branch_id) is None:
            raise HTTPException(status_code=422, detail="That plant doesn't exist — pick the receiving plant again.")
        po.plant_branch_id = payload.plant_branch_id
    if "ship_to_location_id" in payload.model_fields_set:
        _check_location(db, payload.ship_to_location_id, "Ship-to")
        po.ship_to_location_id = payload.ship_to_location_id
    items = {i.id: i for i in po.items}
    for ln in payload.lines:
        line = items.get(ln.id)
        if line is None:
            raise HTTPException(status_code=422, detail=f"Line #{ln.id} isn't on PO {po.po_number} — reload the page.")
        if "delivery_date" in ln.model_fields_set:
            line.delivery_date = ln.delivery_date
        if "ship_to_location_id" in ln.model_fields_set:
            _check_location(db, ln.ship_to_location_id, f"'{line.item_name}'")
            line.ship_to_location_id = ln.ship_to_location_id
    po.revision = (po.revision or 0) + 1
    db.commit()
    db.refresh(po)
    resp = P2PPurchaseOrderResponse.model_validate(po)
    resp.p2p_request_number = pr.p2p_number
    return resp
