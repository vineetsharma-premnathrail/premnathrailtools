from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.schemas.user import UserHRUpdate, UserResponse
from app.modules.main.routes.users import to_response

router = APIRouter(prefix="/hr", tags=["HR"])


@router.get("/directory", response_model=list[UserResponse])
async def hr_directory(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("hr")),
):
    """Full employee directory for HR — includes reporting_manager and DOJ,
    unlike the generic /users/directory picker other modules use. See
    docs/product/HR_MODULE_PLAN.md Phase 1."""
    users = db.query(User).filter(User.is_active == True).order_by(User.name).all()  # noqa: E712
    return [to_response(u, db) for u in users]


@router.patch("/employees/{user_id}", response_model=UserResponse)
async def update_hr_profile(
    user_id: int,
    payload: UserHRUpdate,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("hr")),
):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Employee not found")

    updates = payload.model_dump(exclude_unset=True)
    if "reporting_manager_id" in updates and updates["reporting_manager_id"] is not None:
        if updates["reporting_manager_id"] == user_id:
            raise HTTPException(status_code=400, detail="An employee cannot be their own reporting manager")
        manager = db.query(User).filter(User.id == updates["reporting_manager_id"], User.is_active == True).first()  # noqa: E712
        if not manager:
            raise HTTPException(status_code=404, detail="Reporting manager not found")
        seen = {user_id}
        current_id = manager.reporting_manager_id
        while current_id is not None:
            if current_id in seen:
                raise HTTPException(status_code=400, detail="This reporting-manager change would create a circular org chart")
            seen.add(current_id)
            current = db.query(User).filter(User.id == current_id).first()
            if not current:
                break
            current_id = current.reporting_manager_id

    for field, val in updates.items():
        setattr(target, field, val)

    db.commit()
    db.refresh(target)
    return to_response(target, db)
