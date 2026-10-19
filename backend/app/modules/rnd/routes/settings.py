"""R&D Settings — only the Technical Offer permissions: who may create
Technical Offers and who may only see them. Module access is granted in
Organization; R&D heads are the R&D department's heads in Organization ›
Department (they can always create). Changes are audited."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.rnd.models.requirement_work import RndTeamMember
from app.modules.rnd.services import requirement_access as ra

router = APIRouter(prefix="/settings", tags=["RnD Settings"], dependencies=[Depends(require_app_access("rnd"))])


class RndSettingsUpdate(BaseModel):
    creator_ids: list[int] = []
    viewer_ids: list[int] = []


def _name(u: User | None) -> str:
    return (u.name or u.email) if u else "Unknown user"


def _person(u: User | None, user_id: int) -> dict:
    return {
        "user_id": user_id, "name": _name(u), "email": u.email if u else None,
        "has_rnd_app": bool(u and "rnd" in u.get_apps()), "is_active": bool(u and u.is_active),
    }


def _response(db: Session, user: User) -> dict:
    rows = db.query(RndTeamMember).order_by(RndTeamMember.id).all()
    users = {u.id: u for u in db.query(User).filter(User.id.in_([r.user_id for r in rows])).all()} if rows else {}
    head_users = ra.heads(db) if ra.org_head_ids(db) else []
    return {
        "heads": [{"user_id": u.id, "name": _name(u)} for u in head_users],
        "creators": [_person(users.get(r.user_id), r.user_id) for r in rows if r.can_create_technical_offer],
        "viewers": [_person(users.get(r.user_id), r.user_id) for r in rows if r.can_view_technical_offer and not r.can_create_technical_offer],
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


@router.put("")
async def update_settings(payload: RndSettingsUpdate, db: Session = Depends(get_db), user: User = Depends(require_app_access("rnd"))):
    ra.ensure_head(db, user, "change who can create or see Technical Offers")
    creators = list(dict.fromkeys(payload.creator_ids))
    viewers = [i for i in dict.fromkeys(payload.viewer_ids) if i not in creators]
    ids = [*creators, *viewers]
    people = {u.id: u for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}
    for uid in ids:
        u = people.get(uid)
        if not u:
            raise HTTPException(status_code=400, detail=f"User #{uid} no longer exists — remove them and save again.")
        if not u.is_active:
            raise HTTPException(status_code=400, detail=f"{_name(u)} is deactivated — remove them before saving.")
        if "rnd" not in u.get_apps():
            raise HTTPException(status_code=400, detail=f"{_name(u)} has no access to the R&D module, so they couldn't open any Technical Offer. "
                                                        "Grant R&D access in Organization › Role & Permissions first.")

    db.query(RndTeamMember).delete()
    for uid in creators:
        db.add(RndTeamMember(user_id=uid, role="member", can_create_technical_offer=True, can_view_technical_offer=True))
    for uid in viewers:
        db.add(RndTeamMember(user_id=uid, role="member", can_create_technical_offer=False, can_view_technical_offer=True))
    creators_txt = ", ".join(_name(people[i]) for i in creators) or "R&D heads only"
    viewers_txt = ", ".join(_name(people[i]) for i in viewers) or "nobody"
    db.add(AuditLog(
        entity_type="rnd_settings", entity_id=1, action="update", module_key="rnd",
        summary=f"{_name(user)} updated Technical Offer permissions. Can create: {creators_txt}. Can see (view only): {viewers_txt}.",
        performed_by_id=user.id,
    ))
    db.commit()
    return _response(db, user)
