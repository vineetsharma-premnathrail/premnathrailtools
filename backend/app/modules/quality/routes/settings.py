"""Quality → Settings (data only) and Quality role permission sets."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.quality.schemas.masters import QualitySettingsUpdatePayload, QualityRoleAssignPayload
from app.modules.quality.services import access
from app.modules.quality.services.settings import (
    QUALITY_SETTING_SPECS, QUALITY_SETTING_GROUPS, get_all_settings, save_settings,
)

router = APIRouter(prefix="/quality/settings", tags=["Quality"], dependencies=[Depends(require_app_access("quality"))])


@router.get("")
async def get_settings(db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    return {
        "values": get_all_settings(db),
        "specs": [{"key": k, **{kk: vv for kk, vv in spec.items() if kk != "default"}, "default": spec["default"]}
                  for k, spec in QUALITY_SETTING_SPECS.items()],
        "groups": [{"key": k, "label": v} for k, v in QUALITY_SETTING_GROUPS.items()],
        "can_edit": access.can_edit_settings(user),
    }


@router.put("")
async def update_settings(payload: QualitySettingsUpdatePayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    if not access.can_edit_settings(user):
        raise HTTPException(status_code=403, detail="Only a Quality head or an admin can change Quality settings. Ask an admin to apply the Quality head role.")
    try:
        values = save_settings(db, payload.values)
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(e))
    db.commit()
    return {"values": values}


@router.get("/roles")
async def list_roles(db: Session = Depends(get_db), _user: User = Depends(require_app_access("quality"))):
    users = [u for u in db.query(User).filter(User.is_active.is_(True)).order_by(User.name).all() if "quality" in u.get_apps()]
    return {
        "roles": [{"key": k, "label": v["label"], "grants": v["grants"]} for k, v in access.QUALITY_ROLE_PERMISSION_SETS.items()],
        "users": [{"id": u.id, "name": u.name or u.email, "email": u.email, "is_admin": u.role == "admin",
                   "is_partner": access.is_partner(u), "roles": access.user_quality_roles(u)} for u in users],
    }


@router.post("/roles/assign")
async def assign_role(payload: QualityRoleAssignPayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can grant Quality roles (they change the user's Permission Matrix).")
    target = db.query(User).filter(User.id == payload.user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail=f"User #{payload.user_id} not found")
    try:
        added = access.apply_role(target, payload.role)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    db.add(AuditLog(entity_type="user", entity_id=target.id, action="quality_role_granted", performed_by_id=user.id,
                    module_key="quality", subtab_key="settings",
                    summary=f"{user.name or user.email} granted Quality role '{access.QUALITY_ROLE_PERMISSION_SETS[payload.role]['label']}' "
                            f"to {target.name or target.email} ({len(added)} new permission(s)).",
                    new_value=", ".join(added) or None))
    db.commit()
    return {"user_id": target.id, "added": added, "roles": access.user_quality_roles(target)}
