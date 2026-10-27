"""Customer / third-party inspection calls (RITES / RDSO / Customer / Other),
the contract inspection requirement on ERP machines / orders, and the
dispatch release check (rule 8). Rules live in services/inspection_calls.py
and services/dispatch.py."""
import os
from datetime import date

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permissions import require_app_access, require_tab_action
from app.db.session import get_db
from app.modules.erp.models.project import Project
from app.modules.main.models.user import User
from app.modules.quality.models.inspection_call import QualityInspectionCall, QUALITY_CALL_STATUSES
from app.modules.quality.models.inspection_lot import QualityInspectionLot
from app.modules.quality.models.masters import QualityMasterValue
from app.modules.quality.models.ncr import QualityNcr
from app.modules.quality.schemas.inspection_call import (
    QualityInspectionCallCreate, QualityInspectionCallSchedulePayload, QualityInspectionCallResultPayload,
    QualityInspectionCallCancelPayload, QualityContractRequirementPayload, QualityDispatchCheckPayload,
    QualityInspectionCallResponse,
)
from app.modules.quality.services import inspection_calls as call_service, dispatch as dispatch_service
from app.modules.quality.services import order_project_inspection as opi
from app.modules.quality.services.inspection_calls import CallError
from app.modules.quality.services.ncr import NcrError
from app.modules.quality.services.settings import active_master_values

router = APIRouter(prefix="/quality/inspection-calls", tags=["Quality"], dependencies=[Depends(require_app_access("quality"))])

_CAN_CREATE = require_tab_action("quality", "inspection_calls", "create")
_CAN_EDIT = require_tab_action("quality", "inspection_calls", "edit")
_CAN_APPROVE = require_tab_action("quality", "inspection_calls", "approve")
MAX_CERT_BYTES = 15 * 1024 * 1024


def _project_label(p: Project | None) -> str | None:
    if not p:
        return None
    return " — ".join(x for x in (p.serial_number, p.model_name, p.client_company, f"PO {p.po_number}" if p.po_number else None) if x)


def _agencies(db: Session) -> dict[str, str]:
    active_master_values(db, "inspection_agencies")  # seeds the list on a fresh DB
    return {r.value: r.label for r in db.query(QualityMasterValue).filter(QualityMasterValue.list_key == "inspection_agencies").all()}


def _responses(db: Session, rows: list[QualityInspectionCall]) -> list[QualityInspectionCallResponse]:
    projects = {p.id: p for p in db.query(Project).filter(Project.id.in_({r.erp_project_id for r in rows} - {None})).all()}
    lots = {l.id: l.lot_number for l in db.query(QualityInspectionLot).filter(QualityInspectionLot.id.in_({r.lot_id for r in rows} - {None})).all()}
    ncrs = {n.id: n.ncr_number for n in db.query(QualityNcr).filter(QualityNcr.id.in_({r.ncr_id for r in rows} - {None})).all()}
    uids = ({r.created_by_id for r in rows} | {r.result_recorded_by_id for r in rows}) - {None}
    users = {u.id: u.name or u.email for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    agencies = _agencies(db)
    links = opi.link_display(db, rows)
    out = []
    for r in rows:
        resp = QualityInspectionCallResponse.model_validate(r)
        resp.project_label = _project_label(projects.get(r.erp_project_id))
        for k, v in links.get(r.id, {}).items():
            setattr(resp, k, v)
        resp.agency_label = agencies.get(r.agency, r.agency)
        resp.lot_number = lots.get(r.lot_id)
        resp.ncr_number = ncrs.get(r.ncr_id)
        resp.created_by_name = users.get(r.created_by_id)
        resp.result_recorded_by_name = users.get(r.result_recorded_by_id)
        resp.days_to_call = (r.call_date - date.today()).days if r.call_date and r.status == "scheduled" else None
        out.append(resp)
    return out


def _get(db: Session, call_id: int, user: User | None = None, lock: bool = False) -> QualityInspectionCall:
    q = db.query(QualityInspectionCall).filter(QualityInspectionCall.id == call_id)
    call = (q.with_for_update() if lock else q).first()
    if not call:
        raise HTTPException(status_code=404, detail=f"Inspection call #{call_id} not found — it may have been removed. Reload the list.")
    if user is not None:
        ensure_in_scope(db, user, call)
    return call


def _run(db: Session, fn):
    try:
        out = fn()
    except (CallError, NcrError) as e:
        db.rollback()
        raise HTTPException(status_code=e.status, detail=str(e))
    db.commit()
    return out


@router.get("/meta")
async def meta(db: Session = Depends(get_db)):
    agencies = _agencies(db)
    active = active_master_values(db, "inspection_agencies")
    return {"statuses": list(QUALITY_CALL_STATUSES), "agencies": [{"value": v, "label": agencies.get(v, v)} for v in active]}


# --- Contracts (ERP machines / orders) ------------------------------------

@router.get("/contracts")
async def list_contracts(search: str | None = None, required_only: bool = False, db: Session = Depends(get_db)):
    q = db.query(Project).filter(Project.is_deleted == False)  # noqa: E712
    if required_only:
        q = q.filter(Project.third_party_inspection_required.is_(True))
    if search:
        like = f"%{search}%"
        q = q.filter(Project.serial_number.ilike(like) | Project.po_number.ilike(like) | Project.client_company.ilike(like)
                     | Project.model_name.ilike(like))
    agencies = _agencies(db)
    return [{"id": p.id, "label": _project_label(p), "po_number": p.po_number, "client_company": p.client_company,
             "delivery_date": p.delivery_date, "third_party_inspection_required": bool(p.third_party_inspection_required),
             "inspection_agency": p.inspection_agency, "inspection_agency_label": agencies.get(p.inspection_agency or "", p.inspection_agency)}
            for p in q.order_by(Project.id.desc()).limit(500).all()]


@router.put("/contracts/{project_id}")
async def set_contract_requirement(project_id: int, payload: QualityContractRequirementPayload, db: Session = Depends(get_db),
                                   _user: User = Depends(_CAN_APPROVE)):
    """Flag + agency on the contract. Only a Quality head (inspection calls
    'approve') changes it — it decides whether dispatch needs a certificate."""
    p = db.query(Project).filter(Project.id == project_id, Project.is_deleted == False).first()  # noqa: E712
    if not p:
        raise HTTPException(status_code=404, detail=f"ERP machine / order #{project_id} not found")
    agency = (payload.inspection_agency or "").strip() or None
    if payload.third_party_inspection_required:
        allowed = active_master_values(db, "inspection_agencies")
        if agency not in allowed:
            raise HTTPException(status_code=422, detail=f"Pick the inspecting agency for this contract: {', '.join(allowed)}.")
    p.third_party_inspection_required = payload.third_party_inspection_required
    p.inspection_agency = agency if payload.third_party_inspection_required else None
    db.commit()
    return {"id": p.id, "third_party_inspection_required": p.third_party_inspection_required, "inspection_agency": p.inspection_agency}


# --- project requirement (from the Sales Order) ----------------------

@router.get("/order-project-requirement")
async def order_project_requirement(element_id: int | None = None, project_id: int | None = None,
                                    db: Session = Depends(get_db)):
    """What the Sales Order of a project says about inspection - shown
    read-only on the call form ("from Sales Order ...") - and the calls
    already raised for the element."""
    try:
        project, element = opi.resolve_link(db, project_id, element_id, allow_cancelled=True)
    except opi.LinkError as e:
        raise HTTPException(status_code=e.status, detail=str(e))
    if project is None:
        raise HTTPException(status_code=422, detail="Pick a project (and its unit: vehicle / lot) first.")
    req = opi.so_requirement(db, element, project) or {}
    calls = opi.calls_for_element(db, element.id) if element is not None else []
    cleared = None
    if element is not None:
        _req, _agency, cleared = opi.inspection_required_for_element(db, element)
    return {**req, "op_number": project.project_code, "element_no": element.element_no if element else None,
            "element_label": element.label if element else None, "cleared": cleared,
            "calls": [{"id": c.id, "call_number": c.call_number, "status": c.status, "quantity": c.quantity,
                       "accepted_qty": c.accepted_qty, "certificate_number": c.certificate_number} for c in calls]}


# --- Dispatch release check ------------------------------------------------

@router.post("/dispatch-check")
async def dispatch_check(payload: QualityDispatchCheckPayload, db: Session = Depends(get_db)):
    """Can this quantity be dispatched? Same check the Store dispatch issue
    runs (rule 8)."""
    if payload.quantity <= 0:
        raise HTTPException(status_code=422, detail="Quantity must be greater than zero.")
    problems = dispatch_service.check(db, item_id=payload.item_id, quantity=payload.quantity,
                                      batch_number=payload.batch_number, erp_project_id=payload.erp_project_id,
                                      order_project_element_id=payload.order_project_element_id)
    return {"allowed": not problems, "problems": problems}


# --- Calls -------------------------------------------------------------------

@router.get("", response_model=list[QualityInspectionCallResponse])
async def list_calls(status_filter: str | None = Query(None, alias="status"), erp_project_id: int | None = None,
                     order_project_id: int | None = None, order_project_element_id: int | None = None,
                     open_only: bool = False, search: str | None = None, db: Session = Depends(get_db),
                     user: User = Depends(require_app_access("quality"))):
    q = apply_scope(db.query(QualityInspectionCall), user, QualityInspectionCall)
    if status_filter:
        q = q.filter(QualityInspectionCall.status == status_filter)
    if open_only:
        q = q.filter(QualityInspectionCall.status.in_(("requested", "scheduled")))
    if erp_project_id:
        q = q.filter(QualityInspectionCall.erp_project_id == erp_project_id)
    if order_project_id:
        q = q.filter(QualityInspectionCall.order_project_id == order_project_id)
    if order_project_element_id:
        q = q.filter(QualityInspectionCall.order_project_element_id == order_project_element_id)
    if search:
        like = f"%{search}%"
        q = q.filter(QualityInspectionCall.call_number.ilike(like) | QualityInspectionCall.item_name.ilike(like)
                     | QualityInspectionCall.order_reference.ilike(like) | QualityInspectionCall.certificate_number.ilike(like)
                     | QualityInspectionCall.customer_name.ilike(like))
    return _responses(db, q.order_by(QualityInspectionCall.id.desc()).limit(500).all())


@router.post("", response_model=QualityInspectionCallResponse)
async def create_call(payload: QualityInspectionCallCreate, db: Session = Depends(get_db), user: User = Depends(_CAN_CREATE)):
    def go():
        call = call_service.create(db, payload.model_dump(), user)
        call_service.notify_scheduled(db, call, user)
        return call
    call = _run(db, go)
    return _responses(db, [_get(db, call.id)])[0]


@router.get("/{call_id}", response_model=QualityInspectionCallResponse)
async def get_call(call_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    return _responses(db, [_get(db, call_id, user)])[0]


@router.post("/{call_id}/schedule", response_model=QualityInspectionCallResponse)
async def schedule_call(call_id: int, payload: QualityInspectionCallSchedulePayload, db: Session = Depends(get_db),
                        user: User = Depends(_CAN_EDIT)):
    call = _get(db, call_id, user, lock=True)

    def go():
        call_service.schedule(db, call, call_date=payload.call_date, inspector_name=payload.inspector_name, remarks=payload.remarks)
        call_service.notify_scheduled(db, call, user)
    _run(db, go)
    return _responses(db, [_get(db, call_id)])[0]


@router.post("/{call_id}/result", response_model=QualityInspectionCallResponse)
async def record_result(call_id: int, payload: QualityInspectionCallResultPayload, db: Session = Depends(get_db),
                        user: User = Depends(_CAN_EDIT)):
    call = _get(db, call_id, user, lock=True)
    _run(db, lambda: call_service.record_result(
        db, call, result=payload.result, accepted_qty=payload.accepted_qty, rejected_qty=payload.rejected_qty,
        certificate_number=payload.certificate_number, result_date=payload.result_date, inspector_name=payload.inspector_name,
        remarks=payload.remarks, location_id=payload.location_id, severity=payload.severity, user=user))
    return _responses(db, [_get(db, call_id)])[0]


@router.post("/{call_id}/cancel", response_model=QualityInspectionCallResponse)
async def cancel_call(call_id: int, payload: QualityInspectionCallCancelPayload, db: Session = Depends(get_db),
                      user: User = Depends(_CAN_EDIT)):
    call = _get(db, call_id, user, lock=True)
    _run(db, lambda: call_service.cancel(db, call, reason=payload.reason, user=user))
    return _responses(db, [_get(db, call_id)])[0]


@router.post("/{call_id}/certificate", response_model=QualityInspectionCallResponse)
async def upload_certificate(call_id: int, file: UploadFile = File(...), db: Session = Depends(get_db),
                             _user: User = Depends(_CAN_EDIT)):
    """The agency's certificate / release note (PDF or scan). Can be attached
    with the result or right after it; replacing it keeps the number."""
    from app.utils.sharepoint import upload_file_to_sharepoint, sanitize_folder_name
    call = _get(db, call_id, _user, lock=True)
    if call.status == "cancelled":
        raise HTTPException(status_code=409, detail=f"{call.call_number} was cancelled — there is no certificate to attach.")
    if call.certificate_file_path and call.status not in ("requested", "scheduled"):
        raise HTTPException(status_code=409, detail=f"{call.call_number} already has its certificate file — the record isn't changed after the result. Raise a new call if the agency re-issued it.")
    file.file.seek(0, os.SEEK_END)
    size = file.file.tell()
    file.file.seek(0)
    if size > MAX_CERT_BYTES:
        raise HTTPException(status_code=400, detail=f"The file is {size / 1024 / 1024:.1f} MB — keep the certificate under 15 MB.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="File storage (SharePoint) isn't configured on the server — ask the admin to set SHAREPOINT_SITE_ID.")
    folder = f"{sanitize_folder_name(settings.SHAREPOINT_FOLDER or 'ERP-media')}/Quality/Inspection-Calls/{sanitize_folder_name(call.call_number)}"
    uploaded = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder, file)
    call.certificate_file_name = file.filename
    call.certificate_file_path = uploaded["path"]
    call.certificate_content_type = file.content_type
    db.commit()
    return _responses(db, [_get(db, call_id)])[0]


@router.get("/{call_id}/certificate")
async def download_certificate(call_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    from app.utils.sharepoint import download_file_content
    call = _get(db, call_id, user)
    if not call.certificate_file_path:
        raise HTTPException(status_code=404, detail=f"{call.call_number} has no certificate file attached yet.")
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, call.certificate_file_path)
    return Response(content=content, media_type=call.certificate_content_type or content_type,
                    headers={"Content-Disposition": f'inline; filename="{call.certificate_file_name or "certificate"}"'})
