from datetime import date, datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.routes.auth import get_current_user
from app.modules.erp.models.project import Project
from app.modules.p2p.models.p2p_request import (
    P2PRequest, P2P_REQUEST_STATUSES, P2P_CATEGORIES, P2P_REQUIREMENT_TYPES, P2P_CATEGORY_AUTO_BUYERS,
)
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.p2p_request_attachment import P2PRequestAttachment, P2P_ATTACHMENT_DOC_TYPES
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.vendor.models.vendor import Vendor
from app.modules.store.models.stock_item import StockItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.service import record_stock_receipt
from app.modules.p2p.schemas.p2p_request import (
    P2PRequestCreate,
    P2PRequestResponse,
    P2PRequestUpdate,
    P2PRequestActionPayload,
    P2PRequestApprovePayload,
    P2PRequestAssignBuyerPayload,
    P2PRequestQuotationPayload,
    P2PRequestSelectVendorPayload,
    P2PRequestCreatePOPayload,
    P2PRequestReceivePayload,
    P2PRequestItemStockLinkPayload,
    P2PRequestAttachmentResponse,
)
from app.modules.p2p.service import generate_p2p_number
from app.utils.sharepoint import upload_file_to_sharepoint, build_sharepoint_folder_path
from app.utils.notifications import notify_user

router = APIRouter(prefix="/p2p/requests", tags=["P2P"])


def _requester_or_purchase(user: User = Depends(get_current_user)) -> User:
    """Anyone with the `p2p` app (raise/view own PRs) OR the
    `purchase` app (process all PRs) OR an admin may call these routes —
    per-route logic below narrows what each actually gets to see/do."""
    apps = user.get_apps()
    if "p2p" not in apps and "purchase" not in apps and not _is_po_approver(user):
        raise HTTPException(status_code=403, detail="Access to the P2P module required")
    return user


def _is_purchase_team(user: User) -> bool:
    return "purchase" in user.get_apps()


def _is_po_approver(user: User) -> bool:
    return user.is_purchase_head or user.is_director or user.is_md


def _write_audit(db: Session, pr_id: int, action: str, user: User, summary: str | None = None,
                  old_status: str | None = None, new_status: str | None = None):
    db.add(AuditLog(
        entity_type="p2p_request", entity_id=pr_id, action=action, performed_by_id=user.id,
        summary=summary, old_value=old_status, new_value=new_status,
    ))


def _to_response(db: Session, pr: P2PRequest) -> P2PRequestResponse:
    resp = P2PRequestResponse.model_validate(pr)
    resp.category_label = P2P_CATEGORIES.get(pr.category_code, pr.category_code)
    resp.pending_quantity = pr.pending_quantity
    resp.pending_approval_roles = pr.pending_approval_roles
    resp.pending_po_approval_roles = pr.pending_po_approval_roles
    user_ids = {pr.requested_by_id, pr.assigned_buyer_id} - {None}
    if user_ids:
        users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()}
        if pr.requested_by_id and pr.requested_by_id in users:
            resp.requested_by_name = users[pr.requested_by_id].name or users[pr.requested_by_id].email
        if pr.assigned_buyer_id and pr.assigned_buyer_id in users:
            resp.assigned_buyer_name = users[pr.assigned_buyer_id].name or users[pr.assigned_buyer_id].email
    return resp


def _get_pr_or_404(db: Session, pr_id: int) -> P2PRequest:
    pr = db.query(P2PRequest).options(
        selectinload(P2PRequest.items).selectinload(P2PRequestItem.attachments),
        selectinload(P2PRequest.attachments),
    ).filter(P2PRequest.id == pr_id).first()
    if not pr:
        raise HTTPException(status_code=404, detail="P2P request not found")
    return pr


def _check_view_access(pr: P2PRequest, user: User) -> None:
    if _is_purchase_team(user) or _is_po_approver(user):
        return
    if user.id not in {pr.requested_by_id, pr.approver_id, pr.project_head_id, pr.plant_head_id}:
        raise HTTPException(status_code=403, detail="You may only view your own P2P requests")


def _check_approve_access(pr: P2PRequest, user: User) -> str | None:
    """Which approval slot `user` is acting as (None means either an admin
    override or the legacy no-heads-assigned purchase-team-wide path — the
    caller distinguishes those by role/assigned_approver_ids)."""
    assigned = pr.assigned_approver_ids
    if not assigned:
        if user.role != "admin" and not _is_purchase_team(user):
            raise HTTPException(status_code=403, detail="Purchase module access required to approve or reject this PR.")
        return None

    # Check if user is an assigned approver in one of the three roles.
    for role, assigned_id in assigned.items():
        if assigned_id == user.id and getattr(pr, f"{role}_approved_at") is None:
            return role

    # If user is not an assigned approver but is admin, they can do an override.
    if user.role == "admin":
        return None

    # Otherwise, user is not authorized to approve this PR.
    raise HTTPException(status_code=403, detail="You are not an assigned approver for this PR, or you have already approved it.")


def _check_reject_access(pr: P2PRequest, user: User) -> str:
    """Who is rejecting, for `rejected_by_role` — any assigned head (approved
    or not) or an admin may reject; falls back to purchase-team-wide when no
    heads are assigned at all."""
    if user.role == "admin":
        return "admin"
    assigned = pr.assigned_approver_ids
    if not assigned:
        if not _is_purchase_team(user):
            raise HTTPException(status_code=403, detail="Purchase module access required to approve or reject this PR.")
        return "purchase_team"
    for role, assigned_id in assigned.items():
        if assigned_id == user.id:
            return role
    raise HTTPException(status_code=403, detail="Only an assigned approver (or admin) can reject this PR.")


def _check_po_approve_access(pr: P2PRequest, user: User) -> str:
    role_flags = {
        "purchase_head": user.is_purchase_head,
        "director": user.is_director,
        "md": user.is_md,
    }
    roles = [role for role, enabled in role_flags.items() if enabled and role in pr.pending_po_approval_roles]
    if len(roles) == 1:
        return roles[0]
    if len(roles) > 1:
        raise HTTPException(status_code=403, detail="Your account has more than one pending PO approval role. Ask an administrator to assign one role before approving.")
    raise HTTPException(status_code=403, detail="You do not have a pending PO approval role for this request.")


@router.get("/meta")
async def get_meta(_user: User = Depends(_requester_or_purchase)):
    return {
        "categories": [{"code": k, "label": v} for k, v in P2P_CATEGORIES.items()],
        "requirement_types": list(P2P_REQUIREMENT_TYPES),
        "statuses": list(P2P_REQUEST_STATUSES),
    }


@router.get("/projects")
async def list_projects_for_picker(
    search: str | None = None,
    db: Session = Depends(get_db),
    _user: User = Depends(_requester_or_purchase),
):
    """A lightweight project picker for the PR creation form — every
    requester (any department, not just `erp` app holders) needs to be able
    to search existing Service Module projects, so this deliberately bypasses
    `require_app_access("erp")` and only requires this module's own access."""
    query = db.query(Project).filter(Project.is_deleted == False)  # noqa: E712
    if search:
        like = f"%{search}%"
        query = query.filter(
            (Project.serial_number.ilike(like)) | (Project.model_name.ilike(like)) | (Project.client_company.ilike(like))
        )
    projects = query.order_by(Project.serial_number).limit(1000).all()
    return [
        {
            "id": p.id,
            "label": f"{p.serial_number} — {p.model_name}" if p.model_name else p.serial_number,
        }
        for p in projects
    ]


def _validate_head(db: Session, user_id: int | None, role_label: str) -> User | None:
    """The New PR form lets the requester pick any active user for each of
    the three approval roles — not restricted to users flagged with that
    role (those flags only drive the department-head auto-assign fallback).
    Just confirm the picked id is a real, active user."""
    if user_id is None:
        return None
    head = db.query(User).filter(User.id == user_id, User.is_active == True).first()  # noqa: E712
    if not head:
        raise HTTPException(status_code=400, detail=f"Selected {role_label} not found or inactive.")
    return head


@router.post("", response_model=P2PRequestResponse)
async def create_p2p_request(
    payload: P2PRequestCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("p2p")),
):
    if payload.category_code not in P2P_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category code '{payload.category_code}'")
    if not payload.items:
        raise HTTPException(status_code=400, detail="At least one item is required")

    dept_head = _validate_head(db, payload.approver_id, "Department Head")
    if dept_head is None and user.department:
        dept_head = db.query(User).filter(
            User.department == user.department, User.is_department_head == True, User.is_active == True,  # noqa: E712
        ).first()
    project_head = _validate_head(db, payload.project_head_id, "Project Head")
    plant_head = _validate_head(db, payload.plant_head_id, "Plant Head")

    # Buyer is auto-assigned from the category — no manual "Assign Buyer"
    # step needed once the PR is raised.
    auto_buyer_id = P2P_CATEGORY_AUTO_BUYERS.get(payload.category_code)

    pr = P2PRequest(
        p2p_number=generate_p2p_number(db, payload.category_code),
        category_code=payload.category_code,
        project_label=payload.project_label,
        required_date=payload.required_date,
        requirement_type=payload.requirement_type,
        request_date=date.today(),
        department=user.department,
        requested_by_id=user.id,
        priority=payload.priority,
        approver_id=dept_head.id if dept_head else None,
        approver_name=dept_head.name if dept_head else None,
        project_head_id=project_head.id if project_head else None,
        project_head_name=project_head.name if project_head else None,
        plant_head_id=plant_head.id if plant_head else None,
        plant_head_name=plant_head.name if plant_head else None,
        assigned_buyer_id=auto_buyer_id,
        assignment_date=date.today() if auto_buyer_id else None,
        remarks=payload.remarks,
        status="submitted",
    )
    db.add(pr)
    db.flush()

    for item in payload.items:
        db.add(P2PRequestItem(
            p2p_request_id=pr.id,
            item_name=item.item_name,
            make=item.make,
            part_code=item.part_code,
            unit=item.unit,
            quantity=item.quantity,
            project_inhouse=item.project_inhouse,
            category=item.category,
            ship_to=item.ship_to,
        ))

    _write_audit(db, pr.id, "created", user, summary=f"{user.name or user.email} raised P2P request {pr.p2p_number}.", new_status="submitted")

    for head_id in {pr.approver_id, pr.project_head_id, pr.plant_head_id} - {None}:
        notify_user(
            db, user_id=head_id,
            title="New P2P Request for Review",
            message=f"PR '{pr.p2p_number}' was raised by {user.name or user.email} and awaits your review.",
            notification_type="p2p_request_submitted", entity_type="p2p_request", entity_id=pr.id,
        )

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.get("", response_model=list[P2PRequestResponse])
async def list_p2p_requests(
    status: str | None = None,
    category_code: str | None = None,
    department: str | None = None,
    project_label: str | None = None,
    priority: str | None = None,
    required_date: date | None = None,
    search: str | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    query = db.query(P2PRequest).options(
        selectinload(P2PRequest.items).selectinload(P2PRequestItem.attachments),
        selectinload(P2PRequest.attachments),
    )
    if not _is_purchase_team(user):
        if _is_po_approver(user):
            query = query.filter(P2PRequest.status == "po_raised")
        else:
        # Requesters see their own history; an assigned department/project/
        # plant head also sees PRs routed to them for approval — regardless
        # of other filters.
            query = query.filter(
                (P2PRequest.requested_by_id == user.id)
                | (P2PRequest.approver_id == user.id)
                | (P2PRequest.project_head_id == user.id)
                | (P2PRequest.plant_head_id == user.id)
            )
    if status:
        query = query.filter(P2PRequest.status == status)
    if category_code:
        query = query.filter(P2PRequest.category_code == category_code)
    if department:
        query = query.filter(P2PRequest.department == department)
    if project_label:
        query = query.filter(P2PRequest.project_label.ilike(f"%{project_label}%"))
    if priority:
        query = query.filter(P2PRequest.priority == priority)
    if required_date:
        query = query.filter(P2PRequest.required_date == required_date)
    if search:
        query = query.filter(P2PRequest.p2p_number.ilike(f"%{search}%"))

    prs = query.order_by(P2PRequest.created_at.desc()).offset(skip).limit(limit).all()
    return [_to_response(db, pr) for pr in prs]


@router.get("/{pr_id}", response_model=P2PRequestResponse)
async def get_p2p_request(
    pr_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    pr = _get_pr_or_404(db, pr_id)
    _check_view_access(pr, user)
    return _to_response(db, pr)


@router.get("/{pr_id}/audit")
async def get_p2p_request_audit(
    pr_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    pr = _get_pr_or_404(db, pr_id)
    _check_view_access(pr, user)
    logs = db.query(AuditLog).filter(
        AuditLog.entity_type == "p2p_request", AuditLog.entity_id == pr_id
    ).order_by(AuditLog.performed_at.asc()).all()

    user_ids = {log.performed_by_id for log in logs if log.performed_by_id}
    user_map: dict[int, str] = {}
    if user_ids:
        for u in db.query(User).filter(User.id.in_(user_ids)).all():
            user_map[u.id] = u.name or u.email or f"User #{u.id}"

    return [
        {
            "id": log.id,
            "action": log.action,
            "summary": log.summary,
            "old_status": log.old_value,
            "new_status": log.new_value,
            "performed_by": user_map.get(log.performed_by_id, "System") if log.performed_by_id else "System",
            "performed_at": log.performed_at.isoformat() if log.performed_at else None,
        }
        for log in logs
    ]


@router.patch("/{pr_id}", response_model=P2PRequestResponse)
async def update_p2p_request(
    pr_id: int,
    payload: P2PRequestUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    pr = _get_pr_or_404(db, pr_id)
    updates = payload.model_dump(exclude_unset=True)
    new_status = updates.pop("status", None)

    for field, val in updates.items():
        setattr(pr, field, val)

    if new_status and new_status != pr.status:
        if new_status not in P2P_REQUEST_STATUSES:
            raise HTTPException(status_code=400, detail=f"Invalid status '{new_status}'")
        old_status = pr.status
        pr.status = new_status
        _write_audit(db, pr.id, "status_changed", user,
                     summary=f"{user.name or user.email} manually changed status of {pr.p2p_number} from '{old_status}' to '{new_status}'.",
                     old_status=old_status, new_status=new_status)

    if updates:
        _write_audit(db, pr.id, "updated", user, summary=f"{user.name or user.email} updated P2P request {pr.p2p_number}.")

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


_ROLE_LABELS = {"department_head": "Department Head", "project_head": "Project Head", "plant_head": "Plant Head"}
_PO_ROLE_LABELS = {"purchase_head": "Purchase Head", "director": "Director", "md": "MD"}


@router.post("/{pr_id}/approve", response_model=P2PRequestResponse)
async def approve_p2p_request(
    pr_id: int,
    payload: P2PRequestApprovePayload = P2PRequestApprovePayload(),
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    pr = _get_pr_or_404(db, pr_id)
    if pr.status != "submitted":
        raise HTTPException(status_code=409, detail=f"Only a submitted PR can be approved (current status: {pr.status})")

    role = _check_approve_access(pr, user)
    now = datetime.now(timezone.utc)
    comment_note = f" Comment: {payload.comment}" if payload.comment else ""

    if role is not None:
        setattr(pr, f"{role}_approved_at", now)
        if payload.comment:
            setattr(pr, f"{role}_comment", payload.comment)
        _write_audit(db, pr.id, "approved", user,
                     summary=f"{user.name or user.email} approved P2P request {pr.p2p_number} as {_ROLE_LABELS[role]}.{comment_note}")
    elif user.role == "admin" and pr.pending_approval_roles:
        # Admin override: signs off every still-pending slot at once.
        for pending_role in pr.pending_approval_roles:
            setattr(pr, f"{pending_role}_approved_at", now)
            if payload.comment:
                setattr(pr, f"{pending_role}_comment", payload.comment)
        _write_audit(db, pr.id, "approved", user,
                     summary=f"{user.name or user.email} approved P2P request {pr.p2p_number} (admin override).{comment_note}")

    if not pr.pending_approval_roles:
        old_status = pr.status
        pr.status = "approved"
        pr.approved_by_id = user.id
        pr.approved_at = now
        _write_audit(db, pr.id, "approved", user, summary=f"{user.name or user.email} approved P2P request {pr.p2p_number}.",
                     old_status=old_status, new_status="approved")
        if pr.requested_by_id:
            notify_user(
                db, user_id=pr.requested_by_id,
                title="P2P Request Approved",
                message=f"Your PR '{pr.p2p_number}' was approved by {user.name or user.email}.",
                notification_type="p2p_request_approved", entity_type="p2p_request", entity_id=pr.id,
            )

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.post("/{pr_id}/approve-po", response_model=P2PRequestResponse)
async def approve_po(
    pr_id: int,
    payload: P2PRequestApprovePayload = P2PRequestApprovePayload(),
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    pr = _get_pr_or_404(db, pr_id)
    if pr.status != "po_raised":
        raise HTTPException(status_code=409, detail=f"Only a PO raised request can be approved (current status: {pr.status})")

    role = _check_po_approve_access(pr, user)
    now = datetime.now(timezone.utc)
    setattr(pr, f"{role}_approved_at", now)
    if payload.comment:
        setattr(pr, f"{role}_comment", payload.comment)
    _write_audit(db, pr.id, "po_approved", user,
                 summary=f"{user.name or user.email} approved PO for {pr.p2p_number} as {_PO_ROLE_LABELS[role]}.")

    if not pr.pending_po_approval_roles:
        pr.status = "po_approved"
        _write_audit(db, pr.id, "po_fully_approved", user,
                     summary=f"PO for {pr.p2p_number} received all required approvals.",
                     old_status="po_raised", new_status="po_approved")

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.post("/{pr_id}/reject", response_model=P2PRequestResponse)
async def reject_p2p_request(
    pr_id: int,
    payload: P2PRequestActionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    pr = _get_pr_or_404(db, pr_id)
    if pr.status not in ("submitted", "approved"):
        raise HTTPException(status_code=409, detail=f"Cannot reject a PR with status '{pr.status}'")
    role = _check_reject_access(pr, user)

    old_status = pr.status
    pr.status = "rejected"
    pr.rejected_reason = payload.reason
    pr.rejected_by_role = role
    reason_note = f" Reason: {payload.reason}" if payload.reason else ""
    _write_audit(db, pr.id, "rejected", user, summary=f"{user.name or user.email} rejected P2P request {pr.p2p_number}.{reason_note}",
                 old_status=old_status, new_status="rejected")

    if pr.requested_by_id:
        notify_user(
            db, user_id=pr.requested_by_id,
            title="P2P Request Rejected",
            message=f"Your PR '{pr.p2p_number}' was rejected by {user.name or user.email}.{reason_note}",
            notification_type="p2p_request_rejected", entity_type="p2p_request", entity_id=pr.id,
        )

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.post("/{pr_id}/cancel", response_model=P2PRequestResponse)
async def cancel_p2p_request(
    pr_id: int,
    payload: P2PRequestActionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    pr = _get_pr_or_404(db, pr_id)
    if not _is_purchase_team(user) and pr.requested_by_id != user.id:
        raise HTTPException(status_code=403, detail="You may only cancel your own P2P requests")
    if pr.status in ("closed", "rejected", "cancelled", "po_raised", "partially_received", "received"):
        raise HTTPException(status_code=409, detail=f"Cannot cancel a PR with status '{pr.status}'")

    old_status = pr.status
    pr.status = "cancelled"
    pr.cancelled_reason = payload.reason
    reason_note = f" Reason: {payload.reason}" if payload.reason else ""
    _write_audit(db, pr.id, "cancelled", user, summary=f"{user.name or user.email} cancelled P2P request {pr.p2p_number}.{reason_note}",
                 old_status=old_status, new_status="cancelled")
    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.post("/{pr_id}/assign-buyer", response_model=P2PRequestResponse)
async def assign_buyer(
    pr_id: int,
    payload: P2PRequestAssignBuyerPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    pr = _get_pr_or_404(db, pr_id)
    if pr.status != "approved":
        raise HTTPException(status_code=409, detail=f"A buyer can only be assigned to an approved PR (current status: {pr.status})")

    buyer = db.query(User).filter(User.id == payload.assigned_buyer_id).first()
    if not buyer:
        raise HTTPException(status_code=404, detail="Buyer not found")

    pr.assigned_buyer_id = payload.assigned_buyer_id
    pr.assignment_date = payload.assignment_date or date.today()
    _write_audit(db, pr.id, "buyer_assigned", user,
                 summary=f"{user.name or user.email} assigned {buyer.name or buyer.email} as buyer for {pr.p2p_number}.")

    notify_user(
        db, user_id=buyer.id,
        title="Assigned as Buyer",
        message=f"You have been assigned as the buyer for PR '{pr.p2p_number}'.",
        notification_type="p2p_request_buyer_assigned", entity_type="p2p_request", entity_id=pr.id,
    )

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.post("/{pr_id}/request-quotations", response_model=P2PRequestResponse)
async def request_quotations(
    pr_id: int,
    payload: P2PRequestQuotationPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    pr = _get_pr_or_404(db, pr_id)
    if pr.status != "approved":
        raise HTTPException(status_code=409, detail=f"Quotations can only be recorded on an approved PR (current status: {pr.status})")

    updates = payload.model_dump(exclude_unset=True)
    for field, val in updates.items():
        setattr(pr, field, val)
    _write_audit(db, pr.id, "quotation_recorded", user,
                 summary=f"{user.name or user.email} recorded vendor/RFQ details for {pr.p2p_number}.")
    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.post("/{pr_id}/select-vendor", response_model=P2PRequestResponse)
async def select_vendor(
    pr_id: int,
    payload: P2PRequestSelectVendorPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    pr = _get_pr_or_404(db, pr_id)
    if pr.status != "approved":
        raise HTTPException(status_code=409, detail=f"A vendor can only be selected on an approved PR (current status: {pr.status})")

    pr.selected_vendor = payload.selected_vendor
    _write_audit(db, pr.id, "vendor_selected", user,
                 summary=f"{user.name or user.email} selected vendor '{payload.selected_vendor}' for {pr.p2p_number}.")
    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.post("/{pr_id}/create-po", response_model=P2PRequestResponse)
async def create_po(
    pr_id: int,
    payload: P2PRequestCreatePOPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    pr = _get_pr_or_404(db, pr_id)
    if pr.status != "approved":
        raise HTTPException(status_code=409, detail=f"A PO can only be raised on an approved PR (current status: {pr.status})")
    if db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.po_number == payload.po_number).first():
        raise HTTPException(status_code=409, detail=f"PO number '{payload.po_number}' already exists")

    vendor_row = None
    if pr.selected_vendor:
        vendor_row = db.query(Vendor).filter(Vendor.name == pr.selected_vendor).first()

    old_status = pr.status
    pr.po_number = payload.po_number
    pr.po_date = payload.po_date or date.today()
    pr.po_value = payload.po_value
    pr.expected_delivery = payload.expected_delivery
    pr.ordered_quantity = payload.ordered_quantity if payload.ordered_quantity is not None else sum(i.quantity for i in pr.items)
    pr.status = "po_raised"

    # The PR's po_* fields above are a denormalized snapshot for quick display;
    # this linked P2PPurchaseOrder is the real record — see
    # docs/product/PURCHASE_DEPARTMENT_MODULE_PLAN.md Phase 2.
    po = P2PPurchaseOrder(
        po_number=payload.po_number,
        p2p_request_id=pr.id,
        vendor_id=vendor_row.id if vendor_row else None,
        vendor_name=pr.selected_vendor,
        status="issued",
        po_date=pr.po_date,
        expected_delivery=pr.expected_delivery,
        created_by_id=user.id,
        total_value=payload.po_value,
    )
    db.add(po)
    db.flush()
    for item in pr.items:
        db.add(P2PPurchaseOrderItem(
            purchase_order_id=po.id,
            item_name=item.item_name,
            make=item.make,
            part_code=item.part_code,
            unit=item.unit,
            quantity=item.quantity,
        ))

    _write_audit(db, pr.id, "po_raised", user,
                 summary=f"{user.name or user.email} raised PO '{payload.po_number}' for {pr.p2p_number}.",
                 old_status=old_status, new_status="po_raised")

    if pr.requested_by_id:
        notify_user(
            db, user_id=pr.requested_by_id,
            title="Purchase Order Raised",
            message=f"A purchase order ('{payload.po_number}') has been raised for your PR '{pr.p2p_number}'.",
            notification_type="p2p_request_po_raised", entity_type="p2p_request", entity_id=pr.id,
        )

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.post("/{pr_id}/update-receipt", response_model=P2PRequestResponse)
async def update_receipt(
    pr_id: int,
    payload: P2PRequestReceivePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    pr = _get_pr_or_404(db, pr_id)
    if pr.status not in ("po_approved", "partially_received"):
        raise HTTPException(status_code=409, detail=f"Receipts can only be recorded once a PO is raised (current status: {pr.status})")

    old_status = pr.status
    ordered = pr.ordered_quantity if pr.ordered_quantity is not None else sum(i.quantity for i in pr.items)
    received = max(0.0, min(payload.received_quantity, ordered)) if ordered else payload.received_quantity
    previously_received = pr.received_quantity or 0.0
    delta = received - previously_received

    mapped_items = [item for item in pr.items if item.stock_item_id]
    if delta > 0 and mapped_items and not payload.store_location_id:
        raise HTTPException(
            status_code=400,
            detail="store_location_id is required — this PR has item(s) linked to a stock item, so receiving must post a stock-in transaction",
        )

    pr.ordered_quantity = ordered
    pr.received_quantity = received
    pr.grn_number = payload.grn_number or pr.grn_number
    pr.receipt_date = payload.receipt_date or date.today()
    pr.receiving_remarks = payload.receiving_remarks or pr.receiving_remarks

    if received <= 0:
        pr.receipt_status = "pending"
    elif ordered and received < ordered:
        pr.receipt_status = "partial"
        pr.status = "partially_received"
    else:
        pr.receipt_status = "received"
        pr.status = "received"

    # Post the newly-received delta (this call may be a partial receipt on top
    # of an earlier one) to Store for every item mapped to a stock catalog
    # entry — unmapped items are silently skipped, not blocked. See
    # docs/product/PURCHASE_STORE_INTEGRATION.md integration point 1.
    if delta > 0 and ordered and mapped_items:
        for item in mapped_items:
            item_delta = delta * (item.quantity / ordered)
            if item_delta > 0:
                record_stock_receipt(
                    db, stock_item_id=item.stock_item_id, location_id=payload.store_location_id,
                    quantity=item_delta, reference_type="p2p_grn", reference_id=pr.id,
                    performed_by_id=user.id, remarks=payload.receiving_remarks,
                )

    _write_audit(db, pr.id, "receipt_updated", user,
                 summary=f"{user.name or user.email} recorded receipt of {received}/{ordered} for {pr.p2p_number}.",
                 old_status=old_status, new_status=pr.status)

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.patch("/{pr_id}/items/{item_id}/stock-link", response_model=P2PRequestResponse)
async def link_item_to_stock(
    pr_id: int,
    item_id: int,
    payload: P2PRequestItemStockLinkPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    """Map (or unmap) a P2P request line to a Store catalog item, so a later
    receipt on this PR can post a stock-in transaction for it. Non-blocking —
    a PR can be received without every item being mapped."""
    pr = _get_pr_or_404(db, pr_id)
    item = next((i for i in pr.items if i.id == item_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found on this P2P request")

    if payload.stock_item_id is not None:
        stock_item = db.query(StockItem).filter(StockItem.id == payload.stock_item_id).first()
        if not stock_item:
            raise HTTPException(status_code=404, detail="Stock item not found")

    item.stock_item_id = payload.stock_item_id
    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.post("/{pr_id}/close", response_model=P2PRequestResponse)
async def close_p2p_request(
    pr_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    pr = _get_pr_or_404(db, pr_id)
    if pr.status != "received":
        raise HTTPException(status_code=409, detail="A P2P request can only be closed once fully received.")

    old_status = pr.status
    pr.status = "closed"
    pr.closed_by_id = user.id
    pr.closed_at = datetime.now(timezone.utc)
    _write_audit(db, pr.id, "closed", user, summary=f"{user.name or user.email} closed P2P request {pr.p2p_number}.",
                 old_status=old_status, new_status="closed")

    if pr.requested_by_id:
        notify_user(
            db, user_id=pr.requested_by_id,
            title="P2P Request Closed",
            message=f"Your PR '{pr.p2p_number}' has been closed by {user.name or user.email}.",
            notification_type="p2p_request_closed", entity_type="p2p_request", entity_id=pr.id,
        )

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.post("/{pr_id}/attachments", response_model=list[P2PRequestAttachmentResponse])
async def upload_attachments(
    pr_id: int,
    doc_type: str = Form("supporting"),
    item_id: int | None = Form(None),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    pr = _get_pr_or_404(db, pr_id)
    if not _is_purchase_team(user) and pr.requested_by_id != user.id:
        raise HTTPException(status_code=403, detail="You may only add attachments to your own P2P requests")
    if doc_type not in P2P_ATTACHMENT_DOC_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid doc_type '{doc_type}'")
    if item_id is not None and item_id not in {item.id for item in pr.items}:
        raise HTTPException(status_code=400, detail="item_id does not belong to this P2P request")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    folder_path = build_sharepoint_folder_path(user.name or user.email or "", "p2p", pr.p2p_number)

    saved: list[P2PRequestAttachment] = []
    for f in files:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, folder_path, f)
        attachment = P2PRequestAttachment(
            p2p_request_id=pr.id,
            item_id=item_id,
            doc_type=doc_type,
            filename=result["name"],
            content_type=f.content_type,
            size=result["size"],
            sharepoint_path=result["path"],
            sharepoint_url=result.get("webUrl"),
            created_by_id=user.id,
        )
        db.add(attachment)
        saved.append(attachment)

    if saved:
        _write_audit(db, pr.id, "attachment_added", user,
                     summary=f"{user.name or user.email} uploaded {len(saved)} file(s) to {pr.p2p_number}.")
        db.flush()
        for a in saved:
            db.refresh(a)
    db.commit()
    return saved


@router.delete("/{pr_id}/attachments/{attachment_id}")
async def delete_attachment(
    pr_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    pr = _get_pr_or_404(db, pr_id)
    if not _is_purchase_team(user) and pr.requested_by_id != user.id:
        raise HTTPException(status_code=403, detail="You may only remove attachments from your own P2P requests")

    attachment = db.query(P2PRequestAttachment).filter(
        P2PRequestAttachment.id == attachment_id, P2PRequestAttachment.p2p_request_id == pr_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    db.delete(attachment)
    db.commit()
    return {"message": "Attachment deleted"}
