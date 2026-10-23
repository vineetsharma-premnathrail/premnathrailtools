"""Proforma invoices of a sales order (SAP VA01 PF / F-37). Rules:
sales/proforma.py; Word document of record: sales/reports/proforma.py.

GET    /sales/orders/{so_id}/proforma          list (Sales › Orders view)
POST   /sales/orders/{so_id}/proforma          issue for an advance milestone (edit)
GET    /sales/proforma                         lookup for Finance: ?so_id= & status=issued
GET    /sales/proforma/{pi_id}                 one PI
POST   /sales/proforma/{pi_id}/cancel          cancel with a reason (edit)
GET    /sales/proforma/{pi_id}/pdf             PDF (the Word document once it exists)
"""
from datetime import date, datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.data_scope import in_scope
from app.core.permission_registry import can_perform
from app.core.permissions import ensure_feature_action, require_app_access, require_feature_action, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.services import managed_documents
from app.modules.sales import proforma as pf
from app.modules.sales import service as svc
from app.modules.sales.access import ensure_order
from app.modules.sales.models.order import SalesOrder
from app.modules.sales.models.proforma import SalesProformaInvoice
from app.modules.sales.reports.proforma import PI_ENTITY, pi_document_target, pi_spec
from app.modules.sales.views import get_order
from app.modules.main.routes.auth import get_current_user

router = APIRouter(tags=["Sales"])


class ProformaCreatePayload(BaseModel):
    billing_line_id: int
    pi_date: date | None = None
    valid_until: date | None = None
    remarks: str | None = Field(default=None, max_length=2000)


class ProformaCancelPayload(BaseModel):
    reason: str | None = Field(default=None, max_length=2000)


def _prices(user: User = Depends(get_current_user)) -> None:
    """A proforma is a priced document: on Sales › Sales Orders it also needs
    Prices & margins (or 'edit' on the order lines — see views.prices_hidden)."""
    from app.modules.sales.views import prices_hidden
    if prices_hidden(user):
        ensure_feature_action(user, "sales", "orders", "prices", "view")


def _http(e: svc.SalesError) -> HTTPException:
    return HTTPException(status_code=e.status_code, detail=e.detail)


def _scoped(db: Session, so_id: int, user: User) -> SalesOrder:
    so = get_order(db, so_id)
    ensure_order(db, user, so)
    return so


def _pi(db: Session, pi_id: int, user: User) -> tuple[SalesProformaInvoice, SalesOrder]:
    pi = db.get(SalesProformaInvoice, pi_id)
    if not pi:
        raise HTTPException(status_code=404, detail=f"Proforma invoice #{pi_id} not found — it may have been removed.")
    return pi, _scoped(db, pi.so_id, user)


@router.get("/sales/orders/{so_id}/proforma", dependencies=[Depends(require_app_access("sales")), Depends(require_feature_action("sales", "orders", "proforma", "view")), Depends(_prices)])
async def list_order_proformas(so_id: int, db: Session = Depends(get_db), user: User = Depends(require_tab_access("sales", "orders"))):
    so = _scoped(db, so_id, user)
    pf.sync_status(db, so)
    db.commit()
    rows = db.query(SalesProformaInvoice).filter(SalesProformaInvoice.so_id == so.id).order_by(SalesProformaInvoice.id.desc()).all()
    return [pf.view(db, p, so) for p in rows]


@router.post("/sales/orders/{so_id}/proforma", status_code=201, dependencies=[Depends(require_app_access("sales")), Depends(require_feature_action("sales", "orders", "proforma", "create")), Depends(_prices)])
async def create_proforma(so_id: int, payload: ProformaCreatePayload, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                          user: User = Depends(require_tab_action("sales", "orders", "edit"))):
    so = _scoped(db, so_id, user)
    try:
        pi = pf.create(db, so, user, payload.billing_line_id, payload.pi_date, payload.valid_until, payload.remarks)
    except svc.SalesError as e:
        raise _http(e)
    from app.modules.sales import events as sales_events
    number = pi.pi_number
    sales_events.order_event(
        db, background_tasks, "proforma_raised", so, title=f"Proforma {number} raised on {so.display_number}",
        message=f"{user.name or user.email} raised proforma invoice {number} on {so.display_number} ({so.customer_name or 'customer'}). "
                f"Send it to the customer and follow up the advance.",
        actor=user,
    )
    db.commit()
    return pf.view(db, pi, so)


@router.get("/sales/proforma")
async def lookup_proformas(so_id: int | None = None, customer_id: int | None = None, status: str | None = None,
                           db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """For Finance (recording a customer advance against a PI) and Sales: PIs of
    the orders the user can see."""
    # Finance = the Sales Invoices tab (same rule as the billing due list), not
    # just any Finance tab; Sales also needs the Proforma feature and Prices,
    # like every other proforma route.
    finance = can_perform(user, "accounts", "sales_invoices", "view")
    if not finance:
        if not can_perform(user, "sales", "orders", "view"):
            raise HTTPException(status_code=403, detail="Listing proforma invoices needs 'View' on Sales › Sales Orders or on "
                                                        "Finance › Sales Invoices. "
                                                        "Ask an admin to add it to one of your roles in Organization › Role & Permissions.")
        ensure_feature_action(user, "sales", "orders", "proforma", "view")
        _prices(user)
    q = db.query(SalesProformaInvoice, SalesOrder).join(SalesOrder, SalesOrder.id == SalesProformaInvoice.so_id).filter(
        SalesOrder.is_deleted == False)  # noqa: E712
    if so_id:
        q = q.filter(SalesProformaInvoice.so_id == so_id)
    if customer_id:
        q = q.filter(SalesOrder.customer_id == customer_id)
    if status:
        if status not in pf.STATUS_LABEL:
            raise HTTPException(status_code=422, detail=f"Unknown status '{status}' — use one of: {', '.join(pf.STATUS_LABEL)}.")
        q = q.filter(SalesProformaInvoice.status == status)
    out = []
    for pi, so in q.order_by(SalesProformaInvoice.id.desc()).limit(200).all():
        if finance or in_scope(db, user, so):
            out.append(pf.view(db, pi, so))
    return out


@router.get("/sales/proforma/{pi_id}", dependencies=[Depends(require_app_access("sales")), Depends(require_feature_action("sales", "orders", "proforma", "view")), Depends(_prices)])
async def get_proforma(pi_id: int, db: Session = Depends(get_db), user: User = Depends(require_tab_access("sales", "orders"))):
    pi, so = _pi(db, pi_id, user)
    return pf.view(db, pi, so)


@router.post("/sales/proforma/{pi_id}/cancel", dependencies=[Depends(require_app_access("sales")), Depends(require_feature_action("sales", "orders", "proforma", "cancel")), Depends(_prices)])
async def cancel_proforma(pi_id: int, payload: ProformaCancelPayload, db: Session = Depends(get_db),
                          user: User = Depends(require_tab_action("sales", "orders", "edit"))):
    pi, so = _pi(db, pi_id, user)
    try:
        pf.cancel(db, pi, user, payload.reason)
    except svc.SalesError as e:
        raise _http(e)
    db.commit()
    return pf.view(db, pi, so)


@router.get("/sales/proforma/{pi_id}/pdf", dependencies=[Depends(require_app_access("sales")), Depends(require_feature_action("sales", "orders", "proforma", "print")), Depends(_prices)])
async def proforma_pdf(pi_id: int, db: Session = Depends(get_db), user: User = Depends(require_tab_action("sales", "orders", "print"))):
    from app.modules.quality.reports.render import render_pdf
    pi, so = _pi(db, pi_id, user)

    def render() -> bytes:
        try:
            return render_pdf(pi_spec(db, pi, so), f"Generated {datetime.now():%d-%m-%Y %H:%M} by {user.name or user.email} from the Premnath Rail portal.")
        except Exception as e:  # noqa: BLE001
            raise HTTPException(status_code=500, detail=f"Couldn't build the proforma invoice PDF: {e}")

    pdf = await managed_documents.pdf_of_record(db, PI_ENTITY, pi.id, 0, render=render)
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{pi.pi_number.replace("/", "-")}.pdf"'})


managed_documents.register(managed_documents.DocumentAdapter(entity_type=PI_ENTITY, app="sales", load=pi_document_target))
