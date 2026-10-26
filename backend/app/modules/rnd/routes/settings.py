"""R&D Settings — read-only: who the R&D head is, and whether the current user
may create Technical Offers. R&D heads are the R&D department's heads in
Organization › Department (they can always create). Everyone else gets the
Technical Offer team through the permission R&D › Requirements ›
"Technical Offer team (every requirement)" in Organization › Role &
Permissions (it replaced the creator / viewer lists that used to live here)."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.rnd.services import requirement_access as ra

router = APIRouter(prefix="/settings", tags=["RnD Settings"], dependencies=[Depends(require_app_access("rnd"))])


def _name(u: User | None) -> str:
    return (u.name or u.email) if u else "Unknown user"


def _response(db: Session, user: User) -> dict:
    head_users = ra.heads(db) if ra.org_head_ids(db) else []
    return {
        "heads": [{"user_id": u.id, "name": _name(u)} for u in head_users],
        "can_edit": ra.is_head(db, user),
        "is_head": ra.is_head(db, user),
        "can_create_technical_offer": ra.is_rnd_side(user) and ra.can_create_technical_offer(db, user),
    }


@router.get("")
async def read_settings(db: Session = Depends(get_db), user: User = Depends(require_app_access("rnd"))):
    return _response(db, user)


@router.get("/people")
async def rnd_people(db: Session = Depends(get_db), _user: User = Depends(require_app_access("rnd"))):
    """Active users with R&D access (granted in Organization) — for the
    Settings, access and task pickers."""
    roles = ra.team_roles(db)
    return [
        {"id": u.id, "name": u.name or u.email, "email": u.email, "designation": getattr(u, "designation", None), "team_role": roles.get(u.id)}
        for u in ra.rnd_users(db)
    ]
