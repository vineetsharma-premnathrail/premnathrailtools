"""Read-only history lists for a project page and a machine page: what was issued
from Store, what was bought (requisition -> purchase order -> goods receipt) and
which tasks were worked, for one Project Management project.

The route files (projects/routes/project_history.py and erp/routes/machine_history.py)
own the permission and data-scope checks; this module only reads rows and shapes them.
Everything is batch-loaded (one query per level), never per row."""
from __future__ import annotations

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.core.permission_registry import can_feature, can_perform, can_view_tab
from app.modules.crm.models.organization import Organization
from app.modules.erp.models.service_request import ServiceRequest
from app.modules.main.models.user import User
from app.modules.organization.models.department import Department
from app.modules.p2p.models.goods_receipt import P2PGoodsReceipt
from app.modules.p2p.models.p2p_request import P2P_PURPOSES, P2PRequest
from app.modules.p2p.models.p2p_request_item import P2PRequestItem
from app.modules.p2p.models.purchase_order import P2PPurchaseOrder
from app.modules.projects.models.task import PmProjectTask, PmTaskSubtask
from app.modules.rnd.models.project_task import RndProjectTask
from app.modules.store.models.item import StoreItem
from app.modules.store.models.location import StoreLocation
from app.modules.store.models.material_issue import StoreMaterialIssue, StoreMaterialIssueItem
from app.modules.store.routes.doc_types import doc_type_labels

# The requisition list hides drafts: a draft is private to whoever is still writing it.
PR_HIDDEN_STATUSES = ("draft",)

PR_STATUS_LABELS = {
    "submitted": "Waiting for approval", "returned": "Returned for changes", "rejected": "Rejected",
    "cancelled": "Cancelled", "approved": "Approved - with procurement", "vendor_quotations": "RFQ out for quotes",
    "technical_evaluation": "Technical evaluation", "commercial_evaluation": "Commercial evaluation",
    "vendor_selected": "Vendor chosen", "po_drafted": "PO being prepared", "po_raised": "PO in approval",
    "po_approved": "PO approved", "partially_received": "Partly received", "received": "Received", "closed": "Closed",
}
PO_STATUS_LABELS = {
    "draft": "Draft", "issued": "Issued", "acknowledged": "Acknowledged", "partially_fulfilled": "Partly received",
    "fulfilled": "Fulfilled", "cancelled": "Cancelled",
}
GRN_STATUS_LABELS = {"draft": "Draft", "completed": "Received", "reversed": "Reversed"}
TASK_STATUS_LABELS = {"todo": "To do", "in_progress": "In progress", "on_hold": "On hold", "blocked": "Blocked", "done": "Done", "cancelled": "Cancelled"}
# R&D task workflow statuses (rnd_project_tasks): open → closed; submitted is an older "done" state.
RND_TASK_STATUS_LABELS = {"open": "Open", "submitted": "Completed", "closed": "Completed", "cancelled": "Cancelled"}
TASK_OPEN = ("todo", "in_progress", "on_hold", "blocked", "open")


def _label(labels: dict[str, str], key: str | None) -> str:
    key = key or ""
    return labels.get(key, key.replace("_", " ").capitalize())


def _user_names(db: Session, ids) -> dict[int, str]:
    wanted = {i for i in ids if i}
    if not wanted:
        return {}
    return {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(wanted)).all()}


def sees_po_values(user: User) -> bool:
    """PO totals show only to people who hold Procurement > Purchase Orders > Prices (or Edit on that tab,
    who type the rates). Someone with no Procurement access at all does NOT see money here, unlike the
    Procurement screens themselves: a project page must not become a way round the Prices switch."""
    if not can_view_tab(user, "p2p", "purchase_orders"):
        return False
    return can_feature(user, "p2p", "purchase_orders", "prices", "view") or can_perform(user, "p2p", "purchase_orders", "edit")


# ── Store issues ─────────────────────────────────────────────────────────

def store_issues(db: Session, project_id: int, machine_id: int | None = None) -> list[dict]:
    """Issues charged to PM project `project_id`; for a machine page (`machine_id`) also the issues made
    against the machine itself and against its service requests. `project_id` may be None (machine
    without a project). Newest first."""
    conds = []
    if project_id:
        conds.append(StoreMaterialIssue.order_project_id == project_id)
    if machine_id:
        conds.append(StoreMaterialIssue.erp_project_id == machine_id)
        sr_ids = db.query(ServiceRequest.id).filter(ServiceRequest.project_id == machine_id)
        conds.append(StoreMaterialIssue.service_request_id.in_(sr_ids))
    if not conds:
        return []
    issues = (
        db.query(StoreMaterialIssue).filter(or_(*conds))
        .order_by(StoreMaterialIssue.issue_date.desc(), StoreMaterialIssue.id.desc()).all()
    )
    if not issues:
        return []
    issue_ids = [i.id for i in issues]
    lines = db.query(StoreMaterialIssueItem).filter(StoreMaterialIssueItem.issue_id.in_(issue_ids)).order_by(StoreMaterialIssueItem.id).all()
    items = {x.id: x for x in db.query(StoreItem).filter(StoreItem.id.in_({l.item_id for l in lines})).all()} if lines else {}
    lines_by_issue: dict[int, list[dict]] = {}
    for l in lines:
        item = items.get(l.item_id)
        lines_by_issue.setdefault(l.issue_id, []).append({
            "item_code": item.item_code if item else None, "item_name": item.item_name if item else None,
            "quantity": l.quantity, "uom": item.uom if item else None,
        })
    names = _user_names(db, {i.requested_by_id for i in issues})
    dept_ids = {i.department_id for i in issues if i.department_id}
    depts = {d.id: d.name for d in db.query(Department).filter(Department.id.in_(dept_ids)).all()} if dept_ids else {}
    cust_ids = {i.customer_id for i in issues if i.customer_id}
    customers = {o.id: o.name for o in db.query(Organization).filter(Organization.id.in_(cust_ids)).all()} if cust_ids else {}
    loc_ids = {i.location_id for i in issues if i.location_id}
    locations = {l.id: l.name for l in db.query(StoreLocation).filter(StoreLocation.id.in_(loc_ids)).all()} if loc_ids else {}
    type_labels = doc_type_labels(db, "issue")

    out = []
    for i in issues:
        to = [x for x in (names.get(i.requested_by_id), depts.get(i.department_id), customers.get(i.customer_id), i.vendor_name) if x]
        rows = lines_by_issue.get(i.id, [])
        out.append({
            "id": i.id, "issue_number": i.issue_number, "issue_date": i.issue_date, "issue_type": i.issue_type,
            "issue_type_label": type_labels.get(i.issue_type) if i.issue_type else None,
            # An issue posts its stock movement the moment it is saved, so every row on file is issued.
            "status": "issued", "issued_to": " · ".join(to) or None,
            "store_name": locations.get(i.location_id), "line_count": len(rows), "lines": rows,
        })
    return out


# ── Purchases ────────────────────────────────────────────────────────────

def purchases(db: Session, project_id: int | None, show_prices: bool) -> list[dict]:
    """Requisitions charged to the project (header or any line), each with its purchase orders and their
    goods receipts. Newest first. Draft requisitions are left out."""
    if not project_id:
        return []
    line_prs = db.query(P2PRequestItem.p2p_request_id).filter(P2PRequestItem.order_project_id == project_id)
    prs = (
        db.query(P2PRequest)
        .filter(or_(P2PRequest.order_project_id == project_id, P2PRequest.id.in_(line_prs)),
                P2PRequest.status.notin_(PR_HIDDEN_STATUSES))
        .order_by(P2PRequest.request_date.desc(), P2PRequest.id.desc()).all()
    )
    if not prs:
        return []
    pr_ids = [p.id for p in prs]
    counts = dict(
        db.query(P2PRequestItem.p2p_request_id, func.count(P2PRequestItem.id))
        .filter(P2PRequestItem.p2p_request_id.in_(pr_ids)).group_by(P2PRequestItem.p2p_request_id).all()
    )
    pos = db.query(P2PPurchaseOrder).filter(P2PPurchaseOrder.p2p_request_id.in_(pr_ids)).order_by(P2PPurchaseOrder.po_date, P2PPurchaseOrder.id).all()
    grns = (
        db.query(P2PGoodsReceipt).filter(P2PGoodsReceipt.purchase_order_id.in_([po.id for po in pos]))
        .order_by(P2PGoodsReceipt.received_date, P2PGoodsReceipt.id).all()
    ) if pos else []
    grns_by_po: dict[int, list[dict]] = {}
    for g in grns:
        grns_by_po.setdefault(g.purchase_order_id, []).append({
            "id": g.id, "grn_number": g.grn_number, "grn_date": g.received_date,
            "status": g.status, "status_label": _label(GRN_STATUS_LABELS, g.status),
        })
    pos_by_pr: dict[int, list[dict]] = {}
    for po in pos:
        pos_by_pr.setdefault(po.p2p_request_id, []).append({
            "id": po.id, "po_number": po.po_number, "vendor_name": po.vendor_name, "po_date": po.po_date,
            "status": po.status, "status_label": _label(PO_STATUS_LABELS, po.status),
            "total_amount": po.total_value if show_prices else None, "grns": grns_by_po.get(po.id, []),
        })
    names = _user_names(db, {p.requested_by_id for p in prs})
    return [{
        "id": p.id, "pr_number": p.p2p_number, "pr_date": p.request_date,
        "purpose_label": P2P_PURPOSES.get(p.purpose) if p.purpose else None,
        "status": p.status, "status_label": _label(PR_STATUS_LABELS, p.status),
        "requested_by_name": names.get(p.requested_by_id), "line_count": counts.get(p.id, 0),
        "pos": pos_by_pr.get(p.id, []),
    } for p in prs]


# ── Tasks ────────────────────────────────────────────────────────────────

def task_history(db: Session, project_id: int | None) -> list[dict]:
    """Every task of the project, read-only: the PM tasks inside its milestones
    (pm_task_subtasks, top level — a milestone is pm_project_tasks) and the R&D tasks
    given on the project from R&D › R&D Tasks (rnd_project_tasks.pm_project_id).
    Open ones first (earliest due date first, undated last), then finished and
    cancelled ones (latest finished first)."""
    if not project_id:
        return []
    milestones = {m.id: m for m in db.query(PmProjectTask).filter(PmProjectTask.project_id == project_id).all()}
    pm_tasks = db.query(PmTaskSubtask).filter(PmTaskSubtask.task_id.in_(list(milestones)), PmTaskSubtask.parent_id.is_(None)).all() if milestones else []
    rnd_tasks = db.query(RndProjectTask).filter(RndProjectTask.pm_project_id == project_id).all()
    if not pm_tasks and not rnd_tasks:
        return []
    dept_ids = {m.department_id for m in milestones.values() if m.department_id}
    depts = {d.id: d.name for d in db.query(Department).filter(Department.id.in_(dept_ids)).all()} if dept_ids else {}
    names = _user_names(db, {t.assignee_id for t in pm_tasks} | {t.created_by_id for t in pm_tasks}
                        | {t.assigned_to_id for t in rnd_tasks} | {t.created_by_id for t in rnd_tasks})

    def checklist_of(items) -> list[dict]:
        return [{"text": i.get("text") or "", "done": bool(i.get("done"))} for i in (items or []) if isinstance(i, dict)]

    rows = []
    for t in pm_tasks:
        m = milestones.get(t.task_id)
        rows.append({
            "id": t.id, "kind": "pm", "title": t.title, "milestone_name": m.title if m else None,
            "department_name": depts.get(m.department_id) if m else None,
            "assignee_name": names.get(t.assignee_id), "created_by_name": names.get(t.created_by_id),
            "due_date": t.due_date, "start_date": t.start_date, "status": t.status,
            "status_label": _label(TASK_STATUS_LABELS, t.status), "completed_at": t.completed_at,
            "priority": t.priority or "standard", "progress_percent": 100 if t.status == "done" else None,
            "description": t.description, "checklist": [],
        })
    for t in rnd_tasks:
        rows.append({
            "id": t.id, "kind": "rnd", "title": t.title, "milestone_name": None, "department_name": "R&D",
            "assignee_name": names.get(t.assigned_to_id), "created_by_name": names.get(t.created_by_id),
            "due_date": t.due_date, "start_date": t.start_date, "status": t.status,
            "status_label": _label(RND_TASK_STATUS_LABELS, t.status), "completed_at": t.closed_at,
            "priority": t.priority or "standard", "progress_percent": t.progress_percent or 0,
            "description": t.remarks, "checklist": checklist_of(t.checklist),
        })

    def key(r: dict):
        if r["status"] in TASK_OPEN:
            return (0, r["due_date"] is None, r["due_date"].toordinal() if r["due_date"] else 0, r["kind"], r["id"])
        done = r["completed_at"].timestamp() if r["completed_at"] else 0
        return (1, False, -done, r["kind"], r["id"])

    return sorted(rows, key=key)
