"""Work permits (permit-to-work / LOTO) on maintenance work orders.

    POST /maintenance/work-orders/{wo_id}/permits          issue   (Work Orders › Approve — the planner / permit issuer)
    POST /maintenance/permits/{id}/activate                accept  (the job's technician, or Work Orders › Edit)
    POST /maintenance/permits/{id}/close                   close   (Work Orders › Edit; isolation removed)
    POST /maintenance/permits/{id}/cancel                  cancel  (Work Orders › Approve, with reason)
    GET  /maintenance/permits/{id}/permit.pdf              print (PDF until a Word draft exists)

The printable permit is a managed Word document (entity type
maintenance_work_permit), like every generated document in the portal."""
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.data_scope import ensure_in_scope
from app.modules.maintenance.role_events import role_event
from app.core.permission_registry import can_perform, is_admin_user
from app.core.permissions import (
    ensure_feature_action, ensure_tab_action, require_app_access, require_feature_action, require_tab_access, require_tab_action,
)
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.maintenance import access  # noqa: F401 — registers the maintenance data scopes
from app.modules.maintenance import permits as svc
from app.modules.maintenance.models.asset import MaintenanceAsset
from app.modules.maintenance.models.permit import (
    MaintenanceWorkPermit, MAINTENANCE_PERMIT_TYPES, MAINTENANCE_PERMIT_TYPE_LABELS,
)
from app.modules.maintenance.models.work_order import MaintenanceWorkOrder
from app.modules.maintenance.service import _aware, now_utc, notify_many, user_names

try:  # managed Word documents framework (main/services/managed_documents.py)
    from app.modules.main.services import managed_documents
except ImportError:  # pragma: no cover
    managed_documents = None

router = APIRouter(prefix="/maintenance", tags=["Maintenance"], dependencies=[Depends(require_app_access("maintenance"))])

PERMIT_STATUS_LABEL = {"issued": "Issued", "active": "Active", "closed": "Closed", "cancelled": "Cancelled"}
MAX_VALIDITY_HOURS = 24 * 7


class PermitIssuePayload(BaseModel):
    permit_type: str
    work_description: str | None = None
    hazards: str | None = None
    isolation_points: str | None = None
    precautions: str | None = None
    ppe_required: str | None = None
    valid_from: datetime | None = None
    valid_to: datetime


class PermitClosePayload(BaseModel):
    isolation_removed: bool = False
    remarks: str | None = None


class PermitReasonPayload(BaseModel):
    reason: str


def _wo(db: Session, wo_id: int, user: User) -> MaintenanceWorkOrder:
    wo = db.query(MaintenanceWorkOrder).filter(MaintenanceWorkOrder.id == wo_id).first()
    if not wo:
        raise HTTPException(status_code=404, detail=f"Maintenance work order #{wo_id} not found.")
    ensure_in_scope(db, user, wo)
    return wo


def _permit(db: Session, permit_id: int, user: User) -> tuple[MaintenanceWorkPermit, MaintenanceWorkOrder]:
    p = db.get(MaintenanceWorkPermit, permit_id)
    if not p:
        raise HTTPException(status_code=404, detail=f"Work permit #{permit_id} not found — it may have been removed with its work order.")
    return p, _wo(db, p.work_order_id, user)


def _out(db: Session, p: MaintenanceWorkPermit) -> dict:
    names = user_names(db, [p.issued_by_id, p.accepted_by_id, p.closed_by_id])
    return {
        "id": p.id, "permit_number": p.permit_number, "work_order_id": p.work_order_id, "permit_type": p.permit_type,
        "permit_type_label": MAINTENANCE_PERMIT_TYPE_LABELS.get(p.permit_type, p.permit_type), "status": p.status,
        "work_description": p.work_description, "hazards": p.hazards, "isolation_points": p.isolation_points,
        "precautions": p.precautions, "ppe_required": p.ppe_required,
        "issued_by_id": p.issued_by_id, "issued_by_name": names.get(p.issued_by_id), "issued_at": p.issued_at,
        "valid_from": p.valid_from, "valid_to": p.valid_to, "expired": p.status == "active" and svc.is_expired(p),
        "accepted_by_id": p.accepted_by_id, "accepted_by_name": names.get(p.accepted_by_id), "accepted_at": p.accepted_at,
        "closed_by_id": p.closed_by_id, "closed_by_name": names.get(p.closed_by_id), "closed_at": p.closed_at,
        "isolation_removed": p.isolation_removed, "close_remarks": p.close_remarks, "cancel_reason": p.cancel_reason,
        "document_revision": p.document_revision or 0,
    }


@router.get("/permit-types")
async def permit_types(_user: User = Depends(require_tab_access("maintenance", "work_orders"))):
    return [{"value": k, "label": MAINTENANCE_PERMIT_TYPE_LABELS[k]} for k in MAINTENANCE_PERMIT_TYPES]


@router.get("/work-orders/{wo_id}/permits")
async def list_permits(wo_id: int, db: Session = Depends(get_db),
                       user: User = Depends(require_feature_action("maintenance", "work_orders", "permits", "view"))):
    wo = _wo(db, wo_id, user)
    return [_out(db, p) for p in svc.permits_for(db, wo.id)]


@router.post("/work-orders/{wo_id}/permits", status_code=201)
async def issue_permit(wo_id: int, payload: PermitIssuePayload, db: Session = Depends(get_db),
                       user: User = Depends(require_feature_action("maintenance", "work_orders", "permits", "create"))):
    wo = _wo(db, wo_id, user)
    if wo.status in ("completed", "closed", "cancelled"):
        raise HTTPException(status_code=409, detail=f"Can't issue a permit on {wo.wo_number}: the job is {wo.status}.")
    if payload.permit_type not in MAINTENANCE_PERMIT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid permit type '{payload.permit_type}'. Valid: {', '.join(MAINTENANCE_PERMIT_TYPES)}.")
    if not (payload.hazards or "").strip():
        raise HTTPException(status_code=400, detail="List the hazards of the job (e.g. 'Hot surfaces, stored hydraulic pressure') — the permit is the record the technician signs against.")
    if payload.permit_type == "electrical_isolation" and not (payload.isolation_points or "").strip():
        raise HTTPException(status_code=400, detail="An electrical isolation (LOTO) permit needs the isolation points — which breakers / valves are locked out and tagged.")
    now = now_utc()
    valid_from = _aware(payload.valid_from) or now
    valid_to = _aware(payload.valid_to)
    if valid_to <= valid_from:
        raise HTTPException(status_code=400, detail="'Valid to' must be after 'Valid from'.")
    if valid_to <= now:
        raise HTTPException(status_code=400, detail="'Valid to' is already in the past — a permit must still be valid when work starts.")
    if valid_to - valid_from > timedelta(hours=MAX_VALIDITY_HOURS):
        raise HTTPException(status_code=400, detail="A permit can be valid for at most 7 days. Issue a fresh permit for longer jobs (shift-wise re-validation).")
    dup = [p for p in svc.open_permits(db, wo.id) if p.permit_type == payload.permit_type]
    if dup:
        raise HTTPException(status_code=409, detail=f"{dup[0].permit_number} ({MAINTENANCE_PERMIT_TYPE_LABELS[payload.permit_type]}) is still open on {wo.wo_number}. Close or cancel it before issuing another of the same type.")
    p = MaintenanceWorkPermit(
        permit_number=svc.generate_permit_number(db), work_order_id=wo.id, permit_type=payload.permit_type,
        status="issued", work_description=(payload.work_description or wo.title or "").strip() or None,
        hazards=payload.hazards.strip(), isolation_points=(payload.isolation_points or "").strip() or None,
        precautions=(payload.precautions or "").strip() or None, ppe_required=(payload.ppe_required or "").strip() or None,
        issued_by_id=user.id, issued_at=now, valid_from=valid_from, valid_to=valid_to,
    )
    db.add(p)
    wo.permit_required = True  # once a permit is issued the job runs under it
    db.flush()
    if wo.assigned_to_id:
        notify_many(db, [wo.assigned_to_id], f"Permit {p.permit_number} issued for {wo.wo_number}",
                    f"{MAINTENANCE_PERMIT_TYPE_LABELS[p.permit_type]} — check the isolation at site and accept it before starting.",
                    "maintenance_permit_issued", "maintenance_work_order", wo.id, exclude_user_id=user.id)
    role_event(db, None, "permit_issued", title=f"Permit {p.permit_number} waiting for acceptance ({wo.wo_number})",
               message=f"{user.name or user.email} issued {MAINTENANCE_PERMIT_TYPE_LABELS[p.permit_type]} {p.permit_number} for {wo.wo_number} — "
                       "the technician must check the isolation at site and accept it before starting.",
               entity_type="maintenance_work_order", entity_id=wo.id, actor=user, record=wo, skip_user_ids={wo.assigned_to_id})
    db.commit()
    return _out(db, p)


@router.post("/permits/{permit_id}/activate")
async def activate_permit(permit_id: int, db: Session = Depends(get_db),
                          user: User = Depends(require_feature_action("maintenance", "work_orders", "permits", "approve"))):
    """The technician accepts the permit at site: isolation verified, the
    precautions understood. The job's assignee may always accept; anyone
    else needs Work Orders › Edit."""
    p, wo = _permit(db, permit_id, user)
    if wo.assigned_to_id != user.id:
        ensure_tab_action(user, "maintenance", "work_orders", "edit")
    if p.status != "issued":
        raise HTTPException(status_code=409, detail=f"{p.permit_number} is {PERMIT_STATUS_LABEL.get(p.status, p.status)} — only an Issued permit can be accepted.")
    now = now_utc()
    if svc.is_expired(p, now):
        raise HTTPException(status_code=409, detail=f"{p.permit_number} expired at {_aware(p.valid_to):%d-%m-%Y %H:%M}. Cancel it and have a new permit issued.")
    if p.valid_from and _aware(p.valid_from) > now:
        raise HTTPException(status_code=409, detail=f"{p.permit_number} is valid only from {_aware(p.valid_from):%d-%m-%Y %H:%M}.")
    if p.issued_by_id == user.id and not is_admin_user(user):
        raise HTTPException(status_code=409, detail="The permit issuer can't also accept it — the technician doing the job accepts it at site (two-person rule).")
    p.status, p.accepted_by_id, p.accepted_at = "active", user.id, now
    p.document_revision = (p.document_revision or 0) + 1
    db.commit()
    return _out(db, p)


@router.post("/permits/{permit_id}/close")
async def close_permit(permit_id: int, payload: PermitClosePayload, db: Session = Depends(get_db),
                       user: User = Depends(require_feature_action("maintenance", "work_orders", "permits", "edit"))):
    p, wo = _permit(db, permit_id, user)
    if p.status != "active":
        raise HTTPException(status_code=409, detail=f"{p.permit_number} is {PERMIT_STATUS_LABEL.get(p.status, p.status)} — only an Active permit is closed (cancel an Issued one).")
    if not payload.isolation_removed:
        raise HTTPException(status_code=400, detail="Confirm the isolation is removed, locks / tags taken off and the area handed back before closing the permit.")
    p.status, p.closed_by_id, p.closed_at = "closed", user.id, now_utc()
    p.isolation_removed = True
    p.close_remarks = (payload.remarks or "").strip() or None
    p.document_revision = (p.document_revision or 0) + 1
    db.commit()
    return _out(db, p)


@router.post("/permits/{permit_id}/cancel")
async def cancel_permit(permit_id: int, payload: PermitReasonPayload, db: Session = Depends(get_db),
                        user: User = Depends(require_feature_action("maintenance", "work_orders", "permits", "cancel"))):
    p, wo = _permit(db, permit_id, user)
    if p.status not in ("issued", "active"):
        raise HTTPException(status_code=409, detail=f"{p.permit_number} is already {PERMIT_STATUS_LABEL.get(p.status, p.status)}.")
    if not (payload.reason or "").strip():
        raise HTTPException(status_code=400, detail="Give the reason for cancelling the permit.")
    if p.status == "active" and wo.status == "in_progress":
        raise HTTPException(status_code=409, detail=f"{wo.wo_number} is in progress under {p.permit_number}. Put the job on hold (make the area safe) before cancelling its permit.")
    p.status, p.cancel_reason = "cancelled", payload.reason.strip()
    p.document_revision = (p.document_revision or 0) + 1
    db.commit()
    return _out(db, p)


# ── printable permit (managed Word document) ────────────────────────────────

def permit_spec(db: Session, p: MaintenanceWorkPermit) -> dict:
    wo = db.get(MaintenanceWorkOrder, p.work_order_id)
    asset = db.get(MaintenanceAsset, wo.asset_id) if wo else None
    names = user_names(db, [p.issued_by_id, p.accepted_by_id, p.closed_by_id])

    def dt(v):
        v = _aware(v)
        return v.strftime("%d-%m-%Y %H:%M") if v else None

    return {
        "title": "PERMIT TO WORK", "number": p.permit_number,
        "intro": f"{MAINTENANCE_PERMIT_TYPE_LABELS.get(p.permit_type, p.permit_type)}. No work may start until this permit is "
                 "accepted at site, and the permit must be closed (isolation removed) before the equipment is handed back.",
        "facts": [
            ("Work order", wo.wo_number if wo else None), ("Equipment", f"{asset.asset_code} — {asset.name}" if asset else None),
            ("Status", PERMIT_STATUS_LABEL.get(p.status, p.status)), ("Valid", f"{dt(p.valid_from)} to {dt(p.valid_to)}"),
            ("Issued by", names.get(p.issued_by_id)), ("Issued at", dt(p.issued_at)),
            ("Accepted by", names.get(p.accepted_by_id)), ("Accepted at", dt(p.accepted_at)),
            ("Closed by", names.get(p.closed_by_id)), ("Closed at", dt(p.closed_at)),
        ],
        "sections": [{"heading": "Work, hazards and controls", "columns": ["Item", "Details"], "widths": [1.8, 5.1],
                      "rows": [["Work", p.work_description or ""], ["Hazards", p.hazards or ""],
                               ["Isolation points (LOTO)", p.isolation_points or ""], ["Precautions", p.precautions or ""],
                               ["PPE required", p.ppe_required or ""]]}],
        "statement": "Isolation removed and area handed back." if p.isolation_removed else None,
        "remarks": p.close_remarks or p.cancel_reason,
        "signatures": [("Permit issuer", names.get(p.issued_by_id)), ("Permit acceptor", names.get(p.accepted_by_id)),
                       ("Closed by", names.get(p.closed_by_id))],
    }


def _permit_target(db: Session, permit_id: int, user: User, modify: bool):
    from app.modules.quality.reports.render import render_docx
    p, _wo_ = _permit(db, permit_id, user)
    ensure_feature_action(user, "maintenance", "work_orders", "permits", "print")
    if modify:
        ensure_tab_action(user, "maintenance", "work_orders", "edit")
        ensure_feature_action(user, "maintenance", "work_orders", "permits", "edit")
    spec = permit_spec(db, p)
    return managed_documents.DocumentTarget(
        entity_id=p.id, revision=p.document_revision or 0, title=f"Work permit {p.permit_number}",
        folder=managed_documents.sharepoint_folder("Maintenance", "Permits", p.permit_number),
        filename_stem=managed_documents.safe_filename(f"Permit-{p.permit_number}"),
        build_docx=lambda: render_docx(spec),
    )


if managed_documents:
    managed_documents.register(managed_documents.DocumentAdapter(
        entity_type=svc.PERMIT_ENTITY, app="maintenance", load=_permit_target,
        view_grant="maintenance:work_orders.permits:print", edit_grant="maintenance:work_orders.permits:edit"))


@router.get("/permits/{permit_id}/permit.pdf")
async def permit_pdf(permit_id: int, db: Session = Depends(get_db),
                     user: User = Depends(require_feature_action("maintenance", "work_orders", "permits", "print"))):
    from app.modules.quality.reports.render import render_pdf
    p, _wo_ = _permit(db, permit_id, user)
    spec = permit_spec(db, p)

    def render() -> bytes:
        try:
            return render_pdf(spec, f"Generated {now_utc():%d-%m-%Y %H:%M} UTC by {user.name or user.email} from the Premnath Rail portal.")
        except Exception as e:  # noqa: BLE001 — surface the real reason
            raise HTTPException(status_code=500, detail=f"Couldn't build the permit PDF: {e}")

    pdf = (await managed_documents.pdf_of_record(db, svc.PERMIT_ENTITY, p.id, p.document_revision or 0, render=render)
           if managed_documents else render())
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="Permit-{p.permit_number}.pdf"'})
