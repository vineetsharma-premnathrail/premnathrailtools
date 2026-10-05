"""Joiner / mover / leaver business logic for HR lifecycle events.

Closes security findings S-10 / C-10 / C-54 and workflow gaps P2-USR-14,
-16, -17 and -18 (docs/erp-review): an exit completed here reassigns every
piece of approval authority the leaver held, cancels their own pending
requests, deactivates the portal account and revokes every live session in
one transaction, so nothing is left waiting on someone who has gone.

Nothing in here commits — the route owns the transaction.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.audit import record_audit
from app.core.sequential_id import next_sequential_id
from app.modules.hr.models.asset import HrAsset
from app.modules.hr.models.attendance import HrAttendanceRegularization
from app.modules.hr.models.employee_profile import HrEmployeeProfile, EMPLOYMENT_TYPES
from app.modules.hr.models.expense import HrExpenseClaim
from app.modules.hr.models.leave import HrLeaveRequest
from app.modules.hr.models.lifecycle import HrChecklistItem, HrChecklistTemplate, HrLifecycleEvent
from app.modules.hr.models.masters import HrDesignation, HrGrade
from app.modules.hr.models.travel import HrTravelRequest
from app.modules.hr.services.employee_sync import apply_org_fields
from app.modules.hr.services.exit_guard import revoke_user_sessions
from app.modules.main.models.user import User
from app.modules.organization.models.branch import Branch
from app.modules.organization.models.department import Department
from app.modules.organization.services.department_heads import is_same_unit
from app.modules.p2p.models.p2p_request import P2PRequest, P2P_CATEGORY_AUTO_BUYERS
from app.utils.notifications import broadcast_notification, notify_user

MODULE_KEY = "hr"
ENTITY_TYPE = "hr_lifecycle_event"

EVENT_TYPE_LABELS = {
    "joining": "Joining", "confirmation": "Confirmation", "transfer": "Transfer",
    "promotion": "Promotion", "exit": "Exit",
}
HEAD_FLAGS = ("is_department_head", "is_project_head", "is_plant_head")
ROLE_FLAG_LABELS = {
    "is_department_head": "Department Head",
    "is_project_head": "Project Head",
    "is_plant_head": "Plant Head",
    "is_purchase_head": "Purchase Head",
    "is_director": "Director",
    "is_md": "MD",
    "is_finance_manager": "Finance Manager",
}
# PRs in these statuses are finished — the buyer no longer needs replacing.
P2P_CLOSED_STATUSES = ("closed", "rejected", "cancelled")
P2P_SLOTS = (
    # (id column, name column, approved_at column, label)
    ("approver_id", "approver_name", "department_head_approved_at", "Department Head"),
    ("project_head_id", "project_head_name", "project_head_approved_at", "Project Head"),
    ("plant_head_id", "plant_head_name", "plant_head_approved_at", "Plant Head"),
)
PROBATION_TYPES = ("probation", "trainee", "intern")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def user_label(u: User | None) -> str:
    if not u:
        return "—"
    return u.name or u.email


# ── Numbering, snapshot, checklist seeding ─────────────────────────────

def next_event_no(db: Session) -> str:
    return next_sequential_id(db, prefix=f"LC-{date.today().year}-", column=HrLifecycleEvent.event_no)


def get_profile(db: Session, user_id: int | None) -> HrEmployeeProfile | None:
    if not user_id:
        return None
    return db.query(HrEmployeeProfile).filter(HrEmployeeProfile.user_id == user_id).first()


def match_department_id(db: Session, department_name: str | None) -> int | None:
    """Department whose name equals the free-text User.department
    (case-insensitive). None when there's no single obvious match."""
    if not department_name or not department_name.strip():
        return None
    rows = db.query(Department.id).filter(func.lower(Department.name) == department_name.strip().lower()).all()
    return rows[0][0] if len(rows) == 1 else None


def match_designation_id(db: Session, designation_name: str | None) -> int | None:
    if not designation_name or not designation_name.strip():
        return None
    row = db.query(HrDesignation.id).filter(func.lower(HrDesignation.name) == designation_name.strip().lower()).first()
    return row[0] if row else None


def snapshot_from_fields(db: Session, event: HrLifecycleEvent, user: User) -> None:
    """Capture where the employee is today into the from_* columns."""
    profile = get_profile(db, user.id)
    event.from_department_id = (profile.department_id if profile else None) or match_department_id(db, user.department)
    event.from_designation_id = (profile.designation_id if profile else None) or match_designation_id(db, user.designation)
    event.from_grade_id = profile.grade_id if profile else None
    event.from_branch_id = (profile.branch_id if profile else None) or user.branch_id
    event.from_manager_id = user.reporting_manager_id


def seed_checklist(db: Session, event: HrLifecycleEvent) -> list[HrChecklistItem]:
    """Copy every active template for this event type onto the event.
    Manager-category lines go to the relevant manager when the template has
    no fixed owner."""
    templates = (
        db.query(HrChecklistTemplate)
        .filter(HrChecklistTemplate.event_type == event.event_type, HrChecklistTemplate.is_active == True)  # noqa: E712
        .order_by(HrChecklistTemplate.sort_order, HrChecklistTemplate.id)
        .all()
    )
    manager_id = event.to_manager_id or event.from_manager_id
    items = []
    for idx, t in enumerate(templates):
        owner = t.default_owner_user_id
        if owner is None and t.category == "manager":
            owner = manager_id
        item = HrChecklistItem(
            template_id=t.id, category=t.category, title=t.title, owner_user_id=owner,
            status="pending", sort_order=t.sort_order if t.sort_order is not None else idx,
        )
        event.items.append(item)
        items.append(item)
    return items


def notify_item_owners(db: Session, event: HrLifecycleEvent, items: list[HrChecklistItem], actor_id: int | None) -> None:
    subject = subject_name(db, event)
    per_owner: dict[int, list[str]] = {}
    for it in items:
        if it.owner_user_id and it.owner_user_id != actor_id:
            per_owner.setdefault(it.owner_user_id, []).append(it.title)
    for owner_id, titles in per_owner.items():
        listed = "; ".join(titles[:5]) + (f" and {len(titles) - 5} more" if len(titles) > 5 else "")
        notify_user(
            db, owner_id,
            title=f"{EVENT_TYPE_LABELS.get(event.event_type, event.event_type)} checklist: {subject}",
            message=f"{event.event_no} — you own {len(titles)} task(s): {listed}. Mark them done in HR > Lifecycle.",
            notification_type="hr_checklist_assigned", entity_type=ENTITY_TYPE, entity_id=event.id,
        )


def subject_name(db: Session, event: HrLifecycleEvent) -> str:
    if event.user_id:
        u = db.get(User, event.user_id)
        if u:
            return user_label(u)
    return event.candidate_name or event.candidate_email or "candidate"


# ── Departments / approvals the person holds ───────────────────────────

def departments_headed(db: Session, user_id: int) -> list[tuple[Department, list[str]]]:
    out = []
    for d in db.query(Department).order_by(Department.name).all():
        slots = []
        if d.head_user_id == user_id:
            slots.append("head")
        if d.secondary_head_user_id == user_id:
            slots.append("secondary")
        if user_id in (d.additional_head_user_ids or []):
            slots.append("additional")
        if slots:
            out.append((d, slots))
    return out


def replace_department_head(dept: Department, old_id: int, new_id: int | None) -> None:
    """Swap `old_id` out of every head slot of `dept` for `new_id` (or
    remove it when new_id is None) without creating duplicates."""
    heads = [dept.head_user_id, dept.secondary_head_user_id] + list(dept.additional_head_user_ids or [])
    replaced: list[int] = []
    for h in heads:
        if h is None:
            continue
        v = new_id if h == old_id else h
        if v is not None and v not in replaced:
            replaced.append(v)
    dept.head_user_id = replaced[0] if replaced else None
    dept.secondary_head_user_id = replaced[1] if len(replaced) > 1 else None
    dept.additional_head_user_ids = replaced[2:]


def pending_p2p_approvals(db: Session, user_id: int) -> list[tuple[P2PRequest, list[tuple[str, str, str, str]]]]:
    """PRs still waiting on `user_id` in a Department/Project/Plant Head slot.
    Only 'submitted' PRs are awaiting head approval (see
    P2PRequest.pending_approval_roles and _check_approve_access)."""
    rows = (
        db.query(P2PRequest)
        .filter(P2PRequest.status == "submitted")
        .filter(or_(P2PRequest.approver_id == user_id, P2PRequest.project_head_id == user_id, P2PRequest.plant_head_id == user_id))
        .order_by(P2PRequest.id)
        .all()
    )
    out = []
    for pr in rows:
        slots = [s for s in P2P_SLOTS if getattr(pr, s[0]) == user_id and getattr(pr, s[2]) is None]
        if slots:
            out.append((pr, slots))
    return out


def _pending_hr_approval_queries(db: Session, user_id: int):
    return [
        ("leave", "Leave request", db.query(HrLeaveRequest).filter(HrLeaveRequest.approver_id == user_id, HrLeaveRequest.status == "pending")),
        ("regularization", "Attendance regularization", db.query(HrAttendanceRegularization).filter(HrAttendanceRegularization.approver_id == user_id, HrAttendanceRegularization.status == "pending")),
        ("travel", "Travel request", db.query(HrTravelRequest).filter(HrTravelRequest.approver_id == user_id, HrTravelRequest.status == "pending")),
        ("claim", "Expense claim", db.query(HrExpenseClaim).filter(HrExpenseClaim.approver_id == user_id, HrExpenseClaim.status == "submitted")),
    ]


def _ref(row) -> str:
    return getattr(row, "request_no", None) or getattr(row, "claim_no", None) or f"#{row.id}"


def _names(db: Session, ids: set[int]) -> dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: user_label(u) for u in db.query(User).filter(User.id.in_(ids)).all()}


# ── Impact preview ──────────────────────────────────────────────────────

def compute_impact(db: Session, event: HrLifecycleEvent) -> dict[str, Any]:
    """Everything the person holds that a leaver (or mover) completion
    would have to deal with. Read-only."""
    if not event.user_id:
        return {
            "user": None, "event_type": event.event_type, "needs_handover": False,
            "pending_checklist_items": [
                {"id": i.id, "title": i.title, "category": i.category, "owner_user_id": i.owner_user_id}
                for i in event.items if i.status == "pending"
            ],
            "unreturned_assets": [], "direct_reportees": [], "departments_headed": [], "role_flags": [],
            "pending_hr_approvals": [], "pending_p2p_approvals": [], "p2p_buyer_requests": [],
            "checklist_items_owned": [], "templates_owned": [], "own_open_requests": [],
            "own_open_p2p_requests": [], "auto_buyer_categories": [], "warnings": [],
            "blockers": {"pending_checklist_items": 0, "unreturned_assets": 0},
        }
    uid = event.user_id
    user = db.get(User, uid)
    warnings: list[str] = []

    pending_items = [i for i in event.items if i.status == "pending"]
    owner_names = _names(db, {i.owner_user_id for i in pending_items if i.owner_user_id})

    assets = (
        db.query(HrAsset)
        .filter(HrAsset.current_holder_id == uid, HrAsset.is_deleted == False)  # noqa: E712
        .order_by(HrAsset.asset_code).all()
    )
    reportees = (
        db.query(User).filter(User.reporting_manager_id == uid, User.is_active == True, User.id != uid)  # noqa: E712
        .order_by(User.name).all()
    )
    depts = departments_headed(db, uid)
    flags = [f for f in ROLE_FLAG_LABELS if getattr(user, f, False)] if user else []

    hr_approvals = []
    for kind, label, q in _pending_hr_approval_queries(db, uid):
        for row in q.all():
            hr_approvals.append({"kind": kind, "label": label, "id": row.id, "ref": _ref(row), "requester_id": row.user_id})
    req_names = _names(db, {a["requester_id"] for a in hr_approvals})
    for a in hr_approvals:
        a["requester_name"] = req_names.get(a["requester_id"])

    p2p = pending_p2p_approvals(db, uid)
    p2p_req_names = _names(db, {pr.requested_by_id for pr, _ in p2p if pr.requested_by_id})
    buyer_rows = (
        db.query(P2PRequest)
        .filter(P2PRequest.assigned_buyer_id == uid, P2PRequest.status.notin_(P2P_CLOSED_STATUSES))
        .order_by(P2PRequest.id).all()
    )

    other_items = (
        db.query(HrChecklistItem, HrLifecycleEvent)
        .join(HrLifecycleEvent, HrLifecycleEvent.id == HrChecklistItem.event_id)
        .filter(
            HrChecklistItem.owner_user_id == uid, HrChecklistItem.status == "pending",
            HrLifecycleEvent.id != event.id, HrLifecycleEvent.status.in_(("draft", "in_progress")),
        ).all()
    )
    templates = db.query(HrChecklistTemplate).filter(HrChecklistTemplate.default_owner_user_id == uid).all()

    own = []
    for row in db.query(HrLeaveRequest).filter(HrLeaveRequest.user_id == uid, HrLeaveRequest.status == "pending").all():
        own.append({"kind": "leave", "label": "Leave request", "id": row.id, "ref": row.request_no, "status": row.status, "action": "cancel"})
    for row in db.query(HrAttendanceRegularization).filter(HrAttendanceRegularization.user_id == uid, HrAttendanceRegularization.status == "pending").all():
        own.append({"kind": "regularization", "label": "Attendance regularization", "id": row.id, "ref": row.request_no, "status": row.status, "action": "cancel"})
    for row in db.query(HrTravelRequest).filter(HrTravelRequest.user_id == uid, HrTravelRequest.status.in_(("pending", "approved"))).all():
        own.append({
            "kind": "travel", "label": "Travel request", "id": row.id, "ref": row.request_no, "status": row.status,
            "action": "cancel" if row.status == "pending" else "keep",
        })
    for row in db.query(HrExpenseClaim).filter(HrExpenseClaim.user_id == uid, HrExpenseClaim.status.in_(("draft", "submitted", "approved"))).all():
        own.append({
            "kind": "claim", "label": "Expense claim", "id": row.id, "ref": row.claim_no, "status": row.status,
            "action": "cancel" if row.status == "draft" else "keep",
            "amount": float(row.total_amount or 0),
        })
    kept_claims = [o for o in own if o["kind"] == "claim" and o["action"] == "keep"]
    if kept_claims:
        warnings.append(
            f"{len(kept_claims)} expense claim(s) are submitted or approved but not paid — settle them in the full & final "
            "settlement in ADP; they are not cancelled."
        )

    own_p2p = (
        db.query(P2PRequest)
        .filter(P2PRequest.requested_by_id == uid, P2PRequest.status.notin_(P2P_CLOSED_STATUSES))
        .order_by(P2PRequest.id).all()
    )
    if own_p2p:
        warnings.append(
            f"{len(own_p2p)} purchase requisition(s) raised by this person are still open. They are not cancelled — "
            "the buyer and approvers carry on; ask the department to take them over."
        )

    auto_buyer = sorted(code for code, email in P2P_CATEGORY_AUTO_BUYERS.items() if user and email.lower() == (user.email or "").lower())
    if auto_buyer:
        warnings.append(
            f"This person is the hard-coded auto-assigned buyer for P2P categories {', '.join(auto_buyer)} "
            "(P2P_CATEGORY_AUTO_BUYERS in app/modules/p2p/models/p2p_request.py). New PRs in those categories will keep "
            "auto-assigning to them until that mapping is changed and redeployed."
        )

    needs_handover = bool(reportees or depts or hr_approvals or p2p or buyer_rows or other_items or templates)
    if event.event_type in ("transfer", "promotion"):
        needs_handover = False  # optional for movers; asked for explicitly on completion

    return {
        "user": {"id": user.id, "name": user.name, "email": user.email, "is_active": user.is_active} if user else None,
        "event_type": event.event_type,
        "pending_checklist_items": [
            {"id": i.id, "title": i.title, "category": i.category, "owner_user_id": i.owner_user_id,
             "owner_name": owner_names.get(i.owner_user_id)}
            for i in pending_items
        ],
        "unreturned_assets": [
            {"id": a.id, "asset_code": a.asset_code, "name": a.name, "category": a.category,
             "serial_number": a.serial_number, "status": a.status}
            for a in assets
        ],
        "direct_reportees": [
            {"id": r.id, "name": r.name, "email": r.email, "designation": r.designation, "department": r.department}
            for r in reportees
        ],
        "departments_headed": [{"id": d.id, "name": d.name, "code": d.code, "slots": slots} for d, slots in depts],
        "role_flags": [{"flag": f, "label": ROLE_FLAG_LABELS[f]} for f in flags],
        "pending_hr_approvals": hr_approvals,
        "pending_p2p_approvals": [
            {"id": pr.id, "p2p_number": pr.p2p_number, "roles": [s[3] for s in slots],
             "requested_by_id": pr.requested_by_id, "requested_by_name": p2p_req_names.get(pr.requested_by_id),
             "department": pr.department}
            for pr, slots in p2p
        ],
        "p2p_buyer_requests": [{"id": pr.id, "p2p_number": pr.p2p_number, "status": pr.status} for pr in buyer_rows],
        "checklist_items_owned": [
            {"id": it.id, "title": it.title, "event_id": ev.id, "event_no": ev.event_no} for it, ev in other_items
        ],
        "templates_owned": [{"id": t.id, "title": t.title, "event_type": t.event_type} for t in templates],
        "own_open_requests": own,
        "own_open_p2p_requests": [{"id": pr.id, "p2p_number": pr.p2p_number, "status": pr.status} for pr in own_p2p],
        "auto_buyer_categories": auto_buyer,
        "needs_handover": needs_handover,
        "blockers": {"pending_checklist_items": len(pending_items), "unreturned_assets": len(assets)},
        "warnings": warnings,
    }


# ── Validation helpers ──────────────────────────────────────────────────

def load_active_user(db: Session, user_id: int, role: str) -> User:
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(status_code=400, detail=f"The {role} (user #{user_id}) doesn't exist. Pick someone from the list again.")
    if not u.is_active:
        raise HTTPException(
            status_code=400,
            detail=f"{user_label(u)} is deactivated, so they can't be the {role}. Pick an active employee.",
        )
    return u


def validate_refs(db: Session, *, department_id=None, branch_id=None, designation_id=None, grade_id=None, manager_id=None, subject_user_id=None) -> None:
    if department_id and not db.get(Department, department_id):
        raise HTTPException(status_code=400, detail=f"Department #{department_id} doesn't exist. Pick one from the list, or add it in Organization > Departments.")
    if branch_id and not db.get(Branch, branch_id):
        raise HTTPException(status_code=400, detail=f"Plant #{branch_id} doesn't exist. Pick one from the list, or add it in Organization > Plants.")
    if designation_id:
        d = db.get(HrDesignation, designation_id)
        if not d:
            raise HTTPException(status_code=400, detail=f"Designation #{designation_id} doesn't exist. Pick one from the list, or add it in HR > Masters > Designations.")
        if not d.is_active:
            raise HTTPException(status_code=400, detail=f"Designation '{d.name}' is inactive. Re-activate it in HR > Masters or pick another.")
    if grade_id:
        g = db.get(HrGrade, grade_id)
        if not g:
            raise HTTPException(status_code=400, detail=f"Grade #{grade_id} doesn't exist. Pick one from the list, or add it in HR > Masters > Grades.")
        if not g.is_active:
            raise HTTPException(status_code=400, detail=f"Grade '{g.code}' is inactive. Re-activate it in HR > Masters or pick another.")
    if manager_id:
        if subject_user_id and manager_id == subject_user_id:
            raise HTTPException(status_code=400, detail="An employee can't be their own reporting manager. Pick a different manager.")
        load_active_user(db, manager_id, "reporting manager")


# ── Completion ─────────────────────────────────────────────────────────

def _audit_user(db: Session, target: User, summary: str, old: dict, new: dict, actor: User) -> None:
    record_audit(
        db, entity_type="user", entity_id=target.id, action="update", module_key=MODULE_KEY,
        summary=summary, old_value=old, new_value=new, user_id=actor.id,
    )


def _ensure_profile(db: Session, user: User, actor: User) -> tuple[HrEmployeeProfile, bool]:
    profile = get_profile(db, user.id)
    if profile:
        return profile, False
    profile = HrEmployeeProfile(
        user_id=user.id,
        department_id=match_department_id(db, user.department),
        designation_id=match_designation_id(db, user.designation),
        branch_id=user.branch_id,
        employment_status="active",
        created_by_id=actor.id, updated_by_id=actor.id,
    )
    db.add(profile)
    db.flush()
    return profile, True


def _name_of(db: Session, model, obj_id: int | None, attr: str = "name") -> str | None:
    if not obj_id:
        return None
    obj = db.get(model, obj_id)
    return getattr(obj, attr, None) if obj else None


def ensure_joining_can_activate(user: User, profile: HrEmployeeProfile | None) -> None:
    """A joining may re-activate an account only for an exited rehire.
    Any other deactivated account was switched off by an admin (security
    incident, removed from Azure, ...), and re-activating it is admin-only
    (Users & Roles > Activate)."""
    if user.is_active or (profile is not None and profile.employment_status == "exited"):
        return
    raise HTTPException(
        status_code=409,
        detail=(
            f"{user_label(user)}'s portal account was deactivated by an admin, and they aren't an exited employee being "
            "rehired, so a joining can't switch it back on. Ask an admin to re-activate the account in Users & Roles "
            "first, then complete this joining."
        ),
    )


def complete_joining(db: Session, event: HrLifecycleEvent, payload, actor: User) -> dict:
    if not event.user_id:
        raise HTTPException(
            status_code=400,
            detail=(
                "This joining isn't linked to a portal user yet. Once the new joiner's Microsoft account exists and they "
                "(or an admin sync) have created their portal user, use 'Link user' on this event, then complete it."
            ),
        )
    user = db.get(User, event.user_id)
    profile = get_profile(db, user.id)
    ensure_joining_can_activate(user, profile)
    if profile and profile.employment_status not in ("onboarding", "exited"):
        raise HTTPException(
            status_code=409,
            detail=(
                f"{user_label(user)} is already an employee with status '{profile.employment_status}'. A joining is only for new "
                "hires or rehires — use a transfer or promotion event to change their department, designation or manager."
            ),
        )
    employment_type = payload.employment_type or (profile.employment_type if profile else None) or "permanent"
    if employment_type not in EMPLOYMENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Employment type '{employment_type}' isn't valid. Use one of: {', '.join(EMPLOYMENT_TYPES)}.")
    if payload.employee_code:
        clash = db.query(HrEmployeeProfile).filter(
            func.lower(HrEmployeeProfile.employee_code) == payload.employee_code.strip().lower(),
            HrEmployeeProfile.user_id != user.id,
        ).first()
        if clash:
            other = db.get(User, clash.user_id)
            raise HTTPException(status_code=409, detail=f"Employee code '{payload.employee_code}' is already used by {user_label(other)}. Enter a different code.")
    validate_refs(db, department_id=event.to_department_id, branch_id=event.to_branch_id, designation_id=event.to_designation_id,
                  grade_id=event.to_grade_id, manager_id=event.to_manager_id, subject_user_id=user.id)

    created = False
    if not profile:
        profile, created = _ensure_profile(db, user, actor)
    rehire = profile.employment_status == "exited"
    status = "probation" if employment_type in PROBATION_TYPES or payload.probation_end_date else "active"
    profile.employment_type = employment_type
    profile.employment_status = status
    if payload.employee_code:
        profile.employee_code = payload.employee_code.strip()
    if payload.probation_end_date:
        profile.probation_end_date = payload.probation_end_date
    if event.to_department_id:
        profile.department_id = event.to_department_id
    if event.to_designation_id:
        profile.designation_id = event.to_designation_id
    if event.to_grade_id:
        profile.grade_id = event.to_grade_id
    if event.to_branch_id:
        profile.branch_id = event.to_branch_id
    if rehire:
        profile.date_of_exit = None
        profile.exit_reason = None
    profile.updated_by_id = actor.id

    old_user = {"department": user.department, "designation": user.designation, "branch_id": user.branch_id,
                "reporting_manager_id": user.reporting_manager_id, "date_of_joining": user.date_of_joining, "is_active": user.is_active}
    doj = event.effective_date or date.today()
    user.date_of_joining = doj
    if event.to_manager_id:
        user.reporting_manager_id = event.to_manager_id
    apply_org_fields(db, user, profile)
    if rehire:
        user.is_active = True  # only an exited rehire is re-activated (see ensure_joining_can_activate)
    new_user = {"department": user.department, "designation": user.designation, "branch_id": user.branch_id,
                "reporting_manager_id": user.reporting_manager_id, "date_of_joining": user.date_of_joining, "is_active": user.is_active}
    _audit_user(db, user, f"Joining {event.event_no} completed for {user_label(user)}", old_user, new_user, actor)

    changes = [
        f"Employee profile {'created' if created else 'updated'} — status {status}, employment type {employment_type}",
        f"Date of joining set to {doj.strftime('%d-%m-%Y')}",
    ]
    if rehire:
        changes.append("Rehire: previous exit cleared and the portal account re-activated")
    for label, before, after in (
        ("Department", old_user["department"], user.department),
        ("Designation", old_user["designation"], user.designation),
        ("Reporting manager", _name_of(db, User, old_user["reporting_manager_id"]), _name_of(db, User, user.reporting_manager_id)),
        ("Plant", _name_of(db, Branch, old_user["branch_id"]), _name_of(db, Branch, user.branch_id)),
    ):
        if before != after:
            changes.append(f"{label}: {before or '—'} → {after or '—'}")
    return {"changes": changes, "profile_id": profile.id, "employment_status": status}


def complete_confirmation(db: Session, event: HrLifecycleEvent, payload, actor: User) -> dict:
    user = db.get(User, event.user_id)
    profile = get_profile(db, event.user_id)
    if not profile:
        raise HTTPException(
            status_code=409,
            detail=f"{user_label(user)} has no employee profile yet, so there is no probation to confirm. Create their profile in HR > Employees first.",
        )
    if profile.employment_status not in ("probation", "onboarding"):
        raise HTTPException(
            status_code=409,
            detail=f"{user_label(user)} is '{profile.employment_status}', not on probation, so there is nothing to confirm. Cancel this event if it was raised by mistake.",
        )
    before = profile.employment_status
    confirm_date = event.effective_date or date.today()
    profile.employment_status = "active"
    profile.confirmation_date = confirm_date
    changes = [f"Status: {before} → active", f"Confirmation date set to {confirm_date.strftime('%d-%m-%Y')}"]
    if profile.employment_type == "probation":
        profile.employment_type = "permanent"
        changes.append("Employment type: probation → permanent")
    profile.updated_by_id = actor.id
    return {"changes": changes}


def _reassign_p2p(db: Session, user_id: int, new_user: User, actor: User, event: HrLifecycleEvent) -> tuple[list[str], list[str]]:
    """Move every pending P2P head-approval slot from user_id to new_user.
    A slot is left alone (and reported) when new_user raised that PR —
    they can't approve their own requisition."""
    changes, conflicts = [], []
    for pr, slots in pending_p2p_approvals(db, user_id):
        if pr.requested_by_id == new_user.id:
            conflicts.append(
                f"{pr.p2p_number}: {user_label(new_user)} raised this PR, so it can't be handed to them — reassign its "
                f"{', '.join(s[3] for s in slots)} approval manually in P2P."
            )
            continue
        old = {s[0]: getattr(pr, s[0]) for s in slots}
        for id_col, name_col, _at, _label in slots:
            setattr(pr, id_col, new_user.id)
            setattr(pr, name_col, new_user.name)
        record_audit(
            db, entity_type="p2p_request", entity_id=pr.id, action="update", module_key=MODULE_KEY,
            summary=f"{', '.join(s[3] for s in slots)} approval on {pr.p2p_number} reassigned to {user_label(new_user)} ({event.event_no})",
            old_value=old, new_value={s[0]: new_user.id for s in slots}, user_id=actor.id,
        )
        changes.append(f"{pr.p2p_number}: {', '.join(s[3] for s in slots)} approval → {user_label(new_user)}")
    return changes, conflicts


def _clear_flags(db: Session, user: User, flags, actor: User, event: HrLifecycleEvent) -> list[str]:
    cleared = [f for f in flags if getattr(user, f, False)]
    if not cleared:
        return []
    for f in cleared:
        setattr(user, f, False)
    _audit_user(db, user, f"Approval roles removed from {user_label(user)} ({event.event_no}): {', '.join(ROLE_FLAG_LABELS[f] for f in cleared)}",
                {f: True for f in cleared}, {f: False for f in cleared}, actor)
    return [ROLE_FLAG_LABELS[f] for f in cleared]


def complete_move(db: Session, event: HrLifecycleEvent, payload, actor: User) -> dict:
    """Transfer or promotion: apply the to_* fields to profile + user."""
    user = db.get(User, event.user_id)
    to_fields = (event.to_department_id, event.to_branch_id, event.to_designation_id, event.to_grade_id, event.to_manager_id)
    if not any(to_fields):
        raise HTTPException(
            status_code=400,
            detail="Nothing to apply — set at least one of the new department, plant, designation, grade or reporting manager on this event, then complete it.",
        )
    validate_refs(db, department_id=event.to_department_id, branch_id=event.to_branch_id, designation_id=event.to_designation_id,
                  grade_id=event.to_grade_id, manager_id=event.to_manager_id, subject_user_id=user.id)
    bad_flags = [f for f in payload.clear_head_flags if f not in HEAD_FLAGS]
    if bad_flags:
        raise HTTPException(status_code=400, detail=f"Unknown head flag(s) {', '.join(bad_flags)}. Use any of: {', '.join(HEAD_FLAGS)}.")
    if payload.department_head_slots not in ("keep", "remove", "reassign"):
        raise HTTPException(status_code=400, detail="department_head_slots must be 'keep', 'remove' or 'reassign'.")
    handover = None
    if payload.department_head_slots == "reassign" or payload.reassign_pending_approvals:
        handover_id = payload.handover_to_id or event.handover_to_id
        if not handover_id:
            raise HTTPException(
                status_code=400,
                detail="Pick who takes over (the successor) — it's needed to reassign the old department head slot or the pending P2P approvals.",
            )
        if handover_id == user.id:
            raise HTTPException(status_code=400, detail="The successor can't be the same person who is moving. Pick someone else.")
        handover = load_active_user(db, handover_id, "successor")
        event.handover_to_id = handover.id

    profile, created = _ensure_profile(db, user, actor)
    changes: list[str] = []
    if created:
        changes.append("Employee profile created (there was none)")
    for label, attr, new_id, model in (
        ("Department", "department_id", event.to_department_id, Department),
        ("Plant", "branch_id", event.to_branch_id, Branch),
        ("Designation", "designation_id", event.to_designation_id, HrDesignation),
    ):
        if new_id and getattr(profile, attr) != new_id:
            changes.append(f"{label}: {_name_of(db, model, getattr(profile, attr)) or '—'} → {_name_of(db, model, new_id)}")
            setattr(profile, attr, new_id)
    if event.to_grade_id and profile.grade_id != event.to_grade_id:
        changes.append(f"Grade: {_name_of(db, HrGrade, profile.grade_id, 'code') or '—'} → {_name_of(db, HrGrade, event.to_grade_id, 'code')}")
        profile.grade_id = event.to_grade_id
    profile.updated_by_id = actor.id

    old_user = {"department": user.department, "designation": user.designation, "branch_id": user.branch_id,
                "reporting_manager_id": user.reporting_manager_id}
    if event.to_manager_id and user.reporting_manager_id != event.to_manager_id:
        changes.append(f"Reporting manager: {_name_of(db, User, user.reporting_manager_id) or '—'} → {_name_of(db, User, event.to_manager_id)}")
        user.reporting_manager_id = event.to_manager_id
    apply_org_fields(db, user, profile)
    new_user = {"department": user.department, "designation": user.designation, "branch_id": user.branch_id,
                "reporting_manager_id": user.reporting_manager_id}
    if old_user != new_user:
        _audit_user(db, user, f"{EVENT_TYPE_LABELS[event.event_type]} {event.event_no} applied to {user_label(user)}", old_user, new_user, actor)

    cleared = _clear_flags(db, user, payload.clear_head_flags, actor, event)
    if cleared:
        changes.append(f"Approval roles removed: {', '.join(cleared)}")

    conflicts: list[str] = []
    if payload.department_head_slots != "keep" and event.from_department_id:
        dept = db.get(Department, event.from_department_id)
        if dept and user.id in ([dept.head_user_id, dept.secondary_head_user_id] + list(dept.additional_head_user_ids or [])):
            new_head = handover.id if payload.department_head_slots == "reassign" and handover else None
            if new_head and not is_same_unit(db, dept, new_head):
                new_head = None
                changes.append(f"{user_label(handover)} is in another unit, so not made head of {dept.name} — set a head from that unit")
            replace_department_head(dept, user.id, new_head)
            changes.append(
                f"Head of {dept.name}: {user_label(user)} → {user_label(handover)}" if new_head
                else f"Removed {user_label(user)} as head of {dept.name}"
            )
    if payload.reassign_pending_approvals and handover:
        p2p_changes, conflicts = _reassign_p2p(db, user.id, handover, actor, event)
        changes.extend(p2p_changes)
    return {"changes": changes, "conflicts": conflicts}


def complete_exit(db: Session, event: HrLifecycleEvent, payload, actor: User) -> dict:
    """The leaver path. Everything happens in the caller's single
    transaction: reassign, cancel, deactivate, revoke, audit, notify."""
    user = db.get(User, event.user_id)
    if user.id == actor.id:
        raise HTTPException(status_code=403, detail="You can't complete your own exit. Another HR user has to do it.")
    impact = compute_impact(db, event)

    blockers = impact["blockers"]
    if (blockers["pending_checklist_items"] or blockers["unreturned_assets"]) and not payload.force:
        parts = []
        if blockers["pending_checklist_items"]:
            parts.append(f"{blockers['pending_checklist_items']} checklist item(s) still pending")
        if blockers["unreturned_assets"]:
            codes = ", ".join(a["asset_code"] for a in impact["unreturned_assets"][:5])
            parts.append(f"{blockers['unreturned_assets']} company asset(s) not returned ({codes})")
        raise HTTPException(
            status_code=409,
            detail=(
                f"Can't complete the exit yet: {' and '.join(parts)}. Mark the checklist items done or not applicable and "
                "record the asset returns in HR > Assets — or tick 'Complete anyway' and give the reason."
            ),
        )
    if payload.force and not (payload.force_reason or "").strip():
        raise HTTPException(status_code=400, detail="You chose to complete the exit anyway — write the reason in the remarks box so it's on record.")

    handover_id = payload.handover_to_id or event.handover_to_id
    handover: User | None = None
    if handover_id:
        if handover_id == user.id:
            raise HTTPException(status_code=400, detail="The handover person can't be the leaver themself. Pick their successor or manager.")
        handover = load_active_user(db, handover_id, "handover person")
        event.handover_to_id = handover.id
    if impact["needs_handover"] and not handover:
        parts = []
        for key, label in (
            ("direct_reportees", "direct reportee(s)"), ("departments_headed", "department head slot(s)"),
            ("pending_hr_approvals", "pending HR approval(s)"), ("pending_p2p_approvals", "pending P2P approval(s)"),
            ("p2p_buyer_requests", "open PR(s) as buyer"), ("checklist_items_owned", "checklist task(s) on other events"),
            ("templates_owned", "checklist template(s) as default owner"),
        ):
            if impact[key]:
                parts.append(f"{len(impact[key])} {label}")
        raise HTTPException(
            status_code=400,
            detail=(
                f"{user_label(user)} still holds {', '.join(parts)}. Pick a handover person (successor or manager) so these "
                "can be reassigned, then complete the exit."
            ),
        )

    summary: dict[str, Any] = {"reassigned_to": {"id": handover.id, "name": user_label(handover)} if handover else None}
    changes: list[str] = []
    conflicts: list[str] = []

    # 1. Direct reportees -> handover
    reportee_names = []
    for r in db.query(User).filter(User.reporting_manager_id == user.id, User.id != user.id).all():
        new_mgr = handover.id if handover and handover.id != r.id else None
        _audit_user(db, r, f"Reporting manager of {user_label(r)} changed from leaver {user_label(user)} ({event.event_no})",
                    {"reporting_manager_id": user.id}, {"reporting_manager_id": new_mgr}, actor)
        r.reporting_manager_id = new_mgr
        if r.is_active:
            reportee_names.append(r.name)
            if new_mgr:
                notify_user(db, r.id, "Your reporting manager has changed",
                            f"{user_label(user)} has left. You now report to {user_label(handover)}.",
                            "hr_manager_changed", entity_type=ENTITY_TYPE, entity_id=event.id)
    if reportee_names:
        changes.append(f"{len(reportee_names)} direct reportee(s) now report to {user_label(handover)}")
    summary["reportees"] = reportee_names

    # 2. Department head slots -> handover
    dept_names = []
    headless = []
    for dept, _slots in departments_headed(db, user.id):
        # A head is only handed over within the department's own unit.
        new_head = handover.id if handover and is_same_unit(db, dept, handover.id) else None
        replace_department_head(dept, user.id, new_head)
        (dept_names if new_head else headless).append(dept.name)
    if dept_names:
        changes.append(f"Head of {', '.join(dept_names)} → {user_label(handover)}")
    if headless:
        changes.append(f"Removed as head of {', '.join(headless)} — handover person is in another unit; set a head from that unit")
    summary["departments"] = dept_names

    # 3. HR approvals waiting on the leaver -> handover (or HR queue when the
    #    handover person is the requester — nobody decides their own request)
    hr_moved = []
    for kind, label, q in _pending_hr_approval_queries(db, user.id):
        for row in q.all():
            if handover and row.user_id != handover.id:
                row.approver_id = handover.id
                hr_moved.append(f"{label} {_ref(row)}")
            else:
                row.approver_id = None
                hr_moved.append(f"{label} {_ref(row)} (to the HR queue — the handover person raised it)")
    if hr_moved:
        changes.append(f"{len(hr_moved)} pending HR approval(s) reassigned")
    summary["hr_approvals"] = hr_moved

    # 4. P2P head approvals + buyer queue
    p2p_changes: list[str] = []
    if handover:
        p2p_changes, p2p_conflicts = _reassign_p2p(db, user.id, handover, actor, event)
        conflicts.extend(p2p_conflicts)
        for pr in db.query(P2PRequest).filter(P2PRequest.assigned_buyer_id == user.id, P2PRequest.status.notin_(P2P_CLOSED_STATUSES)).all():
            record_audit(
                db, entity_type="p2p_request", entity_id=pr.id, action="update", module_key=MODULE_KEY,
                summary=f"Buyer on {pr.p2p_number} reassigned from leaver {user_label(user)} to {user_label(handover)} ({event.event_no})",
                old_value={"assigned_buyer_id": user.id}, new_value={"assigned_buyer_id": handover.id}, user_id=actor.id,
            )
            pr.assigned_buyer_id = handover.id
            p2p_changes.append(f"{pr.p2p_number}: buyer → {user_label(handover)}")
    if p2p_changes:
        changes.append(f"{len(p2p_changes)} P2P approval/buyer assignment(s) reassigned")
    summary["p2p"] = p2p_changes

    # 5. Checklist tasks on other events + template default owner
    task_moves = []
    for it in db.query(HrChecklistItem).join(HrLifecycleEvent, HrLifecycleEvent.id == HrChecklistItem.event_id).filter(
        HrChecklistItem.owner_user_id == user.id, HrChecklistItem.status == "pending",
        HrLifecycleEvent.id != event.id, HrLifecycleEvent.status.in_(("draft", "in_progress")),
    ).all():
        it.owner_user_id = handover.id if handover else None
        task_moves.append(it.title)
    for t in db.query(HrChecklistTemplate).filter(HrChecklistTemplate.default_owner_user_id == user.id).all():
        t.default_owner_user_id = handover.id if handover else None
        task_moves.append(f"template: {t.title}")
    if task_moves:
        changes.append(f"{len(task_moves)} checklist task(s)/template(s) handed over")
    summary["checklist_tasks"] = task_moves

    # 6. The leaver's own pending requests -> cancelled
    now = _now()
    cancelled = []
    for row in db.query(HrLeaveRequest).filter(HrLeaveRequest.user_id == user.id, HrLeaveRequest.status == "pending").all():
        row.status = "cancelled"
        row.cancelled_at = now
        row.decision_remarks = f"Cancelled automatically — employee exited ({event.event_no})."
        cancelled.append(f"Leave {row.request_no}")
    for row in db.query(HrAttendanceRegularization).filter(HrAttendanceRegularization.user_id == user.id, HrAttendanceRegularization.status == "pending").all():
        row.status = "cancelled"
        row.decision_remarks = f"Cancelled automatically — employee exited ({event.event_no})."
        cancelled.append(f"Regularization {row.request_no}")
    for row in db.query(HrTravelRequest).filter(HrTravelRequest.user_id == user.id, HrTravelRequest.status == "pending").all():
        row.status = "cancelled"
        row.decision_remarks = f"Cancelled automatically — employee exited ({event.event_no})."
        cancelled.append(f"Travel {row.request_no}")
    for row in db.query(HrExpenseClaim).filter(HrExpenseClaim.user_id == user.id, HrExpenseClaim.status == "draft").all():
        row.status = "cancelled"
        row.decision_remarks = f"Cancelled automatically — employee exited ({event.event_no})."
        cancelled.append(f"Claim {row.claim_no}")
    if cancelled:
        changes.append(f"{len(cancelled)} of the leaver's own pending request(s) cancelled")
    summary["cancelled_requests"] = cancelled

    # 7. Approval role flags off
    cleared = _clear_flags(db, user, list(ROLE_FLAG_LABELS), actor, event)
    if cleared:
        changes.append(f"Approval roles removed: {', '.join(cleared)}")
    summary["role_flags_cleared"] = cleared

    # 8. Profile -> exited
    profile, _created = _ensure_profile(db, user, actor)
    exit_date = event.last_working_day or event.effective_date or date.today()
    profile.employment_status = "exited"
    profile.date_of_exit = exit_date
    profile.exit_reason = event.exit_reason or event.exit_type
    profile.updated_by_id = actor.id
    changes.append(f"Employee profile marked exited on {exit_date.strftime('%d-%m-%Y')}")

    # 9. Account off + every session revoked
    was_active = user.is_active
    user.is_active = False
    revoked = revoke_user_sessions(db, user.id)
    _audit_user(db, user, f"Portal account of {user_label(user)} deactivated on exit {event.event_no}; {revoked} session(s) revoked",
                {"is_active": was_active}, {"is_active": False, "sessions_revoked": revoked}, actor)
    changes.append(f"Portal account deactivated and {revoked} signed-in session(s) revoked")
    summary["sessions_revoked"] = revoked

    summary["outstanding_assets"] = [f"{a['asset_code']} {a['name']}" for a in impact["unreturned_assets"]]
    summary["pending_checklist_items"] = [i["title"] for i in impact["pending_checklist_items"]]
    if payload.force:
        summary["forced"] = True
        summary["force_reason"] = payload.force_reason.strip()
    summary["warnings"] = impact["warnings"]

    if handover:
        notify_user(
            db, handover.id, title=f"Handover from {user_label(user)}",
            message=(
                f"{user_label(user)} has exited ({event.event_no}). You now own: "
                + ("; ".join(changes[:-2]) if len(changes) > 2 else "nothing further")
                + ". Review your P2P and HR approval queues."
            ),
            notification_type="hr_exit_handover", entity_type=ENTITY_TYPE, entity_id=event.id,
        )
    return {"changes": changes, "conflicts": conflicts, **summary}


def complete_event(db: Session, event: HrLifecycleEvent, payload, actor: User) -> dict:
    if event.status in ("completed", "cancelled"):
        raise HTTPException(status_code=409, detail=f"{event.event_no} is already {event.status}. Start a new event if something else needs to change.")
    if event.status == "draft":
        raise HTTPException(status_code=409, detail=f"{event.event_no} is still a draft. Start it (set it to In progress) before completing it.")
    if event.event_type != "joining" and not event.user_id:
        raise HTTPException(status_code=400, detail=f"{event.event_no} has no employee on it. Cancel it and raise a new one for the right employee.")
    if event.user_id and event.user_id == actor.id:
        raise HTTPException(status_code=403, detail="You can't complete a lifecycle event about yourself. Another HR user has to do it.")

    if event.event_type == "joining":
        result = complete_joining(db, event, payload, actor)
    elif event.event_type == "confirmation":
        result = complete_confirmation(db, event, payload, actor)
    elif event.event_type in ("transfer", "promotion"):
        result = complete_move(db, event, payload, actor)
    elif event.event_type == "exit":
        result = complete_exit(db, event, payload, actor)
    else:  # pragma: no cover — validated on create
        raise HTTPException(status_code=400, detail=f"Unknown event type '{event.event_type}'.")

    if payload.remarks:
        event.remarks = f"{event.remarks}\n{payload.remarks}".strip() if event.remarks else payload.remarks
    result["completed_on"] = date.today().isoformat()
    result["completed_by"] = user_label(actor)
    event.status = "completed"
    event.completed_by_id = actor.id
    event.completed_at = _now()
    event.completion_summary = result

    record_audit(
        db, entity_type=ENTITY_TYPE, entity_id=event.id, action="completed", module_key=MODULE_KEY,
        summary=f"{EVENT_TYPE_LABELS[event.event_type]} {event.event_no} completed for {subject_name(db, event)}: "
                + ("; ".join(result.get("changes", [])) or "no changes"),
        new_value=result, user_id=actor.id,
    )
    broadcast_notification(
        db, title=f"{EVENT_TYPE_LABELS[event.event_type]} completed: {subject_name(db, event)}",
        message=f"{event.event_no} was completed by {user_label(actor)}. " + ("; ".join(result.get("changes", [])[:4])),
        notification_type="hr_lifecycle_completed", entity_type=ENTITY_TYPE, entity_id=event.id,
        exclude_user_id=actor.id, app_name="hr",
    )
    return result
