"""The one portal admin comes from the server environment (owner, 2026-11-12).

The portal admin can't be made or removed from the portal, and a Microsoft
tenant Global Administrator is never made admin automatically. The only way:
set PORTAL_ADMIN_EMAIL in the server's environment (Dokploy) and redeploy.

- docker-entrypoint.sh runs this module on every start (`python -m
  app.cli.set_admin`); nobody runs it by hand.
- The login routes also apply it when that person logs in, so it works on an
  empty database too (their account appears only at their first login).
- Exactly one admin: whoever was admin before becomes a normal user (their
  roles stay, so they keep their normal module access).
- Every change gets an audit entry and the Partners are told on bell + Teams,
  so a change made quietly on the server is still seen. Nothing is written or
  sent when the admin is already right. Empty setting = admin left as it is.
"""
from __future__ import annotations

import logging
import sys

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User

logger = logging.getLogger(__name__)

NOTIFICATION_TYPE = "portal_admin_changed"


class SetAdminError(Exception):
    """Why the setting can't be applied, written for the person managing the server."""


def env_email() -> str:
    """PORTAL_ADMIN_EMAIL, lower-cased; '' when not set. One address only."""
    from app.core.config import settings

    raw = (settings.PORTAL_ADMIN_EMAIL or "").strip().lower()
    if raw and ("," in raw or ";" in raw or " " in raw):
        raise SetAdminError(
            "PORTAL_ADMIN_EMAIL holds more than one address. The portal has exactly one admin: "
            "put one email there and redeploy.")
    return raw


def plan(db: Session, email: str) -> tuple[User, list[User]]:
    """The user who becomes admin and the current admins who stop being admin."""
    email = (email or "").strip().lower()
    if "@" not in email:
        raise SetAdminError(f"PORTAL_ADMIN_EMAIL '{email}' is not an email address.")
    target = db.query(User).filter(func.lower(User.email) == email).first()
    if target is None:
        raise SetAdminError(
            f"No portal user has the email {email} yet. They become admin at their first Microsoft login.")
    if not target.is_active:
        raise SetAdminError(
            f"{target.name} ({target.email}) is deactivated, so they can't be admin. Re-activate them, "
            "or put another person's email in PORTAL_ADMIN_EMAIL and redeploy.")
    others = db.query(User).filter(User.role == "admin", User.id != target.id).order_by(User.id).all()
    return target, others


def apply(db: Session, email: str) -> tuple[User, list[User], bool]:
    """Make `email` the only admin. Returns (admin, demoted, changed). Caller commits."""
    target, others = plan(db, email)
    changed = target.role != "admin" or bool(others)
    if not changed:
        return target, others, False
    if target.role != "admin":
        target.role = "admin"
        db.add(AuditLog(entity_type="user", entity_id=target.id, action="role_changed", module_key="organization",
                        field_name="Role", old_value="user", new_value="admin",
                        summary=f"{target.name} made the portal admin (server setting)"))
    for o in others:
        o.role = "user"
        db.add(AuditLog(entity_type="user", entity_id=o.id, action="role_changed", module_key="organization",
                        field_name="Role", old_value="admin", new_value="user",
                        summary=f"{o.name} is no longer portal admin: {target.name} is the only admin "
                                "(server setting)"))
    _tell_partners(db, target, others)
    return target, others, True


def _tell_partners(db: Session, target: User, demoted: list[User]) -> None:
    from app.utils.notifications import notify_user

    msg = f"{target.name} ({target.email}) is now the portal admin. This was set on the server."
    if demoted:
        msg += " No longer admin: " + ", ".join(u.name or u.email for u in demoted) + "."
    msg += " If you did not expect this, check who has access to the server."
    partners = db.query(User).filter(User.is_partner.is_(True), User.is_active.is_(True)).all()
    for p in {p.id: p for p in partners + [target]}.values():
        notify_user(db, p.id, "Portal admin changed", msg, NOTIFICATION_TYPE,
                    entity_type="user", entity_id=target.id, teams=True)


def apply_from_env(db: Session, only_for: User | None = None) -> bool:
    """Make PORTAL_ADMIN_EMAIL the only admin, if set. Never raises: a wrong
    setting is logged, never allowed to stop a server start or a login.
    `only_for`: at login, act only when the person logging in is that email.
    Returns True when it changed something; commits itself."""
    try:
        email = env_email()
        if not email or (only_for is not None and (only_for.email or "").strip().lower() != email):
            return False
        _, _, changed = apply(db, email)
        if changed:
            db.commit()
            logger.warning("Portal admin set from PORTAL_ADMIN_EMAIL (%s).", email)
        return changed
    except SetAdminError as e:
        db.rollback()
        logger.warning("PORTAL_ADMIN_EMAIL not applied: %s", e)
        return False
    except Exception:  # noqa: BLE001 — must never block a start or a login
        db.rollback()
        logger.exception("PORTAL_ADMIN_EMAIL could not be applied")
        return False


def main() -> int:
    """Server start (docker-entrypoint.sh). Always exits 0: never stops the container."""
    logging.basicConfig(level=logging.INFO, format="[portal-admin] %(message)s")
    import app.main  # noqa: F401 — registers every model so relationships resolve
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        if apply_from_env(db):
            print("[entrypoint] portal admin set from PORTAL_ADMIN_EMAIL")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
