from datetime import date, datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.permissions import require_app_access
from app.db.session import get_db, SessionLocal
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.routes.auth import get_current_user
from app.modules.erp.models.project import Project
from app.modules.p2p.models.p2p_request import (
    P2PRequest, P2P_REQUEST_STATUSES, P2P_CATEGORIES, P2P_REQUIREMENT_TYPES, resolve_auto_buyer_id,
    PO_APPROVAL_ROLE_SETS, P2P_ROLE_FLAGS, P2P_ROLE_LABELS,
)
from app.modules.p2p.models.p2p_request_approval import P2PRequestApproval
from app.modules.p2p.models.p2p_request_po_approver import P2PRequestPOApprover
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.p2p_request_attachment import P2PRequestAttachment, P2P_ATTACHMENT_DOC_TYPES
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.schemas.p2p_request import (
    P2PRequestApprovalResponse,
    P2PRequestCreate,
    P2PRequestResponse,
    P2PRequestUpdate,
    P2PRequestActionPayload,
    P2PRequestApprovePayload,
    P2PRequestAssignBuyerPayload,
    P2PRequestQuotationPayload,
    P2PRequestSelectVendorPayload,
    P2PRequestCreatePOPayload,
    P2PRequestAttachmentResponse,
    P2PRequestItemStockCheckResponse,
    P2PRequestItemStockLocationInfo,
    P2PRequestIssueFromStockPayload,
)
from app.modules.p2p.service import generate_p2p_number, compute_line_total, resolve_pr_approvers, resolve_po_approvers
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.stock_balance import StoreStockBalance
from app.modules.store.models.material_issue import StoreMaterialIssue, StoreMaterialIssueItem
from app.modules.store.service import generate_material_issue_number
from app.modules.store.services.stock_ledger import post_stock_transaction
from app.utils.sharepoint import upload_file_to_sharepoint, build_sharepoint_folder_path, download_file_content
from app.utils.notifications import notify_user
from app.utils.email import send_p2p_pr_approval_email, send_p2p_po_approval_email

router = APIRouter(prefix="/p2p/requests", tags=["P2P"])

_PR_APPROVAL_SLOT_LABELS = (("approver_id", "Department Head"), ("project_head_id", "Project Head"), ("plant_head_id", "Plant Head"))
# Role key -> User flag for every PO approval role: the manager-matrix roles
# plus the legacy Purchase Head -> Director -> MD chain that in-flight PRs
# (project_type is NULL) still finish on.
_PO_APPROVAL_ROLE_FLAGS = {"purchase_head": "is_purchase_head", "director": "is_director", "md": "is_md", **P2P_ROLE_FLAGS}


def po_approver_users(db: Session, pr: "P2PRequest") -> list[tuple["User", str]]:
    """Everyone a PR's PO goes to, as (user, role) — one entry per person.
    Matrix PRs: the people picked per role on the New PR form plus every
    Director. Legacy PRs: holders of their still-pending chain role flags."""
    out: dict[int, tuple[User, str]] = {}
    if pr.project_type in PO_APPROVAL_ROLE_SETS:
        for row in pr.po_approvers:
            u = db.query(User).filter(User.id == row.approver_id, User.is_active == True).first()  # noqa: E712
            if u:
                out.setdefault(u.id, (u, row.role))
        for u in db.query(User).filter(User.is_active == True, User.is_director == True).all():  # noqa: E712
            out.setdefault(u.id, (u, "director"))
    else:
        for role in pr.pending_po_approval_roles:
            for u in db.query(User).filter(User.is_active == True, getattr(User, _PO_APPROVAL_ROLE_FLAGS[role]) == True).all():  # noqa: E712
                out.setdefault(u.id, (u, role))
    return list(out.values())


async def _send_p2p_pr_approval_emails_background(pr_id: int) -> None:
    """Best-effort email to each assigned PR approver, run after the PR has
    already been committed — mirrors the ERP module's
    `_send_purchase_requisition_email_background` pattern of opening its own
    DB session since the request-scoped one is closed by the time a
    BackgroundTask runs."""
    db = SessionLocal()
    try:
        pr = db.query(P2PRequest).options(
            selectinload(P2PRequest.items), selectinload(P2PRequest.approvals),
        ).filter(P2PRequest.id == pr_id).first()
        if not pr:
            return
        if pr.approvals:
            slots = [(a.approver_id, P2P_ROLE_LABELS.get(a.role, a.role)) for a in pr.approvals]
        else:
            slots = [(getattr(pr, field), role_label) for field, role_label in _PR_APPROVAL_SLOT_LABELS]
        for approver_id, role_label in slots:
            if not approver_id:
                continue
            approver = db.query(User).filter(User.id == approver_id).first()
            if approver:
                await send_p2p_pr_approval_email(db, pr, approver, role_label)
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


async def _send_p2p_po_approval_emails_background(pr_id: int) -> None:
    """Best-effort email to every user holding a still-pending PO approval
    role (purchase head / director / MD), run after the PO has already been
    committed. Opens its own DB session for the same reason as above."""
    db = SessionLocal()
    try:
        pr = db.query(P2PRequest).filter(P2PRequest.id == pr_id).first()
        if not pr:
            return
        po = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)).filter(
            P2PPurchaseOrder.p2p_request_id == pr.id
        ).order_by(P2PPurchaseOrder.id.desc()).first()
        if not po:
            return
        for approver, role in po_approver_users(db, pr):
            await send_p2p_po_approval_email(db, pr, po, approver, P2P_ROLE_LABELS.get(role, role))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


def _requester_or_purchase(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    """Anyone with the `p2p` app (raise/view own PRs) OR the `purchase` app
    (process all PRs) OR a PO-approver flag OR anyone named as an approver on
    at least one PR may call these routes — being picked as a PR approver
    itself grants access, since approvers are picked from the whole user
    directory and most don't hold the p2p app. Per-route logic below narrows
    what each actually gets to see/do (a mere approver only ever sees PRs
    routed to them — see list_p2p_requests / _check_view_access)."""
    apps = user.get_apps()
    if "p2p" in apps or "purchase" in apps or _is_po_approver(user):
        return user
    is_assigned_approver = (
        db.query(P2PRequestApproval.id).filter(P2PRequestApproval.approver_id == user.id).first() is not None
        or db.query(P2PRequestPOApprover.id).filter(P2PRequestPOApprover.approver_id == user.id).first() is not None
        or db.query(P2PRequest.id).filter(
            (P2PRequest.approver_id == user.id)
            | (P2PRequest.project_head_id == user.id)
            | (P2PRequest.plant_head_id == user.id)
        ).first() is not None
    )
    if is_assigned_approver:
        return user
    raise HTTPException(status_code=403, detail="Access to the P2P module required")


def _is_purchase_team(user: User) -> bool:
    return "purchase" in user.get_apps()


def _is_po_approver(user: User) -> bool:
    return any(getattr(user, flag, False) for flag in _PO_APPROVAL_ROLE_FLAGS.values())


def _write_audit(db: Session, pr_id: int, action: str, user: User, summary: str | None = None,
                  old_status: str | None = None, new_status: str | None = None):
    db.add(AuditLog(
        entity_type="p2p_request", entity_id=pr_id, action=action, performed_by_id=user.id,
        summary=summary, old_value=old_status, new_value=new_status,
    ))


def _to_response(db: Session, pr: P2PRequest) -> P2PRequestResponse:
    resp = P2PRequestResponse.model_validate(pr)
    resp.category_label = P2P_CATEGORIES.get(pr.category_code, pr.category_code)
    resp.approvals = [
        P2PRequestApprovalResponse.model_validate(a).model_copy(update={"role_label": P2P_ROLE_LABELS.get(a.role, a.role)})
        for a in pr.approvals
    ]
    if pr.project_type in PO_APPROVAL_ROLE_SETS:
        resp.po_approval_role_labels = [P2P_ROLE_LABELS[r] for r in PO_APPROVAL_ROLE_SETS[pr.project_type]]
        picked = [
            {"role": a.role, "role_label": P2P_ROLE_LABELS.get(a.role, a.role), "people": [{"id": a.approver_id, "name": a.approver_name}]}
            for a in pr.po_approvers
        ]
        directors = [{"id": u.id, "name": u.name or u.email} for u in db.query(User).filter(User.is_active == True, User.is_director == True).all()]  # noqa: E712
        resp.po_approval_panel = picked + [{"role": "director", "role_label": "Director", "people": directors}]
    if pr.po_approved_role:
        resp.po_approved_role_label = P2P_ROLE_LABELS.get(pr.po_approved_role, pr.po_approved_role)
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

    location_ids = {item.issued_from_location_id for item in pr.items} - {None}
    if location_ids:
        locations = {l.id: l for l in db.query(StoreLocation).filter(StoreLocation.id.in_(location_ids)).all()}
        for item_resp in resp.items:
            if item_resp.issued_from_location_id and item_resp.issued_from_location_id in locations:
                item_resp.issued_from_location_name = locations[item_resp.issued_from_location_id].name
    return resp


def _get_pr_or_404(db: Session, pr_id: int, *, for_update: bool = False) -> P2PRequest:
    query = db.query(P2PRequest).options(
        selectinload(P2PRequest.items).selectinload(P2PRequestItem.attachments),
        selectinload(P2PRequest.attachments),
        selectinload(P2PRequest.approvals),
        selectinload(P2PRequest.po_approvers),
    ).filter(P2PRequest.id == pr_id)
    if for_update:
        # Locks just the PR row itself — selectinload's collection queries
        # run separately and aren't part of this lock, which is fine since
        # only the PR's own status/po_* fields need protecting here.
        query = query.with_for_update()
    pr = query.first()
    if not pr:
        raise HTTPException(status_code=404, detail="P2P request not found")
    return pr


def _check_view_access(pr: P2PRequest, user: User) -> None:
    if _is_purchase_team(user) or _is_po_approver(user):
        return
    allowed = {pr.requested_by_id, pr.approver_id, pr.project_head_id, pr.plant_head_id}
    allowed.update(a.approver_id for a in pr.approvals)
    allowed.update(a.approver_id for a in pr.po_approvers)
    if user.id not in allowed:
        raise HTTPException(status_code=403, detail="You may only view your own P2P requests")


def _check_approve_access(pr: P2PRequest, user: User) -> list[str] | None:
    """Every approval slot `user` is acting as (None means either an admin
    override or the legacy no-heads-assigned purchase-team-wide path — the
    caller distinguishes those by role/assigned_approver_ids). Returns all
    still-pending roles assigned to this user, not just the first one, so a
    user holding multiple approver roles on the same PR clears every one of
    their slots in a single click.

    Per the "user self select kar sake" requirement (2026-09-30), a requester
    who named THEMSELVES in a slot may sign that slot — the business accepted
    waiving the PR-level four-eyes control. That consent only covers slots
    they were explicitly named in: on a PR with no assigned approvers at all
    (legacy fallback) the requester still can't wave their own PR through,
    and the admin override below never applies to the admin's own PR."""
    assigned = pr.assigned_approver_ids
    if not assigned:
        if pr.requested_by_id is not None and pr.requested_by_id == user.id:
            raise HTTPException(
                status_code=403,
                detail="You raised this requisition and no approvers are assigned to it, so you can't approve it yourself.",
            )
        if user.role != "admin" and not _is_purchase_team(user):
            raise HTTPException(status_code=403, detail="Purchase module access required to approve or reject this PR.")
        return None

    # Collect every role this user is assigned to that is still pending.
    pending = set(pr.pending_approval_roles)
    roles = [
        role for role, assigned_id in assigned.items()
        if assigned_id == user.id and role in pending
    ]
    if roles:
        return roles

    # If user is not an assigned approver but is admin, they can do an
    # override — except on their own PR (self-signing is only allowed for
    # slots the requester was explicitly named in).
    if user.role == "admin" and pr.requested_by_id != user.id:
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


def _check_po_reject_access(pr: P2PRequest, user: User) -> str:
    """Who is rejecting a PO-raised request — any holder of one of this PR's
    PO approval roles, or an admin."""
    if user.role == "admin":
        return "admin"
    if pr.project_type in PO_APPROVAL_ROLE_SETS:
        role_set = PO_APPROVAL_ROLE_SETS[pr.project_type]
    else:
        role_set = ("purchase_head", "director", "md")
    for role in role_set:
        if getattr(user, _PO_APPROVAL_ROLE_FLAGS[role], False):
            return role
    labels = ", ".join(P2P_ROLE_LABELS.get(r, r) for r in role_set)
    raise HTTPException(status_code=403, detail=f"Only one of {labels} (or an admin) can reject this PO.")


def _check_po_approve_access(pr: P2PRequest, user: User) -> list[str]:
    """Every PO approval slot `user` is acting as. Returns all still-pending
    PO roles assigned to this user, not just the first one, so a user holding
    multiple PO approver roles (purchase_head/director/md) clears every one
    of their slots in a single click."""
    role_flags = {
        "purchase_head": user.is_purchase_head,
        "director": user.is_director,
        "md": user.is_md,
    }
    roles = [role for role, enabled in role_flags.items() if enabled and role in pr.pending_po_approval_roles]
    if roles:
        return roles
    raise HTTPException(status_code=403, detail="You do not have a pending PO approval role for this request.")


@router.get("/meta")
async def get_meta(_user: User = Depends(_requester_or_purchase)):
    # UOMs come from the Store item master's fixed list so a PR line's unit
    # matches store stock exactly — requesters usually lack the `store` app,
    # so the list is served here rather than from /store/items/meta.
    from app.modules.store.models.item import STORE_UOMS
    return {
        "categories": [{"code": k, "label": v} for k, v in P2P_CATEGORIES.items()],
        "requirement_types": list(P2P_REQUIREMENT_TYPES),
        "statuses": list(P2P_REQUEST_STATUSES),
        "uoms": [{"value": code, "label": f"{code} — {label}"} for code, label in STORE_UOMS.items()],
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


@router.post("", response_model=P2PRequestResponse)
async def create_p2p_request(
    payload: P2PRequestCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("p2p")),
):
    if payload.category_code not in P2P_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category code '{payload.category_code}'")
    if not payload.items:
        raise HTTPException(status_code=400, detail="At least one item is required")
    # Every line must say whether it's for the Project or Inhouse (2026-09-30)
    # — Store issue/consumption and reporting split on it downstream.
    for idx, item in enumerate(payload.items, start=1):
        if item.project_inhouse not in ("Project", "Inhouse"):
            raise HTTPException(
                status_code=400,
                detail=f"Line {idx} ({item.item_name.strip() or 'unnamed item'}): choose Project or Inhouse.",
            )

    if not (payload.project_label or "").strip():
        raise HTTPException(status_code=400, detail="Project is required — pick the existing project, or give the new project's name.")
    try:
        approvers = resolve_pr_approvers(db, user, payload.project_type, payload.approvers)
        po_approvers = resolve_po_approvers(db, payload.project_type, payload.po_approvers) if payload.po_approvers else {}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Buyer is auto-assigned from the category — no manual "Assign Buyer"
    # step needed once the PR is raised.
    auto_buyer_id = resolve_auto_buyer_id(db, payload.category_code)

    pr = P2PRequest(
        p2p_number=generate_p2p_number(db, payload.category_code),
        category_code=payload.category_code,
        project_label=payload.project_label,
        project_type=payload.project_type,
        required_date=payload.required_date,
        requirement_type=payload.requirement_type,
        request_date=date.today(),
        department=user.department,
        requested_by_id=user.id,
        priority=payload.priority,
        assigned_buyer_id=auto_buyer_id,
        assignment_date=date.today() if auto_buyer_id else None,
        remarks=payload.remarks,
        status="submitted",
    )
    db.add(pr)
    db.flush()

    created_items: list[P2PRequestItem] = []
    for item in payload.items:
        row = P2PRequestItem(
            p2p_request_id=pr.id,
            item_name=item.item_name,
            make=item.make,
            part_code=item.part_code,
            unit=item.unit,
            quantity=item.quantity,
            project_inhouse=item.project_inhouse,
            category=item.category,
            ship_to=item.ship_to,
        )
        db.add(row)
        created_items.append(row)
    # Store-stock snapshot up front, so the approvers see per line whether
    # it's already sitting in store before they sign.
    _refresh_stock_snapshot(db, created_items)

    for role, approver in approvers.items():
        db.add(P2PRequestApproval(
            p2p_request_id=pr.id, role=role, approver_id=approver.id,
            approver_name=approver.name or approver.email,
        ))
    for role, approver in po_approvers.items():
        db.add(P2PRequestPOApprover(
            p2p_request_id=pr.id, role=role, approver_id=approver.id,
            approver_name=approver.name or approver.email,
        ))

    _write_audit(db, pr.id, "created", user, summary=f"{user.name or user.email} raised P2P request {pr.p2p_number}.", new_status="submitted")

    # One user may hold several roles on this PR — notify them once.
    for head_id in {approver.id for approver in approvers.values()}:
        notify_user(
            db, user_id=head_id,
            title="New P2P Request for Review",
            message=f"PR '{pr.p2p_number}' was raised by {user.name or user.email} and awaits your review.",
            notification_type="p2p_request_submitted", entity_type="p2p_request", entity_id=pr.id,
        )

    db.commit()
    db.refresh(pr)
    background_tasks.add_task(_send_p2p_pr_approval_emails_background, pr.id)
    return _to_response(db, pr)


@router.get("", response_model=list[P2PRequestResponse])
async def list_p2p_requests(
    queue: str | None = Query(None, pattern="^(pr-approval|po-approval)$"),
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
        selectinload(P2PRequest.approvals),
        selectinload(P2PRequest.po_approvers),
    )
    if queue == "pr-approval" and user.role != "admin":
        # The P.R Approval queue: ONLY PRs where the viewer holds an approver
        # slot — even for the purchase team, whose monitoring view is the
        # main list. Admins see the full queue.
        query = query.filter(
            P2PRequest.approvals.any(P2PRequestApproval.approver_id == user.id)
            | (P2PRequest.approver_id == user.id)
            | (P2PRequest.project_head_id == user.id)
            | (P2PRequest.plant_head_id == user.id)
        )
    elif queue == "po-approval" and user.role != "admin":
        # The P.O Approval queue: ONLY PRs whose PO this viewer is eligible
        # to approve — their role flags intersected with each PR's role set
        # (matrix by project_type, legacy PH/Director/MD otherwise) — anyone
        # holding a role may approve, including whoever raised the PR or PO.
        eligibility = [P2PRequest.po_approvers.any(P2PRequestPOApprover.approver_id == user.id)]
        if user.is_director:
            eligibility.append(P2PRequest.project_type.in_(tuple(PO_APPROVAL_ROLE_SETS)))
        if user.is_purchase_head or user.is_director or user.is_md:
            eligibility.append(P2PRequest.project_type.is_(None))
        if not eligibility:
            return []
        query = query.filter(or_(*eligibility))
    elif not _is_purchase_team(user):
        if _is_po_approver(user):
            # A pure PO approver (purchase_head/director/md without "purchase"
            # app access) needs to see their PO Approval history, not just the
            # pending queue — the po-approval page's Approved/Rejected/All
            # tabs filter this same result set client-side by exact status,
            # so restricting the query to "po_raised" here made those tabs
            # always render empty for such users.
            query = query.filter(P2PRequest.status.in_(
                ("po_raised", "po_approved", "partially_received", "received", "closed", "rejected")
            ))
        else:
        # Requesters see their own history; an assigned department/project/
        # plant head also sees PRs routed to them for approval — regardless
        # of other filters.
            query = query.filter(
                (P2PRequest.requested_by_id == user.id)
                | (P2PRequest.approver_id == user.id)
                | (P2PRequest.project_head_id == user.id)
                | (P2PRequest.plant_head_id == user.id)
                | P2PRequest.approvals.any(P2PRequestApproval.approver_id == user.id)
                | P2PRequest.po_approvers.any(P2PRequestPOApprover.approver_id == user.id)
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


_PR_LOCKED_FIELDS = {
    "status", "approver_id", "approver_name", "project_head_id", "project_head_name",
    "plant_head_id", "plant_head_name", "project_type", "approvers",
}


@router.patch("/{pr_id}", response_model=P2PRequestResponse)
async def update_p2p_request(
    pr_id: int,
    payload: P2PRequestUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    # Status and the approver slots used to be editable here, which let any
    # purchase user jump a PR straight to 'po_approved' (skipping Purchase
    # Head / Director / MD) or swap themselves in as a head mid-flow. Status
    # now only moves through the dedicated transition endpoints, and heads
    # are fixed at creation — reject those keys explicitly rather than
    # silently dropping them, so a caller knows the change didn't happen.
    blocked = sorted(set(payload.model_extra or {}) & _PR_LOCKED_FIELDS)
    if blocked:
        raise HTTPException(
            status_code=400,
            detail=f"{', '.join(blocked)} can't be edited directly — status only changes through approve/reject/cancel/close, and approvers are fixed when the requisition is raised.",
        )

    pr = _get_pr_or_404(db, pr_id)
    updates = payload.model_dump(exclude_unset=True, exclude=set(payload.model_extra or {}))

    for field, val in updates.items():
        setattr(pr, field, val)

    if updates:
        _write_audit(db, pr.id, "updated", user, summary=f"{user.name or user.email} updated P2P request {pr.p2p_number}.")

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)




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

    # An approval comment is mandatory (2026-09-30) — it's the approver's
    # recorded reasoning on the requisition's approval trail. Applies to the
    # admin override too. Rejections keep their own separate reason field.
    comment = (payload.comment or "").strip()
    if not comment:
        raise HTTPException(status_code=400, detail="Add a comment before approving — it is recorded on the requisition's approval trail.")
    payload.comment = comment

    roles = _check_approve_access(pr, user)
    now = datetime.now(timezone.utc)
    comment_note = f" Comment: {payload.comment}"

    def _stamp(role: str) -> None:
        if pr.approvals:
            row = next(a for a in pr.approvals if a.role == role)
            row.approved_at = now
            if payload.comment:
                row.comment = payload.comment
        else:
            setattr(pr, f"{role}_approved_at", now)
            if payload.comment:
                setattr(pr, f"{role}_comment", payload.comment)

    if roles is not None:
        for role in roles:
            _stamp(role)
        role_labels = " & ".join(P2P_ROLE_LABELS.get(role, role) for role in roles)
        _write_audit(db, pr.id, "approved", user,
                     summary=f"{user.name or user.email} approved P2P request {pr.p2p_number} as {role_labels}.{comment_note}")
    elif user.role == "admin" and pr.pending_approval_roles:
        # Admin override: signs off every still-pending slot at once.
        for pending_role in list(pr.pending_approval_roles):
            _stamp(pending_role)
        _write_audit(db, pr.id, "approved", user,
                     summary=f"{user.name or user.email} approved P2P request {pr.p2p_number} (admin override).{comment_note}")

    if not pr.pending_approval_roles:
        old_status = pr.status
        pr.status = "approved"
        pr.approved_by_id = user.id
        pr.approved_at = now
        _write_audit(db, pr.id, "approved", user, summary=f"{user.name or user.email} approved P2P request {pr.p2p_number}.",
                     old_status=old_status, new_status="approved")
        # Stock may have moved since creation — re-check and auto-route:
        # out-of-stock lines go to procurement (the RFQ covers exactly
        # them), available lines wait for the buyer to issue from stock.
        _route_lines_on_approval(db, pr, user)
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
    # Locks the PR row so two approvers clicking at the same moment can't
    # both stamp the any-one approval.
    pr = _get_pr_or_404(db, pr_id, for_update=True)
    if pr.status != "po_raised":
        raise HTTPException(status_code=409, detail=f"Only a PO raised request can be approved (current status: {pr.status})")

    # Same rule as PR approval: the approver's comment is mandatory.
    comment = (payload.comment or "").strip()
    if not comment:
        raise HTTPException(status_code=400, detail="Add a comment before approving — it is recorded on the requisition's approval trail.")
    payload.comment = comment

    now = datetime.now(timezone.utc)

    if pr.project_type in PO_APPROVAL_ROLE_SETS:
        # Manager matrix: ALL roles must approve (production_manager,
        # purchase_manager, project_manager, director). Named roles are
        # picked persons; director is any ONE of the directors.
        named_role = next((a.role for a in pr.po_approvers if a.approver_id == user.id), None)
        is_director = user.is_director

        if not named_role and not is_director:
            names = ", ".join(f"{a.approver_name} ({P2P_ROLE_LABELS.get(a.role, a.role)})" for a in pr.po_approvers)
            who = f" ({names})" if names else ""
            raise HTTPException(status_code=403, detail=f"Only the PO approvers picked on this requisition{who} or a Director can approve this PO.")

        # Stamp the appropriate role approval
        if named_role:
            approver_row = next(a for a in pr.po_approvers if a.role == named_role)
            approver_row.approved_at = now
            approver_row.approved_by_id = user.id
            approver_row.approved_by_name = user.name or user.email
            approver_row.comment = payload.comment
            role_label = P2P_ROLE_LABELS.get(named_role, named_role)
        else:
            pr.director_po_approved_at = now
            pr.director_po_approved_by_id = user.id
            pr.director_po_approved_by_name = user.name or user.email
            pr.director_po_comment = payload.comment
            role_label = "Director"

        _write_audit(db, pr.id, "po_role_approved", user,
                     summary=f"{user.name or user.email} approved PO for {pr.p2p_number} as {role_label}.")

        # Check if ALL roles are now approved
        if not pr.pending_po_approval_roles:
            pr.status = "po_approved"
            _write_audit(db, pr.id, "po_fully_approved", user,
                         summary=f"PO for {pr.p2p_number} received all required approvals (final approval by {user.name or user.email} as {role_label}).",
                         old_status="po_raised", new_status="po_approved")
            if pr.requested_by_id:
                notify_user(
                    db, user_id=pr.requested_by_id,
                    title="Purchase Order Fully Approved",
                    message=f"The PO for your PR '{pr.p2p_number}' has received all required approvals and is now active.",
                    notification_type="p2p_po_approved", entity_type="p2p_request", entity_id=pr.id,
                )
    else:
        # Legacy chain (pre-matrix PRs): every one of Purchase Head, Director
        # and MD must stamp their own slot.
        roles = _check_po_approve_access(pr, user)
        for role in roles:
            setattr(pr, f"{role}_approved_at", now)
            setattr(pr, f"{role}_approved_by_name", user.name or user.email)
            if payload.comment:
                setattr(pr, f"{role}_comment", payload.comment)
        role_labels = " & ".join(P2P_ROLE_LABELS.get(role, role) for role in roles)
        _write_audit(db, pr.id, "po_approved", user,
                     summary=f"{user.name or user.email} approved PO for {pr.p2p_number} as {role_labels}.")

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
    if pr.status not in ("submitted", "approved", "po_raised"):
        raise HTTPException(status_code=409, detail=f"Cannot reject a PR with status '{pr.status}'")
    role = _check_po_reject_access(pr, user) if pr.status == "po_raised" else _check_reject_access(pr, user)

    old_status = pr.status
    pr.status = "rejected"
    pr.rejected_reason = payload.reason
    pr.rejected_by_role = role
    pr.rejected_by_name = user.name or user.email
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


def _get_pr_item_or_404(pr: P2PRequest, item_id: int) -> P2PRequestItem:
    for item in pr.items:
        if item.id == item_id:
            return item
    raise HTTPException(status_code=404, detail="P2P request item not found on this PR")


def _match_store_item(db: Session, item: P2PRequestItem) -> StoreItem | None:
    """Matches a free-text PR item to the store item master by name, and by
    part code too when the PR item has one — see plan doc for why name-only
    matching was rejected (too many false positives)."""
    query = db.query(StoreItem).filter(StoreItem.item_name.ilike(item.item_name))
    if item.part_code:
        query = query.filter(
            (StoreItem.part_number.ilike(item.part_code)) | (StoreItem.manufacturer_part_number.ilike(item.part_code))
        )
    return query.first()


def _stock_balance_info(db: Session, item_id: int, location_id: int | None = None) -> P2PRequestItemStockLocationInfo:
    query = db.query(StoreStockBalance).filter(StoreStockBalance.item_id == item_id)
    if location_id is not None:
        query = query.filter(StoreStockBalance.location_id == location_id)
    balances = query.all()
    on_hand = sum(b.on_hand_qty for b in balances)
    reserved = sum(b.reserved_qty for b in balances)
    location_name = None
    if location_id is not None:
        location = db.query(StoreLocation).filter(StoreLocation.id == location_id).first()
        location_name = location.name if location else None
    return P2PRequestItemStockLocationInfo(
        location_id=location_id, location_name=location_name,
        on_hand_qty=on_hand, reserved_qty=reserved, available_qty=on_hand - reserved,
    )


def _refresh_stock_snapshot(db: Session, items: list[P2PRequestItem]) -> dict[str, list[P2PRequestItem]]:
    """Re-runs the automatic store-stock check on every still-pending line
    and stores the result on the line (stock_status / stock_available_qty /
    stock_checked_at). Availability is summed across all warehouses, net of
    reservations. Returns the pending lines bucketed by outcome so callers
    can route or summarise them. Purely informational at creation time; the
    final-approval hook uses the buckets to auto-route out-of-stock lines to
    procurement."""
    now = datetime.now(timezone.utc)
    buckets: dict[str, list[P2PRequestItem]] = {"in_stock": [], "partial": [], "not_in_stock": [], "no_match": []}
    for item in items:
        # A just-created, not-yet-flushed row still has fulfillment_status
        # None (the column default fires at INSERT) — that's a pending line.
        if item.fulfillment_status not in (None, "pending"):
            continue
        store_item = _match_store_item(db, item)
        if not store_item:
            item.stock_status = "no_match"
            item.stock_available_qty = None
        else:
            available = max(_stock_balance_info(db, store_item.id).available_qty, 0.0)
            item.stock_available_qty = available
            if available >= item.quantity:
                item.stock_status = "in_stock"
            elif available > 0:
                item.stock_status = "partial"
            else:
                item.stock_status = "not_in_stock"
        item.stock_checked_at = now
        buckets[item.stock_status].append(item)
    return buckets


def _route_lines_on_approval(db: Session, pr: P2PRequest, user: User) -> None:
    """Runs when the PR reaches 'approved': re-checks store stock (it may
    have moved since creation) and routes each pending line — lines with no
    stock (or no Item Master match) go straight to procurement so the RFQ
    covers exactly them; fully-available lines wait for the buyer to issue
    them from stock (stock is never moved without a person); partial lines
    are left for the buyer to split. Notifies the assigned buyer with the
    outcome."""
    buckets = _refresh_stock_snapshot(db, pr.items)
    to_procure = buckets["not_in_stock"] + buckets["no_match"]
    for item in to_procure:
        item.fulfillment_status = "sent_to_procurement"

    total_pending = sum(len(v) for v in buckets.values())
    if total_pending == 0:
        return

    parts = []
    if to_procure:
        parts.append(f"{len(to_procure)} line(s) not in store — sent to procurement for RFQ")
    if buckets["in_stock"]:
        parts.append(f"{len(buckets['in_stock'])} line(s) fully available in store — issue from stock")
    if buckets["partial"]:
        parts.append(f"{len(buckets['partial'])} line(s) partially available — decide split")
    summary = "; ".join(parts)
    _write_audit(db, pr.id, "stock_checked", user,
                 summary=f"Automatic store-stock check on approval of {pr.p2p_number}: {summary}.")

    if pr.assigned_buyer_id:
        if not to_procure and not buckets["partial"]:
            message = f"PR '{pr.p2p_number}' is approved and every line is available in store stock — issue from stock; no RFQ is needed."
        else:
            message = f"PR '{pr.p2p_number}' is approved. {summary}."
        notify_user(
            db, user_id=pr.assigned_buyer_id,
            title="PR Approved — Stock Check Result",
            message=message,
            notification_type="p2p_stock_routing", entity_type="p2p_request", entity_id=pr.id,
        )


def _pr_store_manager_id(pr: P2PRequest) -> int | None:
    return next((a.approver_id for a in pr.approvals if a.role == "store_manager"), None)


def _check_can_issue(pr: P2PRequest, user: User) -> None:
    """Issuing from store stock is the job of the Store Manager picked on
    this PR (the store holds and hands over the material). Admins may too."""
    if user.role == "admin" or _pr_store_manager_id(pr) == user.id:
        return
    raise HTTPException(status_code=403, detail="Only the Store Manager picked on this requisition can issue its items from store stock.")


@router.get("/{pr_id}/items/{item_id}/stock-check", response_model=P2PRequestItemStockCheckResponse)
async def check_item_stock(
    pr_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Manual, per-item lookup a buyer runs on an approved PR to see whether
    the requested item is already sitting in store stock before deciding to
    raise a purchase for it — see issue_item_from_stock / send_item_to_procurement
    for the two follow-up decisions."""
    pr = _get_pr_or_404(db, pr_id)
    if not (user.role == "admin" or "purchase" in user.get_apps() or _pr_store_manager_id(pr) == user.id):
        raise HTTPException(status_code=403, detail="Only the Purchase team or this requisition's Store Manager can check its store stock.")
    if pr.status == "submitted" or pr.status in ("rejected", "cancelled"):
        raise HTTPException(status_code=409, detail=f"Stock can only be checked on an approved PR (current status: {pr.status})")
    item = _get_pr_item_or_404(pr, item_id)
    if item.fulfillment_status != "pending":
        raise HTTPException(status_code=409, detail=f"This item has already been decided ('{item.fulfillment_status}')")

    store_item = _match_store_item(db, item)
    if not store_item:
        message = (
            f"No store item found matching name '{item.item_name}' and part code '{item.part_code}'."
            if item.part_code else
            f"No store item found matching name '{item.item_name}'. (PR item has no part code to narrow the match.)"
        )
        return P2PRequestItemStockCheckResponse(matched=False, requested_qty=item.quantity, message=message)

    ship_to_location = None
    if item.ship_to:
        location = db.query(StoreLocation).filter(
            (StoreLocation.name.ilike(item.ship_to)) | (StoreLocation.code.ilike(item.ship_to))
        ).first()
        if location:
            ship_to_location = _stock_balance_info(db, store_item.id, location.id)

    location_ids = {
        b.location_id for b in db.query(StoreStockBalance).filter(StoreStockBalance.item_id == store_item.id).all()
    }
    locations = sorted(
        (info for info in (_stock_balance_info(db, store_item.id, loc_id) for loc_id in location_ids) if info.available_qty > 0),
        key=lambda info: info.available_qty, reverse=True,
    )

    return P2PRequestItemStockCheckResponse(
        matched=True,
        store_item_id=store_item.id,
        store_item_code=store_item.item_code,
        store_item_name=store_item.item_name,
        part_code_matched=bool(item.part_code),
        requested_qty=item.quantity,
        ship_to_location=ship_to_location,
        total_across_locations=_stock_balance_info(db, store_item.id),
        locations=locations,
    )


@router.post("/{pr_id}/items/{item_id}/issue-from-stock", response_model=P2PRequestResponse)
async def issue_item_from_stock(
    pr_id: int,
    item_id: int,
    payload: P2PRequestIssueFromStockPayload,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    comment = (payload.comment or "").strip()
    if not comment:
        raise HTTPException(status_code=400, detail="Add a comment before issuing — e.g. who received it or where it was handed over. It is recorded on the material issue and the requisition history.")
    pr = _get_pr_or_404(db, pr_id)
    _check_can_issue(pr, user)
    if pr.status == "submitted" or pr.status in ("rejected", "cancelled"):
        raise HTTPException(status_code=409, detail=f"An item can only be issued from stock on an approved PR (current status: {pr.status})")
    # Locks this specific PR-item row so two concurrent/double-clicked calls
    # against the same item can't both read fulfillment_status=='pending'
    # and both post a stock issue — only one can hold the lock at a time,
    # and the second sees the already-updated status once it gets in.
    item = db.query(P2PRequestItem).filter(
        P2PRequestItem.id == item_id, P2PRequestItem.p2p_request_id == pr.id,
    ).with_for_update().first()
    if not item:
        raise HTTPException(status_code=404, detail="P2P request item not found on this PR")
    if item.fulfillment_status != "pending":
        raise HTTPException(status_code=409, detail=f"This item has already been decided ('{item.fulfillment_status}')")
    if not db.query(StoreLocation).filter(StoreLocation.id == payload.location_id).first():
        raise HTTPException(status_code=404, detail="Store location not found")

    store_item = _match_store_item(db, item)
    if not store_item:
        raise HTTPException(status_code=404, detail=f"No store item found matching name '{item.item_name}'" + (f" and part code '{item.part_code}'" if item.part_code else ""))

    quantity = payload.quantity if payload.quantity is not None else item.quantity
    if quantity <= 0:
        raise HTTPException(status_code=422, detail="Quantity must be greater than zero")
    if quantity > item.quantity:
        raise HTTPException(status_code=422, detail=f"Quantity ({quantity}) cannot exceed the PR item's requested quantity ({item.quantity})")

    issue = StoreMaterialIssue(
        issue_number=generate_material_issue_number(db),
        location_id=payload.location_id,
        requested_by_id=pr.requested_by_id,
        project_or_work_order=pr.project_label,
        issue_date=date.today(),
        issued_by_id=user.id,
        remarks=f"Issued against P2P request {pr.p2p_number}, item '{item.item_name}'. {comment}",
        p2p_request_id=pr.id,
    )
    db.add(issue)
    db.flush()
    db.add(StoreMaterialIssueItem(issue_id=issue.id, item_id=store_item.id, quantity=quantity))

    try:
        post_stock_transaction(
            db, item_id=store_item.id, location_id=payload.location_id, transaction_type="issue",
            quantity=quantity, reference_type="p2p_request", reference_number=pr.p2p_number,
            created_by_id=user.id,
        )
    except ValueError as e:
        db.rollback()
        raise HTTPException(status_code=409, detail=str(e))

    # A partial issue splits the line: the issued part is fulfilled from
    # stock and only the shortfall goes to procurement (the PO draft orders
    # quantity - issued_qty).
    shortfall = item.quantity - quantity
    item.fulfillment_status = "sent_to_procurement" if shortfall > 0 else "stock_issued"
    item.issued_from_location_id = payload.location_id
    item.issued_qty = quantity
    item.material_issue_id = issue.id

    split_note = f" The remaining {shortfall:g} goes to procurement." if shortfall > 0 else " instead of purchasing it."
    _write_audit(db, pr.id, "item_issued_from_stock", user,
                 summary=f"{user.name or user.email} issued '{item.item_name}' (qty {quantity:g}) from store stock for {pr.p2p_number}.{split_note} Comment: {comment}")

    # A PR whose every line came out of store stock has nothing left to buy —
    # close it instead of leaving it waiting for an RFQ that will never come.
    if pr.status == "approved" and all(i.fulfillment_status == "stock_issued" for i in pr.items):
        pr.status = "closed"
        pr.closed_by_id = user.id
        pr.closed_at = datetime.now(timezone.utc)
        _write_audit(db, pr.id, "closed", user,
                     summary=f"{pr.p2p_number} closed automatically — every line was issued from store stock, nothing left to purchase.",
                     old_status="approved", new_status="closed")

    if pr.requested_by_id:
        notify_user(
            db, user_id=pr.requested_by_id,
            title="Item Issued from Stock",
            message=f"'{item.item_name}' on your PR '{pr.p2p_number}' was issued from existing store stock (issue '{issue.issue_number}') instead of being purchased.",
            notification_type="p2p_request_item_issued_from_stock", entity_type="p2p_request", entity_id=pr.id,
        )

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr)


@router.post("/{pr_id}/items/{item_id}/send-to-procurement", response_model=P2PRequestResponse)
async def send_item_to_procurement(
    pr_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    pr = _get_pr_or_404(db, pr_id)
    if pr.status == "submitted" or pr.status in ("rejected", "cancelled"):
        raise HTTPException(status_code=409, detail=f"This decision can only be made on an approved PR (current status: {pr.status})")
    item = _get_pr_item_or_404(pr, item_id)
    if item.fulfillment_status != "pending":
        raise HTTPException(status_code=409, detail=f"This item has already been decided ('{item.fulfillment_status}')")

    item.fulfillment_status = "sent_to_procurement"
    _write_audit(db, pr.id, "item_sent_to_procurement", user,
                 summary=f"{user.name or user.email} confirmed '{item.item_name}' is not in store stock and sent it to procurement for {pr.p2p_number}.")

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


class P2PRequestSetPOApproversPayload(BaseModel):
    po_approvers: dict[str, int] = Field(default_factory=dict)


@router.post("/{pr_id}/set-po-approvers", response_model=P2PRequestResponse)
async def set_po_approvers(
    pr_id: int,
    payload: P2PRequestSetPOApproversPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    """Set PO approvers before raising the PO — called from RFQ page."""
    pr = _get_pr_or_404(db, pr_id)
    if pr.status not in ("approved", "vendor_quotations", "technical_evaluation", "commercial_evaluation", "vendor_selected", "po_drafted"):
        raise HTTPException(status_code=409, detail=f"PO approvers can only be set before the PO is raised (current status: {pr.status})")

    try:
        po_approvers = resolve_po_approvers(db, pr.project_type, payload.po_approvers)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    db.query(P2PRequestPOApprover).filter(P2PRequestPOApprover.p2p_request_id == pr.id).delete()
    for role, approver in po_approvers.items():
        db.add(P2PRequestPOApprover(
            p2p_request_id=pr.id, role=role, approver_id=approver.id,
            approver_name=approver.name or approver.email,
        ))

    _write_audit(db, pr.id, "po_approvers_set", user,
                 summary=f"{user.name or user.email} set PO approvers for {pr.p2p_number}.")
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
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    # Locks the PR row for the rest of this request so a concurrent/
    # double-submitted create-PO call can't both pass the status check below
    # before either commits.
    pr = _get_pr_or_404(db, pr_id, for_update=True)
    if pr.status != "approved":
        raise HTTPException(status_code=409, detail=f"A PO can only be raised on an approved PR (current status: {pr.status})")
    if db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.po_number == payload.po_number).first():
        raise HTTPException(status_code=409, detail=f"PO number '{payload.po_number}' already exists")
    existing_po = db.query(P2PPurchaseOrder).filter(
        P2PPurchaseOrder.p2p_request_id == pr.id, P2PPurchaseOrder.status != "cancelled",
    ).first()
    if existing_po:
        raise HTTPException(status_code=409, detail=f"PR '{pr.p2p_number}' already has a PO ('{existing_po.po_number}') — cancel it first to raise a new one")

    # Items already fulfilled from existing store stock (see
    # issue_item_from_stock above) aren't purchased — they're excluded from
    # the PO entirely.
    procurable_items = [i for i in pr.items if i.fulfillment_status != "stock_issued"]

    # Per-line pricing (see P2PRequestCreatePOItemPricing) is what derives
    # the PO's total — payload.po_value is ignored, so this total is grounded
    # in real quantities/prices rather than an arbitrary typed-in number (see
    # check_three_way_match in accounts/service.py, which matches against
    # these line prices for AP's 3-way match).
    pricing_by_item_id = {p.pr_item_id: p for p in payload.item_pricing}
    computed_total = 0.0
    line_pricing: list[tuple[float | None, float | None, float | None]] = []  # (unit_price, tax_rate, line_total) per procurable_items entry
    for item in procurable_items:
        pricing = pricing_by_item_id.get(item.id)
        unit_price = pricing.unit_price if pricing else None
        tax_rate = pricing.tax_rate if pricing else None
        line_total = compute_line_total(item.quantity, unit_price, tax_rate)
        if line_total is not None:
            computed_total += line_total
        line_pricing.append((unit_price, tax_rate, line_total))
    # Every line must be priced — the approvers sign off on this value, and
    # AP's 3-way match pays against it, so a typed-in lump sum (or nothing)
    # isn't acceptable.
    unpriced = [item.item_name for item, (unit_price, _t, _l) in zip(procurable_items, line_pricing) if unit_price is None or unit_price <= 0]
    if unpriced:
        raise HTTPException(
            status_code=400,
            detail=f"Enter a unit price for every line before raising the PO — missing: {', '.join(unpriced)}.",
        )
    po_value = round(computed_total, 2)

    old_status = pr.status
    pr.po_number = payload.po_number
    pr.po_date = payload.po_date or date.today()
    pr.po_value = po_value
    pr.expected_delivery = payload.expected_delivery
    pr.ordered_quantity = payload.ordered_quantity if payload.ordered_quantity is not None else sum(i.quantity for i in procurable_items)
    pr.status = "po_raised"

    # The PR's po_* fields above are a denormalized snapshot for quick display;
    # this linked P2PPurchaseOrder is the real record — see
    # docs/product/PURCHASE_DEPARTMENT_MODULE_PLAN.md Phase 2.
    po = P2PPurchaseOrder(
        po_number=payload.po_number,
        p2p_request_id=pr.id,
        vendor_name=pr.selected_vendor,
        status="issued",
        po_date=pr.po_date,
        expected_delivery=pr.expected_delivery,
        created_by_id=user.id,
        total_value=po_value,
    )
    db.add(po)
    db.flush()
    for item, (unit_price, tax_rate, line_total) in zip(procurable_items, line_pricing):
        db.add(P2PPurchaseOrderItem(
            purchase_order_id=po.id,
            item_name=item.item_name,
            make=item.make,
            part_code=item.part_code,
            unit=item.unit,
            quantity=item.quantity,
            unit_price=unit_price,
            tax_rate=tax_rate,
            line_total=line_total,
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

    for approver, role in po_approver_users(db, pr):
        notify_user(
            db, user_id=approver.id,
            title="Purchase Order Awaiting Approval",
            message=f"PO '{payload.po_number}' for PR '{pr.p2p_number}' awaits your approval as {P2P_ROLE_LABELS.get(role, role)}.",
            notification_type="p2p_po_approval_pending", entity_type="p2p_request", entity_id=pr.id,
        )

    db.commit()
    db.refresh(pr)
    background_tasks.add_task(_send_p2p_po_approval_emails_background, pr.id)
    return _to_response(db, pr)


# Receiving used to be a single flat "update-receipt" call directly on the
# PR (no line items, no quality inspection). Replaced by the proper
# per-PO, per-line-item Goods Receipt flow — see
# app/modules/p2p/routes/goods_receipts.py — which writes back onto this
# PR's ordered_quantity/received_quantity/receipt_status/grn_number fields
# once a receipt is quality-inspected, so /close's status gate below still
# works unchanged.


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


@router.get("/{pr_id}/attachments/{attachment_id}/content")
async def get_p2p_attachment_content(
    pr_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    """Raw bytes for in-app preview, fetched via the app-only Graph token —
    never the raw SharePoint webUrl."""
    pr = _get_pr_or_404(db, pr_id)
    if not _is_purchase_team(user) and pr.requested_by_id != user.id:
        raise HTTPException(status_code=403, detail="You may only view attachments on your own P2P requests")

    attachment = db.query(P2PRequestAttachment).filter(
        P2PRequestAttachment.id == attachment_id, P2PRequestAttachment.p2p_request_id == pr_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")

    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, attachment.sharepoint_path or "")
    return Response(
        content=content,
        media_type=attachment.content_type or content_type,
        headers={"Content-Disposition": f'inline; filename="{attachment.filename}"'},
    )


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
