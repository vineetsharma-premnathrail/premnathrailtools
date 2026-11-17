"""R&D Tasks board: one list + analytics over the two task tables
(requirement tasks and project tasks).

There is no task "type" column — type is which table a task lives in and, for
a project task, which parent it has: "requirement", "prototype" (a Prototype /
Research project) or "project" (a Project Management "All Projects" project,
rnd_project_tasks.pm_project_id — since 2026-11-03; or a past machine of All Projects,
rnd_project_tasks.machine_id — since 2026-11-17, shown under type "project" with the serial as reference). A row is built once (`collect`) and the list,
the summary tiles, the per-person and the per-project views all read the same
filtered rows, so they always agree (AC-54).

Buckets (mutually exclusive, so the tiles add up — AC-53):
  completed = closed; overdue = open and due before today (IST);
  pending = every other live task; cancelled is excluded from tiles and
  progress and appears only when the status filter asks for it.
Project / requirement progress = average progress of its non-cancelled tasks.
Department = the assignee's department in the user master.

Scope (AC-55): the analytics feature, the R&D head and admins see every task;
everyone else sees the tasks assigned to or created by them — applied in SQL
before anything is counted.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Any

from fastapi import HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.permission_registry import can_feature
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.tender import Tender
from app.modules.crm.services.requirement_movement import today_ist
from app.modules.erp.models.project import Project as ErpMachine
from app.modules.main.models.user import User
from app.modules.projects.models.project import PmProject
from app.modules.rnd.models.project import RndProject
from app.modules.rnd.models.project_task import RndProjectTask
from app.modules.rnd.models.requirement import RndRequirement, RndRequirementRevision
from app.modules.rnd.models.requirement_work import RndRequirementTask
from app.modules.rnd.services import requirement_access as ra
from app.modules.rnd.services import requirements as intake
from app.core.priority import map_legacy_priority
from app.core.record_ref import encode_ref

TYPES = ("requirement", "prototype", "project")
STATUS_FILTERS = ("open", "submitted", "closed", "cancelled", "overdue", "pending")
# The page's "Completed" filter sends "completed"; the stored status is "closed".
STATUS_ALIASES = {"completed": "closed"}
PROGRESS_BANDS = ("0", "1-49", "50-99", "100")
MAX_PAGE_SIZE = 200


def sees_all(db: Session, user: User) -> bool:
    """Analytics feature, R&D head or admin."""
    if user.role == "admin" or ra.is_head(db, user):
        return True
    return can_feature(user, "rnd", "tasks", "analytics", "view")


def _bucket(status: str, due: date, today: date) -> str:
    if status == "cancelled":
        return "cancelled"
    if status == "closed":
        return "completed"
    if status == "open" and due < today:
        return "overdue"
    return "pending"


def _band(progress: int) -> str:
    if progress <= 0:
        return "0"
    if progress < 50:
        return "1-49"
    if progress < 100:
        return "50-99"
    return "100"


def natural_key(text: str | None) -> list:
    """Sort key that reads numbers as numbers: PEW-2 < PEW-10 < PEW-77 < PEW-77-1 < PEW-78."""
    return [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", (text or "").lower())]


def _user_label(u: User | None) -> str | None:
    return (u.name or u.email) if u else None


def with_refs(parent: dict) -> dict:
    """Signed references for the page URLs (never raw ids): `id_ref` for a project / requirement
    header, `record_id_ref` for the inquiry / tender behind a requirement."""
    out = dict(parent)
    if out.get("id"):
        out["id_ref"] = encode_ref(out["id"])
    if out.get("record_id"):
        out["record_id_ref"] = encode_ref(out["record_id"])
    return out


def _requirement_parents(db: Session, tasks: list[RndRequirementTask]) -> tuple[dict[tuple[str, int], dict], set[tuple[str, int]]]:
    """(parents, deleted): the parent card of each requirement (3 queries per source however many tasks)
    and the (source, record_id) pairs whose inquiry / tender is soft-deleted — those tasks are hidden."""
    keys = {(t.source, t.record_id) for t in tasks}
    out: dict[tuple[str, int], dict] = {}
    deleted: set[tuple[str, int]] = set()
    for source, model in (("inquiry", Inquiry), ("tender", Tender)):
        ids = [rid for s, rid in keys if s == source]
        if not ids:
            continue
        reqs = {r.record_id: r for r in db.query(RndRequirement).filter(RndRequirement.source == source, RndRequirement.record_id.in_(ids)).all()}
        for rec in db.query(model).filter(model.id.in_(ids)).all():
            if rec.is_deleted:
                deleted.add((source, rec.id))
                continue
            req = reqs.get(rec.id)
            title = rec.product if source == "inquiry" else rec.tender_name
            out[(source, rec.id)] = {
                "kind": "requirement", "id": req.id if req else None, "source": source, "record_id": rec.id,
                "ref": req.rd_number if req else (rec.universal_id or f"{source} #{rec.id}"), "title": title,
            }
    return out, deleted


def _changed_flags(db: Session, tasks: list[RndRequirementTask]) -> dict[int, bool]:
    """Same answer as intake.changed_flags (a newer revision arrived and is not accepted yet, AC-16),
    for the whole board in two queries instead of two per requirement."""
    keys = {(t.source, t.record_id) for t in tasks if t.revision_no is not None}
    latest: dict[tuple[str, int], tuple[int, str]] = {}
    for source in ("inquiry", "tender"):
        ids = [rid for s, rid in keys if s == source]
        if not ids:
            continue
        reqs = {r.id: (source, r.record_id) for r in db.query(RndRequirement).filter(RndRequirement.source == source, RndRequirement.record_id.in_(ids)).all()}
        if not reqs:
            continue
        for rev in db.query(RndRequirementRevision).filter(RndRequirementRevision.requirement_id.in_(list(reqs))).order_by(RndRequirementRevision.revision_no.asc()).all():
            latest[reqs[rev.requirement_id]] = (rev.revision_no, rev.status)  # ascending: the last one wins
    out: dict[int, bool] = {}
    for t in tasks:
        state = latest.get((t.source, t.record_id)) if t.revision_no is not None else None
        out[t.id] = bool(state and state[0] > t.revision_no and state[1] not in intake.WORK_OPEN)
    return out


def collect(db: Session, user: User, filters: dict[str, Any]) -> list[dict]:
    """Every task row the user may see that matches `filters`, in board order
    (parent reference ascending, then task id ascending)."""
    today = today_ist()
    wanted_type = filters.get("type")
    if wanted_type and wanted_type not in TYPES:
        raise HTTPException(status_code=422, detail=f"Type '{wanted_type}' isn't valid — pick Requirement, Prototype or Project.")
    status = filters.get("status")
    status = STATUS_ALIASES.get(status, status) if status else status
    if status and status not in STATUS_FILTERS:
        raise HTTPException(status_code=422, detail=f"Status '{status}' isn't valid — pick one of {', '.join(STATUS_FILTERS)}.")
    band = filters.get("progress_band")
    if band and band not in PROGRESS_BANDS:
        raise HTTPException(status_code=422, detail=f"Progress band '{band}' isn't valid — pick one of {', '.join(PROGRESS_BANDS)}.")
    priority = filters.get("priority")
    if priority:
        from app.core.priority import parse_priority
        priority = parse_priority(priority)
    mine_only = not sees_all(db, user)

    rows: list[dict] = []

    def base(model):
        q = db.query(model)
        if mine_only:
            q = q.filter(or_(model.assigned_to_id == user.id, model.created_by_id == user.id))
        if filters.get("assigned_to_id"):
            q = q.filter(model.assigned_to_id == filters["assigned_to_id"])
        if filters.get("due_from"):
            q = q.filter(model.due_date >= filters["due_from"])
        if filters.get("due_to"):
            q = q.filter(model.due_date <= filters["due_to"])
        if priority:
            q = q.filter(model.priority == priority)
        if status in ("open", "submitted", "closed", "cancelled"):
            q = q.filter(model.status == status)
        return q

    req_tasks: list[RndRequirementTask] = []
    if (wanted_type in (None, "requirement") and not filters.get("rnd_project_id") and not filters.get("pm_project_id")
            and not filters.get("machine_id")):
        q = base(RndRequirementTask)
        if filters.get("requirement_id"):
            rq = db.get(RndRequirement, filters["requirement_id"])
            q = q.filter(RndRequirementTask.source == (rq.source if rq else ""), RndRequirementTask.record_id == (rq.record_id if rq else -1))
        req_tasks = q.all()
    proj_tasks: list[RndProjectTask] = []
    if wanted_type in (None, "prototype", "project") and not filters.get("requirement_id"):
        q = base(RndProjectTask)
        if filters.get("rnd_project_id"):
            q = q.filter(RndProjectTask.project_id == filters["rnd_project_id"])
        elif filters.get("pm_project_id"):
            q = q.filter(RndProjectTask.pm_project_id == filters["pm_project_id"])
        elif filters.get("machine_id"):
            q = q.filter(RndProjectTask.machine_id == filters["machine_id"])
        elif wanted_type == "prototype":
            q = q.filter(RndProjectTask.project_id.isnot(None))
        elif wanted_type == "project":
            q = q.filter(or_(RndProjectTask.pm_project_id.isnot(None), RndProjectTask.machine_id.isnot(None)))
        proj_tasks = q.all()

    uids = {t.assigned_to_id for t in req_tasks + proj_tasks} | {t.created_by_id for t in req_tasks + proj_tasks}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    parents_req, deleted_reqs = _requirement_parents(db, req_tasks)
    rnd_ids = {t.project_id for t in proj_tasks if t.project_id}
    pm_ids = {t.pm_project_id for t in proj_tasks if t.pm_project_id}
    machine_ids = {t.machine_id for t in proj_tasks if t.machine_id}
    machines = {m.id: m for m in db.query(ErpMachine).filter(ErpMachine.id.in_(machine_ids)).all()} if machine_ids else {}
    projects = {p.id: p for p in db.query(RndProject).filter(RndProject.id.in_(rnd_ids)).all()} if rnd_ids else {}
    pm_projects = {p.id: p for p in db.query(PmProject).filter(PmProject.id.in_(pm_ids)).all()} if pm_ids else {}
    # Tasks of a deleted inquiry / tender, Prototype / Research project or machine would only 404 when opened.
    req_tasks = [t for t in req_tasks if (t.source, t.record_id) not in deleted_reqs]
    proj_tasks = [t for t in proj_tasks if not (
        (t.project_id and projects.get(t.project_id) is not None and projects[t.project_id].is_deleted)
        or (t.machine_id and machines.get(t.machine_id) is not None and machines[t.machine_id].is_deleted))]
    changed = _changed_flags(db, req_tasks)

    def row(kind: str, t, parent: dict, changed_flag: bool) -> dict:
        assignee = users.get(t.assigned_to_id)
        bucket = _bucket(t.status, t.due_date, today)
        return {
            "key": f"{kind}-{t.id}", "id": t.id, "type": kind, "title": t.title, "parent": parent,
            "assignee": {"id": t.assigned_to_id, "name": _user_label(assignee), "department": assignee.department if assignee else None},
            "creator": {"id": t.created_by_id, "name": _user_label(users.get(t.created_by_id))},
            "priority": map_legacy_priority(t.priority), "status": t.status, "bucket": bucket, "work_status": t.work_status,
            "progress_percent": t.progress_percent or 0, "progress_from_checklist": bool(t.checklist),
            "start_date": t.start_date.isoformat() if t.start_date else None, "due_date": t.due_date.isoformat(),
            "closed_at": t.closed_at.isoformat() if t.closed_at else None,
            "days_overdue": (today - t.due_date).days if bucket == "overdue" else 0,
            "parent_task_id": t.parent_task_id, "requirement_changed": changed_flag,
        }

    for t in req_tasks:
        parent = parents_req.get((t.source, t.record_id)) or {
            "kind": "requirement", "id": None, "source": t.source, "record_id": t.record_id, "ref": f"{t.source} #{t.record_id}", "title": None}
        rows.append(row("requirement", t, with_refs(parent), changed.get(t.id, False)))
    for t in proj_tasks:
        if t.machine_id:
            m = machines.get(t.machine_id)
            parent = {"kind": "machine", "id": t.machine_id, "ref": m.serial_number if m else f"Machine #{t.machine_id}",
                      "title": ((m.client_company or m.model_name or "").strip() or None) if m else None}
            rows.append(row("project", t, with_refs(parent), False))
            continue
        if t.pm_project_id:
            pm = pm_projects.get(t.pm_project_id)
            parent = {"kind": "pm_project", "id": t.pm_project_id, "ref": pm.project_code if pm else f"Project #{t.pm_project_id}", "title": pm.name if pm else None}
            rows.append(row("project", t, with_refs(parent), False))
            continue
        p = projects.get(t.project_id)
        parent = {"kind": "project", "id": t.project_id, "ref": p.project_number if p else f"RND #{t.project_id}", "title": p.title if p else None}
        rows.append(row("prototype", t, with_refs(parent), False))

    # Filters that depend on derived values.
    if status in ("overdue", "pending"):
        rows = [r for r in rows if r["bucket"] == status]
    if filters.get("department"):
        dept = filters["department"].strip().lower()
        rows = [r for r in rows if (r["assignee"]["department"] or "").strip().lower() == dept]
    if band:
        rows = [r for r in rows if _band(r["progress_percent"]) == band]
    if not status:
        # Cancelled tasks are shown only when asked for.
        rows = [r for r in rows if r["bucket"] != "cancelled"]
    term = (filters.get("q") or "").strip().lower()
    if term:
        rows = [r for r in rows if term in (r["title"] or "").lower() or term in (r["parent"]["ref"] or "").lower()
                or term in (r["parent"].get("title") or "").lower() or term in (r["assignee"]["name"] or "").lower()]
    rows.sort(key=lambda r: (natural_key(r["parent"]["ref"]), r["id"]))
    return rows


def _tally(rows: list[dict]) -> dict:
    live = [r for r in rows if r["bucket"] != "cancelled"]
    counts = {"pending": 0, "completed": 0, "overdue": 0}
    for r in live:
        counts[r["bucket"]] += 1
    return {
        "total": len(live), **counts,
        "avg_progress": round(sum(r["progress_percent"] for r in live) / len(live), 1) if live else 0,
    }


def analytics(rows: list[dict]) -> dict:
    """Tiles, per-person and per-project/requirement views from the same filtered rows."""
    by_user: dict[Any, dict] = {}
    by_parent: dict[tuple, dict] = {}
    for r in rows:
        if r["bucket"] == "cancelled":
            continue
        u = by_user.setdefault(r["assignee"]["id"], {"user_id": r["assignee"]["id"], "name": r["assignee"]["name"],
                                                     "department": r["assignee"]["department"], "rows": []})
        u["rows"].append(r)
        p = r["parent"]
        key = (p["kind"], p.get("id") or (p.get("source"), p.get("record_id")))
        g = by_parent.setdefault(key, {"kind": p["kind"], "id": p.get("id"), "id_ref": p.get("id_ref"), "source": p.get("source"),
                                       "record_id": p.get("record_id"), "record_id_ref": p.get("record_id_ref"),
                                       "ref": p["ref"], "title": p.get("title"), "rows": []})
        g["rows"].append(r)

    def finish(group: dict) -> dict:
        t = _tally(group.pop("rows"))
        return {**group, **t, "progress": t["avg_progress"]}

    return {
        "totals": _tally(rows),
        "by_user": sorted((finish(g) for g in by_user.values()), key=lambda g: (g["name"] or "")),
        "by_project": sorted((finish(g) for g in by_parent.values()), key=lambda g: natural_key(g["ref"])),
    }


def paginate(rows: list[dict], page: int, page_size: int) -> dict:
    page = max(page, 1)
    page_size = max(1, min(page_size, MAX_PAGE_SIZE))
    start = (page - 1) * page_size
    return {"items": rows[start:start + page_size], "total": len(rows), "page": page, "page_size": page_size}
