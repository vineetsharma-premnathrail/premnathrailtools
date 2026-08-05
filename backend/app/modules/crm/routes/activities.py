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
    return user.role == "admin" or record.created_by_id == user.id


@router.get("/team-members")
async def list_team_members(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("crm")),
):
    """Lightweight internal-user lookup (name + designation) for the MOM
    export's "PEW Member Present" picker — avoids re-typing attendee names
    that already live on the user's profile."""
    users = db.query(User).filter(User.is_active == True).order_by(User.name).all()  # noqa: E712
    return [{"id": u.id, "name": u.name, "designation": u.designation} for u in users]


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
    data = payload.model_dump()
    data["mom_items"] = payload.model_dump(mode="json").get("mom_items")
    activity = Activity(**data, created_by_id=user.id)
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
    json_data = payload.model_dump(exclude_unset=True, mode="json")
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(activity, field, json_data[field] if field == "mom_items" else value)
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
