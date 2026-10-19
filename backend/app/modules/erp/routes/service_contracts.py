"""Service contracts — AMC / CMC (SAP VA41 create, VA42 change, VA43 display).

Tab Service › Service Contracts (erp:service_contracts) — view / create /
edit / delete / submit / approve / cancel in the Permission Matrix. Rules in
erp/contracts.py."""
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.core.data_scope import apply_scope, ensure_in_scope, register_scoped
from app.core.permissions import require_app_access, require_feature_action, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.erp import contracts as svc
from app.modules.erp.models.project import Project
from app.modules.erp.models.service_contract import (
    SERVICE_CONTRACT_BILLING_FREQUENCIES, SERVICE_CONTRACT_STATUSES, SERVICE_CONTRACT_TYPE_LABELS,
    ServiceContract, ServiceContractBilling, ServiceContractMachine,
)
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.erp.schemas.service_contract import (
    ServiceContractCreate, ServiceContractInvoicePayload, ServiceContractReasonPayload, ServiceContractResponse,
    ServiceContractUpdate,
)
from app.modules.main.models.user import User

router = APIRouter(prefix="/erp/service-contracts", tags=["ERP - Service Contracts"],
                   dependencies=[Depends(require_app_access("erp"))])

register_scoped(ServiceContract, "erp", entity_type=svc.CONTRACT_ENTITY, owner=("created_by_id",), label="service contract")
svc.register()

_VIEW = require_tab_access("erp", "service_contracts")
_CREATE = require_tab_action("erp", "service_contracts", "create")
_EDIT = require_tab_action("erp", "service_contracts", "edit")
_DELETE = require_tab_action("erp", "service_contracts", "delete")
_SUBMIT = require_tab_action("erp", "service_contracts", "submit")
_CANCEL = require_tab_action("erp", "service_contracts", "cancel")

_FIELDS = ("contract_type", "title", "customer_id", "start_date", "end_date", "contract_value", "gst_rate", "sac_code",
           "billing_frequency", "bill_in_advance", "visits_included", "labour_covered", "spares_covered",
           "sla_response_hours", "sla_resolution_hours", "customer_po_number", "customer_po_date", "terms")
_TEXT = ("title", "sac_code", "customer_po_number", "terms")


def _get(db: Session, cid: int, user: User) -> ServiceContract:
    c = (db.query(ServiceContract)
         .options(selectinload(ServiceContract.machines), selectinload(ServiceContract.billing_lines))
         .filter(ServiceContract.id == cid, ServiceContract.is_deleted == False).first())  # noqa: E712
    if c is None:
        raise HTTPException(status_code=404, detail=f"Service contract #{cid} not found — it may have been deleted; go back to the list.")
    ensure_in_scope(db, user, c)
    return c


def _out(db: Session, c: ServiceContract) -> ServiceContractResponse:
    skip = {"machines", "billing_lines"}
    ms = []
    for m in c.machines:
        p = m.project
        ms.append({"project_id": m.project_id, "serial_number": p.serial_number if p else None, "model_name": p.model_name if p else None,
                   "site_name": p.site_name if p else None, "product_name": p.product_name if p else None})
    out = ServiceContractResponse(
        **{k: getattr(c, k) for k in ServiceContractResponse.model_fields if k not in skip and hasattr(c, k)},
        machines=ms, billing_lines=[svc.billing_view(db, b) for b in c.billing_lines],
    )
    out.customer_name = c.customer.name if c.customer is not None else None
    out.billed_amount = round(sum(float(b.amount or 0) for b in c.billing_lines if b.status == "invoiced"), 2)
    out.visits_used = svc.visits_used(db, c.id)
    nxt = db.query(ServiceContract.id).filter(ServiceContract.renewed_from_id == c.id, ServiceContract.is_deleted == False,  # noqa: E712
                                              ServiceContract.status != "cancelled").first()
    out.renewed_by_id = nxt[0] if nxt else None
    if c.renewed_from_id:
        out.renewed_from_number = db.query(ServiceContract.contract_number).filter(ServiceContract.id == c.renewed_from_id).scalar()
    if c.status == "active":
        out.days_to_expiry = (c.end_date - date.today()).days
    return out


def _clean(data: dict) -> dict:
    for k in _TEXT:
        if k in data:
            data[k] = (data[k] or "").strip() or None
    return data


@router.get("/meta")
async def meta(_user: User = Depends(_VIEW)):
    return {
        "types": [{"value": k, "label": v} for k, v in SERVICE_CONTRACT_TYPE_LABELS.items()],
        "statuses": list(SERVICE_CONTRACT_STATUSES),
        "billing_frequencies": list(SERVICE_CONTRACT_BILLING_FREQUENCIES),
    }


@router.get("/entitlement")
async def entitlement(project_id: int, on: date | None = None, db: Session = Depends(get_db),
                      _user: User = Depends(require_tab_access("erp", "service_requests"))):
    """What the SR form shows: is the machine covered by a contract today."""
    p = db.query(Project).filter(Project.id == project_id, Project.is_deleted == False).first()  # noqa: E712
    if p is None:
        raise HTTPException(status_code=404, detail="Machine not found — it may have been deleted. Pick another machine.")
    ensure_in_scope(db, _user, p)
    return {"entitlement": svc.entitlement_view(db, p, on)}


@router.get("", response_model=list[ServiceContractResponse])
async def list_contracts(
    status: str | None = None, customer_id: int | None = None, project_id: int | None = None,
    expiring_within_days: int | None = None, search: str | None = None,
    db: Session = Depends(get_db), user: User = Depends(_VIEW),
):
    q = apply_scope(db.query(ServiceContract).options(selectinload(ServiceContract.machines), selectinload(ServiceContract.billing_lines))
                    .filter(ServiceContract.is_deleted == False), user, ServiceContract)  # noqa: E712
    if status:
        q = q.filter(ServiceContract.status == status)
    if customer_id:
        q = q.filter(ServiceContract.customer_id == customer_id)
    if project_id:
        q = q.filter(ServiceContract.machines.any(ServiceContractMachine.project_id == project_id))
    if expiring_within_days is not None:
        q = q.filter(ServiceContract.status == "active",
                     ServiceContract.end_date <= date.today() + timedelta(days=max(0, expiring_within_days)))
    if search and search.strip():
        like = f"%{search.strip()}%"
        q = q.filter(or_(ServiceContract.contract_number.ilike(like), ServiceContract.title.ilike(like),
                         ServiceContract.customer_po_number.ilike(like)))
    return [_out(db, c) for c in q.order_by(ServiceContract.id.desc()).limit(500).all()]


@router.post("", response_model=ServiceContractResponse, status_code=201)
async def create_contract(payload: ServiceContractCreate, db: Session = Depends(get_db), user: User = Depends(_CREATE)):
    svc.ensure_contracts_enabled()
    from app.modules.accounts.services.fiscal import next_number
    data = _clean(payload.model_dump())
    machine_ids = data.pop("machine_ids") or []
    c = ServiceContract(**{k: data[k] for k in _FIELDS}, status="draft", created_by_id=user.id, contract_number="")
    svc.validate(db, c, machine_ids)
    try:
        c.contract_number = next_number(db, "SC", c.start_date)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=f"Can't issue a contract number: {e}")
    c.machines = [ServiceContractMachine(project_id=pid) for pid in dict.fromkeys(machine_ids)]
    db.add(c)
    db.flush()
    for b in svc.build_billing_plan(c):
        c.billing_lines.append(b)
    svc.audit(db, c, "created", f"{svc.label(c)} drafted by {user.name or user.email}.", user.id)
    db.commit()
    return _out(db, _get(db, c.id, user))


@router.get("/{cid}", response_model=ServiceContractResponse)
async def get_contract(cid: int, db: Session = Depends(get_db), user: User = Depends(_VIEW)):
    c = _get(db, cid, user)
    svc.sync_billing(db, c)
    db.commit()
    return _out(db, c)


@router.get("/{cid}/service-requests")
async def contract_service_requests(cid: int, db: Session = Depends(get_db), user: User = Depends(require_feature_action("erp", "service_contracts", "service_requests", "view"))):
    c = _get(db, cid, user)
    rows = db.query(ServiceRequest).filter(ServiceRequest.service_contract_id == c.id, ServiceRequest.is_deleted == False)  # noqa: E712
    return [{"id": s.id, "request_number": s.request_number, "issue_title": s.issue_title, "status": s.status,
             "service_type": s.service_type, "is_chargeable": s.is_chargeable, "opened_at": s.opened_at, "project_id": s.project_id}
            for s in rows.order_by(ServiceRequest.id.desc()).all()]


@router.patch("/{cid}", response_model=ServiceContractResponse)
async def update_contract(cid: int, payload: ServiceContractUpdate, db: Session = Depends(get_db), user: User = Depends(_EDIT)):
    c = _get(db, cid, user)
    if c.status != "draft":
        raise HTTPException(status_code=409, detail=f"{c.contract_number} is {c.status.replace('_', ' ')} — only a draft is edited. "
                                                    "Renew it (or cancel and redraft) to change the terms.")
    data = _clean(payload.model_dump(exclude_unset=True))
    machine_ids = data.pop("machine_ids", None)
    for k, v in data.items():
        if v is None and k in ("contract_type", "customer_id", "start_date", "end_date", "billing_frequency", "contract_value",
                               "gst_rate", "visits_included", "labour_covered", "spares_covered", "bill_in_advance"):
            continue
        setattr(c, k, v)
    ids = machine_ids if machine_ids is not None else [m.project_id for m in c.machines]
    svc.validate(db, c, ids)
    if machine_ids is not None:
        keep = set(machine_ids)
        for m in list(c.machines):
            if m.project_id not in keep:
                c.machines.remove(m)
        have = {m.project_id for m in c.machines}
        for pid in dict.fromkeys(machine_ids):
            if pid not in have:
                c.machines.append(ServiceContractMachine(project_id=pid))
    svc.replan(db, c)
    svc.audit(db, c, "updated", f"{c.contract_number} edited by {user.name or user.email}.", user.id)
    db.commit()
    return _out(db, _get(db, c.id, user))


@router.post("/{cid}/submit", response_model=ServiceContractResponse)
async def submit_contract(cid: int, db: Session = Depends(get_db), user: User = Depends(_SUBMIT)):
    c = _get(db, cid, user)
    try:
        svc.submit(db, c, user)
    except HTTPException:
        db.rollback()
        raise
    db.commit()
    return _out(db, _get(db, c.id, user))


@router.post("/{cid}/cancel", response_model=ServiceContractResponse)
async def cancel_contract(cid: int, payload: ServiceContractReasonPayload, db: Session = Depends(get_db), user: User = Depends(_CANCEL)):
    c = _get(db, cid, user)
    svc.cancel(db, c, user, payload.reason)
    db.commit()
    return _out(db, _get(db, c.id, user))


@router.post("/{cid}/renew", response_model=ServiceContractResponse, status_code=201)
async def renew_contract(cid: int, db: Session = Depends(get_db), user: User = Depends(require_feature_action("erp", "service_contracts", "renew", "create"))):
    svc.ensure_contracts_enabled()
    c = _get(db, cid, user)
    new = svc.renew(db, c, user)
    for b in svc.build_billing_plan(new):
        new.billing_lines.append(b)
    db.commit()
    return _out(db, _get(db, new.id, user))


@router.post("/{cid}/billing/{bid}/invoice", response_model=ServiceContractResponse)
async def invoice_period(cid: int, bid: int, payload: ServiceContractInvoicePayload, db: Session = Depends(get_db),
                         user: User = Depends(require_feature_action("erp", "service_contracts", "billing_plan", "create"))):
    """Drafts the AR (sales) invoice of one billing period; Finance approves
    and posts it (Finance › Sales)."""
    c = _get(db, cid, user)
    b = db.query(ServiceContractBilling).filter(ServiceContractBilling.id == bid, ServiceContractBilling.contract_id == c.id).first()
    if b is None:
        raise HTTPException(status_code=404, detail=f"Billing period #{bid} isn't on {c.contract_number} — reload the contract.")
    svc.invoice_line(db, c, b, user.id, invoice_date=payload.invoice_date)
    db.commit()
    return _out(db, _get(db, c.id, user))


@router.delete("/{cid}")
async def delete_contract(cid: int, db: Session = Depends(get_db), user: User = Depends(_DELETE)):
    c = _get(db, cid, user)
    if c.status != "draft":
        raise HTTPException(status_code=409, detail=f"{c.contract_number} is {c.status.replace('_', ' ')} — only a draft can be deleted; "
                                                    "cancel it with a reason instead.")
    c.is_deleted = True
    svc.audit(db, c, "deleted", f"Draft {c.contract_number} deleted by {user.name or user.email}.", user.id)
    db.commit()
    return {"ok": True}
