"""Portal provisioning for HR records created without an account.

Accounts themselves come from Microsoft sign-in / "Sync Azure Users" — HR
can't create a Microsoft mailbox. So when HR gives a record Portal Access and
a Work Email, the record is linked to the User with that email:

- right away, if the account already exists (link_now);
- otherwise when that account is first created — first sign-in or Azure
  sync — via link_pending_profile, called from those places.

Linking moves the record from "no login" to a normal account holder: the
User row becomes the source of truth for joining date and manager, and
department / designation / plant are mirrored onto it."""
from __future__ import annotations

import re

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.hr.models.employee_profile import HrEmployeeProfile
from app.modules.main.models.user import User

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def validate_work_email(db: Session, profile: HrEmployeeProfile) -> User | None:
    """Check the work email and return the existing account it belongs to
    (None = no account yet; the link happens at first sign-in)."""
    email = (profile.work_email or "").strip().lower()
    name = profile.full_name or "this person"
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail=f"'{profile.work_email}' is not a valid email address. Enter the work email like name@premnathrail.com.")
    domain = (settings.DOMAIN_EMAIL or "").strip().lstrip("@").lower()
    if domain and not email.endswith(f"@{domain}"):
        raise HTTPException(
            status_code=422,
            detail=f"Work email must be a company address ending in @{domain} — only those can sign in to the portal. "
                   f"If {name} has no company email, set Portal Access to No.",
        )
    profile.work_email = email
    clash = (
        db.query(HrEmployeeProfile)
        .filter(func.lower(HrEmployeeProfile.work_email) == email, HrEmployeeProfile.user_id.is_(None), HrEmployeeProfile.id != profile.id)
        .first()
    )
    if clash:
        raise HTTPException(
            status_code=409,
            detail=f"{email} is already the work email on {clash.full_name or 'another HR record'}'s record. One email can sign in as one person — check the address.",
        )
    user = db.query(User).filter(func.lower(User.email) == email).first()
    if user is None:
        return None
    has_record = db.query(HrEmployeeProfile.id).filter(HrEmployeeProfile.user_id == user.id).first()
    if has_record:
        raise HTTPException(
            status_code=409,
            detail=f"The portal account {email} ({user.name}) already has its own HR record. Open {user.name} from the Employees list "
                   f"instead of creating a second record — or check the email.",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=409,
            detail=f"The portal account {email} ({user.name}) is deactivated — probably someone who left. A rehire must go "
                   "through HR > Lifecycle > New > Joining so the account is re-activated properly.",
        )
    return user


def check_role(db: Session, role_id: int | None, actor: User):
    """The application role HR picked for the account — it must exist and be
    one HR may hand out (same authority rules as Organization › Role &
    Permissions: no granting what you don't hold, no wider data access)."""
    from app.core.permission_registry import is_admin_user
    from app.modules.main.models.role import Role
    from app.modules.main.routes.roles import validate_grants, validate_scope_escalation

    if not role_id:
        raise HTTPException(status_code=422, detail="Pick the Application Role this person gets in the portal (Portal Access = Yes).")
    role = db.get(Role, role_id)
    if role is None or not role.is_active:
        raise HTTPException(status_code=422, detail=f"Role #{role_id} doesn't exist or is inactive — pick an active role from the list.")
    if role.is_default:
        raise HTTPException(status_code=422, detail=f"'{role.name}' applies to everyone automatically — pick the job role this person needs instead.")
    if not is_admin_user(actor):
        validate_grants(list(role.permissions or []), actor)
        validate_scope_escalation(dict(role.data_scopes or {}), actor)
    return role


def _give_role(db: Session, user: User, role, actor: User | None) -> None:
    from app.modules.main.models.audit_log import AuditLog

    if role is None or role in (user.roles or []):
        return
    if actor is not None:
        from app.modules.main.services.grc import check_assignment, permissions_after

        check_assignment(db, user, actor, permissions_after(db, [r.id for r in user.roles] + [role.id], None, user), None)
    user.roles.append(role)
    db.add(AuditLog(
        entity_type="user_permissions", entity_id=user.id, action="update", module_key="hr",
        summary=f"Role '{role.name}' given to {user.name} from their HR record (Portal Access)"
                + (f" by {actor.name}" if actor else " at first sign-in"),
        performed_by_id=actor.id if actor else None,
    ))


def link(db: Session, profile: HrEmployeeProfile, user: User, role=None, actor: User | None = None) -> None:
    """Attach a no-login record to `user` and give it the record's
    application role. Does not commit."""
    from app.modules.hr.services.employee_sync import apply_org_fields
    from app.modules.main.models.role import Role

    from app.modules.main.models.user_document import UserDocument

    profile.user_id = user.id
    profile.portal_access = True
    # The record's uploaded documents now belong to the account too.
    db.query(UserDocument).filter(UserDocument.hr_profile_id == profile.id, UserDocument.user_id.is_(None)).update(
        {UserDocument.user_id: user.id}, synchronize_session=False)
    if profile.date_of_joining and not user.date_of_joining:
        user.date_of_joining = profile.date_of_joining
    if profile.reporting_manager_id and not user.reporting_manager_id and profile.reporting_manager_id != user.id:
        user.reporting_manager_id = profile.reporting_manager_id
    db.flush()
    apply_org_fields(db, user, profile)
    _give_role(db, user, role if role is not None else (db.get(Role, profile.portal_role_id) if profile.portal_role_id else None), actor)


def link_pending_profile(db: Session, user: User) -> bool:
    """Called when a User row is first created (sign-in, Azure sync): adopt
    the HR record waiting for this email, if any. Does not commit."""
    if not user.email or db.query(HrEmployeeProfile.id).filter(HrEmployeeProfile.user_id == user.id).first():
        return False
    profile = (
        db.query(HrEmployeeProfile)
        .filter(HrEmployeeProfile.user_id.is_(None), HrEmployeeProfile.portal_access.is_(True),
                func.lower(HrEmployeeProfile.work_email) == user.email.lower())
        .first()
    )
    if profile is None:
        return False
    link(db, profile, user)
    return True
