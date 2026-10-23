from datetime import date, datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.responses import Response
from sqlalchemy import or_
from sqlalchemy.orm import Session, object_session, selectinload

from app.core import assignee_rules
from app.core.config import settings
from app.core.permission_registry import can_feature, can_perform, can_view_tab
from app.core.permissions import GRANT_HINT, ensure_can_delete, ensure_feature_action, ensure_tab_action, require_app_access
from app.db.session import get_db, SessionLocal
from app.modules.main.models.user import User
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.routes.auth import get_current_user
from app.modules.erp.models.project import Project
from app.modules.p2p.models.p2p_request import (
    P2PRequest, P2P_REQUEST_STATUSES, P2P_CATEGORIES, P2P_REQUIREMENT_TYPES, resolve_auto_buyer_id,
    PO_APPROVAL_ROLE_SETS, P2P_ROLE_FLAGS, P2P_ROLE_LABELS, P2P_PO_APPROVER_FLAGS, P2P_PROJECT_TYPES,
    P2P_EDITABLE_STATUSES, P2P_PURPOSES,
)
from app.modules.p2p import purpose as pr_purpose
from app.modules.p2p.models.p2p_request_approval import P2PRequestApproval
from app.modules.p2p.models.p2p_request_po_approver import P2PRequestPOApprover
from app.modules.p2p.item_link import item_category_for, item_snapshot, purchasable_item
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.p2p_request_attachment import P2PRequestAttachment, P2P_ATTACHMENT_DOC_TYPES
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder, P2PPurchaseOrderItem
from app.modules.p2p.models.rfq import RFQ
from app.modules.erp.models.service_material import ServiceMaterial
from app.modules.p2p.schemas.p2p_request import (
    P2PRequestApprovalResponse,
    P2PRequestCreate,
    P2PRequestEdit,
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
from app.modules.p2p.service import generate_p2p_number, compute_line_total, active_partners
from app.modules.p2p.models.p2p_request import SETTINGS_SCHEME, ENGINE_SCHEME
from app.modules.p2p import approvals as p2p_approvals
# Registers the Order Project hooks (PO/GRN line inheritance, 360 "purchase" column).
from app.modules.p2p import order_project_links
from app.modules.p2p.access import ensure_pr_in_scope, scope_prs
from app.modules.p2p.pricing import mask_for
from app.modules.organization.services import approval_engine as engine
from app.core.notify_rules import fire_rule
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
BUYER_RULE_KEY = "p2p:purchase_requisitions.buyer"  # core/assignee_rules.PICKERS

_PR_APPROVAL_SLOT_LABELS = (("approver_id", "Department Head"), ("project_head_id", "Project Head"), ("plant_head_id", "Plant Head"))
# Role key -> User flag for every PO approval role: the manager-matrix roles
# plus the legacy Purchase Head -> Director -> Partner chain that in-flight PRs
# (project_type is NULL) still finish on.
_PO_APPROVAL_ROLE_FLAGS = {"purchase_head": "is_purchase_head", "director": "is_director", "partner": "is_partner", **P2P_ROLE_FLAGS}


def po_approver_users(db: Session, pr: "P2PRequest") -> list[tuple["User", str]]:
    """Everyone a PR's PO goes to, as (user, role) — one entry per person.
    Matrix PRs: the people picked per role on the New PR form plus every
    Director. Legacy PRs: holders of their still-pending chain role flags."""
    out: dict[int, tuple[User, str]] = {}
    if pr.approval_scheme == SETTINGS_SCHEME:
        # Level 1 (Settings PO approvers) first; the Partners only once they are all done.
        pending_rows = [a for a in pr.po_approvers if a.approved_at is None]
        if pending_rows:
            for row in pending_rows:
                u = db.query(User).filter(User.id == row.approver_id, User.is_active == True).first()  # noqa: E712
                if u:
                    out.setdefault(u.id, (u, row.role))
        elif pr.partner_approved_at is None:
            for u in active_partners(db):
                out.setdefault(u.id, (u, "partner"))
    elif pr.project_type in PO_APPROVAL_ROLE_SETS:
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
        elif pr.approval_scheme == ENGINE_SCHEME:
            # The approval engine's current stage (Organization › Approval Workflows).
            slots = [(u.id, stage) for u, stage in p2p_approvals.pending_approvers(db, p2p_approvals.pr_request(db, pr.id))]
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
    role (purchase head / director / Partner), run after the PO has already been
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
        if pr.approval_scheme == ENGINE_SCHEME:
            people = p2p_approvals.pending_approvers(db, engine.latest_request(db, p2p_approvals.PO_ENTITY, po.id))
        else:
            people = po_approver_users(db, pr)
        for approver, role in people:
            await send_p2p_po_approval_email(db, pr, po, approver, P2P_ROLE_LABELS.get(role, role))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


# RBAC (2026-10-08) — how the Permission Matrix and approver routing combine:
#   * The matrix decides whether a user may open requisitions at all: 'View' on
#     Procurement › Purchase Requisitions (or › Purchase Orders, for PO
#     approvers who open the PR to see the PO they sign). Deny by default —
#     being named as an approver no longer grants access by itself.
#   * Routing stays the authority on WHICH requisitions a user approves: the
#     central approval engine (Organization › Approval Workflows, see
#     app/modules/p2p/approvals.py) for everything submitted since 2026-10-08,
#     and — for items already in flight then — the old Settings / matrix-picked
#     approvers and Director / Purchase Head / Partner flags. A named PR approver
#     approves/rejects with purchase_requisitions:view only, and a PO approver
#     with purchase_orders:view only — approvers are chosen per PR, so also
#     demanding the matrix 'Approve' box would block legitimate named
#     approvers. 'approve'/'reject' grants are used only where there is no
#     named routing (the legacy no-approvers-assigned PR, RFQ evaluations).
#   * Working a PR (edit/buyer/stock decisions), creating, exporting,
#     importing and deleting use the matching tab action on top of the
#     existing purchase-team / requester checks; resubmitting a returned PR
#     needs 'Submit' and cancelling one needs 'Cancel'.
#   * Data scope (core/data_scope.py, registrations in p2p/access.py) narrows
#     every list and record on top of those checks.

def _can_view_prs(user: User) -> bool:
    return can_view_tab(user, "p2p", "purchase_requisitions")


def _can_view_pos(user: User) -> bool:
    return can_view_tab(user, "p2p", "purchase_orders")


def _requester_or_purchase(user: User = Depends(get_current_user)) -> User:
    """Who may call the requisition routes at all: 'View' on Procurement ›
    Purchase Requisitions or › Purchase Orders (admins always). Per-route
    logic below narrows what each actually gets to see/do (a requester sees
    their own PRs, an approver only PRs routed to them — see
    list_p2p_requests / _check_view_access)."""
    if _can_view_prs(user) or _can_view_pos(user):
        return user
    raise HTTPException(
        status_code=403,
        detail="You don't have 'View' permission on Procurement › Purchase Requisitions (or › Purchase Orders), so you "
               f"can't open requisitions — even ones you are named to approve. {GRANT_HINT}",
    )


def _ensure_pr_view(user: User) -> None:
    ensure_tab_action(user, "p2p", "purchase_requisitions", "view")


def _ensure_pr_action(user: User, action: str) -> None:
    ensure_tab_action(user, "p2p", "purchase_requisitions", action)


# Features of the Purchase Requisitions tab (core/features/p2p.py). PO
# approvers reach requisitions through Purchase Orders › View alone (see
# _requester_or_purchase); the PR tab's features don't govern them, so a
# viewer without PR-tab View passes these and gets the PO tab's price switch.
def _sees_pr_feature(user: User, feature: str, action: str) -> bool:
    if not _can_view_prs(user):
        return True
    return can_feature(user, "p2p", "purchase_requisitions", feature, action)


def _price_tab(user: User) -> str:
    return "purchase_requisitions" if _can_view_prs(user) else "purchase_orders"


def _is_purchase_team(user: User) -> bool:
    return "purchase" in user.get_apps()


def _is_po_approver(user: User) -> bool:
    """Holders of a company-wide PO approval flag (Director / Partner /
    Purchase Head) — the only people who may see every PO-stage PR.
    Department managers (store/design/R&D/production/...) are NOT: on matrix
    PRs they approve only POs they were picked on, and get access to those
    through their P2PRequestPOApprover rows."""
    return any(getattr(user, flag, False) for flag in P2P_PO_APPROVER_FLAGS)


def _write_audit(db: Session, pr_id: int, action: str, user: User, summary: str | None = None,
                  old_status: str | None = None, new_status: str | None = None):
    db.add(AuditLog(
        entity_type="p2p_request", entity_id=pr_id, action=action, performed_by_id=user.id,
        summary=summary, old_value=old_status, new_value=new_status,
    ))


def _latest_po_response(db: Session, pr: P2PRequest):
    """The PR's latest non-cancelled PO with its lines, for approvers who
    can't call /p2p/purchase-orders (that needs the 'purchase' app)."""
    from app.modules.p2p.schemas.purchase_order import P2PPurchaseOrderResponse
    po = db.query(P2PPurchaseOrder).options(selectinload(P2PPurchaseOrder.items)).filter(
        P2PPurchaseOrder.p2p_request_id == pr.id, P2PPurchaseOrder.status != "cancelled",
    ).order_by(P2PPurchaseOrder.id.desc()).first()
    if not po:
        return None
    return P2PPurchaseOrderResponse.model_validate(po).model_copy(update={"p2p_request_number": pr.p2p_number})


# Statuses at which a list row needs the live engine approval (inline
# Approve/Reject, "waiting for me") — other rows skip those queries.
_LIVE_APPROVAL_STATUSES = ("submitted", "returned", "po_drafted", "po_raised")


def _apply_account_assignment(db: Session, pr: P2PRequest, payload) -> None:
    """PR account assignment FKs (p2p/account_assignment.py) — 422 with the fix."""
    from app.modules.p2p.account_assignment import apply
    try:
        apply(db, pr, payload.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


def _to_response(db: Session, pr: P2PRequest, *, include_po: bool = False, user: User | None = None,
                 with_approval: bool = False) -> P2PRequestResponse:
    resp = P2PRequestResponse.model_validate(pr)
    if include_po:
        resp.purchase_order = _latest_po_response(db, pr)
    if user is not None and (with_approval or pr.status in _LIVE_APPROVAL_STATUSES):
        # The central approval engine's view of this requisition (PR stage or
        # its PO) for the viewer — None for items still on the old path.
        resp.engine_approval = p2p_approvals.approval_info(db, pr, user)
    resp.category_label = P2P_CATEGORIES.get(pr.category_code, pr.category_code)
    from app.modules.p2p.account_assignment import label_for
    resp.account_assignment_label = label_for(db, pr)
    if pr.order_project_id:
        from app.modules.sales.models.order_project import OrderProject
        op = db.get(OrderProject, pr.order_project_id)
        resp.order_project_number = op.op_number if op is not None else None
    resp.approvals = [
        P2PRequestApprovalResponse.model_validate(a).model_copy(update={"role_label": P2P_ROLE_LABELS.get(a.role, a.role)})
        for a in pr.approvals
    ]
    if pr.approval_scheme == SETTINGS_SCHEME:
        # Level 1: the Settings PO approvers (snapshotted when the PO goes for
        # approval); level 2: any one Partner.
        resp.po_approval_role_labels = ["PO Approver"] * len(pr.po_approvers) + ["Partner (any one)"]
        partners = [{"id": u.id, "name": u.name or u.email} for u in active_partners(db)]
        resp.po_approval_panel = [
            {
                "role": a.role, "role_label": "PO Approver",
                "people": [{"id": a.approver_id, "name": a.approver_name}],
                "approved_at": a.approved_at.isoformat() if a.approved_at else None,
                "approved_by_name": a.approved_by_name, "comment": a.comment,
            }
            for a in pr.po_approvers
        ] + [{
            "role": "partner", "role_label": "Partner (any one)", "people": partners,
            "approved_at": pr.partner_approved_at.isoformat() if pr.partner_approved_at else None,
            "approved_by_name": pr.partner_approved_by_name, "comment": pr.partner_comment,
        }]
    elif pr.project_type in PO_APPROVAL_ROLE_SETS:
        resp.po_approval_role_labels = [P2P_ROLE_LABELS[r] for r in PO_APPROVAL_ROLE_SETS[pr.project_type]]
        # Each entry carries its own approval state so the panel can show a
        # per-role Approved/Pending pill — ALL of these must approve.
        picked = [
            {
                "role": a.role, "role_label": P2P_ROLE_LABELS.get(a.role, a.role),
                "people": [{"id": a.approver_id, "name": a.approver_name}],
                "approved_at": a.approved_at.isoformat() if a.approved_at else None,
                "approved_by_name": a.approved_by_name, "comment": a.comment,
            }
            for a in pr.po_approvers
        ]
        directors = [{"id": u.id, "name": u.name or u.email} for u in db.query(User).filter(User.is_active == True, User.is_director == True).all()]  # noqa: E712
        resp.po_approval_panel = picked + [{
            "role": "director", "role_label": "Director", "people": directors,
            "approved_at": pr.director_po_approved_at.isoformat() if pr.director_po_approved_at else None,
            "approved_by_name": pr.director_po_approved_by_name, "comment": pr.director_po_comment,
        }]
    if pr.po_approved_role:
        resp.po_approved_role_label = P2P_ROLE_LABELS.get(pr.po_approved_role, pr.po_approved_role)
    if user is not None and with_approval:
        reason = _edit_block_reason(db, pr, user)
        resp.can_edit = reason is None
        # Only the people who could otherwise edit it need to be told why not.
        if reason and (pr.requested_by_id == user.id or _is_purchase_team(user)):
            resp.edit_block_reason = reason
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
    if user is not None:
        # Purchase Requisitions › Prices & PO values (PO approvers: the PO tab's switch).
        mask_for(user, _price_tab(user), resp)
    return resp


def _get_pr_or_404(db: Session, pr_id: int, *, for_update: bool = False, user: User | None = None) -> P2PRequest:
    """The requisition (404 if missing); with `user`, also 403 when it is
    outside their Procurement data scope."""
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
    if user is not None:
        ensure_pr_in_scope(db, user, pr)
    return pr


def _can_see_po_commercials(pr: P2PRequest, user: User) -> bool:
    """Whether the PR detail may carry the full PO (vendor, unit prices, tax,
    line totals). Only the people who buy or approve it see vendor commercial
    terms: Purchase, admins, company-wide PO approvers (Director / Partner /
    Purchase Head) and the PO approvers picked on this PR. The requester and
    the PR-stage heads see the requisition, not the vendor's prices."""
    if user.role == "admin" or _is_purchase_team(user) or _is_po_approver(user):
        return True
    if any(a.approver_id == user.id for a in pr.po_approvers):
        return True
    # PO approvers through the engine (incl. delegates / escalation targets).
    db = object_session(pr)
    if db is None:
        return False
    is_po_party = db.query(P2PRequest.id).filter(
        P2PRequest.id == pr.id, P2PRequest.id.in_(p2p_approvals.po_engine_party_pr_ids(user)),
    ).first() is not None
    return is_po_party or p2p_approvals.can_act_now(db, user, pr)


def _check_view_access(pr: P2PRequest, user: User) -> None:
    if pr.status == "draft":
        # A draft is the requester's private working copy until submitted.
        if pr.requested_by_id == user.id or user.role == "admin":
            return
        raise HTTPException(status_code=403, detail=f"{pr.p2p_number} is still a draft — only the person who raised it can open it until they submit it.")
    if _is_purchase_team(user) or _is_po_approver(user):
        return
    allowed = {pr.requested_by_id, pr.approver_id, pr.project_head_id, pr.plant_head_id}
    allowed.update(a.approver_id for a in pr.approvals)
    allowed.update(a.approver_id for a in pr.po_approvers)
    if user.id in allowed:
        return
    # Approvers of the requisition or its PO in the approval engine — and
    # their delegates / escalation targets while a step is open.
    db = object_session(pr)
    if db is not None and (
        db.query(P2PRequest.id).filter(P2PRequest.id == pr.id, P2PRequest.id.in_(p2p_approvals.engine_party_pr_ids(user))).first()
        or p2p_approvals.can_act_now(db, user, pr)
    ):
        return
    raise HTTPException(status_code=403, detail="You may only view your own P2P requests, or ones you are an approver of.")


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
        # No named approvers to route to — the decision falls to the purchase
        # team, so the matrix 'Approve' grant is what authorises it.
        _ensure_pr_action(user, "approve")
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
        # No named approvers — a purchase-team-wide decision needs the 'Reject' grant.
        _ensure_pr_action(user, "reject")
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
    if pr.approval_scheme == SETTINGS_SCHEME:
        row = next((a for a in pr.po_approvers if a.approver_id == user.id), None)
        if row:
            return row.role
        if user.is_partner:
            return "partner"
        raise HTTPException(status_code=403, detail="Only this PO's approvers (Procurement → Settings), a Partner or an admin can reject this PO.")
    if pr.project_type in PO_APPROVAL_ROLE_SETS:
        # Matrix PRs: the PO goes to the people picked on this PR plus every
        # Director — role flags are irrelevant (picked approvers needn't hold
        # them, and an unpicked flag-holder has no say on this PO).
        picked_role = next((a.role for a in pr.po_approvers if a.approver_id == user.id), None)
        if picked_role:
            return picked_role
        if user.is_director:
            return "director"
        names = ", ".join(f"{a.approver_name} ({P2P_ROLE_LABELS.get(a.role, a.role)})" for a in pr.po_approvers)
        who = f" — {names}" if names else ""
        raise HTTPException(status_code=403, detail=f"Only the PO approvers picked on this requisition{who}, a Director or an admin can reject this PO.")
    role_set = ("purchase_head", "director", "partner")
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
        "partner": user.is_partner,
    }
    roles = [role for role, enabled in role_flags.items() if enabled and role in pr.pending_po_approval_roles]
    if roles:
        return roles
    raise HTTPException(status_code=403, detail="You do not have a pending PO approval role for this request.")


@router.get("/meta")
async def get_meta(db: Session = Depends(get_db), _user: User = Depends(_requester_or_purchase)):
    # UOMs come from the Store item master's fixed list so a PR line's unit
    # matches store stock exactly — requesters usually lack the `store` app,
    # so the list is served here rather than from /store/items/meta.
    from app.modules.store.routes.uoms import uom_options
    return {
        "categories": [{"code": k, "label": v} for k, v in P2P_CATEGORIES.items()],
        "requirement_types": list(P2P_REQUIREMENT_TYPES),
        # Each purpose with the categories it offers and the pre-filled
        # category / requirement type (p2p/purpose.py PURPOSE_FORM).
        "purposes": [{"code": k, "label": v, "categories": list(pr_purpose.PURPOSE_FORM[k]["categories"]),
                      "default_category": pr_purpose.PURPOSE_FORM[k]["category"],
                      "default_requirement_type": pr_purpose.PURPOSE_FORM[k]["requirement_type"]}
                     for k, v in P2P_PURPOSES.items()],
        "statuses": list(P2P_REQUEST_STATUSES),
        "uoms": uom_options(db),
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
    _ensure_pr_action(user, "create")
    draft = payload.save_as_draft
    lines = _validate_pr_payload(db, payload, draft=draft)

    # Buyer is auto-assigned from the category — no manual "Assign Buyer"
    # step needed once the PR is raised.
    auto_buyer_id = resolve_auto_buyer_id(db, payload.category_code)

    pr = P2PRequest(
        p2p_number=generate_p2p_number(db, payload.category_code),
        category_code=payload.category_code,
        project_label=payload.project_label,
        purpose=payload.purpose,
        project_type=pr_purpose.project_type_for(payload.purpose) if payload.purpose else payload.project_type,
        approval_scheme=ENGINE_SCHEME,
        required_date=payload.required_date,
        requirement_type=payload.requirement_type,
        request_date=date.today(),
        department=user.department,
        requested_by_id=user.id,
        priority=payload.priority,
        assigned_buyer_id=auto_buyer_id,
        assignment_date=date.today() if auto_buyer_id else None,
        remarks=payload.remarks,
        status="draft" if draft else "submitted",
    )
    _apply_account_assignment(db, pr, payload)
    _default_label(pr)
    db.add(pr)
    db.flush()

    try:
        _sync_pr_lines(db, pr, lines, draft=draft)
    except HTTPException:
        # A line refused (e.g. its Order Project vehicle) — nothing is saved.
        db.rollback()
        raise

    if draft:
        _write_audit(db, pr.id, "draft_saved", user, summary=f"{user.name or user.email} saved P2P request {pr.p2p_number} as a draft.",
                     new_status="draft")
        db.commit()
        db.refresh(pr)
        return _to_response(db, pr, user=user)

    _write_audit(db, pr.id, "created", user, summary=f"{user.name or user.email} raised P2P request {pr.p2p_number}.", new_status="submitted")
    db.flush()

    # Into approval: the engine resolves the approvers, notifies them (bell +
    # Teams) and refuses with the exact reason when a stage has nobody — in
    # which case nothing is saved. With the workflow switched off the PR is
    # approved at once (and its lines routed).
    p2p_approvals.submit_pr(db, pr, user)

    fire_rule(db, background_tasks, "p2p", "pr_create", "New Purchase Requisition",
              f"PR '{pr.p2p_number}' was raised by {user.name or user.email} for {pr.project_label}.", "p2p_request", pr.id, user,
              _pr_details(pr, user))
    db.commit()
    db.refresh(pr)
    background_tasks.add_task(_send_p2p_pr_approval_emails_background, pr.id)
    return _to_response(db, pr, user=user)


def _default_label(pr: P2PRequest) -> None:
    """A requisition with no project still needs a display line in lists,
    notifications and the PO ("FOR ..."): the charged record's name (filled by
    the account assignment), else the purpose."""
    if not (pr.project_label or "").strip() and pr.purpose:
        pr.project_label = P2P_PURPOSES.get(pr.purpose)


def _validate_pr_payload(db: Session, payload: P2PRequestCreate, *, draft: bool, check_category: bool = True) -> list[tuple]:
    """Check a create/edit payload and return its lines as (payload line,
    Item Master row). A draft needs only a valid category and, per line it
    keeps, a real item and quantity — lines with no item picked yet are
    left out. Submitting needs everything."""
    if payload.category_code not in P2P_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Pick a valid Purchase Requisition category (got '{payload.category_code or 'none'}').")
    if payload.project_type and payload.project_type not in P2P_PROJECT_TYPES:
        raise HTTPException(status_code=400, detail="Project Type must be 'Existing project' or 'New project'.")
    if payload.purpose and payload.purpose not in P2P_PURPOSES:
        raise HTTPException(status_code=400, detail=f"Purpose must be one of: {', '.join(P2P_PURPOSES.values())}.")
    items = [i for i in payload.items if i.store_item_id] if draft else list(payload.items)
    if payload.purpose in pr_purpose.INHOUSE_ONLY:
        # Overhead buying is never for a customer project — every line is Inhouse.
        for i in items:
            i.project_inhouse = "Inhouse"
            i.order_project_element_id = None
    if not draft and not items:
        raise HTTPException(status_code=400, detail="Add at least one item line before submitting the requisition.")
    # Every line is an Item Master item (2026-10-11 — never a typed name) and
    # must say whether it's for the Project or Inhouse (2026-09-30) — Store
    # issue/consumption and reporting split on it downstream.
    lines = []
    for idx, item in enumerate(items, start=1):
        master = purchasable_item(db, item.store_item_id, f"Line {idx}")
        if not draft and item.project_inhouse not in ("Project", "Inhouse"):
            raise HTTPException(
                status_code=400,
                detail=f"Line {idx} ({master.item_code} {master.item_name}): choose Project or Inhouse.",
            )
        if not item.quantity or item.quantity <= 0:
            raise HTTPException(status_code=400, detail=f"Line {idx} ({master.item_code} {master.item_name}): quantity must be more than 0.")
        lines.append((item, master))

    if not draft and payload.purpose:
        problems = pr_purpose.header_problems(payload.purpose, payload.account_assignment, payload.project_label)
        # The category can't change once submitted (it is in the number), so
        # only a new / draft requisition's category is held to its purpose.
        if check_category:
            problems += [p for p in [pr_purpose.category_problem(payload.purpose, payload.category_code)] if p]
        if problems:
            raise HTTPException(status_code=400, detail=" ".join(problems))
    elif not draft:
        if not (payload.project_label or "").strip() and not getattr(payload, "account_assignment", None):
            raise HTTPException(status_code=400, detail="Project is required — pick the existing project, or give the new project's name.")
        if payload.project_type not in P2P_PROJECT_TYPES:
            raise HTTPException(status_code=400, detail="Choose whether this requisition is for an existing project or a new project.")
    # Who approves is decided by the central approval engine — the
    # "Purchase requisition" workflow in Organization › Approval Workflows
    # (seeded from the old Procurement › Settings PR approvers). Approver
    # names sent by older clients (`approvers` / `po_approvers`) are ignored.
    return lines


def _sync_pr_lines(db: Session, pr: P2PRequest, lines: list[tuple], *, draft: bool = False) -> None:
    """Make the PR's lines match `lines`: a payload line carrying the id of an
    existing line updates it in place (keeping its attachments), new ones are
    added, and existing lines not sent are removed. Every line goes back to
    'pending' fulfilment with a fresh store-stock snapshot, so the approvers
    see per line whether it's already sitting in store before they sign."""
    existing = {row.id: row for row in pr.items}
    kept: list[P2PRequestItem] = []
    linked: list[tuple] = []
    for idx, (item, master) in enumerate(lines, start=1):
        row = existing.pop(item.id, None) if item.id else None
        if row is None:
            row = P2PRequestItem(p2p_request_id=pr.id)
            pr.items.append(row)
        for field, value in item_snapshot(master).items():
            setattr(row, field, value)
        # Make comes from the Item Master only — a different brand is a
        # different item code, never a free-text override on the PR line.
        row.make = master.make
        row.quantity = item.quantity
        row.project_inhouse = item.project_inhouse
        row.ship_to = item.ship_to
        row.fulfillment_status = "pending"
        kept.append(row)
        linked.append((idx, item, master, row))
    # Order Project vehicle / lot per line (mandatory for project lines of a
    # PR charged to an order that has an Order Project).
    order_project_links.link_pr_lines(db, pr, linked, draft=draft)
    for row in existing.values():
        pr.items.remove(row)
    db.flush()
    _refresh_stock_snapshot(db, kept)


def _edit_block_reason(db: Session, pr: P2PRequest, user: User) -> str | None:
    """None when `user` may edit the requisition's content now; otherwise the
    reason, worded for the person who asked. Editable by the requester (or
    Purchase with 'Edit') until an RFQ is raised against it."""
    is_requester = pr.requested_by_id == user.id
    if not (is_requester or user.role == "admin" or (_is_purchase_team(user) and can_perform(user, "p2p", "purchase_requisitions", "edit"))):
        return "Only the person who raised this requisition (or Purchase, with 'Edit' on Procurement › Purchase Requisitions) can edit it."
    if pr.status not in P2P_EDITABLE_STATUSES:
        return (f"This requisition is {pr.status.replace('_', ' ')}, so it can no longer be edited — a requisition can only be "
                "changed until an RFQ is raised against it.")
    rfq = db.query(RFQ.rfq_number).filter(RFQ.p2p_request_id == pr.id).order_by(RFQ.id).first()
    if rfq:
        return (f"RFQ {rfq[0]} has been raised against this requisition, so it can no longer be edited. "
                "If the requirement has changed, ask the buyer to cancel this requisition and raise a new one.")
    po = db.query(P2PPurchaseOrder.po_number).filter(
        P2PPurchaseOrder.p2p_request_id == pr.id, P2PPurchaseOrder.status != "cancelled").first()
    if po:
        return f"Purchase order {po[0]} already exists for this requisition, so it can no longer be edited."
    issued = [i for i in pr.items if i.fulfillment_status == "stock_issued"]
    if issued:
        return (f"Store has already issued {', '.join(i.item_name for i in issued[:3])} from stock against this requisition, "
                "so it can no longer be edited. Ask the buyer to cancel it and raise a new one if the requirement changed.")
    sr = db.query(ServiceMaterial.id).filter(ServiceMaterial.pr_id == pr.id).first()
    if sr:
        return ("This requisition was raised from a Service Request's Materials tab — change the materials there "
                "instead, so the service request and the requisition stay in step.")
    return None


@router.put("/{pr_id}", response_model=P2PRequestResponse)
async def edit_p2p_request(
    pr_id: int,
    payload: P2PRequestEdit,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    """Re-write a requisition's header and lines. Allowed until an RFQ is
    raised against it (see _edit_block_reason). A requisition in approval or
    already approved loses that approval — what the approvers signed has
    changed — and is saved as a draft or sent for approval afresh."""
    pr = _get_pr_or_404(db, pr_id, for_update=True, user=user)
    _check_view_access(pr, user)
    reason = _edit_block_reason(db, pr, user)
    if reason:
        raise HTTPException(status_code=409, detail=reason)
    draft = payload.save_as_draft
    if not draft:
        # Submitting a draft is raising it; anything else is a resubmission.
        _ensure_pr_action(user, "create" if pr.status == "draft" else "submit")
    lines = _validate_pr_payload(db, payload, draft=draft, check_category=pr.status == "draft")

    if payload.category_code != pr.category_code:
        # The category is part of the PR number; once approvers have seen the
        # number it stays — only a draft is renumbered.
        if pr.status != "draft":
            raise HTTPException(status_code=400, detail=(
                f"The category can't be changed once the requisition has been submitted — it is part of the number "
                f"{pr.p2p_number}. Cancel this requisition and raise a new one under the right category."))
        pr.p2p_number = generate_p2p_number(db, payload.category_code)
        pr.category_code = payload.category_code
        pr.assigned_buyer_id = resolve_auto_buyer_id(db, payload.category_code)
        pr.assignment_date = date.today() if pr.assigned_buyer_id else None

    old_status = pr.status
    if old_status == "submitted":
        # Withdraw the live approval so the approvers' inbox doesn't keep the old version.
        engine.cancel_for_entity(db, p2p_approvals.PR_ENTITY, pr.id, user, "Requisition edited — resubmitted with changes")
    if old_status in ("submitted", "approved"):
        pr.approved_by_id = None
        pr.approved_at = None

    pr.project_label = payload.project_label
    _apply_account_assignment(db, pr, payload)
    pr.purpose = payload.purpose
    pr.project_type = pr_purpose.project_type_for(payload.purpose) if payload.purpose else payload.project_type
    _default_label(pr)
    pr.required_date = payload.required_date
    pr.requirement_type = payload.requirement_type
    pr.priority = payload.priority
    pr.remarks = payload.remarks
    try:
        _sync_pr_lines(db, pr, lines, draft=draft)
    except HTTPException:
        db.rollback()
        raise

    who = user.name or user.email
    if draft:
        pr.status = "draft"
        _write_audit(db, pr.id, "edited", user, old_status=old_status, new_status="draft",
                     summary=f"{who} edited {pr.p2p_number} and saved it as a draft"
                             + (" — its earlier approval was withdrawn." if old_status in ("submitted", "approved") else "."))
        db.commit()
        db.refresh(pr)
        return _to_response(db, pr, user=user, with_approval=True)

    requester = db.get(User, pr.requested_by_id) if pr.requested_by_id else None
    p2p_approvals.submit_pr(db, pr, requester or user)
    _write_audit(db, pr.id, "edited", user, old_status=old_status, new_status=pr.status,
                 summary=f"{who} edited {pr.p2p_number} and sent it for approval"
                         + (" again — the earlier approval was withdrawn." if old_status in ("submitted", "approved") else "."))
    if old_status == "draft":
        fire_rule(db, background_tasks, "p2p", "pr_create", "New Purchase Requisition",
                  f"PR '{pr.p2p_number}' was raised by {who} for {pr.project_label}.", "p2p_request", pr.id, user,
                  _pr_details(pr, user))
    db.commit()
    db.refresh(pr)
    background_tasks.add_task(_send_p2p_pr_approval_emails_background, pr.id)
    return _to_response(db, pr, user=user, with_approval=True)


_PO_STAGE_STATUSES = ("po_raised", "po_approved", "partially_received", "received", "closed", "rejected")


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
    order_project_id: int | None = None,
    order_project_element_id: int | None = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    # The P.O Approval queue is the Purchase Orders tab; everything else is
    # the Purchase Requisitions tab. A user holding only Purchase Orders view
    # (a PO approver) sees just PO-stage requisitions in the plain list.
    if queue == "po-approval":
        ensure_tab_action(user, "p2p", "purchase_orders", "view")
    elif queue == "pr-approval":
        _ensure_pr_view(user)
    query = db.query(P2PRequest).options(
        selectinload(P2PRequest.items).selectinload(P2PRequestItem.attachments),
        selectinload(P2PRequest.attachments),
        selectinload(P2PRequest.approvals),
        selectinload(P2PRequest.po_approvers),
    )
    if queue is None and not _can_view_prs(user):
        query = query.filter(P2PRequest.status.in_(_PO_STAGE_STATUSES))
    if queue == "pr-approval" and user.role != "admin":
        # The P.R Approval queue: ONLY PRs where the viewer holds an approver
        # slot — even for the purchase team, whose monitoring view is the
        # main list. Admins see the full queue.
        query = query.filter(
            P2PRequest.approvals.any(P2PRequestApproval.approver_id == user.id)
            | (P2PRequest.approver_id == user.id)
            | (P2PRequest.project_head_id == user.id)
            | (P2PRequest.plant_head_id == user.id)
            | P2PRequest.id.in_(p2p_approvals.pr_engine_party_pr_ids(user))
        )
    elif queue == "po-approval" and user.role != "admin":
        # The P.O Approval queue: ONLY PRs whose PO this viewer is eligible
        # to approve — their role flags intersected with each PR's role set
        # (matrix by project_type, legacy PH/Director/Partner otherwise) — anyone
        # holding a role may approve, including whoever raised the PR or PO.
        eligibility = [
            # Approval engine: PO steps addressed to (or decided by) the viewer.
            P2PRequest.id.in_(p2p_approvals.po_engine_party_pr_ids(user)),
            # In-flight POs from before the engine: picked rows / role flags.
            P2PRequest.po_approvers.any(P2PRequestPOApprover.approver_id == user.id),
        ]
        if user.is_director:
            eligibility.append(P2PRequest.project_type.in_(tuple(PO_APPROVAL_ROLE_SETS)) & P2PRequest.approval_scheme.is_(None))
        if user.is_partner:
            eligibility.append(P2PRequest.approval_scheme == SETTINGS_SCHEME)
        if user.is_purchase_head or user.is_director or user.is_partner:
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
            query = query.filter(P2PRequest.status.in_(_PO_STAGE_STATUSES))
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
                | P2PRequest.id.in_(p2p_approvals.engine_party_pr_ids(user))
            )
    # Drafts are private to whoever raised them — nobody else's list shows them.
    query = query.filter((P2PRequest.status != "draft") | (P2PRequest.requested_by_id == user.id))
    # Data scope (Organization › Role & Permissions › Data access) on top.
    query = scope_prs(query, db, user)
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
    if order_project_element_id:
        query = query.filter(P2PRequest.items.any(P2PRequestItem.order_project_element_id == order_project_element_id))
    elif order_project_id:
        query = query.filter((P2PRequest.order_project_id == order_project_id)
                             | P2PRequest.items.any(P2PRequestItem.order_project_id == order_project_id))

    prs = query.order_by(P2PRequest.created_at.desc()).offset(skip).limit(limit).all()

    return [_to_response(db, pr, user=user) for pr in prs]


@router.get("/approver-flags")
async def my_approver_flags(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Whether the viewer approves requisitions / POs at all — shows the
    Approvals views. /auth/me's is_pr_approver / is_po_approver only know the
    old routing tables; this adds the approval engine's steps."""
    if user.role == "admin":
        return {"is_pr_approver": True, "is_po_approver": True}
    engine_pr, engine_po = p2p_approvals.is_approver_user(db, user)
    legacy_pr = db.query(P2PRequest.id).filter(
        P2PRequest.approvals.any(P2PRequestApproval.approver_id == user.id)
        | (P2PRequest.approver_id == user.id) | (P2PRequest.project_head_id == user.id) | (P2PRequest.plant_head_id == user.id)
    ).first() is not None
    legacy_po = _is_po_approver(user) or db.query(P2PRequestPOApprover.id).filter(P2PRequestPOApprover.approver_id == user.id).first() is not None
    return {"is_pr_approver": engine_pr or legacy_pr, "is_po_approver": engine_po or legacy_po}


@router.get("/by-po/{po_id}", response_model=P2PRequestResponse)
async def get_p2p_request_by_po(
    po_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    """The requisition a purchase order belongs to — the approval engine links
    a PO approval to /dashboard/p2p/purchase-orders/{po_id}, which opens the
    requisition page where the PO is approved."""
    po = db.get(P2PPurchaseOrder, po_id)
    if po is None or po.p2p_request_id is None:
        raise HTTPException(status_code=404, detail=f"Purchase order #{po_id} was not found or isn't linked to a requisition — it may have been deleted.")
    pr = _get_pr_or_404(db, po.p2p_request_id, user=user)
    _check_view_access(pr, user)
    return _to_response(db, pr, user=user, with_approval=True)


@router.get("/{pr_id}", response_model=P2PRequestResponse)
async def get_p2p_request(
    pr_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    pr = _get_pr_or_404(db, pr_id, user=user)
    _check_view_access(pr, user)
    include_po = _can_see_po_commercials(pr, user) and _sees_pr_feature(user, "purchase_order", "view")
    return _to_response(db, pr, include_po=include_po, user=user, with_approval=True)


@router.get("/{pr_id}/audit")
async def get_p2p_request_audit(
    pr_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    if _can_view_prs(user):
        ensure_feature_action(user, "p2p", "purchase_requisitions", "history", "view")
    pr = _get_pr_or_404(db, pr_id, user=user)
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
    _ensure_pr_action(user, "edit")
    # Status and the approver slots used to be editable here, which let any
    # purchase user jump a PR straight to 'po_approved' (skipping Purchase
    # Head / Director / Partner) or swap themselves in as a head mid-flow. Status
    # now only moves through the dedicated transition endpoints, and heads
    # are fixed at creation — reject those keys explicitly rather than
    # silently dropping them, so a caller knows the change didn't happen.
    blocked = sorted(set(payload.model_extra or {}) & _PR_LOCKED_FIELDS)
    if blocked:
        raise HTTPException(
            status_code=400,
            detail=f"{', '.join(blocked)} can't be edited directly — status only changes through approve/reject/cancel/close, and approvers are fixed when the requisition is raised.",
        )

    pr = _get_pr_or_404(db, pr_id, user=user)
    _check_view_access(pr, user)
    # Same lock as the full edit: nothing changes once an RFQ is raised.
    reason = _edit_block_reason(db, pr, user)
    if reason:
        raise HTTPException(status_code=409, detail=reason)
    updates = payload.model_dump(exclude_unset=True, exclude=set(payload.model_extra or {}))

    for field, val in updates.items():
        setattr(pr, field, val)

    if updates:
        _write_audit(db, pr.id, "updated", user, summary=f"{user.name or user.email} updated P2P request {pr.p2p_number}.")

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr, user=user)




@router.post("/{pr_id}/approve", response_model=P2PRequestResponse)
async def approve_p2p_request(
    pr_id: int,
    background_tasks: BackgroundTasks,
    payload: P2PRequestApprovePayload = P2PRequestApprovePayload(),
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    # Named-approver routing decides who approves; the matrix only needs
    # 'View' on Purchase Requisitions (see the RBAC note at the top).
    _ensure_pr_view(user)
    pr = _get_pr_or_404(db, pr_id, user=user)
    if pr.status != "submitted":
        raise HTTPException(status_code=409, detail=f"Only a submitted PR can be approved (current status: {pr.status})")

    # Submitted through the approval engine: the engine decides who may act
    # (approver, delegate, escalation target, admin stand-in with a comment).
    req = p2p_approvals.pr_request(db, pr.id)
    if req is not None:
        engine.decide(db, req.id, user, "approve", payload.comment)
        db.commit()
        db.refresh(pr)
        return _to_response(db, pr, user=user)

    # ── In-flight PR from before the engine (no approval request): old path.
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
        fire_rule(db, background_tasks, "p2p", "pr_approved", "Purchase Requisition Approved",
                  f"PR '{pr.p2p_number}' got its final approval from {user.name or user.email}.", "p2p_request", pr.id, user,
                  _pr_details(pr, user))

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr, user=user)


@router.post("/{pr_id}/approve-po", response_model=P2PRequestResponse)
async def approve_po(
    pr_id: int,
    background_tasks: BackgroundTasks,
    payload: P2PRequestApprovePayload = P2PRequestApprovePayload(),
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    # PO approver routing (Settings PO approvers, Partners, Directors, picked
    # roles) decides who approves; the matrix only needs 'View' on Purchase
    # Orders (see the RBAC note at the top).
    ensure_tab_action(user, "p2p", "purchase_orders", "view")
    # Locks the PR row so two approvers clicking at the same moment can't
    # both stamp the any-one approval.
    pr = _get_pr_or_404(db, pr_id, for_update=True, user=user)
    if pr.status != "po_raised":
        raise HTTPException(status_code=409, detail=f"Only a PO raised request can be approved (current status: {pr.status})")

    # PO sent for approval through the engine: just decide it there.
    po, req = p2p_approvals.po_request(db, pr.id)
    if req is not None and pr.approval_scheme == ENGINE_SCHEME:
        engine.decide(db, req.id, user, "approve", payload.comment)
        db.commit()
        db.refresh(pr)
        return _to_response(db, pr, user=user)

    # ── In-flight PO from before the engine (no approval request): old path.
    # Same rule as PR approval: the approver's comment is mandatory.
    comment = (payload.comment or "").strip()
    if not comment:
        raise HTTPException(status_code=400, detail="Add a comment before approving — it is recorded on the requisition's approval trail.")
    payload.comment = comment

    now = datetime.now(timezone.utc)

    if pr.approval_scheme == SETTINGS_SCHEME:
        _approve_po_settings_scheme(db, pr, user, payload.comment, now, background_tasks)
    elif pr.project_type in PO_APPROVAL_ROLE_SETS:
        # Manager matrix: ALL roles must approve (production_manager,
        # purchase_manager, project_manager, director). Named roles are
        # picked persons; director is any ONE of the directors.
        my_rows = [a for a in pr.po_approvers if a.approver_id == user.id]
        is_director = user.is_director

        if not my_rows and not is_director:
            names = ", ".join(f"{a.approver_name} ({P2P_ROLE_LABELS.get(a.role, a.role)})" for a in pr.po_approvers)
            who = f" ({names})" if names else ""
            raise HTTPException(status_code=403, detail=f"Only the PO approvers picked on this requisition{who} or a Director can approve this PO.")

        # A user picked in several roles clears every one of their pending
        # slots in one click (same as PR approval). Already-stamped slots are
        # never re-stamped, so a second click can't overwrite the first
        # approver's name/comment.
        pending_rows = [a for a in my_rows if a.approved_at is None]
        pending_roles = pr.pending_po_approval_roles
        if pending_rows:
            for approver_row in pending_rows:
                approver_row.approved_at = now
                approver_row.approved_by_id = user.id
                approver_row.approved_by_name = user.name or user.email
                approver_row.comment = payload.comment
            role_label = " & ".join(P2P_ROLE_LABELS.get(a.role, a.role) for a in pending_rows)
        elif not (is_director and "director" in pending_roles):
            done = [P2P_ROLE_LABELS.get(a.role, a.role) for a in my_rows]
            if is_director and pr.director_po_approved_by_id == user.id:
                done.append("Director")
            waiting = ", ".join(P2P_ROLE_LABELS.get(r, r) for r in pending_roles) or "nobody"
            if done:
                detail = f"You have already approved this PO as {' & '.join(done)}; it is waiting on {waiting}."
            else:
                detail = (f"The Director approval on this PO was already given by "
                          f"{pr.director_po_approved_by_name or 'another Director'}; it is waiting on {waiting}.")
            raise HTTPException(status_code=409, detail=detail)
        else:
            # The all-roles rule needs an independent Director: someone who
            # already approved this PO in a picked role (e.g. a Purchase
            # Manager who also holds is_director) can't fill the Director
            # slot with a second click — one person never covers two roles.
            my_stamped = [P2P_ROLE_LABELS.get(a.role, a.role) for a in pr.po_approvers if a.approved_by_id == user.id]
            if my_stamped:
                raise HTTPException(
                    status_code=409,
                    detail=(f"You approved this PO as {' & '.join(my_stamped)}; another Director must give the "
                            f"Director approval — one person can't fill two approval roles on the same PO."),
                )
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
        # and Partner must stamp their own slot.
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
    return _to_response(db, pr, user=user)


def _approve_po_settings_scheme(db: Session, pr: P2PRequest, user: User, comment: str, now: datetime,
                                background_tasks: BackgroundTasks) -> None:
    """Level 1: every Settings PO approver stamps their own row. Level 2 (only
    after level 1 is complete): any ONE Partner gives the final approval —
    someone who already approved at level 1 can't also be that Partner."""
    my_pending = [a for a in pr.po_approvers if a.approver_id == user.id and a.approved_at is None]
    level1_pending = [a for a in pr.po_approvers if a.approved_at is None]
    if my_pending:
        for row in my_pending:
            row.approved_at = now
            row.approved_by_id = user.id
            row.approved_by_name = user.name or user.email
            row.comment = comment
        _write_audit(db, pr.id, "po_role_approved", user, summary=f"{user.name or user.email} approved the PO for {pr.p2p_number} (PO approver).")
        if not [a for a in pr.po_approvers if a.approved_at is None]:
            for partner in active_partners(db):
                if partner.id != user.id:
                    notify_user(db, partner.id, "Purchase Order Awaiting Final Approval",
                                f"The PO for PR '{pr.p2p_number}' is approved by the PO approvers and needs one Partner's final approval.",
                                notification_type="p2p_po_approval_pending", entity_type="p2p_request", entity_id=pr.id, teams=True)
        return
    if not user.is_partner:
        waiting = ", ".join(a.approver_name or f"user #{a.approver_id}" for a in level1_pending)
        if any(a.approver_id == user.id for a in pr.po_approvers):
            raise HTTPException(status_code=409, detail=f"You have already approved this PO; it is waiting on {waiting or 'a Partner'}.")
        raise HTTPException(status_code=403, detail="Only this PO's approvers (Procurement → Settings) or a Partner can approve it.")
    if level1_pending:
        waiting = ", ".join(a.approver_name or f"user #{a.approver_id}" for a in level1_pending)
        raise HTTPException(status_code=409, detail=f"The PO approvers must approve first — still waiting on {waiting}. The Partner approval comes after them.")
    if pr.partner_approved_at is not None:
        raise HTTPException(status_code=409, detail=f"The Partner approval was already given by {pr.partner_approved_by_name or 'another Partner'}.")
    if any(a.approved_by_id == user.id for a in pr.po_approvers):
        raise HTTPException(status_code=409, detail="You approved this PO as a PO approver; another Partner must give the final approval — "
                                                    "one person can't fill both levels.")
    pr.partner_approved_at = now
    pr.partner_approved_by_name = user.name or user.email
    pr.partner_comment = comment
    pr.status = "po_approved"
    _write_audit(db, pr.id, "po_fully_approved", user, summary=f"{user.name or user.email} (Partner) gave the final approval for the PO of {pr.p2p_number}.",
                 old_status="po_raised", new_status="po_approved")
    if pr.requested_by_id:
        notify_user(db, pr.requested_by_id, "Purchase Order Fully Approved",
                    f"The PO for your PR '{pr.p2p_number}' was approved by {user.name or user.email} (Partner) and is now active.",
                    notification_type="p2p_po_approved", entity_type="p2p_request", entity_id=pr.id)
    fire_rule(db, background_tasks, "p2p", "po_approved", "Purchase Order Approved",
              f"The PO for PR '{pr.p2p_number}' got its final approval from {user.name or user.email} (Partner).",
              "p2p_request", pr.id, user, _pr_details(pr, user))


def _pr_details(pr: P2PRequest, user: User) -> list[tuple[str, str]]:
    """Rows for notification emails."""
    return [
        ("Requisition", pr.p2p_number), ("Project", pr.project_label or ""),
        ("Category", P2P_CATEGORIES.get(pr.category_code, pr.category_code or "")),
        ("Required by", pr.required_date.strftime("%d-%m-%Y") if pr.required_date else ""),
        ("Items", ", ".join(i.item_name for i in pr.items[:8]) + (" …" if len(pr.items) > 8 else "")),
        ("PO value", f"{pr.po_value:,.2f}" if pr.po_value else ""), ("By", user.name or user.email),
    ]


def _cancel_linked_pos(db: Session, pr: P2PRequest, user: User, why: str) -> list[str]:
    """Cancels every not-yet-cancelled PO raised against `pr` and writes an
    audit line on the PR naming each one. Returns the cancelled PO numbers."""
    pos = db.query(P2PPurchaseOrder).filter(
        P2PPurchaseOrder.p2p_request_id == pr.id, P2PPurchaseOrder.status != "cancelled",
    ).all()
    for po in pos:
        old = po.status
        po.status = "cancelled"
        _write_audit(db, pr.id, "po_cancelled", user,
                     summary=f"PO '{po.po_number}' cancelled (was {old}) because {why}",
                     old_status=old, new_status="cancelled")
    return [po.po_number for po in pos]


@router.post("/{pr_id}/reject", response_model=P2PRequestResponse)
async def reject_p2p_request(
    pr_id: int,
    payload: P2PRequestActionPayload,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    pr = _get_pr_or_404(db, pr_id, user=user)
    if pr.status not in ("submitted", "approved", "po_raised"):
        raise HTTPException(status_code=409, detail=f"Cannot reject a PR with status '{pr.status}'")
    # Routing decides who may reject; the matrix needs 'View' on the tab the
    # decision sits on (PO approval -> Purchase Orders, else Requisitions).
    if pr.status == "po_raised":
        ensure_tab_action(user, "p2p", "purchase_orders", "view")
    else:
        _ensure_pr_view(user)

    # Waiting in the approval engine (PR approval, or its PO's): reject there —
    # the engine checks who may act and needs the reason as the comment.
    live = None
    if pr.status == "submitted":
        live = p2p_approvals.pr_request(db, pr.id)
    elif pr.status == "po_raised" and pr.approval_scheme == ENGINE_SCHEME:
        live = p2p_approvals.po_request(db, pr.id)[1]
    if live is not None:
        if not (payload.reason or "").strip():
            raise HTTPException(status_code=422, detail="Give the reason for rejecting — the requester needs it to understand what to change.")
        engine.decide(db, live.id, user, "reject", payload.reason)
        db.commit()
        db.refresh(pr)
        return _to_response(db, pr, user=user)

    # ── Old path: in-flight items from before the engine, and an approved PR
    # the purchase team / an assigned head turns down before any PO.
    role = _check_po_reject_access(pr, user) if pr.status == "po_raised" else _check_reject_access(pr, user)

    old_status = pr.status
    pr.status = "rejected"
    pr.rejected_reason = payload.reason
    pr.rejected_by_role = role
    pr.rejected_by_name = user.name or user.email
    reason_note = f" Reason: {payload.reason}" if payload.reason else ""
    _write_audit(db, pr.id, "rejected", user, summary=f"{user.name or user.email} rejected P2P request {pr.p2p_number}.{reason_note}",
                 old_status=old_status, new_status="rejected")
    if old_status == "po_raised":
        # Rejecting at PO approval kills the PO too — otherwise it stays
        # 'issued' in PO Tracking forever against a terminal PR (C-43).
        _cancel_linked_pos(db, pr, user, f"the PO was rejected at approval.{reason_note}")

    if pr.requested_by_id:
        notify_user(
            db, user_id=pr.requested_by_id,
            title="P2P Request Rejected",
            message=f"Your PR '{pr.p2p_number}' was rejected by {user.name or user.email}.{reason_note}",
            notification_type="p2p_request_rejected", entity_type="p2p_request", entity_id=pr.id,
        )
    fire_rule(db, background_tasks, "p2p", "pr_rejected", "Purchase Requisition Rejected",
              f"PR '{pr.p2p_number}' was rejected by {user.name or user.email}{' at PO approval' if old_status == 'po_raised' else ''}.{reason_note}",
              "p2p_request", pr.id, user, _pr_details(pr, user))

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr, user=user)


def _grn_awaiting_inspection(db: Session, pr: P2PRequest) -> str | None:
    """GRN number of a goods receipt against one of this PR's live POs that
    hasn't finished quality inspection (a draft GRN, or a line still pending /
    in quality). Its accepted quantity would still roll up onto the PR, so
    the PR can't be cancelled or short-closed while one exists."""
    from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt, P2PGoodsReceiptItem
    grns = db.query(P2PGoodsReceipt).join(
        P2PPurchaseOrder, P2PPurchaseOrder.id == P2PGoodsReceipt.purchase_order_id,
    ).options(selectinload(P2PGoodsReceipt.items)).filter(
        P2PPurchaseOrder.p2p_request_id == pr.id, P2PPurchaseOrder.status != "cancelled",
    ).all()
    for g in grns:
        if g.status == "draft" or any(it.quality_status in ("pending", "in_quality") for it in g.items):
            return g.grn_number
    return None


@router.post("/{pr_id}/cancel", response_model=P2PRequestResponse)
async def cancel_p2p_request(
    pr_id: int,
    payload: P2PRequestActionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    _ensure_pr_action(user, "cancel")
    pr = _get_pr_or_404(db, pr_id, user=user)
    if not _is_purchase_team(user) and pr.requested_by_id != user.id:
        raise HTTPException(status_code=403, detail="You may only cancel your own P2P requests")
    if pr.status in ("closed", "rejected", "cancelled"):
        raise HTTPException(status_code=409, detail=f"This requisition is already {pr.status} — there is nothing left to cancel.")
    if pr.status == "po_raised":
        raise HTTPException(status_code=409, detail="The PO for this requisition is awaiting approval — ask a PO approver to reject it instead of cancelling the requisition.")
    if pr.status == "partially_received":
        raise HTTPException(status_code=409, detail="Part of this order has already been received, so the requisition can't be cancelled. If the vendor won't supply the balance, Purchase can short-close it: Close Requisition with a reason.")
    if pr.status == "received":
        raise HTTPException(status_code=409, detail="Every ordered item has already been received, so there is nothing left to cancel. Purchase can close the requisition instead.")
    if pr.status == "po_approved":
        # The PO is approved and with the vendor. Only Purchase (or an admin)
        # can call it off, with a reason, and only while no goods are booked
        # against it; the PO is cancelled together with the requisition.
        if not (_is_purchase_team(user) or user.role == "admin"):
            raise HTTPException(status_code=403, detail="The PO for this requisition is approved and with the vendor, so only Purchase (or an admin) can cancel it now. Ask the buyer to cancel the requisition and the PO.")
        if not (payload.reason or "").strip():
            raise HTTPException(status_code=400, detail="Give a reason for cancelling: the PO is already approved and with the vendor, and the reason is recorded on the PO and the requisition history.")
        open_grn = _grn_awaiting_inspection(db, pr)
        if open_grn:
            raise HTTPException(status_code=409, detail=f"Goods receipt {open_grn} is booked against this requisition's PO and still awaiting quality inspection, so the requisition can't be cancelled yet. Finish the GRN's inspection first: if every item is rejected you can then cancel; if any is accepted, Purchase can short-close the requisition instead.")
        payload.reason = payload.reason.strip()

    old_status = pr.status
    # Still waiting for PR approval in the engine: withdraw that request too,
    # so the approvers' inbox doesn't keep a requisition that no longer exists.
    engine.cancel_for_entity(db, p2p_approvals.PR_ENTITY, pr.id, user, payload.reason or "Requisition cancelled")
    pr.status = "cancelled"
    pr.cancelled_reason = payload.reason
    reason_note = f" Reason: {payload.reason}" if payload.reason else ""
    _write_audit(db, pr.id, "cancelled", user, summary=f"{user.name or user.email} cancelled P2P request {pr.p2p_number}.{reason_note}",
                 old_status=old_status, new_status="cancelled")
    # A PO still in draft (po_drafted) dies with its requisition.
    _cancel_linked_pos(db, pr, user, f"its requisition was cancelled.{reason_note}")
    if pr.requested_by_id and pr.requested_by_id != user.id:
        notify_user(
            db, user_id=pr.requested_by_id,
            title="P2P Request Cancelled",
            message=f"Your PR '{pr.p2p_number}' was cancelled by {user.name or user.email}.{reason_note}",
            notification_type="p2p_request_cancelled", entity_type="p2p_request", entity_id=pr.id,
        )
    db.commit()
    db.refresh(pr)
    return _to_response(db, pr, user=user)


@router.delete("/{pr_id}")
async def discard_draft(
    pr_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    """Throw away a draft. Only drafts — a requisition anyone else has seen
    is cancelled (with its history), never deleted."""
    pr = _get_pr_or_404(db, pr_id, user=user)
    if pr.status != "draft":
        raise HTTPException(status_code=409, detail=f"Only a draft can be discarded — {pr.p2p_number} is {pr.status.replace('_', ' ')}. Use Cancel instead.")
    if pr.requested_by_id != user.id and user.role != "admin":
        raise HTTPException(status_code=403, detail="Only the person who raised this draft can discard it.")
    _write_audit(db, pr.id, "draft_discarded", user, summary=f"{user.name or user.email} discarded draft {pr.p2p_number}.",
                 old_status="draft")
    db.delete(pr)
    db.commit()
    return {"ok": True}


@router.post("/{pr_id}/assign-buyer", response_model=P2PRequestResponse)
async def assign_buyer(
    pr_id: int,
    payload: P2PRequestAssignBuyerPayload,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    _ensure_pr_action(user, "edit")
    ensure_feature_action(user, "p2p", "purchase_requisitions", "buyer", "edit")
    pr = _get_pr_or_404(db, pr_id, user=user)
    if pr.status != "approved":
        raise HTTPException(status_code=409, detail=f"A buyer can only be assigned to an approved PR (current status: {pr.status})")

    buyer = db.query(User).filter(User.id == payload.assigned_buyer_id).first()
    if not buyer:
        raise HTTPException(status_code=404, detail="Buyer not found")
    # The role's assign-to rule (Role & Permissions › Procurement › Purchase Requisitions › Assign buyer).
    if buyer.id != pr.assigned_buyer_id:
        assignee_rules.ensure_allowed(db, user, BUYER_RULE_KEY, buyer)

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
    from app.modules.p2p import notify as p2p_notify
    p2p_notify.buyer_assigned(db, background_tasks, pr, user)

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr, user=user)


def _get_pr_item_or_404(pr: P2PRequest, item_id: int) -> P2PRequestItem:
    for item in pr.items:
        if item.id == item_id:
            return item
    raise HTTPException(status_code=404, detail="P2P request item not found on this PR")


def _linked_store_item(db: Session, item: P2PRequestItem) -> StoreItem | None:
    """The Item Master row this PR line was raised for (its store_item_id).
    None only for an older line the 2026-10-11 migration couldn't link —
    lines are never matched to the master by name."""
    return db.get(StoreItem, item.store_item_id) if item.store_item_id else None


_UNLINKED_LINE = ("'{name}' was raised before PR lines were picked from the Item Master and isn't linked to an item, "
                  "so its store stock can't be checked or issued. Send it to procurement; link it to its item on the "
                  "PO (Link to Item Master) before receiving it.")


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
        store_item = _linked_store_item(db, item)
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
    # Role event for the buying team (the assigned buyer is told directly below).
    from app.modules.p2p import notify as p2p_notify
    from app.modules.p2p.approvals import _AfterDecisionTasks
    p2p_notify.pr_to_procurement(db, _AfterDecisionTasks(), pr, user, to_procure)

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


# A requisition whose lines can't be checked / issued from stock / sent to
# procurement: not yet approved (draft, in approval, sent back) or already
# finished (rejected, cancelled, closed). Stock must never leave the store
# against an unapproved requisition.
_NOT_APPROVED_PR_STATUSES = ("draft", "submitted", "returned", "rejected", "cancelled", "closed")


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
    _ensure_pr_view(user)
    ensure_feature_action(user, "p2p", "purchase_requisitions", "fulfilment", "view")
    pr = _get_pr_or_404(db, pr_id, user=user)
    if not (user.role == "admin" or "purchase" in user.get_apps() or _pr_store_manager_id(pr) == user.id):
        raise HTTPException(status_code=403, detail="Only the Purchase team or this requisition's Store Manager can check its store stock.")
    if pr.status in _NOT_APPROVED_PR_STATUSES:
        raise HTTPException(status_code=409, detail=f"Stock can only be checked on an approved PR (current status: {pr.status})")
    item = _get_pr_item_or_404(pr, item_id)
    if item.fulfillment_status != "pending":
        raise HTTPException(status_code=409, detail=f"This item has already been decided ('{item.fulfillment_status}')")

    store_item = _linked_store_item(db, item)
    if not store_item:
        return P2PRequestItemStockCheckResponse(matched=False, requested_qty=item.quantity,
                                                message=_UNLINKED_LINE.format(name=item.item_name))

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
        part_code_matched=True,
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
    # Routed to the Store Manager named on this PR (like a named approver),
    # so the matrix only needs 'View' on Purchase Requisitions.
    _ensure_pr_view(user)
    ensure_feature_action(user, "p2p", "purchase_requisitions", "fulfilment", "create")
    pr = _get_pr_or_404(db, pr_id, user=user)
    _check_can_issue(pr, user)
    if pr.status in _NOT_APPROVED_PR_STATUSES:
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

    store_item = _linked_store_item(db, item)
    if not store_item:
        raise HTTPException(status_code=409, detail=_UNLINKED_LINE.format(name=item.item_name))

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
    return _to_response(db, pr, user=user)


@router.post("/{pr_id}/items/{item_id}/send-to-procurement", response_model=P2PRequestResponse)
async def send_item_to_procurement(
    pr_id: int,
    item_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    _ensure_pr_action(user, "edit")
    ensure_feature_action(user, "p2p", "purchase_requisitions", "fulfilment", "edit")
    pr = _get_pr_or_404(db, pr_id, user=user)
    if pr.status in _NOT_APPROVED_PR_STATUSES:
        raise HTTPException(status_code=409, detail=f"This decision can only be made on an approved PR (current status: {pr.status})")
    item = _get_pr_item_or_404(pr, item_id)
    if item.fulfillment_status != "pending":
        raise HTTPException(status_code=409, detail=f"This item has already been decided ('{item.fulfillment_status}')")

    item.fulfillment_status = "sent_to_procurement"
    _write_audit(db, pr.id, "item_sent_to_procurement", user,
                 summary=f"{user.name or user.email} confirmed '{item.item_name}' is not in store stock and sent it to procurement for {pr.p2p_number}.")
    from app.modules.p2p import notify as p2p_notify
    p2p_notify.pr_to_procurement(db, background_tasks, pr, user, [item])

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr, user=user)


@router.post("/{pr_id}/request-quotations", response_model=P2PRequestResponse)
async def request_quotations(
    pr_id: int,
    payload: P2PRequestQuotationPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    _ensure_pr_action(user, "edit")
    pr = _get_pr_or_404(db, pr_id, user=user)
    if pr.status != "approved":
        raise HTTPException(status_code=409, detail=f"Quotations can only be recorded on an approved PR (current status: {pr.status})")

    updates = payload.model_dump(exclude_unset=True)
    for field, val in updates.items():
        setattr(pr, field, val)
    _write_audit(db, pr.id, "quotation_recorded", user,
                 summary=f"{user.name or user.email} recorded vendor/RFQ details for {pr.p2p_number}.")
    db.commit()
    db.refresh(pr)
    return _to_response(db, pr, user=user)


def _check_draft_complete(pr: P2PRequest) -> None:
    """A draft is saved with whatever was filled in; before it goes for
    approval it must be as complete as a requisition raised directly."""
    missing = []
    if pr.purpose:
        problems = pr_purpose.header_problems(pr.purpose, pr.account_assignment, pr.project_label)
        problems += [p for p in [pr_purpose.category_problem(pr.purpose, pr.category_code)] if p]
        if problems:
            raise HTTPException(status_code=400, detail=f"{pr.p2p_number} can't be submitted yet — {' '.join(problems)} Click Edit to complete the draft.")
    else:
        if not (pr.project_label or "").strip():
            missing.append("the project")
        if pr.project_type not in P2P_PROJECT_TYPES:
            missing.append("the project type (existing / new)")
    if not pr.items:
        missing.append("at least one item line")
    for idx, item in enumerate(pr.items, start=1):
        if item.project_inhouse not in ("Project", "Inhouse"):
            missing.append(f"Project or Inhouse on line {idx} ({item.item_name})")
    if missing:
        raise HTTPException(status_code=400, detail=f"{pr.p2p_number} can't be submitted yet — fill in {', '.join(missing)}. Click Edit to complete the draft.")


@router.post("/{pr_id}/submit", response_model=P2PRequestResponse)
async def resubmit_p2p_request(
    pr_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    """Send a draft, or a returned requisition (sent back by an approver, or
    withdrawn by the requester), into approval — a new submission in the
    approval engine; any earlier one stays as history."""
    pr = _get_pr_or_404(db, pr_id, user=user)
    _ensure_pr_action(user, "create" if pr.status == "draft" else "submit")
    if not _is_purchase_team(user) and pr.requested_by_id != user.id:
        raise HTTPException(status_code=403, detail="Only the requester (or Purchase) can submit this requisition.")
    if pr.status == "draft" and pr.requested_by_id != user.id:
        raise HTTPException(status_code=403, detail="Only the person who raised this draft can submit it.")
    if pr.status not in ("draft", "returned"):
        raise HTTPException(status_code=409, detail=f"Only a draft, or a requisition returned for changes, can be submitted (current status: {pr.status.replace('_', ' ')}).")
    old_status = pr.status
    if old_status == "draft":
        _check_draft_complete(pr)
    order_project_links.check_saved_pr(db, pr)
    requester = db.get(User, pr.requested_by_id) if pr.requested_by_id else None
    p2p_approvals.submit_pr(db, pr, requester or user)
    who = user.name or user.email
    _write_audit(db, pr.id, "submitted" if old_status == "draft" else "resubmitted", user,
                 summary=f"{who} {'submitted' if old_status == 'draft' else 'resubmitted'} {pr.p2p_number} for approval.",
                 old_status=old_status, new_status=pr.status)
    if old_status == "draft":
        fire_rule(db, background_tasks, "p2p", "pr_create", "New Purchase Requisition",
                  f"PR '{pr.p2p_number}' was raised by {who} for {pr.project_label}.", "p2p_request", pr.id, user,
                  _pr_details(pr, user))
    db.commit()
    db.refresh(pr)
    background_tasks.add_task(_send_p2p_pr_approval_emails_background, pr.id)
    return _to_response(db, pr, user=user)


@router.post("/{pr_id}/select-vendor", response_model=P2PRequestResponse)
async def select_vendor(
    pr_id: int,
    payload: P2PRequestSelectVendorPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    _ensure_pr_action(user, "edit")
    pr = _get_pr_or_404(db, pr_id, user=user)
    if pr.status != "approved":
        raise HTTPException(status_code=409, detail=f"A vendor can only be selected on an approved PR (current status: {pr.status})")

    pr.selected_vendor = payload.selected_vendor
    _write_audit(db, pr.id, "vendor_selected", user,
                 summary=f"{user.name or user.email} selected vendor '{payload.selected_vendor}' for {pr.p2p_number}.")
    db.commit()
    db.refresh(pr)
    return _to_response(db, pr, user=user)


@router.post("/{pr_id}/create-po", response_model=P2PRequestResponse)
async def create_po(
    pr_id: int,
    payload: P2PRequestCreatePOPayload,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    ensure_tab_action(user, "p2p", "purchase_orders", "create")
    ensure_tab_action(user, "p2p", "purchase_orders", "submit")  # it goes straight into PO approval
    # Locks the PR row for the rest of this request so a concurrent/
    # double-submitted create-PO call can't both pass the status check below
    # before either commits.
    pr = _get_pr_or_404(db, pr_id, for_update=True, user=user)
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
    # the PO entirely, and a partially-issued line only orders the shortfall
    # (same as rfq.create_po_draft).
    def _to_order(i: P2PRequestItem) -> float:
        return (i.quantity or 0) - (i.issued_qty or 0)

    procurable_items = [i for i in pr.items if i.fulfillment_status != "stock_issued" and _to_order(i) > 0]
    if not procurable_items:
        raise HTTPException(status_code=409, detail=f"Every line on '{pr.p2p_number}' was already issued from store stock — there is nothing left to order.")

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
        line_total = compute_line_total(_to_order(item), unit_price, tax_rate)
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

    # Quality: a vendor BLOCKED on the approved vendor list gets no PO for
    # those items (services/supplier_quality.ensure_po_allowed).
    from app.modules.quality.services.supplier_quality import ensure_po_allowed, SupplierError
    try:
        ensure_po_allowed(db, pr.selected_vendor, [i.store_item_id for i in procurable_items])
    except SupplierError as e:
        raise HTTPException(status_code=e.status, detail=str(e))

    old_status = pr.status
    pr.po_number = payload.po_number
    pr.po_date = payload.po_date or date.today()
    pr.po_value = po_value
    pr.expected_delivery = payload.expected_delivery
    pr.ordered_quantity = payload.ordered_quantity if payload.ordered_quantity is not None else sum(_to_order(i) for i in procurable_items)

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
            store_item_id=item.store_item_id,
            item_name=item.item_name,
            make=item.make,
            part_code=item.part_code,
            unit=item.unit,
            quantity=_to_order(item),
            unit_price=unit_price,
            tax_rate=tax_rate,
            line_total=line_total,
            item_category=item_category_for(db, item.store_item_id),
            order_project_id=item.order_project_id,
            order_project_element_id=item.order_project_element_id,
        ))

    db.flush()
    # Into PO approval (the "Purchase order" workflow in Organization ›
    # Approval Workflows) — PR → po_raised. The engine notifies the approvers.
    p2p_approvals.submit_po(db, pr, po, user)
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
    background_tasks.add_task(_send_p2p_po_approval_emails_background, pr.id)
    return _to_response(db, pr, user=user)


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
    payload: P2PRequestActionPayload | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("purchase")),
):
    """Closes a fully received PR, or short-closes a partially received one
    (the vendor won't supply the balance) — a short-close needs a reason and
    no GRN still awaiting inspection. Once closed, no further GRN can be
    booked against its PO (goods receipt requires po_approved /
    partially_received), so the unsupplied balance is written off."""
    _ensure_pr_action(user, "edit")
    ensure_feature_action(user, "p2p", "purchase_requisitions", "close", "edit")
    pr = _get_pr_or_404(db, pr_id, user=user)
    reason = ((payload.reason if payload else None) or "").strip()
    if pr.status not in ("received", "partially_received"):
        raise HTTPException(status_code=409, detail=f"Only a received or partially received requisition can be closed (current status: {pr.status.replace('_', ' ')}). Receive the goods against its PO first, or cancel the requisition if nothing will be ordered.")
    short_close = pr.status == "partially_received"
    if short_close:
        if not reason:
            raise HTTPException(status_code=400, detail="Only part of this order has been received. Give a reason to short-close it (e.g. the vendor won't supply the balance); the unreceived quantity is written off and no more goods can be received against this PO.")
        open_grn = _grn_awaiting_inspection(db, pr)
        if open_grn:
            raise HTTPException(status_code=409, detail=f"Goods receipt {open_grn} is still awaiting quality inspection. Finish its inspection first, then short-close the requisition.")

    old_status = pr.status
    pr.status = "closed"
    pr.closed_by_id = user.id
    pr.closed_at = datetime.now(timezone.utc)
    reason_note = f" Reason: {reason}" if reason else ""
    if short_close:
        summary = (f"{user.name or user.email} short-closed P2P request {pr.p2p_number} with "
                   f"{pr.received_quantity or 0:g} of {pr.ordered_quantity or 0:g} received; the balance is written off.{reason_note}")
    else:
        summary = f"{user.name or user.email} closed P2P request {pr.p2p_number}.{reason_note}"
    _write_audit(db, pr.id, "short_closed" if short_close else "closed", user, summary=summary,
                 old_status=old_status, new_status="closed")

    if pr.requested_by_id:
        verb = "short-closed (the balance won't be supplied)" if short_close else "closed"
        notify_user(
            db, user_id=pr.requested_by_id,
            title="P2P Request Closed",
            message=f"Your PR '{pr.p2p_number}' has been {verb} by {user.name or user.email}.{reason_note}",
            notification_type="p2p_request_closed", entity_type="p2p_request", entity_id=pr.id,
        )

    db.commit()
    db.refresh(pr)
    return _to_response(db, pr, user=user)


@router.post("/{pr_id}/attachments", response_model=list[P2PRequestAttachmentResponse])
async def upload_attachments(
    pr_id: int,
    doc_type: str = Form("supporting"),
    item_id: int | None = Form(None),
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(_requester_or_purchase),
):
    pr = _get_pr_or_404(db, pr_id, user=user)
    if not (pr.requested_by_id == user.id and can_perform(user, "p2p", "purchase_requisitions", "create")):
        _ensure_pr_action(user, "edit")
    ensure_feature_action(user, "p2p", "purchase_requisitions", "attachments", "create")
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
    pr = _get_pr_or_404(db, pr_id, user=user)
    # Anyone who may see the PR (incl. its named PR/PO approvers) may open
    # its files — approvers must see the specs they sign off on.
    _check_view_access(pr, user)
    if not _sees_pr_feature(user, "attachments", "view"):
        ensure_feature_action(user, "p2p", "purchase_requisitions", "attachments", "view")

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
    pr = _get_pr_or_404(db, pr_id, user=user)
    if not _is_purchase_team(user) and pr.requested_by_id != user.id:
        raise HTTPException(status_code=403, detail="You may only remove attachments from your own P2P requests")

    attachment = db.query(P2PRequestAttachment).filter(
        P2PRequestAttachment.id == attachment_id, P2PRequestAttachment.p2p_request_id == pr_id
    ).first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    # Company delete rule: 'Delete' on Purchase Requisitions AND only a file
    # you uploaded yourself (admins any).
    ensure_can_delete(user, attachment, "p2p", "purchase_requisitions", what="attachment")
    ensure_feature_action(user, "p2p", "purchase_requisitions", "attachments", "delete")
    # Supporting documents are part of what the approvers signed — once the
    # requisition leaves 'submitted' only Purchase may remove one.
    if pr.status not in ("submitted", "returned") and not _is_purchase_team(user):
        raise HTTPException(
            status_code=409,
            detail=f"Attachments are locked once the requisition is approved (current status: {pr.status}) — ask Purchase (or an admin) to remove it.",
        )

    _write_audit(db, pr.id, "attachment_deleted", user,
                 summary=f"{user.name or user.email} removed attachment '{attachment.filename}' from {pr.p2p_number}.")
    db.delete(attachment)
    db.commit()
    return {"message": "Attachment deleted"}
