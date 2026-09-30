"""Leaver protection shared by HR lifecycle, Azure login and Azure sync.

Kept deliberately tiny (imports only the profile + session models) so
app/modules/main/routes/auth.py and users.py can import it without pulling
the whole HR lifecycle service (and its P2P / department imports) into the
auth path.

- `get_exit_info(db, user_id)` — is this user an exited employee? Azure
  login and "Sync Azure Users" must never re-activate them (security
  finding S-10 / P2-USR-16): the only way back in is HR completing a new
  joining event.
- `revoke_user_sessions(db, user_id)` — the "sign out everywhere" that
  deactivation promised but never did (P2-USR-17). Same mechanics as
  /auth/logout: stamp `revoked_at` on every live refresh session.
"""
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.main.models.user_session import UserSession


def get_exit_info(db: Session, user_id: int | None) -> tuple[bool, date | None]:
    """(is_exited, date_of_exit) from the user's HR employee profile."""
    if not user_id:
        return False, None
    row = (
        db.query(HrEmployeeProfile.employment_status, HrEmployeeProfile.date_of_exit)
        .filter(HrEmployeeProfile.user_id == user_id)
        .first()
    )
    if not row:
        return False, None
    return row[0] == "exited", row[1]


def is_exited(db: Session, user_id: int | None) -> bool:
    return get_exit_info(db, user_id)[0]


def exited_login_message(db: Session, user_id: int | None) -> str:
    """The sign-in refusal text for an exited employee."""
    _, exit_date = get_exit_info(db, user_id)
    when = f" on {exit_date.strftime('%d-%m-%Y')}" if exit_date else ""
    return (
        f"Your employment was closed in HR & Administration{when}, so portal sign-in is disabled. "
        "If you have rejoined, ask HR to complete a joining event for you in HR > Lifecycle."
    )


def revoke_user_sessions(db: Session, user_id: int) -> int:
    """Revoke every live refresh session of `user_id`. Does not commit.
    Returns how many sessions were revoked."""
    now = datetime.now(timezone.utc)
    sessions = (
        db.query(UserSession)
        .filter(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
        .all()
    )
    for s in sessions:
        s.revoked_at = now
    return len(sessions)
