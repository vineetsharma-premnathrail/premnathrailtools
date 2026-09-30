from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.electrical.models.job import (
    ElectricalJob, ElectricalJobStage, ELECTRICAL_JOB_PRIORITIES, ELECTRICAL_STAGE_KEYS, ELECTRICAL_STAGE_LABELS,
    ELECTRICAL_STAGE_PHASES, ELECTRICAL_DONE_STAGE_STATUSES, ELECTRICAL_WORKING_STATUSES,
)
from app.modules.electrical.schemas.job import (
    ElectricalJobCreate, ElectricalJobUpdate, ElectricalJobReasonPayload, ElectricalStageActionPayload,
    ElectricalJobStageUpdate, ElectricalJobStageResponse, ElectricalJobResponse, ElectricalJobDetail,
    ElectricalJobSummary,
)
from app.modules.electrical.service import (
    ELECTRICAL_APP, JOB_STATUS_PHRASE, MANDATORY_STAGES, OPEN_JOB_STATUSES, collect_facts, generate_job_number,
    get_job_or_404, job_progress, mark_job_started, project_label, require_working, seed_stages,
    stage_gate_problems, user_names,
)
from app.modules.erp.models.project import Project
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.quality.models.inspection import QualityInspection
from app.modules.quality.service import generate_inspection_number
from app.utils.notifications import broadcast_notification, notify_user

router = APIRouter(
    prefix="/electrical/jobs", tags=["Electrical"],
    dependencies=[Depends(require_app_access(ELECTRICAL_APP))],
)

_CAN_CREATE = require_tab_action(ELECTRICAL_APP, "jobs", "create")
_CAN_EDIT = require_tab_action(ELECTRICAL_APP, "jobs", "edit")
_CAN_DELETE = require_tab_action(ELECTRICAL_APP, "jobs", "delete")


# ---------------------------------------------------------------------------
# Response builders
# ---------------------------------------------------------------------------

def _to_responses(db: Session, jobs: list[ElectricalJob]) -> list[ElectricalJobResponse]:
    project_ids = {j.erp_project_id for j in jobs if j.erp_project_id}
    branch_ids = {j.branch_id for j in jobs if j.branch_id}
    projects = {p.id: p for p in db.query(Project).filter(Project.id.in_(project_ids)).all()} if project_ids else {}
    branches = {b.id: b.name for b in db.query(Branch).filter(Branch.id.in_(branch_ids)).all()} if branch_ids else {}
    names = user_names(db, {j.lead_engineer_id for j in jobs} | {j.created_by_id for j in jobs})
    out = []
    for j in jobs:
        resp = ElectricalJobResponse.model_validate(j)
        resp.project_label = project_label(projects.get(j.erp_project_id))
        resp.branch_name = branches.get(j.branch_id)
        resp.lead_engineer_name = names.get(j.lead_engineer_id)
        resp.created_by_name = names.get(j.created_by_id)
        for k, v in job_progress(j).items():
            setattr(resp, k, v)
        out.append(resp)
    return out


def _to_detail(db: Session, job: ElectricalJob) -> ElectricalJobDetail:
    base = _to_responses(db, [job])[0]
    detail = ElectricalJobDetail(**base.model_dump())
    facts = collect_facts(db, job)
    names = user_names(db, {s.assignee_id for s in job.stages} | {s.completed_by_id for s in job.stages})
    today = date.today()
    stages = []
    for s in sorted(job.stages, key=lambda x: x.sequence):
        resp = ElectricalJobStageResponse.model_validate(s)
        resp.label = ELECTRICAL_STAGE_LABELS.get(s.stage_key, s.stage_key)
        resp.phase = ELECTRICAL_STAGE_PHASES.get(s.stage_key, "")
        resp.assignee_name = names.get(s.assignee_id)
        resp.completed_by_name = names.get(s.completed_by_id)
        resp.is_mandatory = s.stage_key in MANDATORY_STAGES
        done = s.status in ELECTRICAL_DONE_STAGE_STATUSES
        resp.is_overdue = bool(not done and s.planned_end_date and s.planned_end_date < today)
        resp.gate_problems = [] if done else stage_gate_problems(job, facts, s.stage_key)
        stages.append(resp)
    detail.stages = stages
    detail.summary = ElectricalJobSummary(
        bom_count=facts.bom_count,
        bom_required=len(facts.bom_required),
        bom_estimated_cost=facts.bom_estimated_cost,
        cable_count=facts.cable_count,
        cables_installed=facts.cable_count - len(facts.cables_not_installed),
        panel_count=facts.panel_count,
        panels_assembled=facts.panel_count - len(facts.panels_not_assembled),
        drawing_count=facts.drawing_count,
        drawings_pending_approval=facts.drawings_pending_approval,
        as_built_approved=facts.as_built_approved,
        factory_tests=facts.factory_tests,
        commissioning_tests=facts.commissioning_tests,
        open_failures=len(facts.factory_open_failures) + len(facts.commissioning_open_failures),
        open_issues=len(facts.open_issues),
        document_count=facts.document_count,
        inspection_number=facts.inspection.inspection_number if facts.inspection else None,
        inspection_status=facts.inspection.status if facts.inspection else None,
    )
    return detail


def _get_stage(job: ElectricalJob, stage_key: str) -> ElectricalJobStage:
    if stage_key not in ELECTRICAL_STAGE_KEYS:
        raise HTTPException(status_code=404, detail=f"Unknown stage '{stage_key}'. Valid stages: {', '.join(ELECTRICAL_STAGE_KEYS)}.")
    stage = next((s for s in job.stages if s.stage_key == stage_key), None)
    if not stage:
        raise HTTPException(status_code=404, detail=f"Job {job.job_number} has no '{ELECTRICAL_STAGE_LABELS[stage_key]}' stage record. Ask an admin to check the job's stage list.")
    return stage


def _validate(db: Session, data: dict) -> None:
    if data.get("priority") and data["priority"] not in ELECTRICAL_JOB_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"Invalid priority '{data['priority']}'. Use one of: {', '.join(ELECTRICAL_JOB_PRIORITIES)}.")
    if data.get("erp_project_id") and not db.query(Project).filter(Project.id == data["erp_project_id"], Project.is_deleted == False).first():  # noqa: E712
        raise HTTPException(status_code=404, detail=f"RRV / machine #{data['erp_project_id']} not found in ERP (it may have been deleted). Pick the machine again.")
    if data.get("branch_id") and not db.query(Branch).filter(Branch.id == data["branch_id"]).first():
        raise HTTPException(status_code=404, detail=f"Plant #{data['branch_id']} not found.")
    if data.get("lead_engineer_id") and not db.query(User).filter(User.id == data["lead_engineer_id"], User.is_active == True).first():  # noqa: E712
        raise HTTPException(status_code=404, detail=f"Lead engineer (user #{data['lead_engineer_id']}) not found or inactive. Pick someone else.")
    start, end = data.get("planned_start_date"), data.get("target_handover_date")
    if start and end and end < start:
        raise HTTPException(status_code=400, detail="Target handover date can't be before the planned start date.")


# ---------------------------------------------------------------------------
# Jobs
# ---------------------------------------------------------------------------

@router.get("", response_model=list[ElectricalJobResponse])
async def list_jobs(
    status_filter: str | None = Query(None, alias="status"),
    priority: str | None = None,
    phase: str | None = None,
    erp_project_id: int | None = None,
    mine: bool = False,
    search: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access(ELECTRICAL_APP, "jobs")),
):
    query = db.query(ElectricalJob).options(selectinload(ElectricalJob.stages)).filter(ElectricalJob.is_deleted == False)  # noqa: E712
    if status_filter == "open":
        query = query.filter(ElectricalJob.status.in_(OPEN_JOB_STATUSES))
    elif status_filter:
        query = query.filter(ElectricalJob.status == status_filter)
    if priority:
        query = query.filter(ElectricalJob.priority == priority)
    if erp_project_id:
        query = query.filter(ElectricalJob.erp_project_id == erp_project_id)
    if mine:
        assigned = db.query(ElectricalJobStage.job_id).filter(ElectricalJobStage.assignee_id == user.id)
        query = query.filter((ElectricalJob.lead_engineer_id == user.id) | (ElectricalJob.id.in_(assigned)))
    if search:
        like = f"%{search}%"
        query = query.filter(
            ElectricalJob.job_number.ilike(like) | ElectricalJob.title.ilike(like) | ElectricalJob.vehicle_number.ilike(like)
            | ElectricalJob.rrv_model.ilike(like) | ElectricalJob.customer_name.ilike(like)
        )
    responses = _to_responses(db, query.order_by(ElectricalJob.created_at.desc()).all())
    if phase:
        responses = [r for r in responses if r.current_phase == phase and r.status in OPEN_JOB_STATUSES]
    return responses


@router.post("", response_model=ElectricalJobDetail)
async def create_job(
    payload: ElectricalJobCreate,
    db: Session = Depends(get_db),
    user: User = Depends(_CAN_CREATE),
):
    data = payload.model_dump()
    data["title"] = data["title"].strip()
    _validate(db, data)
    if data.get("erp_project_id"):
        project = db.query(Project).filter(Project.id == data["erp_project_id"]).first()
        data["customer_name"] = data.get("customer_name") or project.client_company
        data["rrv_model"] = data.get("rrv_model") or project.model_name or project.machine_type
        data["vehicle_number"] = data.get("vehicle_number") or project.serial_number
    job = ElectricalJob(**data, job_number=generate_job_number(db), status="draft", created_by_id=user.id)
    seed_stages(job)
    db.add(job)
    db.flush()
    if job.lead_engineer_id and job.lead_engineer_id != user.id:
        notify_user(
            db, job.lead_engineer_id, title="Electrical Job Assigned",
            message=f"You're the lead engineer on {job.job_number} — {job.title}.",
            notification_type="electrical_job_assigned", entity_type="electrical_job", entity_id=job.id,
        )
    db.commit()
    db.refresh(job)
    return _to_detail(db, job)


@router.get("/{job_id}", response_model=ElectricalJobDetail)
async def get_job(job_id: int, db: Session = Depends(get_db)):
    return _to_detail(db, get_job_or_404(db, job_id))


@router.patch("/{job_id}", response_model=ElectricalJobDetail)
async def update_job(
    job_id: int,
    payload: ElectricalJobUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(_CAN_EDIT),
):
    job = get_job_or_404(db, job_id, lock=True)
    if job.status in ("closed", "cancelled"):
        raise HTTPException(status_code=409, detail=f"Job {job.job_number} is {job.status} — its details can't be changed any more.")
    updates = payload.model_dump(exclude_unset=True)
    if "title" in updates and updates["title"]:
        updates["title"] = updates["title"].strip()
    merged = {
        "planned_start_date": job.planned_start_date, "target_handover_date": job.target_handover_date, **updates,
    }
    _validate(db, merged)
    new_lead = updates.get("lead_engineer_id")
    lead_changed = "lead_engineer_id" in updates and new_lead and new_lead != job.lead_engineer_id
    for field, val in updates.items():
        setattr(job, field, val)
    if lead_changed and new_lead != user.id:
        notify_user(
            db, new_lead, title="Electrical Job Assigned",
            message=f"You're now the lead engineer on {job.job_number} — {job.title}.",
            notification_type="electrical_job_assigned", entity_type="electrical_job", entity_id=job.id,
        )
    db.commit()
    db.refresh(job)
    return _to_detail(db, job)


@router.delete("/{job_id}")
async def delete_job(
    job_id: int,
    db: Session = Depends(get_db),
    _perm: User = Depends(_CAN_DELETE),
):
    job = get_job_or_404(db, job_id, lock=True)
    if job.status != "draft":
        raise HTTPException(
            status_code=409,
            detail=f"Job {job.job_number} is {JOB_STATUS_PHRASE.get(job.status, job.status)}. Only draft jobs can be deleted — cancel it instead to keep its history.",
        )
    if any(s.status != "not_started" for s in job.stages):
        raise HTTPException(status_code=409, detail=f"Job {job.job_number} already has stage progress recorded. Cancel it instead of deleting it.")
    job.is_deleted = True
    job.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"Electrical job {job.job_number} deleted"}


@router.post("/{job_id}/hold", response_model=ElectricalJobDetail)
async def hold_job(job_id: int, payload: ElectricalJobReasonPayload, db: Session = Depends(get_db), _perm: User = Depends(_CAN_EDIT)):
    job = get_job_or_404(db, job_id, lock=True)
    if job.status not in ("draft", "in_progress"):
        raise HTTPException(status_code=409, detail=f"Job {job.job_number} is {JOB_STATUS_PHRASE.get(job.status, job.status)} — only a draft or in-progress job can be put on hold.")
    job.status = "on_hold"
    job.hold_reason = payload.reason.strip()
    db.commit()
    db.refresh(job)
    return _to_detail(db, job)


@router.post("/{job_id}/resume", response_model=ElectricalJobDetail)
async def resume_job(job_id: int, db: Session = Depends(get_db), _perm: User = Depends(_CAN_EDIT)):
    job = get_job_or_404(db, job_id, lock=True)
    if job.status != "on_hold":
        raise HTTPException(status_code=409, detail=f"Job {job.job_number} isn't on hold (it's {JOB_STATUS_PHRASE.get(job.status, job.status)}).")
    job.status = "in_progress" if job.started_at else "draft"
    job.hold_reason = None
    db.commit()
    db.refresh(job)
    return _to_detail(db, job)


@router.post("/{job_id}/cancel", response_model=ElectricalJobDetail)
async def cancel_job(job_id: int, payload: ElectricalJobReasonPayload, db: Session = Depends(get_db), _perm: User = Depends(_CAN_EDIT)):
    job = get_job_or_404(db, job_id, lock=True)
    if job.status not in OPEN_JOB_STATUSES:
        raise HTTPException(status_code=409, detail=f"Job {job.job_number} is {JOB_STATUS_PHRASE.get(job.status, job.status)} and can no longer be cancelled.")
    job.status = "cancelled"
    job.cancel_reason = payload.reason.strip()
    db.commit()
    db.refresh(job)
    return _to_detail(db, job)


@router.post("/{job_id}/close", response_model=ElectricalJobDetail)
async def close_job(job_id: int, db: Session = Depends(get_db), _perm: User = Depends(_CAN_EDIT)):
    job = get_job_or_404(db, job_id, lock=True)
    if job.status != "handed_over":
        raise HTTPException(status_code=409, detail=f"Job {job.job_number} is {JOB_STATUS_PHRASE.get(job.status, job.status)}. Complete the 'RRV Electrical Handover' stage before closing the job.")
    pending = [ELECTRICAL_STAGE_LABELS[s.stage_key] for s in job.stages if s.status not in ELECTRICAL_DONE_STAGE_STATUSES]
    if pending:
        raise HTTPException(status_code=409, detail=f"Complete (or mark N/A) every stage before closing — still open: {', '.join(pending)}.")
    job.status = "closed"
    job.closed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(job)
    return _to_detail(db, job)


@router.post("/{job_id}/request-inspection", response_model=ElectricalJobDetail)
async def request_inspection(
    job_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_CAN_EDIT),
):
    """Raises a final inspection in Quality for the RRV's electrical system —
    the Inspection & QC stage completes once Quality passes it."""
    job = get_job_or_404(db, job_id, lock=True)
    require_working(job, "request a QC inspection")
    if job.quality_inspection_id:
        current = db.query(QualityInspection).filter(QualityInspection.id == job.quality_inspection_id).first()
        # A failed inspection can be re-requested after the fix; anything else is still live or already passed.
        if current and not current.is_deleted and current.status != "failed":
            raise HTTPException(status_code=409, detail=f"Inspection {current.inspection_number} is already {current.status.replace('_', ' ')} for this job.")
    project = db.query(Project).filter(Project.id == job.erp_project_id).first() if job.erp_project_id else None
    inspection = QualityInspection(
        inspection_number=generate_inspection_number(db, "FIN"),
        inspection_type="final",
        item_name=f"RRV electrical system — {job.rrv_model or job.title}",
        item_code=job.vehicle_number,
        batch_number=job.job_number,
        quantity_inspected=1,
        project_label=f"{job.job_number} · Electrical" + (f" · {project.serial_number}" if project else ""),
        inspection_date=date.today(),
        status="pending",
        remarks=f"Requested from Electrical by {user.name or user.email} for job {job.job_number} ({job.title}).",
    )
    db.add(inspection)
    db.flush()
    job.quality_inspection_id = inspection.id
    stage = _get_stage(job, "inspection_qc")
    if stage.status == "not_started":
        stage.status = "in_progress"
        stage.started_at = datetime.now(timezone.utc)
    mark_job_started(job)
    broadcast_notification(
        db,
        title="Electrical QC Inspection Requested",
        message=f"{job.job_number} ({job.title}) is waiting for final electrical inspection {inspection.inspection_number}.",
        notification_type="electrical_inspection_requested", entity_type="quality_inspection", entity_id=inspection.id,
        exclude_user_id=user.id, app_name="quality",
    )
    db.commit()
    db.refresh(job)
    return _to_detail(db, job)


# ---------------------------------------------------------------------------
# Stages
# ---------------------------------------------------------------------------

@router.patch("/{job_id}/stages/{stage_key}", response_model=ElectricalJobDetail)
async def update_stage(
    job_id: int, stage_key: str,
    payload: ElectricalJobStageUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(_CAN_EDIT),
):
    job = get_job_or_404(db, job_id, lock=True)
    if job.status in ("closed", "cancelled"):
        raise HTTPException(status_code=409, detail=f"Job {job.job_number} is {job.status} — its stages can't be changed any more.")
    stage = _get_stage(job, stage_key)
    updates = payload.model_dump(exclude_unset=True)
    start = updates.get("planned_start_date", stage.planned_start_date)
    end = updates.get("planned_end_date", stage.planned_end_date)
    if start and end and end < start:
        raise HTTPException(status_code=400, detail=f"'{ELECTRICAL_STAGE_LABELS[stage_key]}' can't end before it starts — check the planned dates.")
    new_assignee = updates.get("assignee_id")
    if new_assignee and not db.query(User).filter(User.id == new_assignee, User.is_active == True).first():  # noqa: E712
        raise HTTPException(status_code=404, detail=f"User #{new_assignee} not found or inactive. Pick someone else to own this stage.")
    assignee_changed = "assignee_id" in updates and new_assignee and new_assignee != stage.assignee_id
    for field, val in updates.items():
        setattr(stage, field, val)
    if assignee_changed and new_assignee != user.id:
        notify_user(
            db, new_assignee, title="Electrical Stage Assigned",
            message=f"You own '{ELECTRICAL_STAGE_LABELS[stage_key]}' on {job.job_number} — {job.title}.",
            notification_type="electrical_stage_assigned", entity_type="electrical_job", entity_id=job.id,
        )
    db.commit()
    db.refresh(job)
    return _to_detail(db, job)


@router.post("/{job_id}/stages/{stage_key}/start", response_model=ElectricalJobDetail)
async def start_stage(job_id: int, stage_key: str, db: Session = Depends(get_db), _perm: User = Depends(_CAN_EDIT)):
    job = get_job_or_404(db, job_id, lock=True)
    require_working(job, "start stages")
    stage = _get_stage(job, stage_key)
    if stage.status != "not_started":
        raise HTTPException(status_code=409, detail=f"'{ELECTRICAL_STAGE_LABELS[stage_key]}' is already {stage.status.replace('_', ' ')}.")
    stage.status = "in_progress"
    stage.started_at = datetime.now(timezone.utc)
    mark_job_started(job)
    db.commit()
    db.refresh(job)
    return _to_detail(db, job)


@router.post("/{job_id}/stages/{stage_key}/complete", response_model=ElectricalJobDetail)
async def complete_stage(
    job_id: int, stage_key: str,
    payload: ElectricalStageActionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(_CAN_EDIT),
):
    job = get_job_or_404(db, job_id, lock=True)
    require_working(job, "complete stages")
    stage = _get_stage(job, stage_key)
    label = ELECTRICAL_STAGE_LABELS[stage_key]
    if stage.status in ELECTRICAL_DONE_STAGE_STATUSES:
        raise HTTPException(status_code=409, detail=f"'{label}' is already {'completed' if stage.status == 'completed' else 'marked not applicable'}.")
    problems = stage_gate_problems(job, collect_facts(db, job), stage_key)
    if problems:
        raise HTTPException(status_code=409, detail=f"'{label}' can't be completed yet. " + " ".join(problems))
    now = datetime.now(timezone.utc)
    stage.status = "completed"
    stage.started_at = stage.started_at or now
    stage.completed_at = now
    stage.completed_by_id = user.id
    if payload.remarks:
        stage.remarks = payload.remarks
    mark_job_started(job)
    if stage_key == "handover":
        job.status = "handed_over"
        job.handed_over_at = now
        if job.lead_engineer_id and job.lead_engineer_id != user.id:
            notify_user(
                db, job.lead_engineer_id, title="RRV Electrical Handed Over",
                message=f"{job.job_number} — {job.title} was handed over to {job.handover_to_name}.",
                notification_type="electrical_job_handed_over", entity_type="electrical_job", entity_id=job.id,
            )
    db.commit()
    db.refresh(job)
    return _to_detail(db, job)


@router.post("/{job_id}/stages/{stage_key}/not-applicable", response_model=ElectricalJobDetail)
async def mark_stage_not_applicable(
    job_id: int, stage_key: str,
    payload: ElectricalJobReasonPayload,
    db: Session = Depends(get_db),
    user: User = Depends(_CAN_EDIT),
):
    job = get_job_or_404(db, job_id, lock=True)
    require_working(job, "change stages")
    stage = _get_stage(job, stage_key)
    label = ELECTRICAL_STAGE_LABELS[stage_key]
    if stage_key in MANDATORY_STAGES:
        raise HTTPException(status_code=400, detail=f"'{label}' is required on every RRV electrical job and can't be marked not applicable.")
    if stage.status in ELECTRICAL_DONE_STAGE_STATUSES:
        raise HTTPException(status_code=409, detail=f"'{label}' is already {'completed' if stage.status == 'completed' else 'marked not applicable'}. Reopen it first.")
    stage.status = "not_applicable"
    stage.completed_at = datetime.now(timezone.utc)
    stage.completed_by_id = user.id
    stage.remarks = f"Not applicable: {payload.reason.strip()}"
    db.commit()
    db.refresh(job)
    return _to_detail(db, job)


@router.post("/{job_id}/stages/{stage_key}/reopen", response_model=ElectricalJobDetail)
async def reopen_stage(job_id: int, stage_key: str, db: Session = Depends(get_db), _perm: User = Depends(_CAN_EDIT)):
    job = get_job_or_404(db, job_id, lock=True)
    if job.status not in ELECTRICAL_WORKING_STATUSES:
        raise HTTPException(status_code=409, detail=f"Job {job.job_number} is {JOB_STATUS_PHRASE.get(job.status, job.status)} — its stages can't be reopened.")
    stage = _get_stage(job, stage_key)
    if stage.status not in ELECTRICAL_DONE_STAGE_STATUSES:
        raise HTTPException(status_code=409, detail=f"'{ELECTRICAL_STAGE_LABELS[stage_key]}' isn't completed, so there's nothing to reopen.")
    was_na = stage.status == "not_applicable"
    stage.status = "in_progress" if stage.started_at else "not_started"
    stage.completed_at = None
    stage.completed_by_id = None
    if was_na:
        stage.remarks = None
    if stage_key == "handover" and job.status == "handed_over":
        job.status = "in_progress"
        job.handed_over_at = None
    db.commit()
    db.refresh(job)
    return _to_detail(db, job)
