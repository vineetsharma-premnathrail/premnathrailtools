"""Design Settings — plain values the Design head maintains (team roles,
change board, ECN acknowledgers, default approver, overdue days). Forms,
fields, tabs and workflow steps are code, not settings (2026-09-18
no-metadata decision). Every save is on the audit trail."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.design.access import get_settings, is_head, role_of, team_configured
from app.modules.design.models.change_notice import DESIGN_ECN_ACK_DEPARTMENTS
from app.modules.design.models.setting import DESIGN_TEAM_ROLES, DesignTeamMember
from app.modules.design.schemas.setting import DesignSettingsResponse, DesignSettingsUpdate, DesignTeamMemberResponse
from app.modules.design.service import DESIGN_APP, add_event, user_name, users_by_id
from app.modules.main.models.user import User

router = APIRouter(prefix="/design/settings", tags=["Design"], dependencies=[Depends(require_app_access("design"))])


def _response(db: Session, user: User) -> DesignSettingsResponse:
    s = get_settings(db)
    members = db.query(DesignTeamMember).order_by(DesignTeamMember.id).all()
    acks = {k: list(v or []) for k, v in (s.ecn_acknowledger_ids or {}).items()}
    ids = {m.user_id for m in members} | set(s.change_board_member_ids or []) | {u for v in acks.values() for u in v}
    ids |= {s.default_approver_id, s.updated_by_id}
    users = users_by_id(db, ids)

    def person(uid):
        u = users.get(uid)
        return {"user_id": uid, "name": user_name(u), "email": u.email if u else None}

    return DesignSettingsResponse(
        customer_response_days=s.customer_response_days, review_overdue_days=s.review_overdue_days,
        default_approver_id=s.default_approver_id, default_approver_name=user_name(users.get(s.default_approver_id)),
        change_board_member_ids=list(s.change_board_member_ids or []),
        change_board=[person(uid) for uid in (s.change_board_member_ids or [])],
        ecn_acknowledger_ids=acks, ecn_acknowledgers={k: [person(uid) for uid in v] for k, v in acks.items()},
        team=[
            DesignTeamMemberResponse(
                user_id=m.user_id, role=m.role, name=user_name(users.get(m.user_id)),
                email=users[m.user_id].email if m.user_id in users else None,
                has_design_app=bool(users.get(m.user_id) and DESIGN_APP in users[m.user_id].get_apps()),
            )
            for m in members
        ],
        team_configured=bool(members), updated_at=s.updated_at, updated_by_name=user_name(users.get(s.updated_by_id)),
        my_role=role_of(db, user), can_edit=is_head(db, user),
    )


@router.get("", response_model=DesignSettingsResponse)
async def read_settings(db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    return _response(db, user)


@router.get("/me")
async def my_role(db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    """The caller's Design role — the frontend uses it to hide team-only buttons."""
    role = role_of(db, user)
    return {"role": role, "is_head": is_head(db, user), "is_team": role != "viewer", "team_configured": team_configured(db)}


@router.put("", response_model=DesignSettingsResponse)
async def update_settings(payload: DesignSettingsUpdate, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    if not is_head(db, user):
        raise HTTPException(status_code=403, detail="Only the Design head or an admin can change Design settings.")
    s = get_settings(db)
    changes = payload.model_dump(exclude_unset=True)
    all_ids = set(changes.get("change_board_member_ids") or [])
    all_ids |= {u for v in (changes.get("ecn_acknowledger_ids") or {}).values() for u in v}
    all_ids |= {m["user_id"] for m in (changes.get("team") or [])}
    if changes.get("default_approver_id"):
        all_ids.add(changes["default_approver_id"])
    people = users_by_id(db, all_ids)
    missing = all_ids - set(people)
    if missing:
        raise HTTPException(status_code=400, detail=f"User(s) #{', #'.join(str(i) for i in sorted(missing))} no longer exist — remove them and save again.")
    inactive = [user_name(p) for p in people.values() if not p.is_active]
    if inactive:
        raise HTTPException(status_code=400, detail=f"{', '.join(inactive)} {'is' if len(inactive) == 1 else 'are'} deactivated — remove them before saving.")

    summary = []
    for key in ("customer_response_days", "review_overdue_days"):
        if changes.get(key) is not None and getattr(s, key) != changes[key]:
            setattr(s, key, changes[key])
            summary.append(key.replace("_", " "))
    if "default_approver_id" in changes:
        approver = changes["default_approver_id"]
        if approver and DESIGN_APP not in people[approver].get_apps():
            raise HTTPException(status_code=400, detail=f"{user_name(people[approver])} doesn't have the Design app, so they can't approve drawings.")
        s.default_approver_id = approver
        summary.append("default approver")
    if changes.get("change_board_member_ids") is not None:
        s.change_board_member_ids = list(dict.fromkeys(changes["change_board_member_ids"]))
        summary.append("change board")
    if changes.get("ecn_acknowledger_ids") is not None:
        acks = changes["ecn_acknowledger_ids"]
        bad = set(acks) - set(DESIGN_ECN_ACK_DEPARTMENTS)
        if bad:
            raise HTTPException(status_code=400, detail=f"Unknown department(s): {', '.join(sorted(bad))}. Use: {', '.join(DESIGN_ECN_ACK_DEPARTMENTS)}.")
        s.ecn_acknowledger_ids = {k: list(dict.fromkeys(v)) for k, v in acks.items() if v}
        summary.append("ECN acknowledgers")
    if changes.get("team") is not None:
        rows = payload.team or []
        seen = set()
        for row in rows:
            if row.role not in DESIGN_TEAM_ROLES:
                raise HTTPException(status_code=400, detail=f"'{row.role}' isn't a Design role. Use designer, reviewer or head.")
            if row.user_id in seen:
                raise HTTPException(status_code=400, detail=f"{user_name(people[row.user_id])} is listed twice in the team.")
            seen.add(row.user_id)
        if rows and not any(r.role == "head" for r in rows):
            raise HTTPException(status_code=400, detail="The team needs at least one Design head — they release drawings and decide ECRs.")
        if rows and user.role != "admin" and not any(r.user_id == user.id and r.role == "head" for r in rows):
            raise HTTPException(status_code=400, detail="You'd be removing yourself as Design head and lose access to Settings. Keep yourself as head, or ask an admin to make the change.")
        db.query(DesignTeamMember).delete()
        for row in rows:
            db.add(DesignTeamMember(user_id=row.user_id, role=row.role))
        summary.append("team")
    s.updated_by_id = user.id
    if summary:
        add_event(db, "settings_updated", user, comment="Changed " + ", ".join(summary))
    db.commit()
    return _response(db, user)
