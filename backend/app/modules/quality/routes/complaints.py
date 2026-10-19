"""Customer complaint register, workflow, traceability and containment.
Rules live in services/complaints.py."""
import os
from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.data_scope import apply_scope, ensure_in_scope
from app.core.permission_registry import can_feature, can_view_tab
from app.core.permissions import ensure_feature_action, require_app_access, require_tab_action
from app.db.session import get_db
from app.modules.erp.models.project import Project
from app.modules.main.models.user import User
from app.modules.quality.models.capa import QualityCapa
from app.modules.quality.models.customer_complaint import (
    QualityCustomerComplaint, QualityComplaintPhoto, QUALITY_COMPLAINT_SEVERITIES, QUALITY_COMPLAINT_SOURCE_LABELS,
    QUALITY_COMPLAINT_STATUS_LABELS, QUALITY_COMPLAINT_STATUSES, QUALITY_COMPLAINT_OPEN_STATUSES,
)
from app.modules.quality.models.masters import QualityDefectCode, QualityMasterValue
from app.modules.quality.models.ncr import QualityNcr
from app.modules.quality.schemas.customer_complaint import (
    QualityCustomerComplaintCreate, QualityCustomerComplaintUpdate, QualityCustomerComplaintResponse,
    QualityComplaintInvestigatePayload, QualityComplaintResponsePayload, QualityComplaintFeedbackPayload,
    QualityComplaintClosePayload, QualityComplaintRejectPayload, QualityCustomerComplaintPhotoResponse,
)
from app.modules.quality.services import access, authz, complaints as complaint_service
from app.modules.quality.services.complaints import ComplaintError
from app.modules.quality.services.settings import active_master_values

router = APIRouter(prefix="/quality/complaints", tags=["Quality"], dependencies=[Depends(require_app_access("quality"))])

_CAN_CREATE = require_tab_action("quality", "complaints", "create")
_CAN_EDIT = require_tab_action("quality", "complaints", "edit")
MAX_PHOTO_BYTES = 8 * 1024 * 1024


def _project_label(p: Project | None) -> str | None:
    if not p:
        return None
    return " — ".join(x for x in (p.serial_number, p.model_name, p.client_company, f"PO {p.po_number}" if p.po_number else None) if x)


def _categories(db: Session) -> dict[str, str]:
    active_master_values(db, "complaint_categories")  # seeds on a fresh DB
    return {r.value: r.label for r in db.query(QualityMasterValue).filter(QualityMasterValue.list_key == "complaint_categories").all()}


def _hides_costs(user: User | None) -> bool:
    """The complaints costs switch binds roles that hold the Complaints tab."""
    return (user is not None and can_view_tab(user, "quality", "complaints")
            and not can_feature(user, "quality", "complaints", "costs", "view"))


def _responses(db: Session, rows: list[QualityCustomerComplaint], detail: bool = False,
               user: User | None = None) -> list[QualityCustomerComplaintResponse]:
    today = date.today()
    uids = ({r.received_by_id for r in rows} | {r.owner_id for r in rows}) - {None}
    users = {u.id: u.name or u.email for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    projects = {p.id: p for p in db.query(Project).filter(Project.id.in_({r.erp_project_id for r in rows} - {None})).all()}
    ncrs = {n.id: n.ncr_number for n in db.query(QualityNcr).filter(QualityNcr.id.in_({r.ncr_id for r in rows} - {None})).all()}
    capas = {c.id: c for c in db.query(QualityCapa).filter(QualityCapa.id.in_({r.capa_id for r in rows} - {None})).all()}
    repeats = {c.id: c.complaint_number for c in db.query(QualityCustomerComplaint).filter(
        QualityCustomerComplaint.id.in_({r.repeat_of_id for r in rows} - {None})).all()}
    codes = {c.id: f"{c.code} — {c.name}" for c in db.query(QualityDefectCode).filter(
        QualityDefectCode.id.in_({r.defect_code_id for r in rows} - {None})).all()}
    cats = _categories(db)
    out = []
    for r in rows:
        resp = QualityCustomerComplaintResponse.model_validate(r)
        resp.received_by_name = users.get(r.received_by_id)
        resp.owner_name = users.get(r.owner_id)
        resp.project_label = _project_label(projects.get(r.erp_project_id))
        resp.category_label = cats.get(r.category, r.category) if r.category else None
        resp.defect_code_label = codes.get(r.defect_code_id)
        resp.ncr_number = ncrs.get(r.ncr_id)
        capa = capas.get(r.capa_id)
        resp.capa_number = capa.capa_number if capa else None
        resp.capa_status = capa.status if capa else None
        resp.capa_effective = bool(capa and capa.status == "closed" and capa.effectiveness_result == "effective")
        resp.repeat_of_number = repeats.get(r.repeat_of_id)
        resp.total_cost = complaint_service.total_cost(r)
        resp.response_days = complaint_service.response_days(r)
        resp.age_days = ((r.closed_at.date() if r.closed_at else today) - r.complaint_date).days
        if detail:
            photos = db.query(QualityComplaintPhoto).filter(QualityComplaintPhoto.complaint_id == r.id).order_by(QualityComplaintPhoto.id).all()
            pu = {u.id: u.name or u.email for u in db.query(User).filter(User.id.in_({p.uploaded_by_id for p in photos} - {None})).all()} if photos else {}
            resp.photos = [QualityCustomerComplaintPhotoResponse(id=p.id, file_name=p.file_name, caption=p.caption,
                                                                 uploaded_by_id=p.uploaded_by_id, created_at=p.created_at,
                                                                 uploaded_by_name=pu.get(p.uploaded_by_id)) for p in photos]
        if _hides_costs(user):
            resp.replacement_cost = resp.travel_cost = resp.rework_cost = resp.other_cost = resp.total_cost = None
        out.append(resp)
    return out


def _get_or_404(db: Session, complaint_id: int, user: User | None = None, lock: bool = False) -> QualityCustomerComplaint:
    q = db.query(QualityCustomerComplaint).filter(QualityCustomerComplaint.is_deleted == False,  # noqa: E712
                                                 QualityCustomerComplaint.id == complaint_id)
    c = (q.with_for_update() if lock else q).first()
    if not c:
        raise HTTPException(status_code=404, detail=f"Customer complaint #{complaint_id} not found — it may have been removed.")
    if user is not None:
        ensure_in_scope(db, user, c)
    return c


def _detail(db: Session, complaint_id: int, user: User | None = None) -> QualityCustomerComplaintResponse:
    db.expire_all()
    return _responses(db, [_get_or_404(db, complaint_id)], detail=True, user=user)[0]


def _run(db: Session, complaint_id: int, fn, user: User | None = None) -> QualityCustomerComplaintResponse:
    try:
        fn()
    except ComplaintError as e:
        db.rollback()
        raise HTTPException(status_code=e.status, detail=str(e))
    db.commit()
    return _detail(db, complaint_id, user)


@router.get("/meta")
async def complaint_meta(db: Session = Depends(get_db)):
    projects = db.query(Project).filter(Project.is_deleted == False).order_by(Project.serial_number).all()  # noqa: E712
    cats = _categories(db)
    active = set(active_master_values(db, "complaint_categories"))
    return {
        "sources": QUALITY_COMPLAINT_SOURCE_LABELS, "statuses": QUALITY_COMPLAINT_STATUS_LABELS,
        "severities": list(QUALITY_COMPLAINT_SEVERITIES),
        "categories": [{"value": k, "label": v} for k, v in cats.items() if k in active],
        "projects": [{"id": p.id, "label": _project_label(p), "client_company": p.client_company} for p in projects],
    }


@router.get("/stats")
async def complaint_stats(db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    """Register KPIs: count, open, average response time, repeats, cost."""
    rows = apply_scope(db.query(QualityCustomerComplaint).filter(QualityCustomerComplaint.is_deleted == False), user, QualityCustomerComplaint).all()  # noqa: E712
    valid = [r for r in rows if r.status != "rejected"]
    resp_days = [d for d in (complaint_service.response_days(r) for r in valid) if d is not None]
    year = date.today().year
    return {
        "total": len(valid), "open": sum(1 for r in valid if r.status in QUALITY_COMPLAINT_OPEN_STATUSES),
        "this_year": sum(1 for r in valid if r.complaint_date.year == year),
        "repeats": sum(1 for r in valid if r.repeat_of_id),
        "avg_response_days": round(sum(resp_days) / len(resp_days), 1) if resp_days else None,
        "total_cost": None if _hides_costs(user) else round(sum(complaint_service.total_cost(r) for r in valid), 2),
    }


@router.get("/traceability")
async def traceability(item_id: int | None = None, batch: str | None = None, serial: str | None = None,
                       db: Session = Depends(get_db)):
    if not (batch or serial):
        raise HTTPException(status_code=422, detail="Enter a batch or serial number to trace.")
    return complaint_service.traceability(db, item_id=item_id, batch=batch, serial=serial)


@router.get("", response_model=list[QualityCustomerComplaintResponse])
async def list_complaints(
    status_filter: str | None = Query(None, alias="status"), severity: str | None = None, open_only: bool = False,
    search: str | None = None, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality")),
):
    q = apply_scope(db.query(QualityCustomerComplaint).filter(QualityCustomerComplaint.is_deleted == False), user, QualityCustomerComplaint)  # noqa: E712
    if status_filter:
        if status_filter not in QUALITY_COMPLAINT_STATUSES:
            raise HTTPException(status_code=422, detail=f"Unknown complaint status '{status_filter}'.")
        q = q.filter(QualityCustomerComplaint.status == status_filter)
    if open_only:
        q = q.filter(QualityCustomerComplaint.status.in_(QUALITY_COMPLAINT_OPEN_STATUSES))
    if severity:
        q = q.filter(QualityCustomerComplaint.severity == severity)
    if search:
        like = f"%{search}%"
        q = q.filter(QualityCustomerComplaint.customer_name.ilike(like) | QualityCustomerComplaint.complaint_number.ilike(like)
                     | QualityCustomerComplaint.description.ilike(like) | QualityCustomerComplaint.item_name.ilike(like)
                     | QualityCustomerComplaint.serial_number.ilike(like) | QualityCustomerComplaint.batch_number.ilike(like))
    return _responses(db, q.order_by(QualityCustomerComplaint.created_at.desc()).all(), user=user)


@router.post("", response_model=QualityCustomerComplaintResponse)
async def create_complaint(payload: QualityCustomerComplaintCreate, db: Session = Depends(get_db), user: User = Depends(_CAN_CREATE)):
    authz.ensure_may_assign(db, user, authz.COMPLAINT_OWNER_RULE, payload.owner_id)
    try:
        c = complaint_service.create(db, payload.model_dump(), user)
    except ComplaintError as e:
        db.rollback()
        raise HTTPException(status_code=e.status, detail=str(e))
    db.commit()
    return _detail(db, c.id, user)


@router.get("/{complaint_id}", response_model=QualityCustomerComplaintResponse)
async def get_complaint(complaint_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    _get_or_404(db, complaint_id, user)
    return _detail(db, complaint_id, user)


@router.get("/{complaint_id}/containment")
async def containment(complaint_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    c = _get_or_404(db, complaint_id, user)
    out = complaint_service.containment(db, c)
    out["traceability"] = complaint_service.traceability(db, item_id=c.item_id, batch=c.batch_number, serial=c.serial_number)
    out["related_complaints"] = [{"id": r.id, "complaint_number": r.complaint_number, "customer_name": r.customer_name,
                                  "status": r.status} for r in complaint_service.related_open(db, c)]
    return out


@router.patch("/{complaint_id}", response_model=QualityCustomerComplaintResponse)
async def update_complaint(complaint_id: int, payload: QualityCustomerComplaintUpdate, db: Session = Depends(get_db),
                           user: User = Depends(_CAN_EDIT)):
    changes = payload.model_dump(exclude_unset=True)
    if {"replacement_cost", "travel_cost", "rework_cost", "other_cost"} & set(changes) and can_view_tab(user, "quality", "complaints"):
        ensure_feature_action(user, "quality", "complaints", "costs", "view")  # editing costs implies seeing them
    c = _get_or_404(db, complaint_id, user, lock=True)
    authz.ensure_may_assign(db, user, authz.COMPLAINT_OWNER_RULE, changes.get("owner_id"), c.owner_id)
    return _run(db, complaint_id, user=user, fn=lambda: complaint_service.update(db, c, payload.model_dump(exclude_unset=True), user))


@router.post("/{complaint_id}/investigate", response_model=QualityCustomerComplaintResponse)
async def investigate(complaint_id: int, payload: QualityComplaintInvestigatePayload, db: Session = Depends(get_db),
                      user: User = Depends(_CAN_EDIT)):
    c = _get_or_404(db, complaint_id, user, lock=True)
    authz.ensure_may_assign(db, user, authz.COMPLAINT_OWNER_RULE, payload.owner_id, c.owner_id)
    return _run(db, complaint_id, user=user, fn=lambda: complaint_service.start_investigation(db, c, owner_id=payload.owner_id, user=user))


@router.post("/{complaint_id}/response", response_model=QualityCustomerComplaintResponse)
async def record_response(complaint_id: int, payload: QualityComplaintResponsePayload, db: Session = Depends(get_db),
                          user: User = Depends(_CAN_EDIT)):
    c = _get_or_404(db, complaint_id, user, lock=True)
    return _run(db, complaint_id, user=user, fn=lambda: complaint_service.record_response(db, c, response_text=payload.response_text, user=user))


@router.post("/{complaint_id}/feedback", response_model=QualityCustomerComplaintResponse)
async def feedback(complaint_id: int, payload: QualityComplaintFeedbackPayload, db: Session = Depends(get_db),
                   user: User = Depends(_CAN_EDIT)):
    c = _get_or_404(db, complaint_id, user, lock=True)
    return _run(db, complaint_id, user=user, fn=lambda: complaint_service.customer_feedback(
        db, c, accepted=payload.accepted, reference=payload.reference, remarks=payload.remarks, user=user))


@router.post("/{complaint_id}/close", response_model=QualityCustomerComplaintResponse)
async def close(complaint_id: int, payload: QualityComplaintClosePayload, db: Session = Depends(get_db),
                user: User = Depends(require_app_access("quality"))):
    c = _get_or_404(db, complaint_id, user, lock=True)
    return _decide(db, c, user, "close", payload.resolution_notes)


@router.post("/{complaint_id}/reject", response_model=QualityCustomerComplaintResponse)
async def reject(complaint_id: int, payload: QualityComplaintRejectPayload, db: Session = Depends(get_db),
                 user: User = Depends(require_app_access("quality"))):
    c = _get_or_404(db, complaint_id, user, lock=True)
    return _decide(db, c, user, "reject", payload.reason)


def _decide(db: Session, c: QualityCustomerComplaint, user: User, action: str, text: str | None) -> QualityCustomerComplaintResponse:
    """Close / reject — a Quality head's one-click decision, recorded in
    Organization › Approval Workflows › Customer complaint close / reject."""
    if not access.can_close_complaint(user):
        raise HTTPException(status_code=403, detail=f"Only a Quality head can {'close' if action == 'close' else 'reject'} a customer complaint.")
    needed = "customer_accepted" if action == "close" else "open"
    if c.status != needed:
        raise HTTPException(status_code=409, detail=f"{c.complaint_number} is {c.status.replace('_', ' ')}, so you can't "
                                                    f"{'close' if action == 'close' else 'reject'} it"
                                                    + (" — it closes once the customer accepted the response." if action == "close" else
                                                       " — only an open complaint is rejected as not valid."))
    authz.one_click(db, authz.COMPLAINT_KEY, entity_id=c.id, actor=user,
                    title=f"{c.complaint_number} — {'close' if action == 'close' else 'reject as not valid'}",
                    reference=c.complaint_number, context={"action": action}, proposal={"action": action, "text": text},
                    comment=(text or "").strip() or None)
    db.commit()
    return _detail(db, c.id, user)


# --- photos ------------------------------------------------------------------

def _require_sharepoint() -> None:
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="Photo storage (SharePoint) isn't configured on the server — ask the admin to set SHAREPOINT_SITE_ID.")


@router.post("/{complaint_id}/photos", response_model=QualityCustomerComplaintResponse)
async def upload_photos(complaint_id: int, files: list[UploadFile] = File(...), caption: str | None = Form(None),
                        db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    from app.utils.sharepoint import upload_file_to_sharepoint, sanitize_folder_name
    c = _get_or_404(db, complaint_id, user)
    if c.status in ("closed", "rejected"):
        raise HTTPException(status_code=409, detail=f"{c.complaint_number} is {c.status} — its photos are part of the record now.")
    sizes = []
    for f in files:
        if not f.content_type or not f.content_type.startswith("image/"):
            raise HTTPException(status_code=400, detail=f"'{f.filename}' isn't an image — upload JPG, PNG or WEBP photos.")
        f.file.seek(0, os.SEEK_END)
        sizes.append(f.file.tell())
        f.file.seek(0)
        if sizes[-1] > MAX_PHOTO_BYTES:
            raise HTTPException(status_code=400, detail=f"'{f.filename}' is {sizes[-1] / 1024 / 1024:.1f} MB — keep photos under 8 MB (resize and try again).")
    _require_sharepoint()
    folder = f"{sanitize_folder_name(settings.SHAREPOINT_FOLDER or 'ERP-media')}/Quality/Complaints/{sanitize_folder_name(c.complaint_number)}"
    for f, size in zip(files, sizes):
        uploaded = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder, f)
        db.add(QualityComplaintPhoto(complaint_id=c.id, file_name=f.filename or "photo", file_path=uploaded["path"],
                                     content_type=f.content_type, file_size=size, caption=(caption or "").strip() or None,
                                     uploaded_by_id=user.id))
    db.commit()
    return _detail(db, complaint_id, user)


@router.get("/{complaint_id}/photos/{photo_id}")
async def get_photo(complaint_id: int, photo_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    from app.utils.sharepoint import download_file_content
    _get_or_404(db, complaint_id, user)
    ph = db.query(QualityComplaintPhoto).filter(QualityComplaintPhoto.id == photo_id, QualityComplaintPhoto.complaint_id == complaint_id).first()
    if not ph:
        raise HTTPException(status_code=404, detail="Photo not found — it may have been removed. Refresh the page.")
    _require_sharepoint()
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, ph.file_path)
    return Response(content=content, media_type=ph.content_type or content_type,
                    headers={"Content-Disposition": f'inline; filename="{ph.file_name}"', "Cache-Control": "private, max-age=3600"})


@router.delete("/{complaint_id}/photos/{photo_id}", response_model=QualityCustomerComplaintResponse)
async def delete_photo(complaint_id: int, photo_id: int, db: Session = Depends(get_db), user: User = Depends(_CAN_EDIT)):
    c = _get_or_404(db, complaint_id, user)
    ph = db.query(QualityComplaintPhoto).filter(QualityComplaintPhoto.id == photo_id, QualityComplaintPhoto.complaint_id == complaint_id).first()
    if not ph:
        raise HTTPException(status_code=404, detail="Photo not found — it may have been removed already. Refresh the page.")
    if c.status in ("closed", "rejected"):
        raise HTTPException(status_code=409, detail=f"{c.complaint_number} is {c.status} — its photos can't be removed.")
    if ph.uploaded_by_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Only the person who added the photo (or an admin) can remove it.")
    db.delete(ph)
    db.commit()
    try:
        from app.utils.sharepoint import delete_file_from_sharepoint
        await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, ph.file_path)
    except HTTPException:
        pass
    return _detail(db, complaint_id, user)
