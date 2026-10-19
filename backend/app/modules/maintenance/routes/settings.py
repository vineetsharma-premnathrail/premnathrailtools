"""GET/PUT /maintenance/settings and POST /maintenance/settings/reset/{key} on
the shared settings framework (app/core/settings_framework.py).

Same endpoints, payload, validation and audit as make_settings_router(); the
only difference is the editor rule — besides admin and an explicit
`maintenance:settings:edit` grant, an explicit `maintenance:work_orders:approve`
grant (the planner who closes jobs) may edit (see maintenance/settings.py)."""
from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core import settings_framework as sf
from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.maintenance.settings import MODULE, can_edit_maintenance_settings

router = APIRouter(prefix="/maintenance/settings", tags=["Settings"])

_EDITORS_NOTE = ("Only admins or users whose role grants Maintenance › Settings → Edit can change these settings — "
                 "ask an admin to add it to one of your roles in Organization › Role & Permissions.")
_CONCURRENT_SAVE = ("Someone else changed this setting at the same moment — nothing was saved; "
                    "reload the page and save again.")


def _payload(db: Session, user: User) -> dict:
    data = sf.settings_payload(db, MODULE, user)
    data["can_edit"] = can_edit_maintenance_settings(user)
    data["editors_note"] = _EDITORS_NOTE
    return data


def _require_editor(user: User) -> None:
    if not can_edit_maintenance_settings(user):
        raise HTTPException(status_code=403, detail=_EDITORS_NOTE)


@router.get("")
def read_settings(db: Session = Depends(get_db), user: User = Depends(require_app_access("maintenance"))):
    return _payload(db, user)


@router.put("")
def update_settings(body: dict = Body(...), db: Session = Depends(get_db),
                    user: User = Depends(require_app_access("maintenance"))):
    _require_editor(user)
    values = body.get("values") if isinstance(body, dict) else None
    if not isinstance(values, dict):
        raise HTTPException(status_code=422, detail="Send the changed settings as {\"values\": {key: value}} — nothing was saved.")
    try:
        sf.save(db, MODULE, values, user)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=_CONCURRENT_SAVE) from None
    return _payload(db, user)


@router.post("/reset/{key}")
def reset_setting(key: str, db: Session = Depends(get_db), user: User = Depends(require_app_access("maintenance"))):
    _require_editor(user)
    try:
        sf.reset(db, MODULE, key, user)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=_CONCURRENT_SAVE) from None
    return _payload(db, user)
