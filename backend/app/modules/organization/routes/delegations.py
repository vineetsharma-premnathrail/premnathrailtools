"""Organization › Delegations: hand your approvals to someone while you're away.

Anyone may manage their OWN delegations (/mine, POST without delegator_id);
managing other people's needs the Delegations tab permissions."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.permission_registry import MODULES, can_perform
from app.db.session import get_db
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.organization.models.approval import ApprovalDelegation
from app.modules.organization.services.approval_engine import transaction_types

router = APIRouter(prefix="/organization/delegations", tags=["Organization - Delegations"])


class DelegationPayload(BaseModel):
    delegator_id: int | None = None
    delegate_id: int
    start_date: date
    end_date: date
    module_key: str | None = None
    workflow_key: str | None = None
    reason: str | None = None


def _out(d: ApprovalDelegation) -> dict:
    today = date.today()
    state = "ended" if not d.is_active or d.end_date < today else ("upcoming" if d.start_date > today else "active")
    tt = transaction_types().get(d.workflow_key) if d.workflow_key else None
    return {
        "id": d.id, "delegator_id": d.delegator_id, "delegator_name": d.delegator.name if d.delegator else None,
        "delegate_id": d.delegate_id, "delegate_name": d.delegate.name if d.delegate else None,
        "start_date": d.start_date, "end_date": d.end_date, "module_key": d.module_key,
        "module_label": MODULES[d.module_key]["label"] if d.module_key in MODULES else None,
        "workflow_key": d.workflow_key, "workflow_label": tt.label if tt else None,
        "reason": d.reason, "is_active": d.is_active, "state": state, "created_by_id": d.created_by_id,
    }


def _check(db: Session, payload: DelegationPayload, delegator_id: int) -> None:
    if payload.end_date < payload.start_date:
        raise HTTPException(status_code=422, detail=f"The end date ({payload.end_date:%d-%m-%Y}) is before the start date ({payload.start_date:%d-%m-%Y}). "
                                                    "Pick an end date on or after the start date.")
    if payload.delegate_id == delegator_id:
        raise HTTPException(status_code=422, detail="Pick someone else — you can't delegate to yourself.")
    delegate = db.get(User, payload.delegate_id)
    if not delegate or not delegate.is_active:
        raise HTTPException(status_code=422, detail="The person picked to approve in your place is not an active user. "
                                                    "Pick an active colleague as the delegate.")
    if payload.module_key and payload.module_key not in MODULES:
        raise HTTPException(status_code=422, detail=f"Unknown module '{payload.module_key}'. Pick a module from the list, or leave it empty for all modules.")
    if payload.workflow_key and payload.workflow_key not in transaction_types():
        raise HTTPException(status_code=422, detail=f"Unknown approval type '{payload.workflow_key}'. Pick a document type from the list, or leave it empty for all types.")
    back = (
        db.query(ApprovalDelegation)
        .filter(ApprovalDelegation.delegator_id == payload.delegate_id, ApprovalDelegation.delegate_id == delegator_id,
                ApprovalDelegation.is_active.is_(True), ApprovalDelegation.end_date >= payload.start_date,
                ApprovalDelegation.start_date <= payload.end_date)
        .first()
    )
    if back:
        raise HTTPException(status_code=409, detail=f"{delegate.name} has already delegated to this person for overlapping dates — "
                                                    "two people can't delegate to each other at the same time.")


def _can_manage_others(user: User, action: str) -> bool:
    return can_perform(user, "organization", "delegations", action)


@router.get("/mine")
async def my_delegations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = (
        db.query(ApprovalDelegation)
        .filter((ApprovalDelegation.delegator_id == user.id) | (ApprovalDelegation.delegate_id == user.id))
        .order_by(ApprovalDelegation.start_date.desc()).all()
    )
    return [_out(d) for d in rows]


@router.get("")
async def list_delegations(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if not _can_manage_others(user, "view"):
        raise HTTPException(status_code=403, detail="You need Organization › Delegations › View to see everyone's delegations "
                                                    "— your own are under My Approvals.")
    return [_out(d) for d in db.query(ApprovalDelegation).order_by(ApprovalDelegation.start_date.desc()).all()]


@router.post("")
async def create_delegation(payload: DelegationPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    delegator_id = payload.delegator_id or user.id
    if delegator_id != user.id and not _can_manage_others(user, "create"):
        raise HTTPException(status_code=403, detail="You can only delegate your own approvals. Setting up someone else's needs "
                                                    "Organization › Delegations › Create.")
    if not db.get(User, delegator_id):
        raise HTTPException(status_code=404, detail="The person whose approvals are being delegated was not found.")
    _check(db, payload, delegator_id)
    d = ApprovalDelegation(
        delegator_id=delegator_id, delegate_id=payload.delegate_id, start_date=payload.start_date, end_date=payload.end_date,
        module_key=payload.module_key or None, workflow_key=payload.workflow_key or None,
        reason=(payload.reason or "").strip() or None, created_by_id=user.id,
    )
    db.add(d)
    db.flush()
    db.add(AuditLog(entity_type="approval_delegation", entity_id=d.id, action="created", module_key="organization",
                    subtab_key="delegations", performed_by_id=user.id,
                    summary=f"{user.name} delegated approvals of {d.delegator.name} to {d.delegate.name} "
                            f"from {d.start_date} to {d.end_date}"))
    db.commit()
    db.refresh(d)
    return _out(d)


@router.post("/{delegation_id}/end")
async def end_delegation(delegation_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    d = db.get(ApprovalDelegation, delegation_id)
    if not d:
        raise HTTPException(status_code=404, detail="Delegation not found — reload the page.")
    if user.id not in (d.delegator_id, d.created_by_id) and not _can_manage_others(user, "edit"):
        raise HTTPException(status_code=403, detail="Only the person who delegated (or someone with Delegations › Edit) can end it.")
    d.is_active = False
    db.add(AuditLog(entity_type="approval_delegation", entity_id=d.id, action="ended", module_key="organization",
                    subtab_key="delegations", performed_by_id=user.id,
                    summary=f"{user.name} ended the delegation of {d.delegator.name}'s approvals to {d.delegate.name}"))
    db.commit()
    db.refresh(d)
    return _out(d)
