"""Service visits (SAP IW41 service confirmation) on a service request:
many visits, many engineers, each with time on site, travel, expenses, the
work done and the customer's sign-off. The visit costs and hours roll up
into the SR bill (erp/visits.py); each visit has a managed Word service
report (entity erp_service_visit_report).

Who may log: the SR's assigned engineer and the visit's engineer for their
own visits; anyone else needs Service Requests › Edit. All inside the
user's Service data scope."""
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core import assignee_rules
from app.core.permission_registry import can_perform
from app.core.permissions import ensure_feature_action, require_app_access, require_feature_action
from app.db.session import get_db
from app.modules.erp import billing as sr_billing, sensitive as sr_sensitive, sla as sr_sla, visits as svc
from app.modules.erp.models.project import Project
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.erp.models.service_request_attachment import ServiceRequestAttachment
from app.modules.erp.models.service_visit import ServiceVisit
from app.modules.erp.routes.service_requests import _ensure_unlocked, _get_live_sr, _recompute_billing, _write_audit
from app.modules.main.models.user import User

try:  # managed Word documents framework (main/services/managed_documents.py)
    from app.modules.main.services import managed_documents
except ImportError:  # pragma: no cover
    managed_documents = None

router = APIRouter(prefix="/erp/service-requests", tags=["ERP - Service Requests"],
                   dependencies=[Depends(require_app_access("erp"))])

_COST_FIELDS = ("work_hours", "travel_hours", "km", "travel_cost", "stay_cost", "misc_cost")

# Role "Assign to" rule for the visit's engineer (core/assignee_rules.PICKERS,
# declared in core/features/erp.py).
RULE_KEY = "erp:service_requests.visits"


class ServiceVisitPayload(BaseModel):
    engineer_id: int | None = None
    visit_date: date | None = None
    travel_start: datetime | None = None
    arrive_at: datetime | None = None
    depart_at: datetime | None = None
    work_hours: float | None = None      # blank = depart − arrive
    travel_hours: float | None = None
    km: float | None = None
    travel_cost: float | None = None
    stay_cost: float | None = None
    misc_cost: float | None = None
    work_done: str | None = None
    customer_sign_name: str | None = None
    customer_signed_at: datetime | None = None
    customer_remarks: str | None = None
    report_attachment_id: int | None = None


def _names(db: Session, ids) -> dict[int, str]:
    ids = {i for i in ids if i}
    return {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}


def _out(db: Session, v: ServiceVisit, names: dict | None = None) -> dict:
    names = names if names is not None else _names(db, [v.engineer_id, v.created_by_id])
    return {
        "id": v.id, "service_request_id": v.service_request_id, "engineer_id": v.engineer_id,
        "engineer_name": names.get(v.engineer_id), "visit_date": v.visit_date, "travel_start": v.travel_start,
        "arrive_at": v.arrive_at, "depart_at": v.depart_at, "work_hours": v.work_hours, "travel_hours": v.travel_hours,
        "km": v.km, "travel_cost": v.travel_cost, "stay_cost": v.stay_cost, "misc_cost": v.misc_cost,
        "work_done": v.work_done, "customer_sign_name": v.customer_sign_name, "customer_signed_at": v.customer_signed_at,
        "customer_remarks": v.customer_remarks, "report_attachment_id": v.report_attachment_id,
        "document_revision": v.document_revision or 0, "created_by_id": v.created_by_id,
        "created_by_name": names.get(v.created_by_id), "created_at": v.created_at,
    }


def _summary(db: Session, sr: ServiceRequest) -> dict:
    visits = svc.visits_for(db, sr.id)
    names = _names(db, [x for v in visits for x in (v.engineer_id, v.created_by_id)])
    labour, travel = svc.rates(db)
    return {
        "visits": [_out(db, v, names) for v in visits], "totals": svc.hours_summary(db, sr.id),
        "labour_rate_per_hour": labour, "travel_rate_per_hour": travel,
        "service_cost": sr.service_cost, "transport_cost": sr.transport_cost, "accommodation_cost": sr.accommodation_cost,
        "miscellaneous_cost": sr.miscellaneous_cost, "total_bill": sr.total_bill,
        "first_response_at": sr.first_response_at, "sla_response_state": sr.sla_response_state,
        "sla_resolution_state": sr.sla_resolution_state,
    }


def _ensure_can_log(sr: ServiceRequest, user: User, engineer_id: int | None) -> None:
    """Own visits: the SR's assigned engineer, or the engineer of the visit.
    Anyone else (planning other engineers' visits): Service Requests › Edit."""
    if can_perform(user, "erp", "service_requests", "edit"):
        return
    if engineer_id == user.id or (engineer_id is None and sr.assigned_service_person_id == user.id):
        return
    raise HTTPException(
        status_code=403,
        detail="Only the visiting engineer can log their own visit. Logging or changing another engineer's visit needs "
               "Service & Commissioning › Service Requests › Edit.",
    )


def _ensure_may_pick_engineer(db: Session, user: User, engineer_id: int | None) -> None:
    """Logging a visit for another engineer: the role's assign-to rule. Your
    own visit is never restricted. An unknown / inactive engineer is left to
    _validate, which says so."""
    if not engineer_id or engineer_id == user.id:
        return
    eng = db.query(User).filter(User.id == engineer_id, User.is_active == True).first()  # noqa: E712
    if eng:
        assignee_rules.ensure_allowed(db, user, RULE_KEY, eng)


def _ensure_open(db: Session, sr: ServiceRequest) -> None:
    status = (sr.status or "").lower()
    if status not in svc.VISIT_OPEN_STATUSES:
        raise HTTPException(
            status_code=409,
            detail=f"{sr.request_number} is {status.replace('_', ' ') or 'open'} — visits are logged once an engineer is assigned "
                   "and until the work is completed (Assigned, Scheduled, In Progress, Pending Parts, On Hold, Work Completed).",
        )
    live = sr_billing.linked_invoice(db, sr)
    if live is not None and live.status in ("pending", "posted"):
        raise HTTPException(
            status_code=409,
            detail=f"{sr.request_number} is already invoiced ({live.invoice_number}), so its visits (which make up the bill) "
                   "can't change. Ask Finance to cancel the draft invoice first.",
        )


def _validate(db: Session, sr: ServiceRequest, v: ServiceVisit) -> None:
    from app.modules.erp.sla import _aware, now_utc
    eng = db.query(User).filter(User.id == v.engineer_id, User.is_active == True).first()  # noqa: E712
    if not eng:
        raise HTTPException(status_code=404, detail=f"Engineer #{v.engineer_id} not found or inactive — pick the engineer again.")
    if v.visit_date is None:
        raise HTTPException(status_code=400, detail="Visit date is required.")
    if v.visit_date > date.today():
        raise HTTPException(status_code=400, detail="Visit date can't be in the future — log a visit after it happens.")
    opened = _aware(sr.opened_at or sr.created_at)
    if opened and v.visit_date < opened.date():
        raise HTTPException(status_code=400, detail=f"Visit date is before {sr.request_number} was raised ({opened:%d-%m-%Y}).")
    ts, arr, dep = _aware(v.travel_start), _aware(v.arrive_at), _aware(v.depart_at)
    now = now_utc()
    for label, t in (("Travel start", ts), ("Arrival", arr), ("Departure", dep)):
        if t and t > now:
            raise HTTPException(status_code=400, detail=f"{label} time can't be in the future.")
    if ts and arr and arr < ts:
        raise HTTPException(status_code=400, detail="Arrival at site can't be before travel started.")
    if arr and dep and dep <= arr:
        raise HTTPException(status_code=400, detail="Departure must be after arrival at site.")
    if v.work_hours is None:
        if not (arr and dep):
            raise HTTPException(status_code=400, detail="Enter the hours worked on site, or both arrival and departure times.")
        v.work_hours = round((dep - arr).total_seconds() / 3600, 2)
    if not (0 < v.work_hours <= 24):
        raise HTTPException(status_code=400, detail="Hours worked must be more than 0 and at most 24 per visit — log a multi-day job as one visit per day.")
    if v.travel_hours is None and ts and arr:
        v.travel_hours = round((arr - ts).total_seconds() / 3600, 2)
    for f in _COST_FIELDS:
        val = getattr(v, f)
        if val is None:
            setattr(v, f, 0.0)
        elif val < 0:
            raise HTTPException(status_code=400, detail=f"{f.replace('_', ' ').capitalize()} can't be negative.")
    if (v.travel_hours or 0) > 48:
        raise HTTPException(status_code=400, detail="Travel hours look wrong (more than 48 for one visit).")
    if not (v.work_done or "").strip():
        raise HTTPException(status_code=400, detail="Describe the work done on this visit — it goes on the customer's service report.")
    if v.customer_signed_at and not (v.customer_sign_name or "").strip():
        raise HTTPException(status_code=400, detail="Enter the name of the customer's representative who signed the service report.")
    if v.customer_sign_name and not v.customer_signed_at:
        v.customer_signed_at = now
    if v.report_attachment_id and not db.query(ServiceRequestAttachment.id).filter(
        ServiceRequestAttachment.id == v.report_attachment_id, ServiceRequestAttachment.service_request_id == sr.id,
    ).first():
        raise HTTPException(status_code=404, detail="The signed report file isn't attached to this service request — upload it on the Attachments tab first.")


def _visit(db: Session, sr: ServiceRequest, visit_id: int) -> ServiceVisit:
    v = db.query(ServiceVisit).filter(ServiceVisit.id == visit_id, ServiceVisit.service_request_id == sr.id).first()
    if not v:
        raise HTTPException(status_code=404, detail=f"Visit #{visit_id} isn't on {sr.request_number} — refresh the page.")
    return v


def _after_change(db: Session, sr: ServiceRequest) -> None:
    db.flush()
    _recompute_billing(db, sr)  # rolls the visits up (erp/visits.py) and re-totals the bill


@router.get("/{sr_id}/visits")
async def list_visits(sr_id: int, db: Session = Depends(get_db),
                      user: User = Depends(require_feature_action("erp", "service_requests", "visits", "view"))):
    sr = _get_live_sr(db, sr_id, user=user)
    return sr_sensitive.mask_dict(user, _summary(db, sr))


@router.post("/{sr_id}/visits", status_code=201)
async def add_visit(sr_id: int, payload: ServiceVisitPayload, db: Session = Depends(get_db),
                    user: User = Depends(require_feature_action("erp", "service_requests", "visits", "create"))):
    sr = _get_live_sr(db, sr_id, user=user)
    engineer_id = payload.engineer_id or user.id
    _ensure_can_log(sr, user, engineer_id)
    _ensure_may_pick_engineer(db, user, engineer_id)
    _ensure_unlocked(sr)
    _ensure_open(db, sr)
    data = payload.model_dump()
    sr_sensitive.ensure_may_change(user, data, None, ("travel_cost", "stay_cost", "misc_cost"), "visit expenses")
    data["engineer_id"] = engineer_id
    data["visit_date"] = data["visit_date"] or date.today()
    v = ServiceVisit(service_request_id=sr.id, created_by_id=user.id, **data)
    _validate(db, sr, v)
    db.add(v)
    _after_change(db, sr)
    names = _names(db, [engineer_id])
    _write_audit(db, sr.id, "visit_logged", user,
                 summary=f"{user.name or user.email} logged a visit by {names.get(engineer_id)} on {v.visit_date:%d-%m-%Y}: "
                         f"{v.work_hours:g} h on site, {v.travel_hours or 0:g} h travel.")
    db.commit()
    db.refresh(sr)
    return sr_sensitive.mask_dict(user, _summary(db, sr))


@router.patch("/{sr_id}/visits/{visit_id}")
async def update_visit(sr_id: int, visit_id: int, payload: ServiceVisitPayload, db: Session = Depends(get_db),
                       user: User = Depends(require_feature_action("erp", "service_requests", "visits", "edit"))):
    sr = _get_live_sr(db, sr_id, user=user)
    v = _visit(db, sr, visit_id)
    data = payload.model_dump(exclude_unset=True)
    sr_sensitive.ensure_may_change(user, data, v, ("travel_cost", "stay_cost", "misc_cost"), "visit expenses")
    _ensure_can_log(sr, user, v.engineer_id)
    if "engineer_id" in data and data["engineer_id"] != v.engineer_id:
        _ensure_can_log(sr, user, data["engineer_id"])
        _ensure_may_pick_engineer(db, user, data["engineer_id"])
    _ensure_unlocked(sr)
    _ensure_open(db, sr)
    recompute_hours = ("arrive_at" in data or "depart_at" in data) and "work_hours" not in data
    for k, val in data.items():
        setattr(v, k, val)
    if recompute_hours:
        v.work_hours = None
    _validate(db, sr, v)
    v.document_revision = (v.document_revision or 0) + 1
    _after_change(db, sr)
    _write_audit(db, sr.id, "visit_updated", user, summary=f"{user.name or user.email} updated the {v.visit_date:%d-%m-%Y} visit.")
    db.commit()
    db.refresh(sr)
    return sr_sensitive.mask_dict(user, _summary(db, sr))


@router.delete("/{sr_id}/visits/{visit_id}")
async def delete_visit(sr_id: int, visit_id: int, db: Session = Depends(get_db),
                       user: User = Depends(require_feature_action("erp", "service_requests", "visits", "delete"))):
    sr = _get_live_sr(db, sr_id, user=user)
    v = _visit(db, sr, visit_id)
    _ensure_can_log(sr, user, v.engineer_id)
    _ensure_unlocked(sr)
    _ensure_open(db, sr)
    if v.customer_signed_at and not can_perform(user, "erp", "service_requests", "edit"):
        raise HTTPException(status_code=403, detail="This visit's report is signed by the customer — only a user with Service Requests › Edit can remove it.")
    when = v.visit_date
    db.delete(v)
    _after_change(db, sr)
    _write_audit(db, sr.id, "visit_deleted", user, summary=f"{user.name or user.email} removed the {when:%d-%m-%Y} visit.")
    db.commit()
    db.refresh(sr)
    return sr_sensitive.mask_dict(user, _summary(db, sr))


# ── service report per visit (managed Word document) ────────────────────────

def visit_report_spec(db: Session, v: ServiceVisit) -> dict:
    sr = db.get(ServiceRequest, v.service_request_id)
    project = db.get(Project, sr.project_id) if sr else None
    names = _names(db, [v.engineer_id])
    _aw = sr_sla._aware

    def dt(x):
        x = _aw(x)
        return x.strftime("%d-%m-%Y %H:%M") if x else None

    return {
        "title": "FIELD SERVICE REPORT", "number": f"{sr.request_number}-V{v.id}" if sr else f"V{v.id}",
        "intro": sr.issue_title if sr else None,
        "facts": [
            ("Customer", (project.client_company if project else None)), ("Machine", f"{project.serial_number} {project.model_name or ''}".strip() if project else None),
            ("Site", ", ".join(x for x in ((project.site_name, project.site_location) if project else ()) if x) or None),
            ("Visit date", v.visit_date.strftime("%d-%m-%Y")), ("Engineer", names.get(v.engineer_id)),
            ("Arrived / departed", f"{dt(v.arrive_at) or '—'} / {dt(v.depart_at) or '—'}"),
            ("Hours on site", f"{v.work_hours:g}"), ("Travel", f"{v.travel_hours or 0:g} h, {v.km or 0:g} km"),
        ],
        "sections": [{"heading": "Work done", "columns": ["Details"], "widths": [6.9], "rows": [[v.work_done or ""]]}],
        "remarks": v.customer_remarks,
        "statement": (f"Work accepted by {v.customer_sign_name} on {dt(v.customer_signed_at)}." if v.customer_signed_at else None),
        "signatures": [("Service engineer", names.get(v.engineer_id)), ("Customer representative", v.customer_sign_name)],
    }


def _visit_target(db: Session, visit_id: int, user: User, modify: bool):
    from app.modules.quality.reports.render import render_docx
    v = db.get(ServiceVisit, visit_id)
    if not v:
        raise HTTPException(status_code=404, detail=f"Visit #{visit_id} not found.")
    sr = _get_live_sr(db, v.service_request_id, user=user)
    ensure_feature_action(user, "erp", "service_requests", "visits", "edit" if modify else "view")
    if modify:
        _ensure_can_log(sr, user, v.engineer_id)
    spec = visit_report_spec(db, v)
    return managed_documents.DocumentTarget(
        entity_id=v.id, revision=v.document_revision or 0, title=f"Service report {spec['number']}",
        folder=managed_documents.sharepoint_folder("Service", sr.request_number, "Visits"),
        filename_stem=managed_documents.safe_filename(f"ServiceReport-{spec['number']}"),
        build_docx=lambda: render_docx(spec),
    )


if managed_documents:
    managed_documents.register(managed_documents.DocumentAdapter(
        entity_type=svc.VISIT_REPORT_ENTITY, app="erp", load=_visit_target,
        view_grant="erp:service_requests.visits:view", edit_grant="erp:service_requests.visits:edit"))


@router.get("/{sr_id}/visits/{visit_id}/report.pdf")
async def visit_report_pdf(sr_id: int, visit_id: int, db: Session = Depends(get_db),
                           user: User = Depends(require_feature_action("erp", "service_requests", "visits", "print"))):
    from app.modules.quality.reports.render import render_pdf
    sr = _get_live_sr(db, sr_id, user=user)
    v = _visit(db, sr, visit_id)
    spec = visit_report_spec(db, v)

    def render() -> bytes:
        try:
            return render_pdf(spec, f"Generated {datetime.now():%d-%m-%Y %H:%M} by {user.name or user.email} from the Premnath Rail portal.")
        except Exception as e:  # noqa: BLE001 — surface the real reason
            raise HTTPException(status_code=500, detail=f"Couldn't build the service report PDF: {e}")

    pdf = (await managed_documents.pdf_of_record(db, svc.VISIT_REPORT_ENTITY, v.id, v.document_revision or 0, render=render)
           if managed_documents else render())
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="ServiceReport-{spec["number"]}.pdf"'})
