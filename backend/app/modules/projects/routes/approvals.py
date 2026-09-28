from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.approval import PmApproval, PM_APPROVAL_TYPES, PM_APPROVAL_STATUSES
from app.modules.projects.schemas.approval import PmApprovalCreate, PmApprovalUpdate, PmApprovalResponse

router = APIRouter(
    prefix="/projects/{project_id}/approvals", tags=["Project Management"],
    dependencies=[Depends(require_app_access("projects"))],
)


def _write_audit(db: Session, project_id: int, action: str, user: User, summary: str | None = None,
                  field_name: str | None = None, old_value: str | None = None, new_value: str | None = None):
    db.add(AuditLog(
        entity_type="pm_project", entity_id=project_id, module_key="projects", subtab_key="approvals",
        action=action, performed_by_id=user.id, summary=summary,
        field_name=field_name, old_value=old_value, new_value=new_value,
    ))


def _get_project_or_404(db: Session, project_id: int) -> PmProject:
    project = db.query(PmProject).filter(PmProject.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail=f"Project #{project_id} not found")
    return project


def _get_approval_or_404(db: Session, project_id: int, approval_id: int) -> PmApproval:
    approval = db.query(PmApproval).filter(
        PmApproval.id == approval_id, PmApproval.project_id == project_id
    ).first()
    if not approval:
        raise HTTPException(status_code=404, detail=f"Approval #{approval_id} not found on project #{project_id}")
    return approval


def _to_response(db: Session, approval: PmApproval) -> PmApprovalResponse:
    resp = PmApprovalResponse.model_validate(approval)
    if approval.requested_by_id:
        requested_by = db.query(User).filter(User.id == approval.requested_by_id).first()
        if requested_by:
            resp.requested_by_name = requested_by.name or requested_by.email
    if approval.approver_id:
        approver = db.query(User).filter(User.id == approval.approver_id).first()
        if approver:
            resp.approver_name = approver.name or approver.email
    return resp


@router.get("", response_model=list[PmApprovalResponse])
async def list_approvals(
    project_id: int,
    approval_type: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
):
    _get_project_or_404(db, project_id)
    query = db.query(PmApproval).filter(PmApproval.project_id == project_id)
    if approval_type:
        query = query.filter(PmApproval.approval_type == approval_type)
    if status_filter:
        query = query.filter(PmApproval.status == status_filter)
    approvals = query.order_by(PmApproval.id.asc()).all()
    return [_to_response(db, a) for a in approvals]


@router.post("", response_model=PmApprovalResponse)
async def create_approval(
    project_id: int,
    payload: PmApprovalCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    if payload.approval_type not in PM_APPROVAL_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid approval_type '{payload.approval_type}'. Must be one of {PM_APPROVAL_TYPES}.")
    if payload.approver_id is not None:
        if not db.query(User).filter(User.id == payload.approver_id).first():
            raise HTTPException(status_code=404, detail=f"User #{payload.approver_id} not found")

    approval = PmApproval(
        project_id=project_id,
        approval_type=payload.approval_type,
        reference_id=payload.reference_id,
        requested_by_id=user.id,
        approver_id=payload.approver_id,
        status="pending",
        comments=payload.comments,
        requested_at=datetime.now(timezone.utc),
    )
    db.add(approval)
    db.flush()

    _write_audit(db, project_id, "created", user, summary=f"Approval request ({approval.approval_type}) created by {user.name or user.email}.")

    db.commit()
    db.refresh(approval)
    return _to_response(db, approval)


@router.patch("/{approval_id}", response_model=PmApprovalResponse)
async def update_approval(
    project_id: int,
    approval_id: int,
    payload: PmApprovalUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    approval = _get_approval_or_404(db, project_id, approval_id)
    updates = payload.model_dump(exclude_unset=True)

    new_status = updates.get("status")
    if new_status and new_status not in PM_APPROVAL_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'. Must be one of {PM_APPROVAL_STATUSES}.")

    if new_status in ("approved", "rejected") and approval.decided_at is None and "decided_at" not in updates:
        updates["decided_at"] = datetime.now(timezone.utc)

    for field, val in updates.items():
        old_val = getattr(approval, field)
        if old_val != val:
            _write_audit(
                db, project_id, "updated", user, field_name=field,
                old_value=str(old_val) if old_val is not None else None,
                new_value=str(val) if val is not None else None,
            )
        setattr(approval, field, val)

    db.commit()
    db.refresh(approval)
    return _to_response(db, approval)


@router.delete("/{approval_id}")
async def delete_approval(
    project_id: int,
    approval_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("projects")),
):
    _get_project_or_404(db, project_id)
    approval = _get_approval_or_404(db, project_id, approval_id)

    _write_audit(db, project_id, "deleted", user, summary=f"Approval ({approval.approval_type}) deleted by {user.name or user.email}.")
    db.delete(approval)
    db.commit()
    return {"message": "Approval deleted"}
