"""Who is who in Design: team roles from Settings, the Design head(s), and
what a non-team viewer (Production, Quality, Purchase holding the Design
app) may see.

Roles come from design_team_members. Until that list has anyone in it the
module behaves as before the team existed: everyone holding the Design app
works as a designer and anyone may be named checker/approver — so turning
the team on is a deliberate Settings step, not a surprise lock-out."""
from datetime import date
from fastapi import HTTPException
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.modules.design.models.setting import DesignSetting, DesignTeamMember
from app.modules.main.models.user import User

VIEWER = "viewer"


def get_settings(db: Session) -> DesignSetting:
    row = db.query(DesignSetting).filter(DesignSetting.id == 1).first()
    if not row:
        row = DesignSetting(id=1, customer_response_days=14, review_overdue_days=7, change_board_member_ids=[], ecn_acknowledger_ids={})
        db.add(row)
        db.flush()
    return row


def team_roles(db: Session) -> dict[int, str]:
    return {m.user_id: m.role for m in db.query(DesignTeamMember).all()}


def team_configured(db: Session) -> bool:
    return db.query(DesignTeamMember.id).first() is not None


def role_of(db: Session, user: User, roles: dict[int, str] | None = None) -> str:
    """admin | head | reviewer | designer | viewer."""
    if user.role == "admin":
        return "admin"
    roles = team_roles(db) if roles is None else roles
    if not roles:
        return "designer"
    return roles.get(user.id, VIEWER)


def is_team(db: Session, user: User) -> bool:
    return role_of(db, user) != VIEWER


def is_head(db: Session, user: User) -> bool:
    """Design head or admin. With no team set up, any Design user acts as
    head (the pre-team behaviour)."""
    return role_of(db, user) in ("admin", "head") or not team_configured(db)


def head_ids(db: Session) -> list[int]:
    """Who gets "Design head" alerts: heads on the team, else the default
    approver from Settings."""
    ids = [uid for uid, role in team_roles(db).items() if role == "head"]
    if ids:
        return ids
    s = get_settings(db)
    return [s.default_approver_id] if s.default_approver_id else []


def require_team(db: Session, user: User, what: str) -> None:
    if not is_team(db, user):
        raise HTTPException(
            status_code=403,
            detail=f"Only members of the Design team can {what}. You can view released drawings and BOMs and raise a change "
                   "request (ECR). Ask the Design head to add you to the team in Design › Settings if you need more.",
        )


def require_head(db: Session, user: User, what: str) -> None:
    if not is_head(db, user):
        raise HTTPException(
            status_code=403,
            detail=f"Only the Design head (or an admin) can {what}. Ask the Design head to do it, or to change your role in Design › Settings.",
        )


def check_signatory_role(db: Session, user_id: int | None, role: str, label: str) -> None:
    """With a team set up: checkers must be reviewers or heads, approvers
    (who release) must be heads — plan rule "only the Design head releases"."""
    if not user_id:
        return
    roles = team_roles(db)
    if not roles:
        return
    person = db.query(User).filter(User.id == user_id).first()
    if person and person.role == "admin":
        return
    held = roles.get(user_id, VIEWER)
    allowed = ("reviewer", "head") if role == "checker" else ("head",)
    if held not in allowed:
        name = (person.name or person.email) if person else f"user #{user_id}"
        need = "a reviewer or the Design head" if role == "checker" else "the Design head"
        raise HTTPException(
            status_code=400,
            detail=f"{name} is {'not on the Design team' if held == VIEWER else 'a ' + held} — the {label} must be {need}. "
                   "Pick someone else, or change their role in Design › Settings.",
        )


# ---------------------------------------------------------------------------
# Number series (same advisory-lock pattern as service._next_number)
# ---------------------------------------------------------------------------

def next_number(db: Session, column, prefix: str) -> str:
    if db.get_bind().dialect.name == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
    last = db.query(func.max(column)).filter(column.like(f"{prefix}%")).scalar()
    if last:
        return f"{prefix}{int(last.rsplit('-', 1)[-1]) + 1:04d}"
    return f"{prefix}0001"


def year_prefix(code: str) -> str:
    return f"{code}-{date.today().year}-"
