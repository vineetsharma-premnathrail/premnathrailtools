"""Azure AD (Entra) → local users sync.

Shared by the admin "Sync Azure Users" button (POST /users/sync-azure) and the
nightly `azure_user_sync` scheduler job, so leavers disabled in Entra lose
portal access without anyone having to click Sync.
"""
from __future__ import annotations

import asyncio
import logging

from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User

logger = logging.getLogger(__name__)

# Generic/shared inboxes that exist as directory objects but aren't real
# people — never pull these into the local users table from an Azure sync.
# Mirrored in app/modules/hr/services/employees.py.
EXCLUDED_MAILBOX_LOCAL_PARTS = {"accounts", "corporate", "info", "prpl", "pew.research", "service"}


def is_syncable_azure_user(email: str) -> bool:
    """False for accounts outside our own tenant domain (guests/partners) or
    known shared/generic mailboxes — both get excluded from Azure AD syncs so
    the org directory only ever contains real internal employees."""
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        return False
    local_part, _, domain = email.partition("@")
    if settings.DOMAIN_EMAIL and domain != settings.DOMAIN_EMAIL.strip().lstrip("@").lower():
        return False
    if local_part in EXCLUDED_MAILBOX_LOCAL_PARTS:
        return False
    return True


# Every action that flips a user's active flag writes one of these AuditLog
# rows (entity_type "user"): admin PATCH /users/{id}/activate|deactivate, and
# the Azure sync itself when someone leaves the tenant.
ACTIVATION_ACTIONS = ("activated", "deactivated", "azure_deactivated")


def azure_may_reactivate(db: Session, user_id: int) -> bool:
    """Re-activation by the Azure sync is opt-in (C-10): an inactive user is
    switched back on only when the latest activation-related audit row says
    the sync itself turned them off ('azure_deactivated') or an admin last
    activated them. A user with no such row — e.g. deactivated by an admin
    before these rows were written — or whose latest row is an admin
    'deactivated' stays inactive until an admin activates them by hand."""
    last = (
        db.query(AuditLog.action)
        .filter(
            AuditLog.entity_type == "user",
            AuditLog.entity_id == user_id,
            AuditLog.action.in_(ACTIVATION_ACTIONS),
        )
        .order_by(AuditLog.id.desc())
        .first()
    )
    return bool(last and last[0] in ("azure_deactivated", "activated"))


def apply_azure_sync(db: Session, azure_users: list[dict], admin_ids: set | list) -> int:
    """Upsert Graph users into `users`, resolve managers, link branch/department,
    and deactivate azure-linked users no longer in the tenant. Commits.
    Returns the number of tenant members processed."""
    # Local imports: these pull in HR/Organization modules that import
    # app.modules.main back — keep module import cheap and cycle-free.
    from app.modules.hr.services.employee_sync import is_org_locked
    from app.modules.hr.services.exit_guard import is_exited, revoke_user_sessions
    from app.modules.organization.services.provisioning import sync_user_org_links

    azure_users = [
        au for au in azure_users
        if is_syncable_azure_user(au.get("mail") or au.get("userPrincipalName") or "")
    ]

    # Anyone already synced in previously (e.g. an external guest or shared
    # mailbox pulled in before this filter existed) who no longer passes the
    # filter is treated the same as someone removed from the tenant: they
    # fall out of active_azure_ids below and get deactivated, not deleted.
    active_azure_ids = {au.get("id") for au in azure_users if au.get("id")}

    azure_id_to_user: dict[str, User] = {}
    for au in azure_users:
        email = au.get("mail") or au.get("userPrincipalName", "")
        if not email:
            continue
        azure_id = au.get("id")
        is_az_admin = azure_id in admin_ids

        target = db.query(User).filter(User.email == email).first()
        if target:
            target.azure_id = azure_id or target.azure_id
            target.name = au.get("displayName") or target.name
            # HR & Administration owns these once an employee profile locks
            # them (see app/modules/hr/services/employee_sync.py).
            if not is_org_locked(db, target.id):
                target.department = au.get("department") or target.department
                target.designation = au.get("jobTitle") or target.designation
            target.phone = au.get("mobilePhone") or target.phone
            target.office_location = au.get("officeLocation") or target.office_location
            # Never re-activate someone HR has exited (their Entra account is
            # often left enabled during handover) — security finding S-10 —
            # nor anyone the sync itself didn't switch off (C-10) — see
            # azure_may_reactivate().
            if not target.is_active:
                if not is_exited(db, target.id) and azure_may_reactivate(db, target.id):
                    target.is_active = True
                    db.add(AuditLog(
                        entity_type="user", entity_id=target.id, action="activated", module_key="organization",
                        summary=f"{target.name} re-activated by Azure AD sync (back in the tenant)",
                    ))
            target.is_azure_admin = is_az_admin
            if is_az_admin and target.role == "user":
                target.role = "admin"
        else:
            target = User(
                email=email,
                name=au.get("displayName") or email.split("@")[0],
                azure_id=azure_id,
                department=au.get("department"),
                designation=au.get("jobTitle"),
                phone=au.get("mobilePhone"),
                office_location=au.get("officeLocation"),
                role="admin" if is_az_admin else "user",
                is_active=True,
                is_azure_admin=is_az_admin,
                assigned_apps=[],
            )
            db.add(target)
            db.flush()
            # Take over the HR record waiting for this email (HR > Employees, Portal Access = Yes).
            from app.modules.hr.services.workforce_link import link_pending_profile

            link_pending_profile(db, target)
        if azure_id:
            azure_id_to_user[azure_id] = target

    # Resolve manager links only after every Azure user has a local row.
    # Graph returns the manager's Azure object id in the expanded relation.
    db.flush()
    for au in azure_users:
        azure_id = au.get("id")
        target = azure_id_to_user.get(azure_id) if azure_id else None
        manager = au.get("manager") or {}
        if target and "manager" in au and not is_org_locked(db, target.id):
            manager_id = manager.get("id")
            manager_user = azure_id_to_user.get(manager_id) if manager_id else None
            target.reporting_manager_id = manager_user.id if manager_user else None

    # Auto-link every synced user to a Branch (from office_location) and
    # Department (from department) now that reporting_manager_id is
    # resolved — see provisioning.py docstring.
    for target in azure_id_to_user.values():
        sync_user_org_links(db, target)

    # Deactivate any azure-linked local users no longer in the active tenant list
    for u in db.query(User).filter(User.azure_id.isnot(None)).all():
        if u.azure_id not in active_azure_ids:
            if u.is_active:
                revoke_user_sessions(db, u.id)
                # Audit trail (C-10) + marks this as a sync-driven deactivation,
                # so the user comes back if they reappear in the tenant.
                db.add(AuditLog(
                    entity_type="user", entity_id=u.id, action="azure_deactivated", module_key="organization",
                    summary=f"{u.name} deactivated by Azure AD sync (no longer an active member of the tenant)",
                ))
            u.is_active = False

    db.commit()
    return len(azure_users)


async def run_azure_sync(db: Session) -> int:
    """Fetch the tenant from Microsoft Graph and apply it. Raises on Graph errors."""
    from app.auth.microsoft import list_azure_org_users, get_azure_admin_ids

    azure_users = await list_azure_org_users()
    admin_ids = await get_azure_admin_ids()
    return apply_azure_sync(db, azure_users, admin_ids)


def run_azure_sync_job() -> None:
    """APScheduler entry point (nightly, see app/main.py). Logs the real Graph
    error on failure instead of raising into the scheduler thread."""
    from app.db.session import SessionLocal

    if not (settings.AZURE_CLIENT_ID and settings.AZURE_CLIENT_SECRET and settings.AZURE_TENANT_ID):
        logger.warning(
            "Nightly Azure AD user sync skipped: AZURE_CLIENT_ID / AZURE_CLIENT_SECRET / AZURE_TENANT_ID "
            "are not all set on the server. Set them to enable automatic leaver deactivation."
        )
        return
    db = SessionLocal()
    try:
        count = asyncio.run(run_azure_sync(db))
        logger.info("Nightly Azure AD user sync complete: %s tenant member(s) processed", count)
    except Exception as e:  # noqa: BLE001 — scheduler job must never crash the thread
        db.rollback()
        logger.error(
            "Nightly Azure AD user sync failed: %s. Check AZURE_CLIENT_ID/SECRET/TENANT and that the "
            "app registration still has User.Read.All + Directory.Read.All (admin-consented).",
            e, exc_info=True,
        )
    finally:
        db.close()
