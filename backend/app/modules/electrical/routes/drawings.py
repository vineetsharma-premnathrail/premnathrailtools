"""Electrical drawing register: drawings per job, each with R0, R1 …
revisions that go draft → submitted → approved/rejected. Approving a
revision supersedes the drawing's previous approved one. Files live in
SharePoint under Electrical-media/<job number>/<drawing number>/ and are
streamed through the backend — the raw SharePoint URL is never exposed."""
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form, Query, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permission_registry import can_feature, can_view_tab
from app.core.permissions import (
    ensure_can_delete, require_app_access, require_feature_action, require_tab_access, require_tab_action,
)
from app.db.session import get_db
from app.modules.electrical.models.drawing import (
    ElectricalDrawing, ElectricalDrawingRevision, ELECTRICAL_DRAWING_TYPES, ELECTRICAL_OPEN_REVISION_STATUSES,
)
from app.modules.electrical import access
from app.modules.electrical.models.job import ElectricalJob
from app.modules.electrical.schemas.drawing import (
    ElectricalDrawingUpdate, ElectricalRevisionDecisionPayload, ElectricalDrawingResponse,
    ElectricalDrawingRevisionResponse,
)
from app.modules.electrical.service import (
    ELECTRICAL_APP, ensure_job_view, get_job_or_404, inline_file_headers, require_working, user_names,
)
from app.modules.main.models.user import User
from app.modules.organization.models.approval import ApprovalRequest
from app.utils.notifications import notify_user
from app.utils.sharepoint import (
    upload_file_to_sharepoint, delete_file_from_sharepoint, download_file_content, sanitize_folder_name,
)

router = APIRouter(
    prefix="/electrical", tags=["Electrical"],
    dependencies=[Depends(require_app_access(ELECTRICAL_APP))],
)

# Any Electrical user — record-level access is the job's data scope.
_VIEWER = require_app_access(ELECTRICAL_APP)

# Electrical › RRV Electrical Jobs › Drawings (app/core/features/electrical.py); approving stays on
# Electrical › Drawings › Approve.
_CAN_CREATE = require_feature_action("electrical", "jobs", "drawings", "create")
_CAN_EDIT = require_feature_action("electrical", "jobs", "drawings", "edit")
_CAN_DELETE = require_feature_action("electrical", "jobs", "drawings", "delete")
_CAN_SUBMIT = require_feature_action("electrical", "jobs", "drawings", "submit")
_CAN_APPROVE = require_tab_action(ELECTRICAL_APP, "drawings", "approve")

_STORAGE_NOT_CONFIGURED = (
    "File storage isn't configured on this server (SHAREPOINT_SITE_ID is empty), so drawing files can't be "
    "uploaded or opened. Ask the portal administrator to set the SharePoint site in the backend environment."
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _live_revisions(d: ElectricalDrawing) -> list[ElectricalDrawingRevision]:
    return sorted((r for r in d.revisions if not r.is_deleted), key=lambda r: r.revision_index)


def _to_responses(db: Session, drawings: list[ElectricalDrawing]) -> list[ElectricalDrawingResponse]:
    job_ids = {d.job_id for d in drawings}
    jobs = {j.id: j for j in db.query(ElectricalJob).filter(ElectricalJob.id.in_(job_ids)).all()} if job_ids else {}
    revs = {d.id: _live_revisions(d) for d in drawings}
    live = _live_requests(db, [r.id for rs in revs.values() for r in rs if r.status == "submitted"])
    names = user_names(db, {r.prepared_by_id for rs in revs.values() for r in rs} | {r.decided_by_id for rs in revs.values() for r in rs})
    out = []
    for d in drawings:
        resp = ElectricalDrawingResponse.model_validate(d)
        job = jobs.get(d.job_id)
        resp.job_number = job.job_number if job else None
        resp.job_title = job.title if job else None
        rev_resps = []
        for r in revs[d.id]:
            rr = ElectricalDrawingRevisionResponse.model_validate(r)
            rr.prepared_by_name = names.get(r.prepared_by_id)
            rr.decided_by_name = names.get(r.decided_by_id)
            rr.has_file = bool(r.sharepoint_path)
            rr.approval_request_id = live.get(r.id)
            rev_resps.append(rr)
        resp.revisions = rev_resps
        if rev_resps:
            resp.latest_revision_label = rev_resps[-1].revision_label
            resp.latest_revision_status = rev_resps[-1].status
        approved = next((r for r in reversed(rev_resps) if r.status == "approved"), None)
        resp.approved_revision_label = approved.revision_label if approved else None
        out.append(resp)
    return out


def _live_requests(db: Session, revision_ids: list[int]) -> dict[int, int]:
    """revision id → its pending approval-engine request id (none for a
    revision submitted before the engine, which the old routes decide)."""
    if not revision_ids:
        return {}
    rows = db.query(ApprovalRequest.entity_id, ApprovalRequest.id).filter(
        ApprovalRequest.entity_type == access.REVISION_ENTITY, ApprovalRequest.entity_id.in_(revision_ids),
        ApprovalRequest.status == "pending",
    ).all()
    return {entity_id: req_id for entity_id, req_id in rows}


def _get_drawing(db: Session, drawing_id: int) -> ElectricalDrawing:
    d = db.query(ElectricalDrawing).filter(ElectricalDrawing.id == drawing_id, ElectricalDrawing.is_deleted == False).first()  # noqa: E712
    if not d:
        raise HTTPException(status_code=404, detail=f"Drawing #{drawing_id} not found (it may have been deleted).")
    return d


def _get_revision(db: Session, revision_id: int) -> ElectricalDrawingRevision:
    r = db.query(ElectricalDrawingRevision).filter(
        ElectricalDrawingRevision.id == revision_id, ElectricalDrawingRevision.is_deleted == False  # noqa: E712
    ).first()
    if not r:
        raise HTTPException(status_code=404, detail=f"Drawing revision #{revision_id} not found (it may have been discarded).")
    return r


def _check_type(drawing_type: str | None) -> None:
    if drawing_type and drawing_type not in ELECTRICAL_DRAWING_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid drawing type '{drawing_type}'. Use one of: {', '.join(ELECTRICAL_DRAWING_TYPES)}.")


def _check_number_free(db: Session, job_id: int, number: str, current_id: int | None = None) -> None:
    clash = db.query(ElectricalDrawing).filter(
        ElectricalDrawing.job_id == job_id, func.upper(ElectricalDrawing.drawing_number) == number.upper(),
        ElectricalDrawing.is_deleted == False,  # noqa: E712
    )
    if current_id:
        clash = clash.filter(ElectricalDrawing.id != current_id)
    if clash.first():
        raise HTTPException(status_code=409, detail=f"Drawing number '{number}' is already used on this job. Use a different number.")


def _auto_number(db: Session, job: ElectricalJob) -> str:
    count = db.query(ElectricalDrawing).filter(ElectricalDrawing.job_id == job.id).count()
    n = count + 1
    while True:
        candidate = f"{job.job_number}-E{n:02d}"
        if not db.query(ElectricalDrawing).filter(ElectricalDrawing.job_id == job.id, ElectricalDrawing.drawing_number == candidate).first():
            return candidate
        n += 1


async def _store_file(job: ElectricalJob, drawing: ElectricalDrawing, revision: ElectricalDrawingRevision, upload: UploadFile) -> None:
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_STORAGE_NOT_CONFIGURED)
    folder = f"Electrical-media/{sanitize_folder_name(job.job_number)}/{sanitize_folder_name(drawing.drawing_number)}"
    result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder, upload)
    old_path = revision.sharepoint_path
    revision.file_name = result["name"]
    revision.sharepoint_path = result["path"]
    revision.sharepoint_url = result.get("webUrl")
    revision.file_size = result.get("size")
    revision.mime_type = upload.content_type
    if old_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, old_path)
        except Exception:
            pass  # the replaced file is orphaned in SharePoint, but the revision now points at the new one


def _ensure_drawings_view(user: User) -> None:
    """Job › Drawings view, or the Electrical › Drawings tab (it lists them all)."""
    ensure_job_view(user, can_feature(user, "electrical", "jobs", "drawings", "view")
                    or can_view_tab(user, "electrical", "drawings"), "drawings")


def _require_preparer(user: User, revision: ElectricalDrawingRevision, action: str) -> None:
    if user.role != "admin" and revision.prepared_by_id and revision.prepared_by_id != user.id:
        raise HTTPException(status_code=403, detail=f"Only the person who prepared {revision.revision_label} (or an admin) can {action}.")


# ---------------------------------------------------------------------------
# Drawings
# ---------------------------------------------------------------------------

@router.get("/drawings", response_model=list[ElectricalDrawingResponse])
async def list_drawings(
    job_id: int | None = None,
    drawing_type: str | None = None,
    revision_status: str | None = Query(None, description="Status of the latest revision"),
    as_built: bool | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access(ELECTRICAL_APP, "drawings")),
):
    query = db.query(ElectricalDrawing).join(ElectricalJob, ElectricalJob.id == ElectricalDrawing.job_id).filter(
        ElectricalDrawing.is_deleted == False, ElectricalJob.is_deleted == False  # noqa: E712
    )
    query = access.scope_jobs(query, db, _tab)
    if job_id:
        query = query.filter(ElectricalDrawing.job_id == job_id)
    if drawing_type:
        query = query.filter(ElectricalDrawing.drawing_type == drawing_type)
    if as_built is not None:
        query = query.filter(ElectricalDrawing.is_as_built == as_built)
    if search:
        like = f"%{search}%"
        query = query.filter(
            ElectricalDrawing.drawing_number.ilike(like) | ElectricalDrawing.title.ilike(like) | ElectricalJob.job_number.ilike(like)
        )
    responses = _to_responses(db, query.order_by(ElectricalDrawing.updated_at.desc()).all())
    if revision_status:
        responses = [r for r in responses if r.latest_revision_status == revision_status]
    return responses


@router.get("/jobs/{job_id}/drawings", response_model=list[ElectricalDrawingResponse])
async def list_job_drawings(job_id: int, db: Session = Depends(get_db), user: User = Depends(_VIEWER)):
    _ensure_drawings_view(user)
    get_job_or_404(db, job_id, user=user)
    drawings = db.query(ElectricalDrawing).filter(
        ElectricalDrawing.job_id == job_id, ElectricalDrawing.is_deleted == False  # noqa: E712
    ).order_by(ElectricalDrawing.drawing_number).all()
    return _to_responses(db, drawings)


@router.post("/jobs/{job_id}/drawings", response_model=ElectricalDrawingResponse)
async def create_drawing(
    job_id: int,
    title: str = Form(...),
    drawing_type: str = Form("schematic"),
    drawing_number: str | None = Form(None),
    is_as_built: bool = Form(False),
    description: str | None = Form(None),
    change_summary: str | None = Form(None),
    file: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(_CAN_CREATE),
):
    job = get_job_or_404(db, job_id, lock=True, user=user)
    require_working(job, "add drawings")
    if not title.strip():
        raise HTTPException(status_code=400, detail="Drawing title is required.")
    _check_type(drawing_type)
    number = (drawing_number or "").strip().upper() or _auto_number(db, job)
    if len(number) > 80:
        raise HTTPException(status_code=400, detail="Drawing number can be at most 80 characters.")
    _check_number_free(db, job_id, number)
    drawing = ElectricalDrawing(
        job_id=job_id, drawing_number=number, title=title.strip(), drawing_type=drawing_type,
        is_as_built=is_as_built, description=description, created_by_id=user.id,
    )
    db.add(drawing)
    db.flush()
    revision = ElectricalDrawingRevision(
        drawing_id=drawing.id, revision_index=0, revision_label="R0", status="draft",
        change_summary=(change_summary or "").strip() or "First issue", prepared_by_id=user.id,
    )
    db.add(revision)
    if file is not None and file.filename:
        await _store_file(job, drawing, revision, file)
    db.commit()
    db.refresh(drawing)
    return _to_responses(db, [drawing])[0]


@router.get("/drawings/{drawing_id}", response_model=ElectricalDrawingResponse)
async def get_drawing(drawing_id: int, db: Session = Depends(get_db), user: User = Depends(_VIEWER)):
    _ensure_drawings_view(user)
    drawing = _get_drawing(db, drawing_id)
    get_job_or_404(db, drawing.job_id, user=user)
    return _to_responses(db, [drawing])[0]


@router.patch("/drawings/{drawing_id}", response_model=ElectricalDrawingResponse)
async def update_drawing(drawing_id: int, payload: ElectricalDrawingUpdate, db: Session = Depends(get_db), _perm: User = Depends(_CAN_EDIT)):
    drawing = _get_drawing(db, drawing_id)
    job = get_job_or_404(db, drawing.job_id, lock=True, user=_perm)
    require_working(job, "change its drawings")
    updates = payload.model_dump(exclude_unset=True)
    _check_type(updates.get("drawing_type"))
    if updates.get("drawing_number"):
        updates["drawing_number"] = updates["drawing_number"].strip().upper()
        _check_number_free(db, job.id, updates["drawing_number"], current_id=drawing.id)
    if updates.get("title"):
        updates["title"] = updates["title"].strip()
    for field, val in updates.items():
        setattr(drawing, field, val)
    db.commit()
    db.refresh(drawing)
    return _to_responses(db, [drawing])[0]


@router.delete("/drawings/{drawing_id}")
async def delete_drawing(drawing_id: int, db: Session = Depends(get_db), user: User = Depends(_CAN_DELETE)):
    drawing = _get_drawing(db, drawing_id)
    ensure_can_delete(user, drawing, ELECTRICAL_APP, "drawings", what="drawing")
    job = get_job_or_404(db, drawing.job_id, lock=True, user=user)
    require_working(job, "change its drawings")
    if any(r.status in ("approved", "superseded") for r in _live_revisions(drawing)):
        raise HTTPException(status_code=409, detail=f"Drawing {drawing.drawing_number} has an approved revision on record, so it can't be deleted. Raise a new revision instead.")
    now = datetime.now(timezone.utc)
    for r in _live_revisions(drawing):
        if r.status == "submitted":
            access.cancel_live(db, access.REVISION_ENTITY, r.id, user, "Drawing deleted")
        r.is_deleted = True
        r.deleted_at = now
    drawing.is_deleted = True
    drawing.deleted_at = now
    db.commit()
    return {"message": f"Drawing {drawing.drawing_number} deleted"}


# ---------------------------------------------------------------------------
# Revisions
# ---------------------------------------------------------------------------

@router.post("/drawings/{drawing_id}/revisions", response_model=ElectricalDrawingResponse)
async def create_revision(
    drawing_id: int,
    change_summary: str = Form(...),
    file: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(_CAN_CREATE),
):
    drawing = _get_drawing(db, drawing_id)
    job = get_job_or_404(db, drawing.job_id, lock=True, user=user)
    require_working(job, "revise its drawings")
    if not change_summary.strip():
        raise HTTPException(status_code=400, detail="Describe what changed in this revision.")
    revs = _live_revisions(drawing)
    open_rev = next((r for r in revs if r.status in ELECTRICAL_OPEN_REVISION_STATUSES), None)
    if open_rev:
        raise HTTPException(status_code=409, detail=f"{drawing.drawing_number} already has {open_rev.revision_label} {open_rev.status}. Finish or discard it before starting another revision.")
    index = (max(r.revision_index for r in revs) + 1) if revs else 0
    revision = ElectricalDrawingRevision(
        drawing_id=drawing.id, revision_index=index, revision_label=f"R{index}", status="draft",
        change_summary=change_summary.strip(), prepared_by_id=user.id,
    )
    db.add(revision)
    if file is not None and file.filename:
        await _store_file(job, drawing, revision, file)
    db.commit()
    db.refresh(drawing)
    return _to_responses(db, [drawing])[0]


@router.post("/revisions/{revision_id}/file", response_model=ElectricalDrawingResponse)
async def upload_revision_file(
    revision_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(_CAN_EDIT),
):
    revision = _get_revision(db, revision_id)
    drawing = _get_drawing(db, revision.drawing_id)
    job = get_job_or_404(db, drawing.job_id, lock=True, user=user)
    require_working(job, "change its drawings")
    if revision.status != "draft":
        raise HTTPException(status_code=409, detail=f"{drawing.drawing_number} {revision.revision_label} is {revision.status} — its file is part of the record now. Raise a new revision to change it.")
    _require_preparer(user, revision, "replace its file")
    await _store_file(job, drawing, revision, file)
    db.commit()
    db.refresh(drawing)
    return _to_responses(db, [drawing])[0]


@router.post("/revisions/{revision_id}/submit", response_model=ElectricalDrawingResponse)
async def submit_revision(revision_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                          user: User = Depends(_CAN_SUBMIT)):
    revision = _get_revision(db, revision_id)
    drawing = _get_drawing(db, revision.drawing_id)
    job = get_job_or_404(db, drawing.job_id, lock=True, user=user)
    require_working(job, "submit drawings")
    if revision.status != "draft":
        raise HTTPException(status_code=409, detail=f"{drawing.drawing_number} {revision.revision_label} is already {revision.status}.")
    _require_preparer(user, revision, "submit it")
    if not revision.sharepoint_path:
        raise HTTPException(status_code=400, detail=f"Attach the drawing file to {revision.revision_label} before submitting it for approval.")
    revision.status = "submitted"
    revision.submitted_at = datetime.now(timezone.utc)
    revision.decision_comment = None
    db.flush()
    # The engine routes it to the approvers (Organization › Approval Workflows)
    # and notifies them; None = nobody but admins can approve, so it waits
    # for an admin on the old route as before.
    req = access.submit_revision(db, revision, job, user)
    approvers = {s.approver_id for s in req.steps} if req is not None else set()
    if job.lead_engineer_id and job.lead_engineer_id != user.id and job.lead_engineer_id not in approvers:
        notify_user(
            db, job.lead_engineer_id, title="Electrical Drawing Awaiting Approval",
            message=f"{drawing.drawing_number} {revision.revision_label} ({drawing.title}) on {job.job_number} was submitted for approval.",
            notification_type="electrical_drawing_submitted", entity_type="electrical_job", entity_id=job.id,
            teams=True,
        )
    access.notify_job_event(
        db, background_tasks, "drawing_submitted", job, title="Electrical Drawing Awaiting Approval",
        message=f"{drawing.drawing_number} {revision.revision_label} ({drawing.title}) on {job.job_number} was submitted for "
                f"approval by {user.name or user.email}. Review it from the job's Drawings tab or the approvals inbox.",
        actor=user, skip=approvers | {job.lead_engineer_id},
    )
    db.commit()
    db.refresh(drawing)
    return _to_responses(db, [drawing])[0]


@router.post("/revisions/{revision_id}/approve", response_model=ElectricalDrawingResponse)
async def approve_revision(
    revision_id: int, payload: ElectricalRevisionDecisionPayload,
    db: Session = Depends(get_db), user: User = Depends(_CAN_APPROVE),
):
    revision = _get_revision(db, revision_id)
    drawing = _get_drawing(db, revision.drawing_id)
    job = get_job_or_404(db, drawing.job_id, lock=True, user=user)
    require_working(job, "approve drawings")
    if revision.status != "submitted":
        raise HTTPException(status_code=409, detail=f"{drawing.drawing_number} {revision.revision_label} is {revision.status} — only a submitted revision can be approved.")
    if revision.prepared_by_id == user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="You prepared this revision, so someone else has to approve it.")
    req = access.live_request(db, access.REVISION_ENTITY, revision.id)
    if req is not None:
        access.decide_live(db, req, user, "approve", payload.comment)
    else:  # submitted before the approval engine (or no engine approver): old rules
        access.apply_revision_approval(db, revision, user, payload.comment)
    db.commit()
    db.refresh(drawing)
    return _to_responses(db, [drawing])[0]


@router.post("/revisions/{revision_id}/reject", response_model=ElectricalDrawingResponse)
async def reject_revision(
    revision_id: int, payload: ElectricalRevisionDecisionPayload,
    db: Session = Depends(get_db), user: User = Depends(_CAN_APPROVE),
):
    revision = _get_revision(db, revision_id)
    drawing = _get_drawing(db, revision.drawing_id)
    job = get_job_or_404(db, drawing.job_id, lock=True, user=user)
    require_working(job, "reject drawings")
    if revision.status != "submitted":
        raise HTTPException(status_code=409, detail=f"{drawing.drawing_number} {revision.revision_label} is {revision.status} — only a submitted revision can be rejected.")
    comment = (payload.comment or "").strip()
    if not comment:
        raise HTTPException(status_code=400, detail="Say why the revision is rejected so the author knows what to fix.")
    req = access.live_request(db, access.REVISION_ENTITY, revision.id)
    if req is not None:
        access.decide_live(db, req, user, "reject", comment)
    else:  # submitted before the approval engine (or no engine approver): old rules
        access.apply_revision_rejection(db, revision, user, comment)
    db.commit()
    db.refresh(drawing)
    return _to_responses(db, [drawing])[0]


@router.delete("/revisions/{revision_id}", response_model=ElectricalDrawingResponse)
async def discard_revision(revision_id: int, db: Session = Depends(get_db), user: User = Depends(_CAN_DELETE)):
    revision = _get_revision(db, revision_id)
    drawing = _get_drawing(db, revision.drawing_id)
    job = get_job_or_404(db, drawing.job_id, lock=True, user=user)
    require_working(job, "change its drawings")
    if revision.status not in ELECTRICAL_OPEN_REVISION_STATUSES:
        raise HTTPException(status_code=409, detail=f"{drawing.drawing_number} {revision.revision_label} is {revision.status} and stays on record — only a draft or submitted revision can be discarded.")
    _require_preparer(user, revision, "discard it")
    if len(_live_revisions(drawing)) == 1:
        raise HTTPException(status_code=409, detail=f"{revision.revision_label} is the only revision of {drawing.drawing_number}. Delete the drawing instead.")
    access.cancel_live(db, access.REVISION_ENTITY, revision.id, user, "Revision discarded")
    revision.is_deleted = True
    revision.deleted_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(drawing)
    return _to_responses(db, [drawing])[0]


@router.get("/revisions/{revision_id}/content")
async def get_revision_content(revision_id: int, db: Session = Depends(get_db), user: User = Depends(_VIEWER)):
    _ensure_drawings_view(user)
    revision = _get_revision(db, revision_id)
    get_job_or_404(db, _get_drawing(db, revision.drawing_id).job_id, user=user)
    if not revision.sharepoint_path:
        raise HTTPException(status_code=404, detail=f"{revision.revision_label} has no file attached yet.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail=_STORAGE_NOT_CONFIGURED)
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, revision.sharepoint_path)
    return Response(
        content=content,
        media_type=revision.mime_type or content_type,
        headers=inline_file_headers(revision.file_name),
    )
