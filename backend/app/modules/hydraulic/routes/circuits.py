from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access, require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.hydraulic.models.circuit import HydCircuit
from app.modules.hydraulic.models.document import HydDocument
from app.modules.hydraulic.schemas.circuit import (
    HydCircuitCreate, HydCircuitUpdate, HydCircuitReviewPayload, HydCircuitRevisePayload,
    HydCircuitRevisionSummary, HydCircuitResponse,
)
from app.modules.hydraulic.service import (
    generate_circuit_number, check_system_type, get_system_or_404, next_revision, systems_by_id, user_names,
)
from app.modules.main.models.user import User
from app.utils.notifications import notify_user

router = APIRouter(
    prefix="/hydraulic/circuits", tags=["Hydraulic & Pneumatic"],
    dependencies=[Depends(require_app_access("hydraulic"))],
)

_CAN_EDIT = require_tab_action("hydraulic", "circuits", "edit")
_CAN_APPROVE = require_tab_action("hydraulic", "circuits", "approve")


def _to_responses(db: Session, circuits: list[HydCircuit], with_revisions: bool = False) -> list[HydCircuitResponse]:
    systems = systems_by_id(db, {c.system_id for c in circuits})
    names = user_names(db, {c.created_by_id for c in circuits} | {c.submitted_by_id for c in circuits} | {c.approved_by_id for c in circuits})
    ids = [c.id for c in circuits]
    docs = dict(db.query(HydDocument.entity_id, func.count(HydDocument.id)).filter(
        HydDocument.entity_type == "circuit", HydDocument.entity_id.in_(ids), HydDocument.is_deleted == False,  # noqa: E712
    ).group_by(HydDocument.entity_id).all()) if ids else {}
    out = []
    for c in circuits:
        resp = HydCircuitResponse.model_validate(c)
        system = systems.get(c.system_id)
        resp.system_number = system.system_number if system else None
        resp.system_name = system.name if system else None
        resp.created_by_name = names.get(c.created_by_id)
        resp.submitted_by_name = names.get(c.submitted_by_id)
        resp.approved_by_name = names.get(c.approved_by_id)
        resp.document_count = docs.get(c.id, 0)
        if with_revisions:
            resp.revisions = [
                HydCircuitRevisionSummary(id=r.id, revision=r.revision, status=r.status, approved_at=r.approved_at, change_note=r.change_note)
                for r in db.query(HydCircuit).filter(
                    HydCircuit.circuit_number == c.circuit_number, HydCircuit.is_deleted == False,  # noqa: E712
                ).order_by(HydCircuit.id).all()
            ]
        out.append(resp)
    return out


def _get_or_404(db: Session, circuit_id: int, lock: bool = False) -> HydCircuit:
    q = db.query(HydCircuit).filter(HydCircuit.id == circuit_id, HydCircuit.is_deleted == False)  # noqa: E712
    if lock:
        q = q.with_for_update()
    circuit = q.first()
    if not circuit:
        raise HTTPException(status_code=404, detail=f"Circuit #{circuit_id} not found (it may have been deleted).")
    return circuit


def _require_status(circuit: HydCircuit, allowed: tuple, action: str) -> None:
    if circuit.status not in allowed:
        raise HTTPException(
            status_code=409,
            detail=f"{circuit.circuit_number} Rev {circuit.revision} is '{circuit.status.replace('_', ' ')}' — you can only {action} "
                   f"a circuit that is {' or '.join(s.replace('_', ' ') for s in allowed)}.",
        )


@router.get("", response_model=list[HydCircuitResponse])
async def list_circuits(
    system_id: int | None = None,
    system_type: str | None = None,
    status_filter: str | None = Query(None, alias="status"),
    include_superseded: bool = False,
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("hydraulic", "circuits")),
):
    query = db.query(HydCircuit).filter(HydCircuit.is_deleted == False)  # noqa: E712
    if system_id:
        query = query.filter(HydCircuit.system_id == system_id)
    if system_type:
        query = query.filter(HydCircuit.system_type == system_type)
    if status_filter:
        query = query.filter(HydCircuit.status == status_filter)
    elif not include_superseded:
        query = query.filter(HydCircuit.status != "superseded")
    if search:
        like = f"%{search}%"
        query = query.filter(HydCircuit.circuit_number.ilike(like) | HydCircuit.title.ilike(like) | HydCircuit.drawing_number.ilike(like))
    return _to_responses(db, query.order_by(HydCircuit.id.desc()).all())


@router.post("", response_model=HydCircuitResponse)
async def create_circuit(
    payload: HydCircuitCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_action("hydraulic", "circuits", "create")),
):
    data = payload.model_dump()
    check_system_type(data["system_type"])
    if data.get("system_id"):
        system = get_system_or_404(db, data["system_id"])
        data["system_type"] = system.system_type
    circuit = HydCircuit(**data, circuit_number=generate_circuit_number(db), revision="A", status="draft", created_by_id=user.id)
    db.add(circuit)
    db.commit()
    db.refresh(circuit)
    return _to_responses(db, [circuit], with_revisions=True)[0]


@router.get("/{circuit_id}", response_model=HydCircuitResponse)
async def get_circuit(circuit_id: int, db: Session = Depends(get_db)):
    return _to_responses(db, [_get_or_404(db, circuit_id)], with_revisions=True)[0]


@router.patch("/{circuit_id}", response_model=HydCircuitResponse)
async def update_circuit(
    circuit_id: int,
    payload: HydCircuitUpdate,
    db: Session = Depends(get_db),
    _perm: User = Depends(_CAN_EDIT),
):
    circuit = _get_or_404(db, circuit_id)
    _require_status(circuit, ("draft",), "edit")
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("system_id"):
        circuit.system_type = get_system_or_404(db, updates["system_id"]).system_type
    for field, val in updates.items():
        setattr(circuit, field, val)
    db.commit()
    db.refresh(circuit)
    return _to_responses(db, [circuit], with_revisions=True)[0]


@router.post("/{circuit_id}/submit", response_model=HydCircuitResponse)
async def submit_circuit(
    circuit_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_CAN_EDIT),
):
    circuit = _get_or_404(db, circuit_id, lock=True)
    _require_status(circuit, ("draft",), "submit for review")
    has_file = db.query(HydDocument).filter(
        HydDocument.entity_type == "circuit", HydDocument.entity_id == circuit.id, HydDocument.is_deleted == False,  # noqa: E712
    ).first()
    if not has_file:
        raise HTTPException(status_code=400, detail="Upload the circuit diagram (PDF, image or CAD file) before submitting it for review — reviewers need something to check.")
    circuit.status = "under_review"
    circuit.submitted_by_id = user.id
    circuit.submitted_at = datetime.now(timezone.utc)
    circuit.review_remarks = None
    db.commit()
    db.refresh(circuit)
    return _to_responses(db, [circuit], with_revisions=True)[0]


@router.post("/{circuit_id}/approve", response_model=HydCircuitResponse)
async def approve_circuit(
    circuit_id: int,
    payload: HydCircuitReviewPayload,
    db: Session = Depends(get_db),
    user: User = Depends(_CAN_APPROVE),
):
    circuit = _get_or_404(db, circuit_id, lock=True)
    _require_status(circuit, ("under_review",), "approve")
    if circuit.submitted_by_id == user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="You submitted this circuit, so someone else has to approve it (four-eyes check). Ask another approver or an admin.")
    # Approving a revision supersedes whichever revision was approved before.
    db.query(HydCircuit).filter(
        HydCircuit.circuit_number == circuit.circuit_number, HydCircuit.id != circuit.id, HydCircuit.status == "approved",
    ).update({"status": "superseded"}, synchronize_session=False)
    circuit.status = "approved"
    circuit.approved_by_id = user.id
    circuit.approved_at = datetime.now(timezone.utc)
    circuit.review_remarks = payload.remarks
    if circuit.submitted_by_id:
        notify_user(
            db, user_id=circuit.submitted_by_id, title=f"Circuit {circuit.circuit_number} Rev {circuit.revision} approved",
            message=f"{user.name or user.email} approved \"{circuit.title}\".",
            notification_type="hyd_circuit_approved", entity_type="hyd_circuit", entity_id=circuit.id,
        )
    db.commit()
    db.refresh(circuit)
    return _to_responses(db, [circuit], with_revisions=True)[0]


@router.post("/{circuit_id}/return", response_model=HydCircuitResponse)
async def return_circuit(
    circuit_id: int,
    payload: HydCircuitReviewPayload,
    db: Session = Depends(get_db),
    user: User = Depends(_CAN_APPROVE),
):
    circuit = _get_or_404(db, circuit_id, lock=True)
    _require_status(circuit, ("under_review",), "return")
    if not (payload.remarks or "").strip():
        raise HTTPException(status_code=400, detail="Say what needs fixing — review remarks are required when returning a circuit.")
    circuit.status = "draft"
    circuit.review_remarks = payload.remarks.strip()
    if circuit.submitted_by_id:
        notify_user(
            db, user_id=circuit.submitted_by_id, title=f"Circuit {circuit.circuit_number} returned for changes",
            message=f"{user.name or user.email}: {circuit.review_remarks}",
            notification_type="hyd_circuit_returned", entity_type="hyd_circuit", entity_id=circuit.id,
        )
    db.commit()
    db.refresh(circuit)
    return _to_responses(db, [circuit], with_revisions=True)[0]


@router.post("/{circuit_id}/revise", response_model=HydCircuitResponse)
async def revise_circuit(
    circuit_id: int,
    payload: HydCircuitRevisePayload,
    db: Session = Depends(get_db),
    user: User = Depends(_CAN_EDIT),
):
    """Raises the next revision of an approved circuit as a new draft. The
    approved revision stays in force until the new one is approved."""
    circuit = _get_or_404(db, circuit_id, lock=True)
    _require_status(circuit, ("approved",), "raise a new revision of")
    open_rev = db.query(HydCircuit).filter(
        HydCircuit.circuit_number == circuit.circuit_number, HydCircuit.is_deleted == False,  # noqa: E712
        HydCircuit.status.in_(("draft", "under_review")),
    ).first()
    if open_rev:
        raise HTTPException(status_code=409, detail=f"Rev {open_rev.revision} of {circuit.circuit_number} is already open ({open_rev.status.replace('_', ' ')}). Finish or delete it before raising another revision.")
    latest = db.query(HydCircuit.revision).filter(HydCircuit.circuit_number == circuit.circuit_number).order_by(HydCircuit.id.desc()).first()
    new = HydCircuit(
        circuit_number=circuit.circuit_number, revision=next_revision(latest[0] if latest else circuit.revision),
        title=circuit.title, system_type=circuit.system_type, system_id=circuit.system_id, status="draft",
        drawing_number=circuit.drawing_number, symbol_standard=circuit.symbol_standard, description=circuit.description,
        change_note=payload.change_note.strip(), created_by_id=user.id,
    )
    db.add(new)
    db.commit()
    db.refresh(new)
    return _to_responses(db, [new], with_revisions=True)[0]


@router.delete("/{circuit_id}")
async def delete_circuit(
    circuit_id: int,
    db: Session = Depends(get_db),
    _perm: User = Depends(require_tab_action("hydraulic", "circuits", "delete")),
):
    circuit = _get_or_404(db, circuit_id)
    _require_status(circuit, ("draft",), "delete")
    circuit.is_deleted = True
    circuit.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"{circuit.circuit_number} Rev {circuit.revision} deleted"}
