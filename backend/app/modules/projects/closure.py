"""Project closure: the checklist that gates "Close project" and the Final
Project Report (an editable Word document of record).

Standard closure (PMBOK "Close Project", SAP PS technical → business close):
every WBS accepted, no open work left, deliverables on record, documents
filed, and a final report with schedule performance and lessons learned.
Costs are not part of the checklist yet — project costing comes later.
"""
from datetime import date

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.data_scope import ensure_in_scope
from app.core.permission_registry import can_perform
from app.modules.main.models.user import User
from app.modules.main.services import managed_documents
from app.modules.organization.models.department import Department
from app.modules.projects import workflow as wf
from app.modules.projects.models.document import PmProjectDocument
from app.modules.projects.models.milestone import PmProjectMilestone
from app.modules.projects.models.project import PmProject
from app.modules.projects.models.task import PmProjectTask, PmTaskTimeLog, PM_TASK_OPEN_STATUSES

REPORT_ENTITY = "pm_project_closure_report"


def _wbs(db: Session, project_id: int) -> list[PmProjectMilestone]:
    return db.query(PmProjectMilestone).filter(PmProjectMilestone.project_id == project_id).order_by(
        PmProjectMilestone.sequence, PmProjectMilestone.id).all()


def _evidence_counts(db: Session, project_id: int) -> dict[int, int]:
    rows = db.query(PmProjectDocument.milestone_id, func.count(PmProjectDocument.id)).filter(
        PmProjectDocument.project_id == project_id, PmProjectDocument.milestone_id.isnot(None),
        PmProjectDocument.task_id.is_(None), PmProjectDocument.message_id.is_(None),
        PmProjectDocument.is_deleted == False,  # noqa: E712
    ).group_by(PmProjectDocument.milestone_id).all()
    return {mid: n for mid, n in rows}


def checklist(db: Session, project: PmProject) -> list[dict]:
    wbs = [m for m in _wbs(db, project.id) if m.status != "cancelled"]
    pending = [m.title for m in wbs if m.status != "achieved"]
    open_tasks = db.query(PmProjectTask.title).filter(
        PmProjectTask.project_id == project.id, PmProjectTask.status.in_(PM_TASK_OPEN_STATUSES)).all()
    evidence = _evidence_counts(db, project.id)
    no_evidence = [m.title for m in wbs if m.status == "achieved" and not evidence.get(m.id)]
    report = managed_documents.get_active(db, REPORT_ENTITY, project.id)

    def names(items: list[str]) -> str:
        return ", ".join(items[:5]) + (f" and {len(items) - 5} more" if len(items) > 5 else "")

    rows = [
        {"key": "wbs_accepted", "label": "Every WBS accepted", "ok": bool(wbs) and not pending,
         "detail": (f"Not accepted yet: {names(pending)}." if pending else None) if wbs else "The project has no WBS elements."},
        {"key": "no_open_tasks", "label": "No open tasks", "ok": not open_tasks,
         "detail": f"{len(open_tasks)} task(s) still open: {names([t for (t,) in open_tasks])}. Cancel or finish them." if open_tasks else None},
        {"key": "deliverables", "label": "Deliverable evidence on every WBS", "ok": not no_evidence, "required": False,
         "detail": f"No evidence file on: {names(no_evidence)}. The handover note is the only record of these." if no_evidence else None},
        {"key": "final_report", "label": "Final Project Report created", "ok": report is not None,
         "detail": None if report else "Create the Final Project Report below, review it in Word, then close."},
        {"key": "documents_archived", "label": "Project documents archived", "ok": project.documents_archived_at is not None,
         "detail": None if project.documents_archived_at else "Confirm when closing that every drawing, report and certificate is filed in Documents."},
    ]
    if not wbs:
        # Projects without WBS elements (the UI no longer has a WBS tab):
        # the WBS rows don't apply.
        rows = [r for r in rows if r["key"] not in ("wbs_accepted", "deliverables")]
    return rows


def require_closable(db: Session, project: PmProject) -> None:
    """Checks every required item except the archive confirmation, which
    the close request itself supplies."""
    failed = [c for c in checklist(db, project) if c.get("required", True) and not c["ok"] and c["key"] != "documents_archived"]
    if failed:
        raise HTTPException(status_code=409, detail="Can't close yet — " + " ".join(
            f"{c['label']}: {c['detail'] or 'not done.'}" for c in failed))


# ── Final Project Report ───────────────────────────────────────────────

def _d(value: date | None) -> str:
    return value.strftime("%d-%m-%Y") if value else "—"


def report_context(db: Session, project: PmProject) -> dict:
    wbs = _wbs(db, project.id)
    depts = {d.id: d.name for d in db.query(Department).all()}
    evidence = _evidence_counts(db, project.id)
    tasks = db.query(PmProjectTask).filter(PmProjectTask.project_id == project.id).all()
    task_wbs = {t.id: t.milestone_id for t in tasks}
    logged: dict[int | None, float] = {}
    for task_id, hours in db.query(PmTaskTimeLog.task_id, PmTaskTimeLog.hours).join(
            PmProjectTask, PmProjectTask.id == PmTaskTimeLog.task_id).filter(PmProjectTask.project_id == project.id).all():
        logged[task_wbs.get(task_id)] = logged.get(task_wbs.get(task_id), 0.0) + (hours or 0)

    rows, effort = [], {}
    for m in wbs:
        slip = (m.actual_date - (m.original_target_date or m.target_date)).days if m.actual_date else None
        own = [t for t in tasks if t.milestone_id == m.id and t.status != "cancelled"]
        rows.append({
            "no": m.sequence, "title": m.title, "department": depts.get(m.department_id, "—"),
            "lead": wf.name_of(db, m.lead_user_id) or "—",
            "planned": _d(m.original_target_date or m.target_date), "actual": _d(m.actual_date),
            "slip": "—" if slip is None else (f"+{slip} d" if slip > 0 else ("on time" if slip == 0 else f"{slip} d")),
            "status": wf.MILESTONE_STATUS_LABELS.get(m.status, m.status), "evidence": evidence.get(m.id, 0),
            "deliverable": m.deliverable or "", "handover_note": m.submission_note or "",
            "cancel_reason": m.cancel_reason if m.status == "cancelled" else "",
        })
        dept = depts.get(m.department_id, "No department")
        e = effort.setdefault(dept, {"tasks": 0, "estimated": 0.0, "logged": 0.0})
        e["tasks"] += len(own)
        e["estimated"] += sum(t.estimated_hours or 0 for t in own)
        e["logged"] += logged.get(m.id, 0.0)

    end = project.technically_completed_on or project.closure_date or date.today()
    target = project.target_handover_date
    variance = (end - target).days if end and target else None
    return {
        "code": project.project_code, "name": project.name, "client": project.client_name, "po": project.customer_po_ref,
        "pm": wf.name_of(db, project.project_manager_id) or "—", "scope": project.description,
        "start": _d(project.start_date), "released": _d(project.released_at.date() if project.released_at else None),
        "target": _d(target), "completed": _d(end), "closed": _d(project.closure_date),
        "variance": "—" if variance is None else (f"{variance} days late" if variance > 0 else ("on target" if variance == 0 else f"{-variance} days early")),
        "wbs": rows, "effort": [(k, v["tasks"], v["estimated"], v["logged"]) for k, v in effort.items()],
        "late": [r for r in rows if r["slip"].startswith("+")],
        "closure_note": project.closure_note, "lessons": project.lessons_learned,
    }


def _report_target(db: Session, project_id: int, user: User, modify: bool) -> managed_documents.DocumentTarget:
    from app.modules.projects.reports.closure_report_docx import build_closure_report_docx
    project = db.get(PmProject, project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project #{project_id} not found — it may have been deleted.")
    if project.status not in ("planning", "active", "technically_complete", "closed"):
        raise HTTPException(status_code=409, detail=f"{project.project_code} is {wf.PROJECT_STATUS_LABELS.get(project.status, project.status)}. "
                                                    "The Final Project Report can only be made for an open or closed project.")
    if not can_perform(user, "projects", "overview", "edit" if modify else "view"):
        action = "Edit" if modify else "View"
        raise HTTPException(status_code=403, detail=f"You don't have '{action}' permission on Project Management › Overview. Ask an admin to add it to one of your roles in Organization › Role & Permissions.")
    ensure_in_scope(db, user, project)
    if modify:
        wf.require_manage(project, user, "prepare the Final Project Report")
    return managed_documents.DocumentTarget(
        entity_id=project.id, revision=0, title=f"Final Project Report {project.project_code}",
        folder=managed_documents.sharepoint_folder("Projects", project.project_code),
        filename_stem=managed_documents.safe_filename(f"Final-Project-Report-{project.project_code}"),
        build_docx=lambda: build_closure_report_docx(report_context(db, project)).getvalue(),
    )


managed_documents.register(managed_documents.DocumentAdapter(entity_type=REPORT_ENTITY, app="projects", load=_report_target))
