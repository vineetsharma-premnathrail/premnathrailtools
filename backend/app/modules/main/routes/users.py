from datetime import date
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permission_registry import MODULES as PERMISSION_MODULES, ACTIONS as PERMISSION_ACTIONS, DATA_ACCESS_SCOPES as PERMISSION_SCOPES
from app.db.session import get_db
from app.modules.main.models.user import User, AVAILABLE_APPS
from app.modules.main.models.module import Module
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user_session import UserSession
from app.modules.main.models.user_document import UserDocument
from app.modules.main.schemas.user import (
    UserResponse, UserUpdate, UserSessionResponse, UserActivityResponse, UserDocumentResponse, UserPermissionsUpdate,
)
from app.modules.main.routes.auth import get_current_user
from app.auth.microsoft import list_azure_org_users, get_azure_admin_ids
from app.modules.organization.services.provisioning import sync_user_org_links
from app.modules.hr.services.employee_sync import is_org_locked
from app.modules.hr.services.exit_guard import get_exit_info, is_exited, revoke_user_sessions
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.branch_user_assignment import BranchUserAssignment
from app.modules.organization.models.department import Department
from app.modules.organization.schemas.branch import BranchUserAssignmentResponse
from app.utils.sharepoint import (
    upload_file_to_sharepoint, sanitize_folder_name, delete_file_from_sharepoint, download_file_content,
)

router = APIRouter(prefix="/users", tags=["Users & Roles"])

VALID_ROLES = {"user", "admin"}

# Generic/shared inboxes that exist as directory objects but aren't real
# people — never pull these into the local users table from an Azure sync.
_EXCLUDED_MAILBOX_LOCAL_PARTS = {"accounts", "corporate", "info", "prpl", "pew.research", "service"}


def _is_syncable_azure_user(email: str) -> bool:
    """False for accounts outside our own tenant domain (guests/partners) or
    known shared/generic mailboxes — both get excluded from Azure AD syncs so
    the org directory only ever contains real internal employees."""
    email = (email or "").strip().lower()
    if not email or "@" not in email:
        return False
    local_part, _, domain = email.partition("@")
    if settings.DOMAIN_EMAIL and domain != settings.DOMAIN_EMAIL.strip().lstrip("@").lower():
        return False
    if local_part in _EXCLUDED_MAILBOX_LOCAL_PARTS:
        return False
    return True

# Granular ERP permission ids the "ERP Permissions" section of the Module
# Access modal can grant. R&D Tools and CRM don't have a sub-permission
# breakdown — just the top-level module toggle in assigned_apps.
VALID_ERP_PERMISSIONS = {
    "project_view", "project_create", "project_edit", "project_delete",
    "sr_view", "sr_create", "sr_edit", "sr_delete",
}

# The modal's "Procurement Permissions" section writes into that same
# erp_permissions list, so these have to pass the check below too. Nothing
# reads them yet — P2P still gates on the `p2p`/`purchase` module toggles and
# the approval-role flags — but they're stored so enforcement can be wired up
# without admins having to re-tick every user.
VALID_P2P_PERMISSIONS = {
    "pr_create",
    "approval_view", "approval_action",
    "rfq_view", "rfq_action",
    "grn_view", "grn_action",
}

VALID_GRANULAR_PERMISSIONS = VALID_ERP_PERMISSIONS | VALID_P2P_PERMISSIONS


def _assignable_app_keys(db: Session) -> set[str]:
    """Module keys an admin may assign: everything in the `modules` registry,
    plus AVAILABLE_APPS as a floor.

    The hardcoded set alone had drifted behind the registry, so ticking a
    module the registry had gained but the set had not failed with a 400.
    Inactive rows count too — the registry endpoint deliberately shows admins
    every row, active or not, and `purchase` is currently inactive yet still
    drives P2P's purchase-team checks, so filtering on is_active here would
    reject exactly the module the checklist is offering. The registry is also
    the only place an unbuilt module gets retired from: drop its row and the
    checklist stops offering it (see the d8a1c3e5f7b9 migration)."""
    return {k for (k,) in db.query(Module.key).all()} | set(AVAILABLE_APPS)


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Dependency: only allow admin roles through."""
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


def to_response(user: User, db: Session | None = None) -> UserResponse:
    """Serialize a User row, computing `apps` from role + assigned_apps
    (admins implicitly get every module regardless of what's assigned)."""
    updates = {"apps": user.get_apps()}
    if user.reporting_manager_id and db is not None:
        manager = db.query(User).filter(User.id == user.reporting_manager_id).first()
        updates["reporting_manager_name"] = manager.name if manager else None
    if user.branch_id and db is not None:
        branch = db.query(Branch).filter(Branch.id == user.branch_id).first()
        updates["branch_name"] = branch.name if branch else None
    return UserResponse.model_validate(user).model_copy(update=updates)


@router.get("", response_model=list[UserResponse])
async def list_users(
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """List all users (admin only) — excludes shared mailboxes / external-domain
    accounts that shouldn't be managed as people (see _is_syncable_azure_user)."""
    users = db.query(User).order_by(User.name).offset(skip).limit(limit).all()
    users = [u for u in users if _is_syncable_azure_user(u.email)]
    return [to_response(u) for u in users]


@router.get("/directory", response_model=list[dict])
async def list_user_directory(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Minimal active-user list (id/name/email) any signed-in user can read —
    used for pickers like "share this document with" where the full
    admin-only user-management payload (roles, permissions) isn't needed."""
    users = db.query(User).filter(User.is_active == True).order_by(User.name).all()  # noqa: E712
    return [
        {
            "id": u.id, "name": u.name, "email": u.email, "department": u.department, "designation": u.designation,
            # Unit — the Add Department head picker only offers people from
            # the department's own unit (organization/services/department_heads.py).
            "branch_id": u.branch_id,
            "is_department_head": u.is_department_head, "is_project_head": u.is_project_head, "is_plant_head": u.is_plant_head,
            # Manager-role flags for the P2P approval matrix — the New PR
            # form's approver pickers filter the directory by these.
            "is_design_manager": u.is_design_manager, "is_rnd_manager": u.is_rnd_manager,
            "is_production_manager": u.is_production_manager, "is_project_manager": u.is_project_manager,
            "is_store_manager": u.is_store_manager, "is_purchase_manager": u.is_purchase_manager,
            "is_director": u.is_director,
        }
        for u in users
    ]


@router.get("/permissions/registry")
async def get_permission_registry(
    _admin: User = Depends(require_admin),
):
    """The full module/subtab/action/scope catalog the Permission Matrix UI
    renders — single source of truth so the frontend doesn't hardcode it."""
    return {
        "modules": PERMISSION_MODULES,
        "actions": PERMISSION_ACTIONS,
        "scopes": PERMISSION_SCOPES,
    }


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    return to_response(target, db)


@router.get("/{user_id}/assignments", response_model=list[BranchUserAssignmentResponse])
async def list_user_branch_assignments(
    user_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """All of this user's branch assignments, across every branch — the
    reverse direction of GET /organization/branches/{id}/user-assignments."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    assignments = db.query(BranchUserAssignment).filter(BranchUserAssignment.user_id == user_id).order_by(BranchUserAssignment.id).all()
    dept_ids = {a.department_id for a in assignments if a.department_id}
    depts_by_id = {d.id: d for d in db.query(Department).filter(Department.id.in_(dept_ids)).all()} if dept_ids else {}
    return [
        BranchUserAssignmentResponse.model_validate(a).model_copy(
            update={"user_name": target.name, "department_name": depts_by_id[a.department_id].name if a.department_id in depts_by_id else None}
        )
        for a in assignments
    ]


@router.patch("/{user_id}/permissions", response_model=UserResponse)
async def update_user_permissions(
    user_id: int,
    payload: UserPermissionsUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    valid_ids = {
        f"{mk}:{stk}:{a}"
        for mk, m in PERMISSION_MODULES.items()
        for stk in (m["subtabs"] or {"": None})
        for a in PERMISSION_ACTIONS
    }
    invalid = set(payload.granular_permissions) - valid_ids
    if invalid:
        raise HTTPException(status_code=400, detail=f"Invalid permission id(s): {', '.join(sorted(invalid)[:5])}")
    invalid_scopes = {v for v in payload.data_access_scopes.values() if v not in PERMISSION_SCOPES}
    if invalid_scopes:
        raise HTTPException(status_code=400, detail=f"Invalid scope(s): {', '.join(sorted(invalid_scopes))}")
    invalid_modules = set(payload.data_access_scopes.keys()) - set(PERMISSION_MODULES.keys())
    if invalid_modules:
        raise HTTPException(status_code=400, detail=f"Invalid module(s): {', '.join(sorted(invalid_modules))}")

    added = sorted(set(payload.granular_permissions) - set(target.granular_permissions or []))
    removed = sorted(set(target.granular_permissions or []) - set(payload.granular_permissions))
    target.granular_permissions = payload.granular_permissions
    target.data_access_scopes = payload.data_access_scopes
    db.add(AuditLog(
        entity_type="user_permissions", entity_id=user_id, action="update",
        summary=f"{admin.name} updated permissions for {target.name}" + (
            f" (+{len(added)}/-{len(removed)})" if added or removed else " (data access scopes only)"
        ),
        old_value=None, new_value=None, performed_by_id=admin.id,
    ))
    db.commit()
    db.refresh(target)
    return to_response(target, db)


@router.get("/{user_id}/permission-history", response_model=list[UserActivityResponse])
async def list_user_permission_history(
    user_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    if not db.query(User).filter(User.id == user_id).first():
        raise HTTPException(status_code=404, detail="User not found")
    return db.query(AuditLog).filter(
        AuditLog.entity_type == "user_permissions", AuditLog.entity_id == user_id
    ).order_by(AuditLog.performed_at.desc()).limit(200).all()


@router.get("/{user_id}/sessions", response_model=list[UserSessionResponse])
async def list_user_sessions(
    user_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    if not db.query(User).filter(User.id == user_id).first():
        raise HTTPException(status_code=404, detail="User not found")
    return db.query(UserSession).filter(UserSession.user_id == user_id).order_by(UserSession.created_at.desc()).limit(100).all()


@router.get("/{user_id}/activity", response_model=list[UserActivityResponse])
async def list_user_activity(
    user_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    if not db.query(User).filter(User.id == user_id).first():
        raise HTTPException(status_code=404, detail="User not found")
    return db.query(AuditLog).filter(AuditLog.performed_by_id == user_id).order_by(AuditLog.performed_at.desc()).limit(200).all()


@router.get("/{user_id}/documents", response_model=list[UserDocumentResponse])
async def list_user_documents(
    user_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    if not db.query(User).filter(User.id == user_id).first():
        raise HTTPException(status_code=404, detail="User not found")
    return db.query(UserDocument).filter(UserDocument.user_id == user_id).order_by(UserDocument.id.desc()).all()


@router.post("/{user_id}/documents", response_model=UserDocumentResponse)
async def upload_user_document(
    user_id: int,
    file: UploadFile = File(...),
    document_type: str = Form(...),
    document_name: str = Form(...),
    document_number: str | None = Form(None),
    issue_date: date | None = Form(None),
    expiry_date: date | None = Form(None),
    issuing_authority: str | None = Form(None),
    confidentiality: str | None = Form(None),
    tags: str | None = Form(None),
    remarks: str | None = Form(None),
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    folder_path = f"{sanitize_folder_name(settings.SHAREPOINT_FOLDER or 'ERP-media')}/user-documents/{sanitize_folder_name(target.name)}"
    result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, file)

    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else None

    document = UserDocument(
        user_id=user_id,
        document_type=document_type,
        document_name=document_name,
        document_number=document_number,
        issue_date=issue_date,
        expiry_date=expiry_date,
        issuing_authority=issuing_authority,
        filename=result["name"],
        content_type=file.content_type,
        size=result["size"],
        sharepoint_path=result["path"],
        sharepoint_url=result.get("webUrl"),
        confidentiality=confidentiality,
        tags=tag_list,
        remarks=remarks,
        created_by_id=admin.id,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    return document


@router.get("/{user_id}/documents/{document_id}/content")
async def get_user_document_content(
    user_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    document = db.query(UserDocument).filter(UserDocument.id == document_id, UserDocument.user_id == user_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, document.sharepoint_path or "")
    return Response(
        content=content,
        media_type=document.content_type or content_type,
        headers={"Content-Disposition": f'inline; filename="{document.filename}"'},
    )


@router.delete("/{user_id}/documents/{document_id}")
async def delete_user_document(
    user_id: int,
    document_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    document = db.query(UserDocument).filter(UserDocument.id == document_id, UserDocument.user_id == user_id).first()
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if settings.SHAREPOINT_SITE_ID and document.sharepoint_path:
        try:
            await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, document.sharepoint_path)
        except HTTPException:
            pass
    db.delete(document)
    db.commit()
    return {"ok": True}


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Update a user's role, module access, or name (admin only)."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if payload.role is not None:
        if payload.role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail="Invalid role")
        if target.id == admin.id and payload.role != "admin":
            raise HTTPException(status_code=400, detail="Cannot change your own admin role")
        target.role = payload.role

    if payload.assigned_apps is not None:
        invalid = set(payload.assigned_apps) - _assignable_app_keys(db)
        if invalid:
            raise HTTPException(status_code=400, detail=f"Invalid app(s): {', '.join(sorted(invalid))}")
        target.assigned_apps = payload.assigned_apps

    if payload.erp_permissions is not None:
        invalid = set(payload.erp_permissions) - VALID_GRANULAR_PERMISSIONS
        if invalid:
            raise HTTPException(status_code=400, detail=f"Invalid permission(s): {', '.join(sorted(invalid))}")
        target.erp_permissions = payload.erp_permissions

    if payload.is_department_head is not None:
        target.is_department_head = payload.is_department_head

    if payload.is_project_head is not None:
        target.is_project_head = payload.is_project_head

    if payload.is_plant_head is not None:
        target.is_plant_head = payload.is_plant_head

    if payload.is_purchase_head is not None:
        target.is_purchase_head = payload.is_purchase_head

    if payload.is_director is not None:
        target.is_director = payload.is_director

    if payload.is_md is not None:
        target.is_md = payload.is_md

    if payload.is_finance_manager is not None:
        target.is_finance_manager = payload.is_finance_manager

    for manager_flag in ("is_design_manager", "is_rnd_manager", "is_production_manager",
                         "is_project_manager", "is_store_manager", "is_purchase_manager"):
        value = getattr(payload, manager_flag, None)
        if value is not None:
            setattr(target, manager_flag, value)

    if payload.name is not None:
        target.name = payload.name

    db.commit()
    db.refresh(target)
    return to_response(target)


@router.patch("/{user_id}/deactivate", response_model=UserResponse)
async def deactivate_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Deactivate a user account (admin only)."""
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    target.is_active = False
    # Deactivation must also cut off every signed-in device, not just new
    # logins (security finding S-10 / P2-USR-17).
    revoke_user_sessions(db, target.id)
    db.commit()
    db.refresh(target)
    return to_response(target)


@router.patch("/{user_id}/activate", response_model=UserResponse)
async def activate_user(
    user_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Reactivate a user account (admin only)."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    exited, exit_date = get_exit_info(db, target.id)
    if exited:
        when = f" on {exit_date.strftime('%d-%m-%Y')}" if exit_date else ""
        raise HTTPException(
            status_code=409,
            detail=(
                f"{target.name} was exited in HR & Administration{when}, so the account can't be re-activated here. "
                "If they have rejoined, complete a joining event for them in HR > Lifecycle — that re-activates the account."
            ),
        )
    target.is_active = True
    db.commit()
    db.refresh(target)
    return to_response(target)


@router.post("/sync-azure", response_model=list[UserResponse])
async def sync_azure_users(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Pull every member from the Azure AD tenant into the local users table,
    so the Users & Roles page shows the full org directory, not just people
    who have already logged in once (admin only)."""
    try:
        azure_users = await list_azure_org_users()
        admin_ids = await get_azure_admin_ids()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Azure sync failed: {e}")

    azure_users = [
        au for au in azure_users
        if _is_syncable_azure_user(au.get("mail") or au.get("userPrincipalName") or "")
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
            # often left enabled during handover) — security finding S-10.
            if not is_exited(db, target.id):
                target.is_active = True
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
            u.is_active = False

    db.commit()
    users = db.query(User).order_by(User.name).all()
    return [to_response(u, db) for u in users]
