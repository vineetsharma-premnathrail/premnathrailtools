from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.permissions import require_app_access
from app.modules.main.models.user import User
from app.modules.crm.models.activity import Activity
from app.modules.crm.schemas.activity import ActivityCreate, ActivityUpdate, ActivityResponse

router = APIRouter(prefix="/crm/activities", tags=["CRM - Activities"])


def _can_modify(record, user: User) -> bool:
    return user.role in ("admin", "super_admin") or record.created_by_id == user.id


@router.get("", response_model=list[ActivityResponse])
async def list_activities(
    search: str | None = None,
    status: str | None = None,
    org_id: int | None = None,
    related_module: str | None = None,
    related_id: int | None = None,
    skip: int = 0,
    limit: int = 200,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    query = db.query(Activity).filter(Activity.is_deleted == False)  # noqa: E712
    if status:
        query = query.filter(Activity.status == status)
    if org_id:
        query = query.filter(Activity.org_id == org_id)
    if related_module:
        query = query.filter(Activity.related_module == related_module)
    if related_id:
        query = query.filter(Activity.related_id == related_id)
    if search:
        like = f"%{search}%"
        query = query.filter((Activity.universal_id.ilike(like)) | (Activity.remarks.ilike(like)))
    return query.order_by(Activity.id.desc()).offset(skip).limit(limit).all()


@router.post("", response_model=ActivityResponse, status_code=201)
async def create_activity(
    payload: ActivityCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    activity = Activity(**payload.model_dump(), created_by_id=user.id)
    db.add(activity)
    db.commit()
    db.refresh(activity)
    return activity


@router.patch("/{activity_id}", response_model=ActivityResponse)
async def update_activity(
    activity_id: int,
    payload: ActivityUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    activity = db.query(Activity).filter(Activity.id == activity_id, Activity.is_deleted == False).first()  # noqa: E712
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    if not _can_modify(activity, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can edit this activity.")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(activity, field, value)
    db.commit()
    db.refresh(activity)
    return activity


@router.delete("/{activity_id}")
async def delete_activity(
    activity_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("crm")),
):
    activity = db.query(Activity).filter(Activity.id == activity_id, Activity.is_deleted == False).first()  # noqa: E712
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    if not _can_modify(activity, user):
        raise HTTPException(status_code=403, detail="Only the creator or an admin can delete this activity.")
    activity.is_deleted = True
    activity.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": "Activity deleted"}
