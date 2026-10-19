"""Sales orders: CRUD for drafts, the approval chain, confirmation, hold /
cancel / short-close / close, the order acknowledgement and the timeline.
Every status change is an action endpoint — there is no generic status PATCH."""
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import ensure_can_delete, ensure_feature_action, require_app_access, require_any_app_access, require_feature_action, require_tab_access, require_tab_action
from app.core.permission_registry import can_perform
from app.db.session import get_db
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.main.services import managed_documents
from app.modules.sales import service as svc
from app.modules.sales import approvals as sap
from app.modules.sales.access import ensure_order, scoped_orders
from app.modules.sales.models.order import (
    SalesOrder, SalesOrderSchedule, SALES_SOURCE_TYPES, SALES_ORDER_OPEN_STATUSES, SALES_ORDER_LIVE_STATUSES,
)
from app.modules.sales.models.approval import SalesApproval
from app.modules.sales.models.amendment import SalesOrderAmendment, SALES_AMENDMENT_OPEN_STATUSES
from app.modules.sales.reports.order_ack import OA_ENTITY, oa_spec, oa_document_target
from app.modules.sales.schemas.order import (
    SalesOrderCreate, SalesOrderUpdate, SalesOrderResponse, SalesOrderReasonPayload, SalesOrderApprovePayload,
    SalesOrderLinePayload, SalesOrderSchedulePayload, SalesBillingPlanPayload,
)
from app.modules.sales.views import sales_errors, get_order, require_status, order_response

router = APIRouter(prefix="/sales/orders", tags=["Sales"])
_SALES = Depends(require_app_access("sales"))


def _reason(payload: SalesOrderReasonPayload, what: str) -> str:
    text = (payload.reason or "").strip()
    if not text:
        raise HTTPException(status_code=422, detail=f"Give a reason for {what} — it's kept on the order's timeline.")
    return text


def _require_head(db: Session, user: User, action: str) -> None:
    if not svc.is_sales_head(db, user) or not can_perform(user, "sales", "orders", "approve"):
        names = ", ".join(u.name or u.email for u in svc.level_holders(db, "sales_head")) or "not set — see Sales › Settings"
        raise HTTPException(status_code=403, detail=f"Only the Sales Head ({names}) can {action}.")


def _ok(db: Session, so_id: int, user: User) -> SalesOrderResponse:
    db.commit()
    return order_response(db, get_order(db, so_id), user)


def _scoped(db: Session, so_id: int, user: User) -> SalesOrder:
    """Load the order (404) and check it's in the user's data scope (403)."""
    so = get_order(db, so_id)
    ensure_order(db, user, so)
    return so


def _locked_order(db: Session, so_id: int, user: User) -> SalesOrder:
    """Row-locks the order (SELECT … FOR UPDATE) before loading it, so two people
    deciding at the same moment are serialised: the second one waits, then
    re-checks the status / pending level the first one left behind."""
    db.query(SalesOrder.id).filter(SalesOrder.id == so_id).with_for_update().first()
    return _scoped(db, so_id, user)


def _decision_order(db: Session, so_id: int, user: User) -> SalesOrder:
    """Approve / return / reject. Engine-routed orders: approvers are in scope
    through their approval step. Orders still on the old chain (submitted before
    the move) are authorised by the level checks alone, so a narrowed data scope
    can't strand them."""
    from app.modules.organization.services import approval_engine as engine
    if engine.latest_request(db, sap.ORDER_ENTITY, so_id) is not None:
        return _locked_order(db, so_id, user)
    db.query(SalesOrder.id).filter(SalesOrder.id == so_id).with_for_update().first()
    return get_order(db, so_id)


# Moved to the service so the approval engine's on_decided (a rejection) uses it too.
_close_followups = svc.close_followups


# ---------------------------------------------------------------- reads

@router.get("", response_model=list[SalesOrderResponse])
async def list_orders(
    status_filter: str | None = Query(None, alias="status"),
    customer_id: int | None = None,
    open_only: bool = False,
    pending_my_approval: bool = False,
    at_risk: bool = False,
    month: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    _app: User = _SALES,
    user: User = Depends(require_tab_access("sales", "orders")),
):
    q = db.query(SalesOrder).options(
        selectinload(SalesOrder.lines), selectinload(SalesOrder.schedules), selectinload(SalesOrder.billing_lines),
    ).filter(SalesOrder.is_deleted == False)  # noqa: E712
    q = scoped_orders(q, user)
    if status_filter:
        q = q.filter(SalesOrder.status == status_filter)
    if open_only:
        q = q.filter(SalesOrder.status.in_(("draft", "pending_approval", *SALES_ORDER_OPEN_STATUSES)))
    if pending_my_approval:
        q = q.filter(SalesOrder.status == "pending_approval")
    if customer_id:
        q = q.filter(SalesOrder.customer_id == customer_id)
    if month:
        try:
            year, mon = (int(p) for p in month.split("-"))
            if not 1 <= mon <= 12 or not 1 <= year <= 9998:
                raise ValueError(month)
        except ValueError:
            raise HTTPException(status_code=422, detail=f"'{month}' is not a month — use YYYY-MM, e.g. 2026-10.")
        q = q.filter(SalesOrder.schedules.any(
            (SalesOrderSchedule.current_delivery_date >= datetime(year, mon, 1).date())
            & (SalesOrderSchedule.current_delivery_date < (datetime(year + (mon == 12), mon % 12 + 1, 1).date()))
        ))
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(or_(SalesOrder.so_number.ilike(like), SalesOrder.customer_po_number.ilike(like),
                         SalesOrder.customer_name.ilike(like), SalesOrder.loa_number.ilike(like)))
    orders = q.order_by(SalesOrder.created_at.desc(), SalesOrder.id.desc()).all()
    out = [order_response(db, so, user, light=True) for so in orders]
    if pending_my_approval:
        out = [o for o in out if (sap.can_decide(db, user, sap.ORDER_ENTITY, o.id) if o.approval_via_engine else
                                  (o.next_approval_level and o.submitted_by_id != user.id
                                   and (svc.holds_level(db, user, o.next_approval_level) or user.role == "admin")))]
    if at_risk:
        out = [o for o in out if o.units_at_risk or o.units_overdue]
    return out


# A sales order is raised only once the customer's order is in: an inquiry at
# stage "Order Received", a tender with status "LOA / Order Received". The CRM
# "Create Sales Order" button follows the same rule (SalesOrderHandoff.tsx).
INQUIRY_ORDER_STAGE = "Order Received"
INQUIRY_NOT_ORDERED_STATUS = "Closed - Not Ordered"
TENDER_ORDER_STATUSES = ("LOA / Order Received", "Closed – Ordered")


def _check_source_ordered(db: Session, inquiry_id: int | None, tender_id: int | None) -> None:
    from app.modules.crm.models.inquiry import Inquiry
    from app.modules.crm.models.tender import Tender
    if inquiry_id:
        inq = db.query(Inquiry).filter(Inquiry.id == inquiry_id, Inquiry.is_deleted == False).first()  # noqa: E712
        if not inq:
            raise HTTPException(status_code=404, detail=f"Inquiry #{inquiry_id} not found in CRM.")
        if inq.current_stage != INQUIRY_ORDER_STAGE or inq.status == INQUIRY_NOT_ORDERED_STATUS:
            raise HTTPException(status_code=422, detail=(
                f"Inquiry {inq.universal_id} is at stage '{inq.current_stage}' (status '{inq.status}'). A sales order can only be "
                f"raised once the customer's order is in — move the inquiry to stage '{INQUIRY_ORDER_STAGE}' in CRM first."))
    elif tender_id:
        t = db.query(Tender).filter(Tender.id == tender_id, Tender.is_deleted == False).first()  # noqa: E712
        if not t:
            raise HTTPException(status_code=404, detail=f"Tender #{tender_id} not found in CRM.")
        if t.status not in TENDER_ORDER_STATUSES:
            raise HTTPException(status_code=422, detail=(
                f"Tender {t.tender_number or t.universal_id} has status '{t.status}'. A sales order can only be raised once the "
                f"LOA / order is received — set the tender status to '{TENDER_ORDER_STATUSES[0]}' in CRM first."))


# Quotations an order can be raised against: approved and with (or accepted by) the customer.
ORDERABLE_QUOTATION_STATUSES = ("accepted", "sent", "approved")


@router.get("/quotations")
async def customer_quotations(customer_id: int, db: Session = Depends(get_db), _app: User = _SALES,
                              _user: User = Depends(require_tab_action("sales", "orders", "create"))):
    """The customer's quotations a new order can be copied from (New Sales Order › Quotation)."""
    from app.modules.crm.models.inquiry import Inquiry, Quotation
    from app.modules.crm.services.quotation_status import STATUS_LABEL, quotation_amounts
    rows = (db.query(Quotation).join(Inquiry, Inquiry.id == Quotation.inquiry_id)
            .options(selectinload(Quotation.items), selectinload(Quotation.inquiry))
            .filter(Inquiry.org_id == customer_id, Inquiry.is_deleted == False,  # noqa: E712
                    Quotation.status.in_(ORDERABLE_QUOTATION_STATUSES))
            .order_by(Quotation.quote_date.desc().nullslast(), Quotation.id.desc()).all())
    out = []
    for q in rows:
        inq = q.inquiry
        so = svc.live_order_for_source(db, inq.id, None)
        out.append({"id": q.id, "quot_number": q.quot_number, "status": q.status, "status_label": STATUS_LABEL.get(q.status, q.status),
                    "quote_date": q.quote_date.isoformat() if q.quote_date else None, "net_value": quotation_amounts(q)["net"],
                    "inquiry_id": inq.id, "inquiry_number": inq.universal_id, "inquiry_stage": inq.current_stage,
                    "order_received": inq.current_stage == INQUIRY_ORDER_STAGE and inq.status != INQUIRY_NOT_ORDERED_STATUS,
                    "existing_order": so.display_number if so else None})
    return out


@router.get("/prefill")
async def prefill(inquiry: int | None = None, tender: int | None = None, quotation: int | None = None, db: Session = Depends(get_db),
                  _app: User = _SALES, _user: User = Depends(require_tab_action("sales", "orders", "create"))):
    """A draft payload built from a won CRM inquiry (its accepted quotation), a quotation
    picked on the form (its inquiry is the source), or an awarded tender."""
    from app.modules.crm.models.inquiry import Inquiry, Quotation, QuotationLineItem, InquiryLineItem
    from app.modules.crm.models.tender import Tender
    from app.modules.crm.models.organization import Organization
    picked = None
    if quotation:
        picked = db.query(Quotation).filter(Quotation.id == quotation).first()
        if not picked:
            raise HTTPException(status_code=404, detail=f"Quotation #{quotation} not found in CRM — pick the quotation again.")
        if picked.status not in ORDERABLE_QUOTATION_STATUSES:
            raise HTTPException(status_code=422, detail=(
                f"Quotation {picked.quot_number} is {picked.status} — an order can only be copied from a quotation that is approved, "
                f"sent or accepted. Finish its approval in CRM, or pick another quotation."))
        inquiry, tender = picked.inquiry_id, None
    if bool(inquiry) == bool(tender):
        raise HTTPException(status_code=422, detail="Pass either ?inquiry=<id>, ?tender=<id> or ?quotation=<id>.")
    existing = svc.live_order_for_source(db, inquiry, tender)
    if not existing:
        _check_source_ordered(db, inquiry, tender)
    defaults = _term_defaults(db)
    if inquiry:
        inq = db.query(Inquiry).filter(Inquiry.id == inquiry, Inquiry.is_deleted == False).first()  # noqa: E712
        if not inq:
            raise HTTPException(status_code=404, detail=f"Inquiry #{inquiry} not found in CRM.")
        quots = db.query(Quotation).filter(Quotation.inquiry_id == inq.id).order_by(Quotation.id.desc()).all()
        # Document status (crm/services/quotation_status.py), never free text.
        accepted = picked or next((q for q in quots if q.status == "accepted"), None)
        if picked:
            note = (f"Copied from quotation {picked.quot_number} ({picked.status}) of inquiry {inq.universal_id} — "
                    f"check the prices and quantities against the customer's PO.")
        elif accepted:
            note = f"Prices copied from quotation {accepted.quot_number} (accepted by the customer)."
        else:
            # Never copy a quotation the customer rejected, that expired or that was
            # never approved — fall back to the newest one with the customer.
            accepted = next((q for q in quots if q.status in ("sent", "approved")), None)
            if accepted:
                note = (f"Prices copied from the newest open quotation {accepted.quot_number} "
                        f"({'sent to the customer' if accepted.status == 'sent' else 'approved, not yet sent'}). "
                        f"Check them against the customer's PO.")
            elif quots:
                note = ("No quotation of this inquiry is approved and with the customer (they are draft, lost or expired) — "
                        "lines copied from the inquiry with no prices. Enter the PO prices.")
            else:
                note = "This inquiry has no quotation — lines copied from the inquiry with no prices. Enter the PO prices."
        lines = []
        if accepted:
            q_items = (db.query(QuotationLineItem).filter(QuotationLineItem.quotation_id == accepted.id)
                       .order_by(QuotationLineItem.sort_order, QuotationLineItem.id).all())
            disc_pct, price_note = _quotation_pricing(accepted, q_items)
            note += price_note
            lump = (accepted.pricing_mode or "itemwise") == "lumpsum"
            for i, li in enumerate(q_items, start=1):
                qty = li.quantity or 1
                price, gst = li.unit_price or 0, li.gst_percent
                if lump and len(q_items) == 1:
                    # One-line lump-sum offer: the package price is that line's price.
                    price, gst = round(float(accepted.price or 0) / float(qty), 2), accepted.lump_sum_gst_percent
                lines.append({"line_number": i, "line_type": "rrv", "rrv_model": li.model_number, "description": li.description or li.model_number or "",
                              "specification": li.details, "quantity": qty, "unit_price": price, "gst_rate": gst if gst is not None else 18,
                              "discount_percent": disc_pct, "uom": "NOS"})
        else:
            items = db.query(InquiryLineItem).filter(InquiryLineItem.inquiry_id == inq.id).order_by(InquiryLineItem.sort_order).all()
            src = items or [inq]
            for i, li in enumerate(src, start=1):
                lines.append({"line_number": i, "line_type": "rrv", "rrv_model": li.product, "description": li.product or "",
                              "specification": li.product_spec, "quantity": li.quantity or 1, "unit_price": 0, "gst_rate": 18,
                              "discount_percent": 0, "uom": "NOS"})
        insp = (inq.inspection_req or "").lower()
        agency = next((a for a in ("rites", "rdso") if a in insp), None)
        org = db.query(Organization).filter(Organization.id == inq.org_id).first()
        return {
            "existing_order": _existing(existing),
            "customer_id": inq.org_id, "customer_name": org.name if org else None, "customer_contact_id": inq.org_contact_id,
            "source_type": "inquiry", "source_inquiry_id": inq.id, "source_label": f"Inquiry {inq.universal_id}",
            "source_quotation_id": accepted.id if accepted else None,
            "source_quotation_number": accepted.quot_number if accepted else None,
            "payment_terms_label": (accepted.payment_terms or "")[:255] if accepted else None,
            "delivery_terms_text": accepted.delivery_time if accepted else None,
            "special_conditions": accepted.quote_conditions if accepted else None,
            "inspection_agency": agency, "third_party_inspection_required": bool(agency),
            "required_delivery_date": inq.required_delivery_date.isoformat() if inq.required_delivery_date else None,
            "lines": lines, "note": note, **defaults,
        }
    t = db.query(Tender).filter(Tender.id == tender, Tender.is_deleted == False).first()  # noqa: E712
    if not t:
        raise HTTPException(status_code=404, detail=f"Tender #{tender} not found in CRM.")
    org = db.query(Organization).filter(Organization.id == t.org_id).first()
    return {
        "existing_order": _existing(existing),
        "customer_id": t.org_id, "customer_name": org.name if org else None, "customer_contact_id": t.org_contact_id,
        "source_type": "tender", "source_tender_id": t.id, "source_label": f"Tender {t.tender_number or t.universal_id}",
        "loa_number": t.loi_number, "purchaser_name": t.tender_authority, "contract_value": t.contract_value,
        "lines": [{"line_number": 1, "line_type": "rrv", "description": t.tender_name or "", "quantity": 1,
                   "unit_price": 0, "gst_rate": 18, "discount_percent": 0, "uom": "NOS"}],
        **defaults,
    }


def _quotation_pricing(quot, items) -> tuple[float, str]:
    """(line discount %, note) that reproduce the quotation's header discount on
    the order lines. The quotation document takes its discount off the grand total
    (percent, or a flat amount); one uniform line discount % gives the customer the
    same grand total, so the order isn't raised at the undiscounted price."""
    if (quot.pricing_mode or "itemwise") == "lumpsum":
        if len(items) == 1:
            return 0.0, ""
        return 0.0, (f" Quotation {quot.quot_number} is a lump-sum offer ({svc.inr(quot.price)} + GST for the whole package) — "
                     f"split that price across the {len(items)} lines.")
    disc = float(quot.discount or 0)
    if disc <= 0:
        return 0.0, ""
    if quot.discount_type == "percent":
        return round(min(disc, 100.0), 3), f" The quotation's {disc:g}% discount is applied as the line discount."
    gross = sum(float(it.total or 0) for it in items)
    if gross <= 0:
        return 0.0, f" The quotation has a flat discount of {svc.inr(disc)} but no priced lines — apply it on the order lines."
    pct = round(min(disc / gross * 100, 100.0), 3)
    return pct, (f" The quotation's flat discount of {svc.inr(disc)} is applied as a {pct:g}% line discount "
                 f"(the same grand total, within rounding) — check it against the customer's PO.")


def _existing(so: SalesOrder | None) -> dict | None:
    return {"id": so.id, "display_number": so.display_number, "status": so.status} if so else None


def _term_defaults(db: Session) -> dict:
    return {
        "ld_applicable": True,
        "ld_rate_percent": svc.get_setting(db, "default_ld_rate_percent"),
        "ld_rate_period": svc.get_setting(db, "default_ld_period"),
        "ld_basis": svc.get_setting(db, "default_ld_basis"),
        "ld_max_percent": svc.get_setting(db, "standard_ld_max_percent"),
        "warranty_months_from_delivery": svc.get_setting(db, "default_warranty_months_from_delivery"),
        "warranty_months_from_commissioning": svc.get_setting(db, "default_warranty_months_from_commissioning"),
        "warranty_rule": svc.get_setting(db, "default_warranty_rule"),
    }


@router.get("/defaults")
async def defaults(db: Session = Depends(get_db), _app: User = _SALES):
    return _term_defaults(db)


@router.get("/by-source")
async def by_source(inquiry: int | None = None, tender: int | None = None, db: Session = Depends(get_db),
                    _user: User = Depends(require_any_app_access("sales", "crm"))):
    """Read-only chip for CRM: the live SO of an inquiry / tender, if any."""
    so = svc.live_order_for_source(db, inquiry, tender)
    return {"order": {"id": so.id, "display_number": so.display_number, "status": so.status,
                      "status_label": svc.STATUS_LABEL.get(so.status)} if so else None}


@router.get("/{so_id}", response_model=SalesOrderResponse)
async def get_order_detail(so_id: int, db: Session = Depends(get_db), _app: User = _SALES,
                           user: User = Depends(require_tab_access("sales", "orders"))):
    return order_response(db, _scoped(db, so_id, user), user)


@router.get("/{so_id}/timeline", dependencies=[Depends(require_feature_action("sales", "orders", "timeline", "view"))])
async def timeline(so_id: int, db: Session = Depends(get_db), _app: User = _SALES,
                   user: User = Depends(require_tab_access("sales", "orders"))):
    so = _scoped(db, so_id, user)
    logs = db.query(AuditLog).filter(AuditLog.entity_type == "sales_order", AuditLog.entity_id == so.id).order_by(
        AuditLog.performed_at.asc(), AuditLog.id.asc()).all()
    names = svc.user_names(db, [l.performed_by_id for l in logs])
    from app.core.timeline import compact_timeline
    return compact_timeline(logs, names)


# ---------------------------------------------------------------- draft CRUD

# NOT NULL header columns: an explicit null in a PATCH would otherwise fail at commit with a bare 500.
_REQUIRED_HEADER = {
    "customer_id": "Customer", "order_type": "Order type", "price_basis": "Price basis", "ld_applicable": "LD applicable",
    "third_party_inspection_required": "Third-party inspection required", "pbg_required": "PBG required", "currency": "Currency",
}


def _check_customer(db: Session, customer_id: int):
    from app.modules.crm.models.organization import Organization
    org = db.query(Organization).filter(Organization.id == customer_id, Organization.is_deleted == False).first()  # noqa: E712
    if not org:
        raise HTTPException(status_code=404, detail=f"Customer #{customer_id} not found in CRM organisations — pick the customer again.")
    return org


def _check_contact(db: Session, customer_id: int, contact_id: int | None) -> None:
    if not contact_id:
        return
    from app.modules.crm.models.organization import OrgContact
    c = db.query(OrgContact).filter(OrgContact.id == contact_id).first()
    if not c or c.org_id != customer_id:
        raise HTTPException(status_code=422, detail="The contact person doesn't belong to this customer — pick a contact of the selected organisation.")


def _check_source_customer(db: Session, inquiry_id: int | None, tender_id: int | None, customer_id: int) -> None:
    """The sold-to party comes from the reference document: an order raised from an
    inquiry / tender is for that record's organisation, never another customer."""
    from app.modules.crm.models.inquiry import Inquiry
    from app.modules.crm.models.tender import Tender
    model, rid, what = (Inquiry, inquiry_id, "inquiry") if inquiry_id else (Tender, tender_id, "tender")
    if not rid:
        return
    src = db.query(model).filter(model.id == rid).first()
    if src and src.org_id and src.org_id != customer_id:
        raise HTTPException(status_code=422, detail=(
            f"This order was raised from {what} {src.universal_id}, whose customer is organisation #{src.org_id} — the order's customer "
            f"must be the same. If the customer really changed, correct the {what} in CRM first (before any order exists), "
            f"or raise a direct order."))


def _check_owner(db: Session, owner_id: int | None) -> None:
    if owner_id is None:
        return
    u = db.query(User).filter(User.id == owner_id).first()
    if not u or not u.is_active:
        raise HTTPException(status_code=422, detail=f"Sales owner #{owner_id} isn't an active user — pick the owner again from the list.")


@router.post("", response_model=SalesOrderResponse)
async def create_order(payload: SalesOrderCreate, db: Session = Depends(get_db), _app: User = _SALES,
                       user: User = Depends(require_tab_action("sales", "orders", "create"))):
    data = {k: (v.strip() if isinstance(v, str) else v) for k, v in payload.model_dump(exclude={"lines", "schedule", "billing_plan"}).items()}
    with sales_errors(db):
        svc.validate_header(data)
    if data["source_type"] not in SALES_SOURCE_TYPES:
        raise HTTPException(status_code=422, detail=f"Source '{data['source_type']}' isn't valid — use one of: {', '.join(SALES_SOURCE_TYPES)}.")
    org = _check_customer(db, payload.customer_id)
    _check_contact(db, payload.customer_id, payload.customer_contact_id)
    existing = svc.live_order_for_source(db, payload.source_inquiry_id, payload.source_tender_id)
    if existing:
        raise HTTPException(status_code=409, detail=f"{existing.display_number} ({svc.STATUS_LABEL[existing.status]}) already exists for this "
                                                    f"{'inquiry' if payload.source_inquiry_id else 'tender'} — open it instead. "
                                                    f"A repeat order is a new inquiry; a quantity option is an amendment of that order.")
    _check_source_ordered(db, payload.source_inquiry_id, payload.source_tender_id)
    _check_source_customer(db, payload.source_inquiry_id, payload.source_tender_id, payload.customer_id)
    _check_owner(db, payload.sales_owner_id)
    if payload.source_quotation_id:
        from app.modules.crm.models.inquiry import Quotation
        q = db.query(Quotation).filter(Quotation.id == payload.source_quotation_id).first()
        if not q or (payload.source_inquiry_id and q.inquiry_id != payload.source_inquiry_id):
            raise HTTPException(status_code=422, detail="The quotation doesn't belong to this inquiry — re-open the order from the inquiry.")
        data["source_quotation_number"] = q.quot_number
    defaults = _term_defaults(db)
    so = SalesOrder(**{k: v for k, v in data.items() if v is not None or k in ("ld_max_percent",)})
    for k, v in defaults.items():
        if getattr(so, k, None) is None and k not in payload.model_fields_set:
            setattr(so, k, v)
    so.status = "draft"
    so.order_type = so.order_type or "rrv_supply"
    so.price_basis = so.price_basis or "for_destination"
    so.currency = "INR"
    so.created_by_id = user.id
    so.sales_owner_id = so.sales_owner_id or user.id
    so.customer_name = org.name
    db.add(so)
    db.flush()
    with sales_errors(db):
        svc.snapshot_customer(db, so)
        svc.apply_lines(db, so, [ln.model_dump() for ln in payload.lines], mode="draft")
        if payload.schedule is None:
            svc.generate_schedule_rows(so)
        else:
            svc.apply_schedule(db, so, [r.model_dump() for r in payload.schedule], mode="draft")
        svc.apply_billing(db, so, [b.model_dump() for b in payload.billing_plan])
        svc.recompute_totals(so)
    return _ok(db, so.id, user)


@router.patch("/{so_id}", response_model=SalesOrderResponse)
async def update_order(so_id: int, payload: SalesOrderUpdate, db: Session = Depends(get_db), _app: User = _SALES,
                       user: User = Depends(require_tab_action("sales", "orders", "edit"))):
    so = _scoped(db, so_id, user)
    require_status(so, ("draft",), "edit", "After confirmation the contract changes only through an amendment.")
    data = {k: (v.strip() if isinstance(v, str) else v) for k, v in payload.model_dump(exclude_unset=True).items()}
    blank = [label for k, label in _REQUIRED_HEADER.items() if k in data and data[k] is None and k != "currency"]
    if blank:
        raise HTTPException(status_code=422, detail=f"{', '.join(blank)} can't be empty on a sales order — pick a value "
                                                    f"(or leave the field out of the save to keep the current one).")
    with sales_errors(db):
        svc.validate_header({**data})
    if "sales_owner_id" in data:
        _check_owner(db, data["sales_owner_id"])
    if data.get("customer_id") and data["customer_id"] != so.customer_id:
        _check_source_customer(db, so.source_inquiry_id, so.source_tender_id, data["customer_id"])
        org = _check_customer(db, data["customer_id"])
        so.customer_name, so.customer_gstin, so.customer_state, so.billing_address = org.name, None, None, None
        # The old customer's GST state and contact person don't carry over to a new customer.
        so.place_of_supply_state_code = None
        if "customer_contact_id" not in data:
            so.customer_contact_id = None
    if "customer_contact_id" in data:
        _check_contact(db, data.get("customer_id") or so.customer_id, data["customer_contact_id"])
    for k, v in data.items():
        if k == "currency" and v is None:
            continue
        setattr(so, k, v)
    with sales_errors(db):
        svc.snapshot_customer(db, so)
        svc.recompute_totals(so)
    return _ok(db, so.id, user)


@router.put("/{so_id}/lines", response_model=SalesOrderResponse, dependencies=[Depends(require_feature_action("sales", "orders", "lines", "edit"))])
async def put_lines(so_id: int, payload: list[SalesOrderLinePayload], db: Session = Depends(get_db), _app: User = _SALES,
                    user: User = Depends(require_tab_action("sales", "orders", "edit"))):
    so = _scoped(db, so_id, user)
    require_status(so, ("draft",), "change the lines of", "Use an amendment for a confirmed order.")
    with sales_errors(db):
        svc.apply_lines(db, so, [ln.model_dump() for ln in payload], mode="draft")
        svc.generate_schedule_rows(so)
        svc.recompute_totals(so)
    return _ok(db, so.id, user)


@router.put("/{so_id}/schedule", response_model=SalesOrderResponse, dependencies=[Depends(require_feature_action("sales", "orders", "schedule", "edit"))])
async def put_schedule(so_id: int, payload: list[SalesOrderSchedulePayload], db: Session = Depends(get_db), _app: User = _SALES,
                       user: User = Depends(require_tab_action("sales", "orders", "edit"))):
    so = _scoped(db, so_id, user)
    require_status(so, ("draft",), "change the delivery schedule of", "Use an amendment for a confirmed order.")
    with sales_errors(db):
        svc.apply_schedule(db, so, [r.model_dump() for r in payload], mode="draft")
        svc.recompute_totals(so)
    return _ok(db, so.id, user)


@router.put("/{so_id}/billing-plan", response_model=SalesOrderResponse, dependencies=[Depends(require_feature_action("sales", "orders", "billing_plan", "edit"))])
async def put_billing(so_id: int, payload: list[SalesBillingPlanPayload], db: Session = Depends(get_db), _app: User = _SALES,
                      user: User = Depends(require_tab_action("sales", "orders", "edit"))):
    so = _scoped(db, so_id, user)
    require_status(so, ("draft",), "change the billing plan of", "Use an amendment for a confirmed order.")
    with sales_errors(db):
        svc.apply_billing(db, so, [b.model_dump() for b in payload])
        svc.recompute_totals(so)
    return _ok(db, so.id, user)


@router.delete("/{so_id}")
async def delete_order(so_id: int, db: Session = Depends(get_db), _app: User = _SALES,
                       user: User = Depends(require_tab_action("sales", "orders", "delete"))):
    so = _scoped(db, so_id, user)
    ensure_can_delete(user, so, "sales", "orders", what="sales order")
    require_status(so, ("draft",), "delete", "A submitted order is cancelled (with a reason), never deleted.")
    so.is_deleted = True
    so.deleted_at = svc.now_utc()
    db.commit()
    return {"message": f"{so.display_number} deleted"}


# ---------------------------------------------------------------- approval chain

@router.post("/{so_id}/submit", response_model=SalesOrderResponse)
async def submit(so_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db), _app: User = _SALES,
                 user: User = Depends(require_tab_action("sales", "orders", "submit"))):
    so = _scoped(db, so_id, user)
    require_status(so, ("draft",), "submit")
    with sales_errors(db):
        svc.snapshot_customer(db, so)
        svc.recompute_totals(so)
    problems = svc.submit_problems(db, so)
    if problems:
        db.rollback()
        raise HTTPException(status_code=422, detail=[f"Can't submit {so.display_number}:"] + problems)
    dup = svc.po_duplicate(db, so)
    if dup:
        db.rollback()
        raise HTTPException(status_code=409, detail=f"PO {so.customer_po_number} of this customer is already on {dup.display_number} "
                                                    f"({svc.STATUS_LABEL[dup.status]}). Check the PO number, or amend that order instead.")
    flags = svc.deviation_flags(db, {f: getattr(so, f) for f in svc.AMENDABLE_HEADER},
                                [svc.billing_dict(b) for b in so.billing_lines])
    from app.modules.sales.pricing import line_deviation_flags  # VK11 minimum price
    flags = flags + [f for f in line_deviation_flags(db, so) if f not in flags]
    # Routing, approver notifications and the decision trail live in the central
    # approval engine (Organization › Approval Workflows → "Sales order").
    try:
        req = sap.submit_order(db, so, user, flags)
    except HTTPException:
        db.rollback()
        raise
    from app.modules.sales import events as sales_events
    sales_events.order_event(
        db, background_tasks, "order_submitted", so,
        title=f"Sales order {so.display_number} waiting for approval",
        message=f"{user.name or user.email} submitted {so.display_number} — {so.customer_name or 'customer'} (PO {so.customer_po_number or '—'})"
                + (" with non-standard terms" if flags else "")
                + ". Review it in Sales › Sales Orders or My Approvals.",
        actor=user, skip_user_ids=sales_events.pending_approver_ids(req),
    )
    return _ok(db, so.id, user)


@router.post("/{so_id}/approve", response_model=SalesOrderResponse)
async def approve(so_id: int, payload: SalesOrderApprovePayload, db: Session = Depends(get_db), _app: User = _SALES,
                  user: User = Depends(require_tab_action("sales", "orders", "approve"))):
    so = _decision_order(db, so_id, user)
    require_status(so, ("pending_approval",), "approve")
    if sap.decide_via_engine(db, sap.ORDER_ENTITY, so.id, user, "approve", payload.comment):
        return _ok(db, so.id, user)
    level = svc.next_level(db, "sales_order", so.id, so.approval_round, so.required_approval_level)
    if not level:
        raise HTTPException(status_code=409, detail=f"{so.display_number} has every approval it needs already — refresh the page.")
    with sales_errors(db):
        stand_in = svc.check_approver(db, user, entity_type="sales_order", entity_id=so.id, rnd=so.approval_round, level=level,
                                      maker_id=so.submitted_by_id, comment=payload.comment, what=so.display_number)
    credit = svc.credit_position(db, so)
    if credit and credit.get("blocked"):
        raise HTTPException(status_code=409, detail=svc.credit_block_detail(so, credit))
    db.add(SalesApproval(entity_type="sales_order", entity_id=so.id, revision=so.approval_round, level=level, approver_id=user.id,
                         decision="approved", comment=(payload.comment or "").strip() or None, stand_in=stand_in,
                         decided_at=svc.now_utc()))
    db.flush()
    nxt = svc.next_level(db, "sales_order", so.id, so.approval_round, so.required_approval_level)
    if nxt:
        svc.notify_level(db, nxt, so.submitted_by_id, f"Approve sales order {so.display_number}",
                         f"{svc.LEVEL_LABEL[level]} approved ({user.name or user.email}). {so.customer_name}: {svc.inr(so.grand_total)}. "
                         f"Your approval as {svc.LEVEL_LABEL[nxt]} is next.", "sales_order_approval_needed", "sales_order", so.id)
        return _ok(db, so.id, user)
    with sales_errors(db):
        svc.confirm_order(db, so, user)
    return _ok(db, so.id, user)


@router.post("/{so_id}/return", response_model=SalesOrderResponse)
async def return_order(so_id: int, payload: SalesOrderReasonPayload, db: Session = Depends(get_db), _app: User = _SALES,
                       user: User = Depends(require_tab_action("sales", "orders", "approve"))):
    so = _decision_order(db, so_id, user)
    require_status(so, ("pending_approval",), "return")
    comment = _reason(payload, "returning the order")
    if sap.decide_via_engine(db, sap.ORDER_ENTITY, so.id, user, "return", comment):
        return _ok(db, so.id, user)
    level = svc.next_level(db, "sales_order", so.id, so.approval_round, so.required_approval_level) or "sales_head"
    with sales_errors(db):
        stand_in = svc.check_approver(db, user, entity_type="sales_order", entity_id=so.id, rnd=so.approval_round, level=level,
                                      maker_id=so.submitted_by_id, comment=comment, what=so.display_number)
    db.add(SalesApproval(entity_type="sales_order", entity_id=so.id, revision=so.approval_round, level=level, approver_id=user.id,
                         decision="returned", comment=comment, stand_in=stand_in, decided_at=svc.now_utc()))
    so.status = "draft"
    so.return_comment = comment
    svc.notify_bell(db, [so.submitted_by_id, so.created_by_id], f"{so.display_number} returned for changes",
                    f"{user.name or user.email}: {comment}", "sales_order_returned", "sales_order", so.id, exclude_user_id=user.id)
    svc.notify_order_rejected(db, so, user, comment, returned=True, told={so.submitted_by_id, so.created_by_id})
    return _ok(db, so.id, user)


@router.post("/{so_id}/reject", response_model=SalesOrderResponse)
async def reject(so_id: int, payload: SalesOrderReasonPayload, db: Session = Depends(get_db), _app: User = _SALES,
                 user: User = Depends(require_tab_action("sales", "orders", "approve"))):
    so = _decision_order(db, so_id, user)
    require_status(so, ("pending_approval",), "reject")
    comment = _reason(payload, "rejecting the order")
    if sap.decide_via_engine(db, sap.ORDER_ENTITY, so.id, user, "reject", comment):
        return _ok(db, so.id, user)
    level = svc.next_level(db, "sales_order", so.id, so.approval_round, so.required_approval_level) or "sales_head"
    with sales_errors(db):
        stand_in = svc.check_approver(db, user, entity_type="sales_order", entity_id=so.id, rnd=so.approval_round, level=level,
                                      maker_id=so.submitted_by_id, comment=comment, what=so.display_number)
    db.add(SalesApproval(entity_type="sales_order", entity_id=so.id, revision=so.approval_round, level=level, approver_id=user.id,
                         decision="rejected", comment=comment, stand_in=stand_in, decided_at=svc.now_utc()))
    for row in so.schedules:
        row.status = "cancelled"
    so.status = "cancelled"
    so.cancel_reason = f"Rejected by {user.name or user.email}: {comment}" + _close_followups(db, so, user, "rejected")
    svc.refresh_line_quantities(so)
    svc.notify_bell(db, [so.submitted_by_id, so.created_by_id], f"{so.display_number} rejected",
                    f"{user.name or user.email}: {comment}", "sales_order_rejected", "sales_order", so.id, exclude_user_id=user.id)
    svc.notify_order_rejected(db, so, user, comment, returned=False, told={so.submitted_by_id, so.created_by_id})
    return _ok(db, so.id, user)


# ---------------------------------------------------------------- hold / cancel / short-close / close

@router.post("/{so_id}/hold", response_model=SalesOrderResponse)
async def hold(so_id: int, payload: SalesOrderReasonPayload, db: Session = Depends(get_db), _app: User = _SALES,
               user: User = Depends(require_tab_action("sales", "orders", "edit"))):
    so = _scoped(db, so_id, user)
    require_status(so, ("confirmed", "in_execution", "partially_delivered"), "put on hold")
    so.hold_reason = _reason(payload, "the hold")
    so.held_from_status = so.status
    so.status = "on_hold"
    return _ok(db, so.id, user)


@router.post("/{so_id}/resume", response_model=SalesOrderResponse)
async def resume(so_id: int, db: Session = Depends(get_db), _app: User = _SALES,
                 user: User = Depends(require_tab_action("sales", "orders", "edit"))):
    so = _scoped(db, so_id, user)
    require_status(so, ("on_hold",), "resume")
    so.status = so.held_from_status or "confirmed"
    so.held_from_status = None
    svc.refresh_order(db, so)
    return _ok(db, so.id, user)


@router.post("/{so_id}/cancel", response_model=SalesOrderResponse)
async def cancel(so_id: int, payload: SalesOrderReasonPayload, db: Session = Depends(get_db), _app: User = _SALES,
                 user: User = Depends(require_tab_action("sales", "orders", "cancel"))):
    so = _locked_order(db, so_id, user)
    require_status(so, ("draft", "pending_approval", "confirmed"), "cancel",
                   "An order in execution is short-closed (Sales Head), not cancelled.")
    reason = _reason(payload, "cancelling the order")
    notes = []
    if so.status == "confirmed":
        _require_head(db, user, "cancel a confirmed order")
        with sales_errors(db):
            for row in so.schedules:
                if row.rrv_build_id:
                    number = svc.unlink_build(db, row)
                    if number:
                        notes.append(number)
    elif user.role != "admin" and user.id not in (so.created_by_id, so.submitted_by_id, so.sales_owner_id):
        raise HTTPException(status_code=403, detail="Only the person who raised this order (or an admin) can cancel it before confirmation.")
    if so.status == "pending_approval":
        svc.withdraw_approval(db, sap.ORDER_ENTITY, so.id, user, f"{so.display_number} cancelled: {reason}")
    for row in so.schedules:
        row.status = "cancelled"
    so.status = "cancelled"
    so.cancel_reason = reason + (f" (builds unlinked: {', '.join(notes)} — Production to cancel or re-assign)" if notes else "")
    so.cancel_reason += _close_followups(db, so, user, "cancelled")
    if notes:
        svc.notify_bell(db, svc.production_planners(db), f"{so.display_number} cancelled — builds released",
                        f"{', '.join(notes)} no longer belong to an order. Cancel them or re-assign them.",
                        "sales_order_cancelled", "sales_order", so.id, exclude_user_id=user.id)
    svc.refresh_line_quantities(so)
    return _ok(db, so.id, user)


@router.post("/{so_id}/short-close", response_model=SalesOrderResponse)
async def short_close(so_id: int, payload: SalesOrderReasonPayload, db: Session = Depends(get_db), _app: User = _SALES,
                      user: User = Depends(require_tab_action("sales", "orders", "approve"))):
    so = _locked_order(db, so_id, user)
    require_status(so, ("in_execution", "partially_delivered"), "short-close")
    _require_head(db, user, "short-close an order")
    reason = _reason(payload, "the short-close")
    open_rows = [r for r in so.schedules if r.status in ("open", "build_planned", "in_production", "ready")]
    started = []
    for r in open_rows:
        b = svc._build(db, r.rrv_build_id)
        if b and b.status not in ("planned", "cancelled"):
            started.append(b.build_number)
    if started:
        raise HTTPException(status_code=409, detail=f"Can't short-close {so.display_number}: build(s) {', '.join(started)} have started. "
                                                    f"Production must decide first — finish and deliver them, or cancel / re-assign the builds.")
    with sales_errors(db):
        for r in open_rows:
            if r.rrv_build_id:
                svc.unlink_build(db, r)
            r.status = "cancelled"
    so.status = "short_closed"
    so.short_close_reason = reason + _close_followups(db, so, user, "short-closed")
    svc.refresh_line_quantities(so)
    return _ok(db, so.id, user)


@router.post("/{so_id}/close", response_model=SalesOrderResponse)
async def close(so_id: int, payload: SalesOrderReasonPayload, db: Session = Depends(get_db), _app: User = _SALES,
                user: User = Depends(require_tab_action("sales", "orders", "approve"))):
    so = _locked_order(db, so_id, user)
    require_status(so, ("delivered",), "close")
    _require_head(db, user, "close an order")
    from app.modules.accounts.services.billing import open_billing_problems
    open_billing = open_billing_problems(db, so)
    if open_billing:
        raise HTTPException(status_code=409, detail=f"Can't close {so.display_number} yet: " + "; ".join(open_billing)
                            + ". Invoice them first (Finance › Sales › Billing due).")
    so.close_reason = _reason(payload, "closing the order") + _close_followups(db, so, user, "closed")
    so.status = "closed"
    return _ok(db, so.id, user)


# ---------------------------------------------------------------- order acknowledgement

@router.post("/{so_id}/issue-oa", response_model=SalesOrderResponse)
async def issue_oa(so_id: int, db: Session = Depends(get_db), _app: User = _SALES,
                   user: User = Depends(require_tab_action("sales", "orders", "edit"))):
    so = _scoped(db, so_id, user)
    if not so.so_number or so.status == "cancelled":
        raise HTTPException(status_code=409, detail=f"The order acknowledgement is issued after confirmation — {so.display_number} is "
                                                    f"{svc.STATUS_LABEL[so.status]}.")
    so.oa_issued_at, so.oa_issued_by_id = svc.now_utc(), user.id
    return _ok(db, so.id, user)


@router.get("/{so_id}/oa.pdf")
async def oa_pdf(so_id: int, db: Session = Depends(get_db), _app: User = _SALES,
                 user: User = Depends(require_tab_action("sales", "orders", "print"))):
    from app.modules.quality.reports.render import render_pdf
    from app.modules.sales.views import prices_hidden
    if prices_hidden(user):  # the OA prints every price
        ensure_feature_action(user, "sales", "orders", "prices", "view")
    so = _scoped(db, so_id, user)
    if not so.so_number:
        raise HTTPException(status_code=409, detail=f"{so.display_number} isn't confirmed yet — the acknowledgement needs the SO number.")

    def render() -> bytes:
        try:
            return render_pdf(oa_spec(db, so), f"Generated {datetime.now():%d-%m-%Y %H:%M} by {user.name or user.email} from the Premnath Rail portal.")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Couldn't build the order acknowledgement PDF: {e}")

    pdf = await managed_documents.pdf_of_record(db, OA_ENTITY, so.id, so.amendment_no or 0, render=render)
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="OA-{so.so_number.replace("/", "-")}.pdf"'})


managed_documents.register(managed_documents.DocumentAdapter(entity_type=OA_ENTITY, app="sales", load=oa_document_target))
