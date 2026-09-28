from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.quality.models.quality_checklist import (
    QualityChecklist, QualityChecklistItem, QUALITY_CHECKLIST_STATUSES,
)
from app.modules.quality.schemas.quality_checklist import (
    QualityChecklistCreate, QualityChecklistUpdate, QualityChecklistResponse,
)

router = APIRouter(prefix="/quality/checklists", tags=["Quality"], dependencies=[Depends(require_app_access("quality"))])


def _get_or_404(db: Session, checklist_id: int) -> QualityChecklist:
    checklist = db.query(QualityChecklist).options(
        selectinload(QualityChecklist.items)
    ).filter(QualityChecklist.id == checklist_id).first()
    if not checklist:
        raise HTTPException(status_code=404, detail="Quality checklist not found")
    return checklist


@router.get("", response_model=list[QualityChecklistResponse])
async def list_quality_checklists(
    status_filter: str | None = Query(None, alias="status"),
    search: str | None = None,
    db: Session = Depends(get_db),
):
    query = db.query(QualityChecklist).options(selectinload(QualityChecklist.items))
    if status_filter:
        query = query.filter(QualityChecklist.status == status_filter)
    if search:
        query = query.filter(QualityChecklist.name.ilike(f"%{search}%"))
    checklists = query.order_by(QualityChecklist.created_at.desc()).all()
    return checklists


@router.post("", response_model=QualityChecklistResponse)
async def create_quality_checklist(
    payload: QualityChecklistCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("quality")),
):
    checklist = QualityChecklist(
        name=payload.name,
        description=payload.description,
        category=payload.category,
        created_by_id=user.id,
    )
    db.add(checklist)
    db.flush()

    for item in payload.items:
        db.add(QualityChecklistItem(
            checklist_id=checklist.id,
            parameter=item.parameter,
            method=item.method,
            acceptance_criteria=item.acceptance_criteria,
            sort_order=item.sort_order,
        ))

    db.commit()
    db.refresh(checklist)
    return _get_or_404(db, checklist.id)


@router.get("/{checklist_id}", response_model=QualityChecklistResponse)
async def get_quality_checklist(checklist_id: int, db: Session = Depends(get_db)):
    return _get_or_404(db, checklist_id)


@router.patch("/{checklist_id}", response_model=QualityChecklistResponse)
async def update_quality_checklist(
    checklist_id: int,
    payload: QualityChecklistUpdate,
    db: Session = Depends(get_db),
):
    checklist = _get_or_404(db, checklist_id)
    updates = payload.model_dump(exclude_unset=True)

    new_status = updates.get("status")
    if new_status and new_status not in QUALITY_CHECKLIST_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'")

    items = updates.pop("items", None)
    for field, val in updates.items():
        setattr(checklist, field, val)

    if items is not None:
        # Replace all existing items — delete then re-insert, matching the
        # nested-item replace pattern used elsewhere in the codebase.
        for existing in list(checklist.items):
            db.delete(existing)
        db.flush()
        for item in items:
            db.add(QualityChecklistItem(
                checklist_id=checklist.id,
                parameter=item["parameter"],
                method=item.get("method"),
                acceptance_criteria=item.get("acceptance_criteria"),
                sort_order=item.get("sort_order", 0),
            ))

    db.commit()
    db.refresh(checklist)
    return _get_or_404(db, checklist.id)


@router.delete("/{checklist_id}")
async def delete_quality_checklist(checklist_id: int, db: Session = Depends(get_db)):
    checklist = _get_or_404(db, checklist_id)
    db.delete(checklist)
    db.commit()
    return {"message": "Quality checklist deleted"}
