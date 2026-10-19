from datetime import date
import json

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.permission_registry import MODULES as PERMISSION_MODULES, ACTIONS as PERMISSION_ACTIONS, ACTION_LABELS, expand_grants
from app.db.session import get_db
from app.modules.main.models.user import User, AVAILABLE_APPS
from app.modules.main.models.module import Module
from app.modules.main.models.role import Role
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user_session import UserSession
from app.modules.main.models.user_document import UserDocument
from app.modules.main.schemas.user import (
    UserResponse, UserUpdate, UserSessionResponse, UserActivityResponse, UserDocumentResponse, UserPermissionsUpdate, UserRolesUpdate,
)
from app.modules.main.routes.auth import get_current_user
from app.core.permissions import require_feature_action, require_tab_action
from app.core.notification_events import notify_event
from app.core.permission_registry import is_admin_user
from app.auth.microsoft import list_azure_org_users, get_azure_admin_ids
from app.modules.main.services.azure_sync import (
    EXCLUDED_MAILBOX_LOCAL_PARTS, is_syncable_azure_user, apply_azure_sync,
)
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

# Shared-mailbox / guest filter and the sync body live in the azure_sync
# service so the nightly scheduler job can reuse them.
_EXCLUDED_MAILBOX_LOCAL_PARTS = EXCLUDED_MAILBOX_LOCAL_PARTS
_is_syncable_azure_user = is_syncable_azure_user

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


def _ensure_may_manage(actor: User, target: User, *, own_access: bool = False) -> None:
    """Authority checks on top of the Organization tab permission.

    - Only an admin may change an admin account (a Users 'Edit' holder must
      not be able to deactivate or re-shape an admin).
    - With own_access=True (roles / extra grants / approval flags), a
      non-admin may never change their own — that would be self-promotion.
    Admins pass both."""
    if is_admin_user(actor):
        return
    if is_admin_user(target):
        raise HTTPException(
            status_code=403,
            detail=f"{target.name or target.email} is an admin — only another admin can change an admin account.",
        )
    if own_access and target.id == actor.id:
        raise HTTPException(
            status_code=403,
            detail="You can't change your own roles, extra permissions or approval flags. Ask an admin "
                   "(or another user with Organization › Role & Permissions 'Edit') to make this change.",
        )


def to_response(user: User, db: Session | None = None) -> UserResponse:
    """Serialize a User row, computing `apps` from role + assigned_apps
    (admins implicitly get every module regardless of what's assigned)."""
    updates = {
        "apps": user.get_apps(), "assigned_apps": user.get_apps(),
        "role_ids": sorted(r.id for r in user.roles), "role_names": sorted(r.name for r in user.roles),
    }
    if user.reporting_manager_id and db is not None:
        manager = db.query(User).filter(User.id == user.reporting_manager_id).first()
        updates["reporting_manager_name"] = manager.name if manager else None
    if user.branch_id and db is not None:
        branch = db.query(Branch).filter(Branch.id == user.branch_id).first()
        updates["branch_name"] = branch.name if branch else None
    return UserResponse.model_validate(user).model_copy(update=updates)


@router.get("", response_model=list[UserResponse])
async def list_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(1000, ge=1, le=5000),
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("organization", "users", "view")),
):
    """List all users (admin only) — excludes shared mailboxes / external-domain
    accounts that shouldn't be managed as people (see _is_syncable_azure_user).
    The filter runs before paging so a page is never short, and the default
    limit covers the whole org (the page filters client-side)."""
    users = db.query(User).order_by(User.name).all()
    users = [u for u in users if _is_syncable_azure_user(u.email)][skip:skip + limit]
    return [to_response(u, db) for u in users]


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
    _user: User = Depends(require_tab_action("organization", "roles", "view")),
):
    """The full module/tab/action catalog the Permission Matrix UI renders —
    single source of truth so the frontend doesn't hardcode it."""
    return {"modules": PERMISSION_MODULES, "actions": PERMISSION_ACTIONS, "action_labels": ACTION_LABELS}


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("organization", "users", "view")),
):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    return to_response(target, db)


@router.get("/{user_id}/assignments", response_model=list[BranchUserAssignmentResponse])
async def list_user_branch_assignments(
    user_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_feature_action("organization", "users", "assignments", "view")),
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
    admin: User = Depends(require_feature_action("organization", "roles", "extra_permissions", "edit")),
):
    """Replace this user's EXTRA grants — the ones on top of their roles."""
    from app.modules.main.routes.roles import validate_grants

    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    _ensure_may_manage(admin, target, own_access=True)
    # validate_grants also stops a non-admin handing out grants they don't hold.
    grants = validate_grants(payload.granular_permissions, admin)
    added = sorted(set(grants) - set(target.granular_permissions or []))
    removed = sorted(set(target.granular_permissions or []) - set(grants))
    from app.modules.main.services.grc import check_assignment, permissions_after
    check_assignment(db, target, admin, permissions_after(db, None, grants, target), payload.sod_mitigation_reason)
    target.granular_permissions = grants
    target.invalidate_permissions()
    if added or removed:
        db.add(AuditLog(
            entity_type="user_permissions", entity_id=user_id, action="update", module_key="organization",
            summary=f"{admin.name} updated extra permissions for {target.name} (+{len(added)}/-{len(removed)})",
            old_value=json.dumps(removed) if removed else None, new_value=json.dumps(added) if added else None,
            performed_by_id=admin.id,
        ))
    db.commit()
    db.refresh(target)
    return to_response(target, db)


@router.put("/{user_id}/roles", response_model=UserResponse)
async def update_user_roles(
    user_id: int,
    payload: UserRolesUpdate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: User = Depends(require_feature_action("organization", "roles", "members", "edit")),
):
    """Replace the roles this user holds."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    wanted = set(payload.role_ids)
    roles = db.query(Role).filter(Role.id.in_(wanted)).all() if wanted else []
    missing = wanted - {r.id for r in roles}
    if missing:
        raise HTTPException(status_code=404, detail=f"Role(s) not found: {', '.join(map(str, sorted(missing)))} — reload the page.")
    _ensure_may_manage(admin, target, own_access=True)
    if not is_admin_user(admin):
        # No privilege escalation: a non-admin may only hand out a role whose
        # every grant they hold themselves (same rule as validate_grants).
        held_ids = {r.id for r in target.roles}
        held = admin.effective_permissions
        for role in roles:
            if role.id in held_ids:
                continue
            beyond = expand_grants(role.permissions) - held
            if beyond:
                raise HTTPException(
                    status_code=403,
                    detail=f"You can't assign the role '{role.name}' — it grants {len(beyond)} permission(s) you don't "
                           f"hold yourself (e.g. {', '.join(sorted(beyond)[:3])}). Ask an admin to assign it.",
                )
            from app.modules.main.routes.roles import validate_scope_escalation

            validate_scope_escalation(dict(role.data_scopes or {}), admin)
    before = sorted(r.name for r in target.roles)
    from app.modules.main.services.grc import check_assignment, permissions_after
    check_assignment(db, target, admin, permissions_after(db, [r.id for r in roles], None, target),
                     payload.sod_mitigation_reason)
    target.roles = roles
    target.invalidate_permissions()
    after = sorted(r.name for r in roles)
    if before != after:
        db.add(AuditLog(
            entity_type="user_permissions", entity_id=user_id, action="update", module_key="organization",
            summary=f"{admin.name} set roles for {target.name}: {', '.join(after) or 'none'}",
            old_value=json.dumps(before), new_value=json.dumps(after), performed_by_id=admin.id,
        ))
        notify_event(db, background_tasks, "organization", "role_members_changed", title=f"Roles of {target.name} changed",
                     message=f"{admin.name} set {target.name}'s roles to: {', '.join(after) or 'none'} (was: {', '.join(before) or 'none'}).",
                     entity_type="user", entity_id=target.id, actor=admin, skip_user_ids={target.id})
    db.commit()
    db.refresh(target)
    return to_response(target, db)


class UserDataScopesUpdate(BaseModel):
    # module_key -> level; a module left out follows the user's roles.
    overrides: dict[str, str]


def _data_scope_rows(target: User) -> list[dict]:
    from app.core.data_scope import SCOPE_LABELS, user_scope

    overrides = target.data_access_scopes or {}
    rows = []
    for mk, m in PERMISSION_MODULES.items():
        if mk == "organization":
            continue
        rows.append({
            "module_key": mk, "module_label": m["label"], "override": overrides.get(mk),
            "effective": user_scope(target, mk), "effective_label": SCOPE_LABELS[user_scope(target, mk)],
        })
    return rows


@router.get("/{user_id}/data-scopes")
async def get_user_data_scopes(
    user_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_feature_action("organization", "roles", "data_access", "view")),
):
    """Per module: the user's personal override (if any) and the scope that applies."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    return _data_scope_rows(target)


@router.put("/{user_id}/data-scopes")
async def update_user_data_scopes(
    user_id: int,
    payload: UserDataScopesUpdate,
    db: Session = Depends(get_db),
    admin: User = Depends(require_feature_action("organization", "roles", "data_access", "edit")),
):
    from app.core.data_scope import SCOPE_LABELS

    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    _ensure_may_manage(admin, target, own_access=True)
    clean: dict[str, str] = {}
    for mk, level in payload.overrides.items():
        if not level:
            continue
        if mk not in PERMISSION_MODULES or mk == "organization":
            raise HTTPException(status_code=422, detail=f"Unknown module '{mk}' — reload the page.")
        if level not in SCOPE_LABELS:
            raise HTTPException(status_code=422, detail=f"Data access must be one of: {', '.join(SCOPE_LABELS.values())}.")
        clean[mk] = level
    before = dict(target.data_access_scopes or {})
    from app.modules.main.routes.roles import validate_scope_escalation

    validate_scope_escalation(clean, admin, before)
    target.data_access_scopes = clean
    if before != clean:
        db.add(AuditLog(
            entity_type="user_permissions", entity_id=user_id, action="update", module_key="organization",
            summary=f"{admin.name} set personal data access for {target.name}: "
                    + (", ".join(f"{PERMISSION_MODULES[k]['label']} = {SCOPE_LABELS[v]}" for k, v in clean.items()) or "follow roles"),
            old_value=json.dumps(before), new_value=json.dumps(clean), performed_by_id=admin.id,
        ))
    db.commit()
    db.refresh(target)
    return _data_scope_rows(target)


@router.get("/{user_id}/effective-permissions")
async def get_user_effective_permissions(
    user_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("organization", "roles", "view")),
):
    """Every grant this user effectively holds and where it comes from
    (role names and/or "Extra"), for the read-only matrix on their profile."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    sources: dict[str, list[str]] = {}
    held = [r for r in target.roles if r.is_active]
    held += [r for r in db.query(Role).filter(Role.is_default.is_(True), Role.is_active.is_(True)).all() if r not in held]
    for role in held:
        for g in expand_grants(role.permissions):
            sources.setdefault(g, []).append(role.name + (" (everyone)" if role.is_default else ""))
    for g in expand_grants(target.granular_permissions):
        sources.setdefault(g, []).append("Extra")
    return {"is_admin": target.role == "admin" or target.is_azure_admin, "apps": target.get_apps(), "grants": sources}


@router.get("/{user_id}/permission-history", response_model=list[UserActivityResponse])
async def list_user_permission_history(
    user_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_feature_action("organization", "users", "activity", "view")),
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
    _user: User = Depends(require_feature_action("organization", "users", "login_history", "view")),
):
    if not db.query(User).filter(User.id == user_id).first():
        raise HTTPException(status_code=404, detail="User not found")
    return db.query(UserSession).filter(UserSession.user_id == user_id).order_by(UserSession.created_at.desc()).limit(100).all()


@router.get("/{user_id}/activity", response_model=list[UserActivityResponse])
async def list_user_activity(
    user_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_feature_action("organization", "users", "activity", "view")),
):
    if not db.query(User).filter(User.id == user_id).first():
        raise HTTPException(status_code=404, detail="User not found")
    return db.query(AuditLog).filter(AuditLog.performed_by_id == user_id).order_by(AuditLog.performed_at.desc()).limit(200).all()


@router.get("/{user_id}/documents", response_model=list[UserDocumentResponse])
async def list_user_documents(
    user_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(require_feature_action("organization", "users", "documents", "view")),
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
    admin: User = Depends(require_feature_action("organization", "users", "documents", "create")),
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
    _user: User = Depends(require_feature_action("organization", "users", "documents", "export")),
):
    document = db.query(UserDocument).filter(UserDocument.id == document_id, UserDocument.user_id == user_id).first()
    if not document:
        raise HTTPException(status_code=404, detail=f"Document #{document_id} not found on user #{user_id} — it may have been "
                                                    "deleted or belongs to another user. Reload the user's Documents tab.")
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
    _user: User = Depends(require_feature_action("organization", "users", "documents", "delete")),
):
    document = db.query(UserDocument).filter(UserDocument.id == document_id, UserDocument.user_id == user_id).first()
    if not document:
        raise HTTPException(status_code=404, detail=f"Document #{document_id} not found on user #{user_id} — it may have been "
                                                    "deleted or belongs to another user. Reload the user's Documents tab.")
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
    admin: User = Depends(require_tab_action("organization", "users", "edit")),
):
    """Update a user's name / approval flags (Users 'Edit'); the admin role itself stays admin-only."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    before = _audited_user_fields(target)
    _ensure_may_manage(admin, target)
    _APPROVAL_FLAGS = (
        "is_department_head", "is_project_head", "is_plant_head", "is_purchase_head", "is_director",
        "is_finance_manager", "is_design_manager", "is_rnd_manager", "is_production_manager",
        "is_project_manager", "is_store_manager", "is_purchase_manager",
    )
    if any(getattr(payload, f, None) is not None for f in _APPROVAL_FLAGS):
        _ensure_may_manage(admin, target, own_access=True)

    if payload.role is not None:
        if payload.role not in VALID_ROLES:
            raise HTTPException(status_code=400, detail="Invalid role")
        # Making someone an admin (or taking it away) stays admin-only, whatever
        # Organization permissions the caller holds.
        if payload.role != target.role and not is_admin_user(admin):
            raise HTTPException(
                status_code=403,
                detail="Only an admin can make a user an admin or remove admin rights. Ask an admin to make this change.",
            )
        if target.id == admin.id and payload.role != "admin":
            raise HTTPException(status_code=400, detail="Cannot change your own admin role")
        target.role = payload.role

    if payload.assigned_apps is not None or payload.erp_permissions is not None:
        raise HTTPException(
            status_code=400,
            detail="Module access and ERP permissions are now given through roles. Open the user's 'Roles & Permissions' "
                   "tab (or Organization › Role & Permissions) and assign a role instead.",
        )

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


    if payload.is_finance_manager is not None:
        target.is_finance_manager = payload.is_finance_manager

    for manager_flag in ("is_design_manager", "is_rnd_manager", "is_production_manager",
                         "is_project_manager", "is_store_manager", "is_purchase_manager"):
        value = getattr(payload, manager_flag, None)
        if value is not None:
            setattr(target, manager_flag, value)

    if payload.name is not None:
        target.name = payload.name

    after = _audited_user_fields(target)
    changed = sorted(k for k in after if after[k] != before[k])
    if changed:
        db.add(AuditLog(
            entity_type="user", entity_id=target.id, action="updated", module_key="organization",
            summary=f"{admin.name} updated {target.name}: {', '.join(changed)}",
            old_value=json.dumps({k: before[k] for k in changed}, default=str),
            new_value=json.dumps({k: after[k] for k in changed}, default=str),
            performed_by_id=admin.id,
        ))

    db.commit()
    db.refresh(target)
    return to_response(target, db)


_AUDITED_USER_FIELDS = (
    "name", "role",
    "is_department_head", "is_project_head", "is_plant_head", "is_purchase_head", "is_director",
    "is_finance_manager", "is_design_manager", "is_rnd_manager", "is_production_manager",
    "is_project_manager", "is_store_manager", "is_purchase_manager",
)


def _audited_user_fields(user: User) -> dict:
    """Snapshot of the admin-editable fields, for the update_user audit diff."""
    out = {}
    for f in _AUDITED_USER_FIELDS:
        v = getattr(user, f, None)
        out[f] = sorted(v) if isinstance(v, list) else v
    return out


@router.patch("/{user_id}/deactivate", response_model=UserResponse)
async def deactivate_user(
    user_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: User = Depends(require_tab_action("organization", "users", "edit")),
):
    """Deactivate a user account (Organization › Users 'Edit')."""
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot deactivate your own account")
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    _ensure_may_manage(admin, target)
    target.is_active = False
    # Deactivation must also cut off every signed-in device, not just new
    # logins (security finding S-10 / P2-USR-17).
    revoke_user_sessions(db, target.id)
    # This row is also what stops the Azure sync re-activating them (C-10) —
    # see azure_may_reactivate() in app/modules/main/services/azure_sync.py.
    db.add(AuditLog(
        entity_type="user", entity_id=target.id, action="deactivated", module_key="organization",
        summary=f"{admin.name} deactivated {target.name}", performed_by_id=admin.id,
    ))
    notify_event(db, background_tasks, "organization", "user_deactivated", title=f"{target.name} deactivated",
                 message=f"{admin.name} deactivated {target.name} ({target.email}) — they can no longer sign in and their sessions were ended.",
                 entity_type="user", entity_id=target.id, actor=admin, skip_user_ids={target.id})
    db.commit()
    db.refresh(target)
    return to_response(target, db)


@router.patch("/{user_id}/activate", response_model=UserResponse)
async def activate_user(
    user_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    admin: User = Depends(require_tab_action("organization", "users", "edit")),
):
    """Reactivate a user account (Organization › Users 'Edit')."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    _ensure_may_manage(admin, target)
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
    db.add(AuditLog(
        entity_type="user", entity_id=target.id, action="activated", module_key="organization",
        summary=f"{admin.name} activated {target.name}", performed_by_id=admin.id,
    ))
    notify_event(db, background_tasks, "organization", "user_deactivated", title=f"{target.name} reactivated",
                 message=f"{admin.name} reactivated {target.name} ({target.email}) — they can sign in again with their existing roles.",
                 entity_type="user", entity_id=target.id, actor=admin, skip_user_ids={target.id})
    db.commit()
    db.refresh(target)
    return to_response(target, db)


@router.post("/sync-azure", response_model=list[UserResponse])
async def sync_azure_users(
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_action("organization", "users", "create")),
):
    """Pull every member from the Azure AD tenant into the local users table,
    so the Users & Roles page shows the full org directory, not just people
    who have already logged in once (admin only)."""
    try:
        azure_users = await list_azure_org_users()
        admin_ids = await get_azure_admin_ids()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Azure sync failed: {e}")

    # Same body the nightly `azure_user_sync` job runs — see
    # app/modules/main/services/azure_sync.py.
    apply_azure_sync(db, azure_users, admin_ids)
    users = db.query(User).order_by(User.name).all()
    # Same shared-mailbox/guest filter as GET /users, so the list doesn't
    # change between a sync and a reload.
    return [to_response(u, db) for u in users if _is_syncable_azure_user(u.email)]
