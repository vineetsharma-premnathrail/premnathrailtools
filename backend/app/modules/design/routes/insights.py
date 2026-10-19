"""Phase-4 Design reports (alongside reports.py's summary and MDL):
revision history, customer approval turnaround, ECR/ECN register,
WBS status, designer workload/on-time and first-time-right."""
from collections import defaultdict
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.design.access import is_team, require_team, team_roles
from app.modules.design.models.change_notice import DesignChangeNotice
from app.modules.design.models.change_request import DesignChangeRequest
from app.modules.design.models.document import DesignDocument, DesignDocumentRevision
from app.modules.design.models.submission import DesignCustomerSubmission
from app.modules.design.routes.documents import VIEWER_REVISION_STATUSES
from app.modules.design.routes.requests import design_department_ids
from app.modules.design.service import as_aware, user_name, users_by_id
from app.modules.design.scope import apply_scope, ensure_in_scope
from app.modules.main.models.user import User
from app.modules.projects.models.milestone import PmProjectMilestone
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.task import PmProjectTask

router = APIRouter(
    prefix="/design/reports", tags=["Design"],
    dependencies=[Depends(require_app_access("design")), Depends(require_tab_access("design", "reports"))],
)


def _days(a, b) -> float | None:
    if not a or not b:
        return None
    return round((as_aware(b) - as_aware(a)).total_seconds() / 86400, 1)


@router.get("/revision-history")
async def revision_history(
    document_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("design")),
):
    doc = db.query(DesignDocument).options(selectinload(DesignDocument.revisions)).filter(
        DesignDocument.id == document_id, DesignDocument.is_deleted == False  # noqa: E712
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail=f"Drawing #{document_id} not found.")
    ensure_in_scope(db, user, doc)
    revs = sorted((r for r in doc.revisions if not r.is_deleted), key=lambda r: r.revision_index)
    if not is_team(db, user):
        # Viewers outside the Design team see released revisions only.
        revs = [r for r in revs if r.status in VIEWER_REVISION_STATUSES]
        if not revs:
            raise HTTPException(
                status_code=404,
                detail=f"{doc.doc_number} has no released revision yet — only the Design team can see it until it's released.",
            )
    users = users_by_id(db, {u for r in revs for u in (r.created_by_id, r.reviewed_by_id, r.approved_by_id)})
    return {
        "doc_number": doc.doc_number, "title": doc.title,
        "revisions": [
            {
                "revision_label": r.revision_label, "status": r.status, "change_summary": r.change_summary,
                "author": user_name(users.get(r.created_by_id)), "checked_by": user_name(users.get(r.reviewed_by_id)),
                "approved_by": user_name(users.get(r.approved_by_id)), "created_at": r.created_at, "released_at": r.released_at,
                "superseded_at": r.superseded_at, "returns": r.returned_count, "cycle_days": _days(r.created_at, r.released_at),
            }
            for r in revs
        ],
    }


@router.get("/customer-approvals")
async def customer_approvals(db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    require_team(db, user, "see customer approval turnaround")
    subs = apply_scope(db.query(DesignCustomerSubmission).options(selectinload(DesignCustomerSubmission.lines)), user, DesignCustomerSubmission).filter(
        DesignCustomerSubmission.is_deleted == False, DesignCustomerSubmission.status.in_(("sent", "closed"))  # noqa: E712
    ).order_by(DesignCustomerSubmission.sent_date.desc()).all()
    today = date.today()
    by_customer: dict[str, dict] = defaultdict(lambda: {"submissions": 0, "drawings": 0, "approved": 0, "rejected": 0, "turnaround": []})
    rows = []
    for s in subs:
        c = by_customer[s.customer_name]
        c["submissions"] += 1
        c["drawings"] += len(s.lines)
        c["approved"] += sum(1 for line in s.lines if line.response in ("approved", "approved_with_comments"))
        c["rejected"] += sum(1 for line in s.lines if line.response == "rejected")
        turnaround = (s.response_date - s.sent_date).days if s.response_date and s.sent_date else None
        if turnaround is not None:
            c["turnaround"].append(turnaround)
        rows.append({
            "id": s.id, "submission_number": s.submission_number, "customer_name": s.customer_name, "status": s.status,
            "sent_date": s.sent_date, "response_date": s.response_date, "turnaround_days": turnaround,
            "days_waiting": (today - s.sent_date).days if s.status == "sent" and s.sent_date else None,
            "overdue": bool(s.status == "sent" and s.response_due_date and s.response_due_date < today),
            "drawings": len(s.lines), "rejected": sum(1 for line in s.lines if line.response == "rejected"),
        })
    customers = [
        {"customer_name": k, "submissions": v["submissions"], "drawings": v["drawings"], "approved": v["approved"],
         "rejected": v["rejected"], "avg_turnaround_days": round(sum(v["turnaround"]) / len(v["turnaround"]), 1) if v["turnaround"] else None}
        for k, v in sorted(by_customer.items())
    ]
    all_t = [r["turnaround_days"] for r in rows if r["turnaround_days"] is not None]
    return {"submissions": rows, "customers": customers, "avg_turnaround_days": round(sum(all_t) / len(all_t), 1) if all_t else None}


@router.get("/change-register")
async def change_register(db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    """ECR → ECN register with the time from request to release."""
    ecrs = apply_scope(db.query(DesignChangeRequest), user, DesignChangeRequest).filter(DesignChangeRequest.is_deleted == False).order_by(DesignChangeRequest.created_at.desc()).all()  # noqa: E712
    ecns = apply_scope(db.query(DesignChangeNotice), user, DesignChangeNotice).filter(DesignChangeNotice.is_deleted == False).order_by(DesignChangeNotice.created_at.desc()).all()  # noqa: E712
    by_ecr = {n.ecr_id: n for n in ecns if n.ecr_id}
    rows = []
    for e in ecrs:
        n = by_ecr.get(e.id)
        rows.append({
            "ecr_id": e.id, "ecr_number": e.ecr_number, "title": e.title, "source": e.source, "urgency": e.urgency,
            "ecr_status": e.status, "raised_at": e.created_at, "decided_at": e.decided_at,
            "ecn_id": n.id if n else None, "ecn_number": n.ecn_number if n else None, "ecn_status": n.status if n else None,
            "released_at": n.implemented_at if n else None, "closed_at": n.closed_at if n else None,
            "days_to_decision": _days(e.created_at, e.decided_at), "days_to_release": _days(e.created_at, n.implemented_at if n else None),
        })
    for n in ecns:
        if not n.ecr_id:
            rows.append({
                "ecr_id": None, "ecr_number": None, "title": n.title, "source": n.reason, "urgency": n.priority,
                "ecr_status": None, "raised_at": n.created_at, "decided_at": n.decided_at, "ecn_id": n.id,
                "ecn_number": n.ecn_number, "ecn_status": n.status, "released_at": n.implemented_at, "closed_at": n.closed_at,
                "days_to_decision": _days(n.created_at, n.decided_at), "days_to_release": _days(n.created_at, n.implemented_at),
            })
    released = [r["days_to_release"] for r in rows if r["days_to_release"] is not None]
    return {"rows": rows, "avg_days_to_release": round(sum(released) / len(released), 1) if released else None,
            "open_ecrs": sum(1 for e in ecrs if e.status in ("open", "impact_checked"))}


@router.get("/milestones")
async def milestone_status(db: Session = Depends(get_db)):
    dept_ids = design_department_ids(db)
    if not dept_ids:
        return {"rows": [], "note": "No department named 'Design' in Organization › Departments, so no project WBS elements are mapped to Design."}
    mss = db.query(PmProjectMilestone).filter(PmProjectMilestone.department_id.in_(dept_ids)).order_by(PmProjectMilestone.target_date).all()
    projects = {p.id: p for p in db.query(PmProject).filter(PmProject.id.in_({m.project_id for m in mss})).all()} if mss else {}
    today = date.today()
    return {"rows": [
        {
            "milestone_id": m.id, "title": m.title, "status": m.status, "target_date": m.target_date, "actual_date": m.actual_date,
            "project": f"{projects[m.project_id].project_code} — {projects[m.project_id].name}" if m.project_id in projects else None,
            "overdue": bool(m.status not in ("achieved", "cancelled") and m.target_date and m.target_date < today),
            "slip_days": (m.target_date - m.original_target_date).days if m.original_target_date and m.target_date else 0,
        }
        for m in mss
    ]}


@router.get("/workload")
async def workload(db: Session = Depends(get_db)):
    """Per team member: open/overdue PM tasks, tasks completed and how many on time."""
    roles = team_roles(db)
    if not roles:
        return {"rows": [], "note": "Set up the Design team in Settings to see workload per designer."}
    tasks = db.query(PmProjectTask).filter(PmProjectTask.assignee_id.in_(roles)).all()
    people = users_by_id(db, set(roles))
    today = date.today()
    rows = []
    for uid, role in roles.items():
        mine = [t for t in tasks if t.assignee_id == uid]
        done = [t for t in mine if t.status == "done"]
        on_time = [t for t in done if t.due_date and t.completed_at and as_aware(t.completed_at).date() <= t.due_date]
        rows.append({
            "user_id": uid, "name": user_name(people.get(uid)), "role": role,
            "open": sum(1 for t in mine if t.status in ("todo", "in_progress", "blocked")),
            "overdue": sum(1 for t in mine if t.status in ("todo", "in_progress", "blocked") and t.due_date and t.due_date < today),
            "done": len(done), "on_time": len(on_time),
            "on_time_pct": round(100 * len(on_time) / len([t for t in done if t.due_date]), 0) if any(t.due_date for t in done) else None,
        })
    return {"rows": sorted(rows, key=lambda r: -r["open"])}


@router.get("/first-time-right")
async def first_time_right(db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    """Drawings sent to a customer: share released without any customer
    rejection, and share passed internally without a return."""
    revs = apply_scope(db.query(DesignDocumentRevision).join(DesignDocument, DesignDocument.id == DesignDocumentRevision.document_id), user, DesignDocument).filter(
        DesignDocumentRevision.is_deleted == False, DesignDocument.is_deleted == False  # noqa: E712
    ).all()
    by_doc: dict[int, list[DesignDocumentRevision]] = defaultdict(list)
    for r in revs:
        by_doc[r.document_id].append(r)
    customer_docs = [d for d, rs in by_doc.items() if any(r.status in ("approved", "customer_rejected") or r.released_by_id for r in rs)]
    released_customer = [d for d in customer_docs if any(r.status in ("released", "superseded") for r in by_doc[d])]
    no_rejection = [d for d in released_customer if not any(r.status == "customer_rejected" for r in by_doc[d])]
    released_revs = [r for r in revs if r.status in ("released", "superseded")]
    no_return = [r for r in released_revs if r.returned_count == 0]
    return {
        "customer_drawings_released": len(released_customer),
        "customer_first_time_right": len(no_rejection),
        "customer_ftr_pct": round(100 * len(no_rejection) / len(released_customer), 1) if released_customer else None,
        "revisions_released": len(released_revs),
        "internal_first_time_right": len(no_return),
        "internal_ftr_pct": round(100 * len(no_return) / len(released_revs), 1) if released_revs else None,
    }
