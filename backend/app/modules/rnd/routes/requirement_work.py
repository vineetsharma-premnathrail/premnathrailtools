"""R&D work on a requirement: tasks the head hands out, linked projects and the
requirement's R&D documents (with their category).

Requirement = a CRM Inquiry / Tender sent to R&D, addressed by
(source, record_id). Files are stored as CrmDocument rows in folder "rnd"
(never shown on CRM's Documents tab) and are opened only through this
router, which checks the requirement access first
(rnd/services/requirement_access.py).

R&D rework 2026-10-30: no per-requirement Access tab, no Share Department
and no Milestones — the R&D side sees every requirement, people outside R&D
see the ones they hold a task on, and work is plain tasks. Creating a task
(and uploading an R&D offer / responding) needs the latest revision to be
accepted (rnd/services/requirements.py).

Task flow: head creates (title, remarks, assignee, due date, files) → assignee
works, posts updates, and completes the task themselves (remarks + files; a
delay reason when late). Past its due date an open task needs a reason and a
new completion date from the assignee, which becomes the new due date. While
working, the assignee can "ask for approval" on something task-related (a
drawing, material, deviation): the person who gave the task or the R&D head
approves / rejects it and the task stays open. Whoever gave the task can
reopen a completed task with a reason. Progress (0-100) follows the checklist
when there is one, otherwise the assignee enters it.
"""
from datetime import date, datetime, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Response, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core import assignee_rules
from app.core.config import settings
from app.core.permissions import ensure_feature_action
from app.db.session import get_db
from app.modules.crm.models.document import CrmDocument
from app.modules.crm.models.inquiry import Inquiry
from app.modules.crm.models.organization import Organization
from app.modules.crm.models.tender import Tender
from app.modules.crm.services.requirement_movement import today_ist
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.rnd.models.document import RND_DOC_CATEGORY_LABELS, RND_DOC_PICKER_CATEGORIES
from app.modules.rnd.models.project import RndProject
from app.modules.rnd.models.requirement_work import (
    RndRequirementDocVisibility, RndRequirementProjectLink, RndRequirementTask, RndTaskEvent,
)
from app.modules.rnd.services import events as rnd_events
from app.modules.rnd.services import requirement_access as ra
from app.modules.rnd.services import requirements as intake
from app.modules.rnd.services import task_approvals
from app.modules.rnd.services import task_fields
from app.utils.notifications import notify_user
from app.utils.sharepoint import build_sharepoint_folder_path, download_file_content, get_download_url, upload_file_to_sharepoint


def _require_requirement_side(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    """R&D › Requirements, or a task on a requirement — what each person may do
    on a given requirement is checked per endpoint (ra.ensure)."""
    if not ra.has_requirement_side(db, user):
        raise HTTPException(status_code=403, detail="Requirements need 'view' on R&D › Requirements, or a task on the requirement. "
                                                    "Ask an admin to add it to one of your roles (Organization › Role & Permissions), "
                                                    f"or ask the R&D head ({ra._head_names(db)}) to give you a task on it.")
    return user


RULE_KEY = "rnd:requirements.tasks"  # core/assignee_rules.PICKERS
router = APIRouter(
    prefix="/requirement-work", tags=["RnD Requirement Work"],
    dependencies=[Depends(_require_requirement_side)],
)

Source = Literal["inquiry", "tender"]
MAX_FILES = 10
REQ_DOC = "rnd_requirement"      # related_sub_module of a requirement-level R&D document
TASK_DOC = "rnd_task"            # related_sub_module of a task file
OFFER_DOC = "technical_offer"    # related_sub_module of an uploaded Technical Offer (R&D or BD)
TASK_BRIEF, TASK_WORK = "rnd_task_brief", "rnd_task_work"   # doc_category: head's files / assignee's files
TASK_APPROVAL = "rnd_task_approval"   # doc_category: files attached to an approval request
KIND = "requirement"                  # task_kind on rnd_task_approvals

# Fixed document categories (no admin editing); the list lives in rnd/models/document.py.
# "technical_offer" is set only by the offer upload flow and is not offered in the picker.
DOC_CATEGORIES = dict(RND_DOC_CATEGORY_LABELS)
UPLOAD_CATEGORIES = tuple(RND_DOC_PICKER_CATEGORIES)


# ── helpers ───────────────────────────────────────────────────────────────

def _name(u: User | None) -> str:
    return (u.name or u.email) if u else "Unknown user"


def _users(db: Session, ids) -> dict[int, User]:
    ids = {i for i in ids if i}
    return {u.id: u for u in db.query(User).filter(User.id.in_(ids)).all()} if ids else {}


def _notify(db: Session, uids, source: str, record_id: int, *, title: str, message: str, notification_type: str, teams: bool = False) -> None:
    """Bell notification linked to the requirement's page."""
    for u in _users(db, uids).values():
        entity_type, entity_id = ra.link_for(db, u, source, record_id)
        notify_user(db, u.id, title=title, message=message, notification_type=notification_type,
                    entity_type=entity_type, entity_id=entity_id, teams=teams)


def _record(db: Session, source: str, record_id: int):
    model = Inquiry if source == "inquiry" else Tender
    record = db.query(model).filter(model.id == record_id, model.is_deleted == False).first()  # noqa: E712
    if not record or not record.technical_offer_sent_at:
        raise HTTPException(status_code=404, detail=f"This {source} no longer exists in CRM or hasn't been sent to R&D — refresh the Requirements list.")
    return record


def _ref(source: str, record) -> str:
    return record.technical_offer_number or record.universal_id or f"{source} #{record.id}"


async def _store_files(db: Session, *, source: str, record, files: list[UploadFile], sub_module: str, sub_id: int | None,
                       category: str, user: User, folder: str) -> list[CrmDocument]:
    files = [f for f in (files or []) if f and f.filename]
    if not files:
        return []
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=422, detail=f"You attached {len(files)} files — attach at most {MAX_FILES} at a time.")
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="File storage (SharePoint) isn't configured on the server, so files can't be saved. Ask IT to set SHAREPOINT_SITE_ID.")
    org = db.query(Organization).filter(Organization.id == record.org_id).first()
    path = build_sharepoint_folder_path(_name(user), org.name if org else "General", f"crm/{source}/{record.universal_id or record.id}/{folder}", root_folder="CRM-media")
    out = []
    for f in files:
        result = await upload_file_to_sharepoint(settings.SHAREPOINT_SITE_ID, path, f)
        doc = CrmDocument(
            related_module=source, related_id=record.id, related_sub_module=sub_module, related_sub_id=sub_id,
            universal_id=record.universal_id, folder_type="rnd", doc_category=category,
            file_name=result["name"], file_path=result["path"], sharepoint_path=result["path"],
            sharepoint_url=result.get("webUrl"), file_size=result.get("size"), mime_type=f.content_type,
            uploaded_by_name=_name(user), org_id=record.org_id, created_by_id=user.id,
        )
        db.add(doc)
        out.append(doc)
    db.flush()
    return out


def _doc_dict(d: CrmDocument) -> dict:
    return {"id": d.id, "name": d.file_name, "file_size": d.file_size, "uploaded_by": d.uploaded_by_name,
            "uploaded_at": d.created_at.isoformat() if d.created_at else None, "category": d.doc_category}


def _event(db: Session, task: RndRequirementTask, action: str, user: User, remarks: str | None = None,
           old_due: date | None = None, new_due: date | None = None) -> None:
    db.add(RndTaskEvent(task_id=task.id, action=action, remarks=remarks, old_due_date=old_due, new_due_date=new_due,
                        user_id=user.id, created_at=datetime.now(timezone.utc)))


def _is_overdue(t: RndRequirementTask) -> bool:
    return t.status == "open" and today_ist() > t.due_date


def _serialize_tasks(db: Session, tasks: list[RndRequirementTask]) -> list[dict]:
    if not tasks:
        return []
    ids = [t.id for t in tasks]
    events = db.query(RndTaskEvent).filter(RndTaskEvent.task_id.in_(ids)).order_by(RndTaskEvent.id.asc()).all()
    docs = db.query(CrmDocument).filter(
        CrmDocument.related_sub_module == TASK_DOC, CrmDocument.related_sub_id.in_(ids), CrmDocument.is_deleted == False,  # noqa: E712
    ).order_by(CrmDocument.id.asc()).all()
    users = _users(db, [t.assigned_to_id for t in tasks] + [t.created_by_id for t in tasks] + [e.user_id for e in events])
    changed = intake.changed_flags(db, tasks)
    by_task_events: dict[int, list] = {}
    for e in events:
        by_task_events.setdefault(e.task_id, []).append({
            "action": e.action, "remarks": e.remarks, "by": _name(users.get(e.user_id)),
            "at": e.created_at.isoformat() if e.created_at else None,
            "old_due_date": e.old_due_date.isoformat() if e.old_due_date else None,
            "new_due_date": e.new_due_date.isoformat() if e.new_due_date else None,
        })
    by_task_docs: dict[int, list] = {}
    for d in docs:
        by_task_docs.setdefault(d.related_sub_id, []).append(_doc_dict(d))
    approvals = task_approvals.serialize(db, KIND, ids, {d.id: _doc_dict(d) for d in docs})
    return [
        {
            "id": t.id, "source": t.source, "record_id": t.record_id, "parent_task_id": t.parent_task_id,
            "title": t.title, "remarks": t.remarks,
            # Whose work it is: the assignee's department from Organization (R&D, Design …).
            "department": (users.get(t.assigned_to_id).department if users.get(t.assigned_to_id) else None) or "R&D",
            "assigned_to_id": t.assigned_to_id, "assigned_to": _name(users.get(t.assigned_to_id)),
            "created_by_id": t.created_by_id, "created_by": _name(users.get(t.created_by_id)),
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "original_due_date": t.original_due_date.isoformat(), "due_date": t.due_date.isoformat(),
            "status": t.status, "is_overdue": _is_overdue(t),
            "extensions": sum(1 for e in by_task_events.get(t.id, []) if e["action"] == "extended"),
            "submitted_at": t.submitted_at.isoformat() if t.submitted_at else None,
            "closed_at": t.closed_at.isoformat() if t.closed_at else None,
            "events": by_task_events.get(t.id, []),
            "brief_documents": [d for d in by_task_docs.get(t.id, []) if d["category"] == TASK_BRIEF],
            "work_documents": [d for d in by_task_docs.get(t.id, []) if d["category"] == TASK_WORK],
            "approvals": approvals.get(t.id, []),
            "pending_approval": any(a["status"] == "pending" for a in approvals.get(t.id, [])),
            "revision_no": t.revision_no,
            "requirement_changed": changed.get(t.id, False),
            **task_fields.fields_out(t),
        }
        for t in tasks
    ]


def _task(db: Session, task_id: int) -> RndRequirementTask:
    t = db.query(RndRequirementTask).filter(RndRequirementTask.id == task_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="This task no longer exists — refresh the page.")
    return t


def _parse_date(value: str, label: str) -> date:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail=f"{label} '{value}' isn't a valid date — pick it from the calendar.") from None


# ── my access ─────────────────────────────────────────────────────────────

@router.get("/{source}/{record_id}/my-access")
async def my_access(source: Source, record_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _record(db, source, record_id)
    return ra.access_for(db, user, source, record_id)


# ── linked Prototype / Research projects ──────────────────────────────────

_STAGES = {"initiation": "Initiation", "research": "Research", "development": "Development",
           "feasibility": "Feasibility", "handover": "Handover", "closed": "Closed"}


def _project_dict(db: Session, p: RndProject) -> dict:
    leads = list(p.lead_ids or []) or ([p.lead_id] if p.lead_id else [])
    users = _users(db, leads)
    return {"id": p.id, "project_number": p.project_number, "title": p.title, "stage": p.stage,
            "stage_label": _STAGES.get(p.stage, p.stage), "status": p.status,
            "lead_name": ", ".join(_name(users.get(i)) for i in leads if i in users) or None}


@router.get("/{source}/{record_id}/projects")
async def linked_projects(source: Source, record_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Prototype / Research projects this requirement is linked to."""
    _record(db, source, record_id)
    ra.ensure(db, user, source, record_id, "view")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "projects", "view")
    rows = db.query(RndRequirementProjectLink, RndProject).join(RndProject, RndProject.id == RndRequirementProjectLink.project_id).filter(
        RndRequirementProjectLink.source == source, RndRequirementProjectLink.record_id == record_id, RndProject.is_deleted == False,  # noqa: E712
    ).order_by(RndRequirementProjectLink.id.asc()).all()
    users = _users(db, [link.linked_by_id for link, _ in rows])
    return [{**_project_dict(db, p), "linked_by": _name(users.get(link.linked_by_id)) if link.linked_by_id else None,
             "linked_at": link.created_at.isoformat() if link.created_at else None} for link, p in rows]


@router.get("/{source}/{record_id}/linkable-projects")
async def linkable_projects(source: Source, record_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """R&D head: existing projects that can still be linked (not cancelled, not already linked)."""
    _record(db, source, record_id)
    ra.ensure_head(db, user, "link projects to a requirement")
    linked = {pid for (pid,) in db.query(RndRequirementProjectLink.project_id).filter(
        RndRequirementProjectLink.source == source, RndRequirementProjectLink.record_id == record_id).all()}
    projects = db.query(RndProject).filter(RndProject.is_deleted == False, RndProject.status != "cancelled").order_by(RndProject.created_at.desc()).all()  # noqa: E712
    return [_project_dict(db, p) for p in projects if p.id not in linked]


class ProjectLinkPayload(BaseModel):
    project_id: int


@router.post("/{source}/{record_id}/projects")
async def link_project(source: Source, record_id: int, payload: ProjectLinkPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    record = _record(db, source, record_id)
    ra.ensure_head(db, user, "link projects to a requirement")
    project = db.query(RndProject).filter(RndProject.id == payload.project_id, RndProject.is_deleted == False).first()  # noqa: E712
    if not project:
        raise HTTPException(status_code=404, detail="That R&D project no longer exists (it may have been deleted) — refresh and pick another.")
    if project.status == "cancelled":
        raise HTTPException(status_code=409, detail=f"{project.project_number} is cancelled — reactivate it in Prototype / Research before linking it.")
    exists = db.query(RndRequirementProjectLink.id).filter(
        RndRequirementProjectLink.source == source, RndRequirementProjectLink.record_id == record_id,
        RndRequirementProjectLink.project_id == project.id).first()
    if exists:
        raise HTTPException(status_code=409, detail=f"{project.project_number} is already linked to this requirement.")
    db.add(RndRequirementProjectLink(source=source, record_id=record_id, project_id=project.id, linked_by_id=user.id,
                                     created_at=datetime.now(timezone.utc)))
    ref = _ref(source, record)
    db.add(AuditLog(entity_type=f"rnd_req_{source}", entity_id=record_id, action="project_linked", module_key="rnd",
                    summary=f"{_name(user)} linked R&D project {project.project_number} ({project.title}) to {ref}.", performed_by_id=user.id))
    db.add(AuditLog(entity_type="rnd_project", entity_id=project.id, action="requirement_linked", module_key="rnd",
                    summary=f"{_name(user)} linked requirement {ref} to {project.project_number}.", performed_by_id=user.id))
    db.commit()
    return await linked_projects(source, record_id, db, user)


@router.delete("/{source}/{record_id}/projects/{project_id}")
async def unlink_project(source: Source, record_id: int, project_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    record = _record(db, source, record_id)
    ra.ensure_head(db, user, "unlink projects from a requirement")
    link = db.query(RndRequirementProjectLink).filter(
        RndRequirementProjectLink.source == source, RndRequirementProjectLink.record_id == record_id,
        RndRequirementProjectLink.project_id == project_id).first()
    if not link:
        raise HTTPException(status_code=404, detail="That project isn't linked to this requirement any more — refresh the page.")
    project = db.query(RndProject).filter(RndProject.id == project_id).first()
    number = project.project_number if project else f"#{project_id}"
    db.delete(link)
    db.add(AuditLog(entity_type=f"rnd_req_{source}", entity_id=record_id, action="project_unlinked", module_key="rnd",
                    summary=f"{_name(user)} unlinked R&D project {number} from {_ref(source, record)}.", performed_by_id=user.id))
    db.commit()
    return await linked_projects(source, record_id, db, user)


# ── requirement documents (R&D side) ──────────────────────────────────────

def _categories(db: Session, docs: list[CrmDocument]) -> dict[int, str | None]:
    ids = [d.id for d in docs if d.related_sub_module == REQ_DOC]
    if not ids:
        return {}
    return {v.document_id: v.category for v in db.query(RndRequirementDocVisibility).filter(RndRequirementDocVisibility.document_id.in_(ids)).all()}


def _category_key(raw: str | None) -> str:
    return raw if raw in DOC_CATEGORIES else "other"


def _req_doc_dict(d: CrmDocument, category: str | None, can_change: bool = False) -> dict:
    key = _category_key(category)
    return {**_doc_dict(d), "category": key, "category_label": DOC_CATEGORIES[key],
            "department": "rnd", "department_label": "R&D", "can_change_category": can_change}


def _can_change_category(user: User, doc: CrmDocument, head: bool) -> bool:
    """The uploader or the R&D head."""
    return head or doc.created_by_id == user.id


def _check_category(value: str | None) -> str:
    key = (value or "").strip()
    if not key:
        raise HTTPException(status_code=422, detail="Pick a category — Customer Specification, Technical Specification, Reference Standard, "
                                                    "Drawing, Calculation, Test Report, Datasheet or Other.")
    if key == "technical_offer":
        raise HTTPException(status_code=422, detail="'Technical Offer' is set only when you upload a Technical Offer (Technical Offers tab). "
                                                    "Pick another category for this file.")
    if key not in UPLOAD_CATEGORIES:
        raise HTTPException(status_code=422, detail=f"'{key}' isn't a document category — pick one of: "
                                                    f"{', '.join(DOC_CATEGORIES[k] for k in UPLOAD_CATEGORIES)}.")
    return key


@router.get("/document-categories")
async def document_categories(user: User = Depends(get_current_user)):
    """The fixed category list for the upload picker (Technical Offer is system-set and not offered)."""
    return [{"key": k, "label": DOC_CATEGORIES[k]} for k in UPLOAD_CATEGORIES]


@router.get("/{source}/{record_id}/documents")
async def list_documents(source: Source, record_id: int, category: str | None = None,
                         db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _record(db, source, record_id)
    ra.ensure(db, user, source, record_id, "view")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "documents", "view")
    docs = db.query(CrmDocument).filter(
        CrmDocument.related_module == source, CrmDocument.related_id == record_id,
        CrmDocument.related_sub_module == REQ_DOC, CrmDocument.is_deleted == False,  # noqa: E712
    ).order_by(CrmDocument.id.desc()).all()
    cats = _categories(db, docs)
    head = ra.is_head(db, user)
    rows = [_req_doc_dict(d, cats.get(d.id), _can_change_category(user, d, head)) for d in docs]
    if category:
        rows = [r for r in rows if r["category"] == category]
    return rows


@router.post("/{source}/{record_id}/documents")
async def upload_documents(source: Source, record_id: int, files: list[UploadFile] = File(...),
                           category: str | None = Form(None),
                           db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Upload files to the requirement under one fixed category (required)."""
    record = _record(db, source, record_id)
    ra.ensure(db, user, source, record_id, "upload")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "documents", "create")
    key = _check_category(category)
    docs = await _store_files(db, source=source, record=record, files=files, sub_module=REQ_DOC, sub_id=None,
                              category="rnd_document", user=user, folder="rnd-documents")
    if not docs:
        raise HTTPException(status_code=422, detail="Choose at least one file to upload.")
    rows = []
    for d in docs:
        row = RndRequirementDocVisibility(document_id=d.id, department=ra.RND, shared_with_all=True, category=key, updated_by_id=user.id)
        db.add(row)
        rows.append(row)
        db.add(AuditLog(entity_type=f"rnd_req_{source}", entity_id=record_id, action="document_uploaded", module_key="rnd",
                        summary=f"{_name(user)} uploaded \"{d.file_name}\" ({DOC_CATEGORIES[key]}).", performed_by_id=user.id))
    db.commit()
    return [_req_doc_dict(d, row.category, True) for d, row in zip(docs, rows)]


class CategoryPayload(BaseModel):
    category: str | None = None


@router.patch("/documents/{document_id}/category")
async def set_document_category(document_id: int, payload: CategoryPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The uploader or the R&D head changes a file's category."""
    doc = db.query(CrmDocument).filter(CrmDocument.id == document_id, CrmDocument.is_deleted == False).first()  # noqa: E712
    if not doc or doc.related_sub_module != REQ_DOC:
        raise HTTPException(status_code=404, detail="This document was deleted or isn't a requirement document — refresh the page.")
    ra.ensure(db, user, doc.related_module, doc.related_id, "view")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "documents", "create")
    if doc.created_by_id != user.id and not ra.is_head(db, user):
        raise HTTPException(status_code=403, detail="Only the person who uploaded this file, or the R&D head, can change its category.")
    key = _check_category(payload.category)
    row = db.query(RndRequirementDocVisibility).filter(RndRequirementDocVisibility.document_id == doc.id).first()
    old = _category_key(row.category if row else None)
    if row is None:
        row = RndRequirementDocVisibility(document_id=doc.id, department=ra.RND, shared_with_all=True)
        db.add(row)
    row.category, row.updated_by_id = key, user.id
    if old != key:
        db.add(AuditLog(entity_type=f"rnd_req_{doc.related_module}", entity_id=doc.related_id, action="document_category_changed", module_key="rnd",
                        summary=f"{_name(user)} changed the category of \"{doc.file_name}\": {DOC_CATEGORIES[old]} → {DOC_CATEGORIES[key]}.",
                        performed_by_id=user.id))
    db.commit()
    return _req_doc_dict(doc, row.category, True)


RND_RESPONSE_DOC = "rnd_request"   # R&D's response files to a CRM ask


@router.get("/{source}/{record_id}/all-documents")
async def all_documents(source: Source, record_id: int, category: str | None = None,
                        db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Every file on the requirement R&D may see, in one list for the
    Documents tab: what the business team sent (TOR + shared client files),
    task files, R&D's own documents (with their category), uploaded Technical
    Offers and responses. Task files are listed only for the head and the
    task's assignee / giver — the same rule as opening them."""
    _record(db, source, record_id)
    access = ra.ensure(db, user, source, record_id, "view")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "documents", "view")
    head = access["is_head"]
    docs = db.query(CrmDocument).filter(
        CrmDocument.related_module == source, CrmDocument.related_id == record_id, CrmDocument.is_deleted == False,  # noqa: E712
    ).order_by(CrmDocument.id.desc()).all()
    task_ids = {d.related_sub_id for d in docs if d.related_sub_module == TASK_DOC and d.related_sub_id}
    tasks = {t.id: t for t in db.query(RndRequirementTask).filter(RndRequirementTask.id.in_(task_ids)).all()} if task_ids else {}
    cats = _categories(db, docs)
    out = []
    for d in docs:
        sub, context = d.related_sub_module, None
        if sub == TASK_DOC:
            t = tasks.get(d.related_sub_id)
            if not t or not (head or t.assigned_to_id == user.id or t.created_by_id == user.id):
                continue
            group = "task"
            context = f"Task: {t.title}" + (" · from the person who gave it" if d.doc_category == TASK_BRIEF else " · work / update")
            row = {**_doc_dict(d), "category": "other", "category_label": DOC_CATEGORIES["other"], "can_change_category": False}
        elif sub == REQ_DOC:
            row = _req_doc_dict(d, cats.get(d.id), _can_change_category(user, d, head))
            group, context = "rnd", "R&D document"
        elif sub == OFFER_DOC:
            group, context = "rnd", "Technical Offer"
            row = {**_doc_dict(d), "category": "technical_offer", "category_label": DOC_CATEGORIES["technical_offer"], "can_change_category": False}
        elif sub == RND_RESPONSE_DOC:
            group, context = "rnd", "R&D response to CRM"
            row = {**_doc_dict(d), "category": "other", "category_label": DOC_CATEGORIES["other"], "can_change_category": False}
        elif d.shared_via_tor:
            group = "crm"
            context = "Technical Offer Request" if (d.doc_category or "").lower().replace(" ", "_") == "technical_offer_request" else (d.doc_category or "Client document")
            # Files BD shared keep their CRM category as the label (they were not picked from R&D's list).
            row = {**_doc_dict(d), "category": "other", "category_label": context, "can_change_category": False}
        else:
            continue  # CRM-internal file never shared with R&D
        if category and row["category"] != category:
            continue
        out.append({**row, "group": group, "context": context})
    return out


def _ensure_can_open(db: Session, user: User, doc: CrmDocument) -> None:
    """Task files: the task's assignee or a head. Everything else on the
    requirement (TOR, reference docs, R&D documents, offers, R&D responses): Download."""
    source, record_id = doc.related_module, doc.related_id
    if source not in ("inquiry", "tender"):
        raise HTTPException(status_code=404, detail="This document doesn't belong to an R&D requirement.")
    _record(db, source, record_id)  # 404 unless the requirement was sent to R&D (and isn't deleted)
    # Same rule as the all-documents list: only files R&D may see open here —
    # never a CRM-internal file (quotation, PO, internal notes) by guessing its id.
    if doc.related_sub_module not in (TASK_DOC, REQ_DOC, OFFER_DOC, RND_RESPONSE_DOC) and not doc.shared_via_tor:
        raise HTTPException(status_code=403, detail="This is a CRM-internal file that wasn't shared with R&D. Ask the BD owner to attach it to "
                                                    "the Technical Offer Request if R&D needs it.")
    # Role-level gate (R&D side): task files follow Tasks, everything else is opened from Documents.
    if ra.is_rnd_side(user):
        if doc.related_sub_module == TASK_DOC:
            ensure_feature_action(user, "rnd", "requirements", "tasks", "view")
        else:
            ensure_feature_action(user, "rnd", "requirements", "documents", "export")
    if doc.related_sub_module == TASK_DOC:
        task = db.query(RndRequirementTask).filter(RndRequirementTask.id == doc.related_sub_id).first()
        if ra.is_head(db, user) or (task and user.id in (task.assigned_to_id, task.created_by_id)):
            return
        raise HTTPException(status_code=403, detail="Task files can be opened only by the task's assignee, the person who gave the task, or the R&D head.")
    if doc.folder_type == "client" and not doc.shared_via_tor:
        raise HTTPException(status_code=403, detail="This client document wasn't shared with R&D in a Technical Offer Request. Ask the BD owner to attach it to the next send.")
    ra.ensure(db, user, source, record_id, "download")


@router.get("/documents/{document_id}/content")
async def document_content(document_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = db.query(CrmDocument).filter(CrmDocument.id == document_id, CrmDocument.is_deleted == False).first()  # noqa: E712
    if not doc:
        raise HTTPException(status_code=404, detail="This document was deleted — refresh the page.")
    _ensure_can_open(db, user, doc)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")
    content, content_type = await download_file_content(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path or "")
    return Response(content=content, media_type=doc.mime_type or content_type,
                    headers={"Content-Disposition": f'inline; filename="{doc.file_name}"'})


@router.get("/documents/{document_id}/download-url")
async def document_download_url(document_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    doc = db.query(CrmDocument).filter(CrmDocument.id == document_id, CrmDocument.is_deleted == False).first()  # noqa: E712
    if not doc:
        raise HTTPException(status_code=404, detail="This document was deleted — refresh the page.")
    _ensure_can_open(db, user, doc)
    if not settings.SHAREPOINT_SITE_ID:
        raise HTTPException(status_code=503, detail="SharePoint site is not configured")
    return {"url": await get_download_url(settings.SHAREPOINT_SITE_ID, doc.sharepoint_path or ""), "file_name": doc.file_name}


# ── tasks ─────────────────────────────────────────────────────────────────

@router.get("/tasks/mine")
async def my_tasks(include_done: bool = False, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Tasks assigned to me across requirements (open + awaiting review by default)."""
    q = db.query(RndRequirementTask).filter(RndRequirementTask.assigned_to_id == user.id)
    if not include_done:
        q = q.filter(RndRequirementTask.status.in_(["open", "submitted"]))
    tasks = q.order_by(RndRequirementTask.due_date.asc()).all()
    out = _serialize_tasks(db, tasks)
    refs: dict[tuple[str, int], tuple[str, str | None]] = {}
    for source, model in (("inquiry", Inquiry), ("tender", Tender)):
        ids = [t.record_id for t in tasks if t.source == source]
        if ids:
            for r in db.query(model).filter(model.id.in_(ids)).all():
                title = r.product if source == "inquiry" else r.tender_name
                refs[(source, r.id)] = (_ref(source, r), title)
    for row in out:
        ref, title = refs.get((row["source"], row["record_id"]), (f"{row['source']} #{row['record_id']}", None))
        row["requirement_ref"], row["requirement_title"] = ref, title
    return out


@router.get("/{source}/{record_id}/tasks")
async def list_tasks(source: Source, record_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Every task on the requirement for the R&D side; someone outside R&D
    (a Design / Electrical / Hydraulic & Pneumatic assignee) sees the tasks
    assigned to them, the tasks they gave, and the sub-tasks under those."""
    _record(db, source, record_id)
    access = ra.ensure(db, user, source, record_id, "view")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "tasks", "view")
    tasks = db.query(RndRequirementTask).filter(
        RndRequirementTask.source == source, RndRequirementTask.record_id == record_id,
    ).order_by(RndRequirementTask.id.desc()).all()
    if not access["is_rnd_side"] and not access["is_head"]:
        mine = {t.id for t in tasks if user.id in (t.assigned_to_id, t.created_by_id)}
        tasks = [t for t in tasks if t.id in mine or t.parent_task_id in mine]
    return _serialize_tasks(db, tasks)


@router.get("/{source}/{record_id}/assignees")
async def list_assignees(source: Source, record_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Who can be given a task here: R&D people and the engineers of Design /
    Electrical / Hydraulic & Pneumatic — every active person, narrowed by the
    role's "Assign to" rule. Each row names the person's own department."""
    _record(db, source, record_id)
    ra.ensure(db, user, source, record_id, "view")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "tasks", "view")
    roles = ra.team_roles(db)
    active = db.query(User).filter(User.is_active == True).order_by(User.name.asc()).all()  # noqa: E712
    people = [u for u in active if u.role != "admin" and not u.is_azure_admin] or active
    out = [{"id": u.id, "name": _name(u), "email": u.email, "designation": u.designation,
            "team_role": roles.get(u.id), "department": u.department, "in_rnd": "rnd" in u.get_apps()} for u in people]
    # The role's assign-to rule (Role & Permissions › R&D › Requirements › Tasks).
    return assignee_rules.filter_people(db, user, RULE_KEY, out)


async def create_requirement_task(
    db: Session, user: User, *, source: str, record_id: int, title: str, assigned_to_id: int, due_date: str,
    remarks: str | None = None, files: list[UploadFile] | None = None, priority: str | None = None,
    start_date: str | None = None, work_status: str | None = None, checklist: str | None = None,
    background_tasks: BackgroundTasks | None = None, check_feature: bool = True,
) -> dict:
    """Create a task on a requirement (shared by this router and POST /rnd/tasks).

    Anyone who can open the requirement gives a task, once its latest revision
    is accepted. R&D-side users also need the role's Tasks > Create feature
    (`check_feature`; the R&D Tasks board checks rnd:tasks:create instead).
    The assignee's department head is told."""
    record = _record(db, source, record_id)
    ra.ensure(db, user, source, record_id, "view")
    if check_feature and ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "tasks", "create")
    revision = intake.require_accepted(db, source, record_id, "give tasks on it")
    title = (title or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="Give the task a title — what should be done.")
    if len(title) > 200:
        raise HTTPException(status_code=422, detail=f"Title is {len(title)} characters — keep it under 200 and put details in Remarks.")
    due = _parse_date(due_date, "Due date")
    if due < today_ist():
        raise HTTPException(status_code=422, detail=f"Due date {due.strftime('%d %b %Y')} is in the past — pick today or a later date.")
    assignee = ra.check_assignee(db, assigned_to_id)
    assignee_rules.ensure_allowed(db, user, RULE_KEY, assignee)

    task = RndRequirementTask(
        source=source, record_id=record_id, title=title, remarks=(remarks or "").strip() or None,
        assigned_to_id=assignee.id, created_by_id=user.id, original_due_date=due, due_date=due, status="open",
        revision_no=revision.revision_no if revision else None,
    )
    task_fields.apply_create(task, priority=priority, start_date=start_date, work_status=work_status, checklist=checklist)
    db.add(task)
    db.flush()
    await _store_files(db, source=source, record=record, files=files or [], sub_module=TASK_DOC, sub_id=task.id,
                       category=TASK_BRIEF, user=user, folder=f"rnd-tasks/{task.id}")
    _event(db, task, "created", user, remarks=task.remarks, new_due=due)
    _after_assign(db, task, assignee, user, record, f"assigned you \"{title}\" — due {due.strftime('%d %b %Y')}."
                  + (f" Remarks: {task.remarks}" if task.remarks else ""), background_tasks=background_tasks)
    db.commit()
    return _serialize_tasks(db, [task])[0]


@router.post("/{source}/{record_id}/tasks")
async def create_task(
    source: Source, record_id: int,
    title: str = Form(...), assigned_to_id: int = Form(...), due_date: str = Form(...),
    remarks: str | None = Form(None), files: list[UploadFile] | None = File(None),
    priority: str | None = Form(None), start_date: str | None = Form(None),
    work_status: str | None = Form(None), checklist: str | None = Form(None),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    """Give a task on the requirement to a person in R&D or in an engineering department."""
    return await create_requirement_task(
        db, user, source=source, record_id=record_id, title=title, assigned_to_id=assigned_to_id, due_date=due_date,
        remarks=remarks, files=files, priority=priority, start_date=start_date, work_status=work_status,
        checklist=checklist, background_tasks=background_tasks,
    )


def _after_assign(db: Session, task: RndRequirementTask, assignee: User, user: User, record, message: str,
                  background_tasks: BackgroundTasks | None = None) -> None:
    """A task just went to `assignee`: the task opens the requirement to them
    (View + Download — requirement_access), tell them, and tell their
    department head(s)."""
    ref = _ref(task.source, record)
    kind = "sub-task" if task.parent_task_id else "task"
    if assignee.id != user.id:
        _notify(db, [assignee.id], task.source, task.record_id, title=f"New {kind} on requirement {ref}",
                message=f"{_name(user)} {message}", notification_type="rnd_task_assigned")
    heads = ra.assignee_heads(db, assignee) - {assignee.id, user.id}
    if heads:
        _notify(db, heads, task.source, task.record_id, title=f"{_name(assignee)} got a {kind} on {ref}",
                message=f"{_name(user)} assigned {_name(assignee)} ({assignee.department or 'R&D'}) \"{task.title}\" — due {task.due_date.strftime('%d %b %Y')}.",
                notification_type="rnd_task_assigned_head")
    # Role subscribers (R&D › Requirements › Tasks) who can open this requirement;
    # the assignee and their heads were told above.
    rnd_events.requirement_event(
        db, "task_assigned", task.source, task.record_id,
        title=f"{_name(assignee)} got a {kind} on {ref}",
        message=f"{_name(user)} assigned {_name(assignee)} ({assignee.department or 'R&D'}) \"{task.title}\" — due {task.due_date.strftime('%d %b %Y')}.",
        actor=user, skip_user_ids={assignee.id, *heads}, background_tasks=background_tasks,
    )


def _ensure_reviewer(db: Session, task: RndRequirementTask, user: User, what: str) -> None:
    """The task's creator reviews it (a sub-task's creator is the main task's assignee); the R&D head reviews any task."""
    if task.created_by_id != user.id and not ra.is_head(db, user):
        raise HTTPException(status_code=403, detail=f"Only the person who gave this task (or the R&D head) can {what}.")


def _ensure_assignee(task: RndRequirementTask, user: User, what: str) -> None:
    if task.assigned_to_id != user.id:
        raise HTTPException(status_code=403, detail=f"Only the person this task is assigned to can {what}.")


@router.post("/tasks/{task_id}/extend")
async def extend_task(task_id: int, reason: str = Form(...), new_due_date: str = Form(...),
                      db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Assignee: why it isn't done, and the new completion date (= new due date)."""
    task = _task(db, task_id)
    _ensure_assignee(task, user, "give a new completion date")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "tasks", "view")
    if task.status != "open":
        raise HTTPException(status_code=409, detail=f"This task is {task.status}, so its due date can't be changed.")
    reason = (reason or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Enter the reason the task isn't complete by its due date.")
    new_due = _parse_date(new_due_date, "New completion date")
    if new_due < today_ist():
        raise HTTPException(status_code=422, detail=f"New completion date {new_due.strftime('%d %b %Y')} is in the past — pick today or a later date.")
    if new_due <= task.due_date:
        raise HTTPException(status_code=422, detail=f"New completion date must be after the current due date ({task.due_date.strftime('%d %b %Y')}).")
    old = task.due_date
    task.due_date = new_due
    _event(db, task, "extended", user, remarks=reason, old_due=old, new_due=new_due)
    record = _record(db, task.source, task.record_id)
    for uid in ({task.created_by_id} if task.parent_task_id else {task.created_by_id, *ra.head_ids(db)}) - {user.id}:
        _notify(db, [uid], task.source, task.record_id, title=f"Task re-dated on {_ref(task.source, record)}",
                    message=f"{_name(user)} moved \"{task.title}\" from {old.strftime('%d %b %Y')} to {new_due.strftime('%d %b %Y')}. Reason: {reason}",
                    notification_type="rnd_task_extended")
    db.commit()
    return _serialize_tasks(db, [task])[0]


@router.post("/tasks/{task_id}/complete")
async def complete_task(task_id: int, remarks: str = Form(...), delay_reason: str | None = Form(None),
                        files: list[UploadFile] | None = File(None), background_tasks: BackgroundTasks = None,
                        db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Assignee completes the task themselves (remarks + files; a delay reason when late)."""
    task = _task(db, task_id)
    _ensure_assignee(task, user, "complete it")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "tasks", "view")
    if task.status != "open":
        raise HTTPException(status_code=409, detail=f"This task is already {task.status}.")
    pending = db.query(RndRequirementTask).filter(
        RndRequirementTask.parent_task_id == task.id, RndRequirementTask.status == "open",
    ).all()
    if pending:
        names = ", ".join(f'"{t.title}"' for t in pending[:3]) + (f" and {len(pending) - 3} more" if len(pending) > 3 else "")
        raise HTTPException(status_code=409, detail=f"{len(pending)} sub-task(s) are still open: {names}. They must be completed or cancelled before this task.")
    task_approvals.ensure_none_pending(db, KIND, task.id)
    task_fields.ensure_checklist_done(task)
    remarks = (remarks or "").strip()
    if not remarks:
        raise HTTPException(status_code=422, detail="Describe what you did (completion remarks) before completing the task.")
    delay_reason = (delay_reason or "").strip() or None
    if _is_overdue(task) and not delay_reason:
        raise HTTPException(status_code=422, detail=f"This task was due on {task.due_date.strftime('%d %b %Y')}. Enter the reason for the delay before completing it.")
    record = _record(db, task.source, task.record_id)
    await _store_files(db, source=task.source, record=record, files=files or [], sub_module=TASK_DOC, sub_id=task.id,
                       category=TASK_WORK, user=user, folder=f"rnd-tasks/{task.id}")
    task.status = "closed"
    task.closed_at = datetime.now(timezone.utc)
    task_fields.mark_complete(task)
    _event(db, task, "completed", user, remarks=remarks + (f"\nDelay reason: {delay_reason}" if delay_reason else ""))
    told = ({task.created_by_id} if task.parent_task_id else {task.created_by_id, *ra.head_ids(db)}) - {user.id}
    for uid in told:
        _notify(db, [uid], task.source, task.record_id, title=f"Task completed ({_ref(task.source, record)})",
                    message=f"{_name(user)} completed \"{task.title}\"" + (" after its due date." if delay_reason else ".") + f" {remarks[:200]}",
                    notification_type="rnd_task_completed")
    rnd_events.requirement_event(
        db, "task_completed", task.source, task.record_id,
        title=f"Task completed ({_ref(task.source, record)})",
        message=f"{_name(user)} completed \"{task.title}\"" + (" after its due date." if delay_reason else ".") + f" {remarks[:200]}",
        actor=user, skip_user_ids=told, background_tasks=background_tasks,
    )
    db.commit()
    return _serialize_tasks(db, [task])[0]


# ── approval requests (task stays open) ───────────────────────────────────

@router.post("/tasks/{task_id}/approvals")
async def request_approval(task_id: int, request: str = Form(...), files: list[UploadFile] | None = File(None),
                           background_tasks: BackgroundTasks = None,
                           db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Assignee asks the person who gave the task (or the R&D head) to approve something task-related."""
    task = _task(db, task_id)
    _ensure_assignee(task, user, "ask for approval on it")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "tasks", "view")
    if task.status != "open":
        raise HTTPException(status_code=409, detail=f"This task is {task.status} — approvals can be asked only while it is open.")
    row = task_approvals.create(db, KIND, task.id, user, request)
    record = _record(db, task.source, task.record_id)
    docs = await _store_files(db, source=task.source, record=record, files=files or [], sub_module=TASK_DOC, sub_id=task.id,
                              category=TASK_APPROVAL, user=user, folder=f"rnd-tasks/{task.id}")
    row.document_ids = [d.id for d in docs]
    _event(db, task, "approval_requested", user, remarks=row.request)
    told = ({task.created_by_id} if task.parent_task_id else {task.created_by_id, *ra.head_ids(db)}) - {user.id}
    for uid in told:
        _notify(db, [uid], task.source, task.record_id, title=f"Approval needed on task ({_ref(task.source, record)})",
                    message=f"{_name(user)} asks for your approval on \"{task.title}\": {row.request[:200]}",
                    notification_type="rnd_task_approval_requested", teams=True)
    # Role subscribers hear about it too; only the task's reviewer / the R&D head can decide it.
    rnd_events.requirement_event(
        db, "task_approval_requested", task.source, task.record_id,
        title=f"Approval requested on task ({_ref(task.source, record)})",
        message=f"{_name(user)} asks the reviewer to approve on \"{task.title}\": {row.request[:200]}",
        actor=user, skip_user_ids=told, background_tasks=background_tasks,
    )
    db.commit()
    return _serialize_tasks(db, [task])[0]


class ApprovalDecision(BaseModel):
    decision: str
    remarks: str | None = None


@router.post("/approvals/{approval_id}/decide")
async def decide_approval(approval_id: int, payload: ApprovalDecision, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = task_approvals.get(db, KIND, approval_id)
    task = _task(db, row.task_id)
    _ensure_reviewer(db, task, user, "decide its approval requests")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "tasks", "approve")
    task_approvals.ensure_task_open(task)
    task_approvals.decide(row, user, payload.decision, payload.remarks)
    _event(db, task, row.status, user, remarks=row.decision_remarks)
    if row.requested_by_id != user.id:
        record = _record(db, task.source, task.record_id)
        _notify(db, [row.requested_by_id], task.source, task.record_id, title=f"Approval {row.status} ({_ref(task.source, record)})",
                    message=f"{_name(user)} {row.status} your request on \"{task.title}\"." + (f" Remarks: {row.decision_remarks}" if row.decision_remarks else ""),
                    notification_type=f"rnd_task_approval_{row.status}")
    db.commit()
    return _serialize_tasks(db, [task])[0]


@router.post("/approvals/{approval_id}/withdraw")
async def withdraw_approval(approval_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    row = task_approvals.get(db, KIND, approval_id)
    task = _task(db, row.task_id)
    task_approvals.withdraw(row, user)
    _event(db, task, "approval_withdrawn", user)
    db.commit()
    return _serialize_tasks(db, [task])[0]


@router.post("/tasks/{task_id}/subtasks")
async def create_subtask(
    task_id: int,
    title: str = Form(...), assigned_to_id: int = Form(...), due_date: str = Form(...),
    remarks: str | None = Form(None), files: list[UploadFile] | None = File(None),
    priority: str | None = Form(None), start_date: str | None = Form(None),
    work_status: str | None = Form(None), checklist: str | None = Form(None),
    background_tasks: BackgroundTasks = None,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    """The assignee of an open task hands part of it to someone in R&D or an
    engineering department."""
    parent = _task(db, task_id)
    _ensure_assignee(parent, user, "split it into sub-tasks")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "tasks", "create")
    if parent.parent_task_id:
        raise HTTPException(status_code=409, detail="This is already a sub-task — sub-tasks can't be split further. Ask the person who gave it to you to create another task instead.")
    if parent.status != "open":
        raise HTTPException(status_code=409, detail=f"This task is {parent.status}, so it can't get new sub-tasks.")
    title = (title or "").strip()
    if not title:
        raise HTTPException(status_code=422, detail="Give the sub-task a title — what should be done.")
    if len(title) > 200:
        raise HTTPException(status_code=422, detail=f"Title is {len(title)} characters — keep it under 200 and put details in Remarks.")
    due = _parse_date(due_date, "Response Due Date")
    if due < today_ist():
        raise HTTPException(status_code=422, detail=f"Response Due Date {due.strftime('%d %b %Y')} is in the past — pick today or a later date.")
    if due > parent.due_date:
        raise HTTPException(status_code=422, detail=f"A sub-task can't be due after its main task ({parent.due_date.strftime('%d %b %Y')}). Pick an earlier date, or ask for more time on the main task first.")
    assignee = ra.check_assignee(db, assigned_to_id)
    assignee_rules.ensure_allowed(db, user, RULE_KEY, assignee)
    record = _record(db, parent.source, parent.record_id)

    task = RndRequirementTask(
        source=parent.source, record_id=parent.record_id, parent_task_id=parent.id, title=title,
        remarks=(remarks or "").strip() or None, assigned_to_id=assignee.id, created_by_id=user.id,
        original_due_date=due, due_date=due, status="open", revision_no=parent.revision_no,
    )
    task_fields.apply_create(task, priority=priority, start_date=start_date, work_status=work_status, checklist=checklist)
    db.add(task)
    db.flush()
    await _store_files(db, source=task.source, record=record, files=files or [], sub_module=TASK_DOC, sub_id=task.id,
                       category=TASK_BRIEF, user=user, folder=f"rnd-tasks/{task.id}")
    _event(db, task, "created", user, remarks=task.remarks, new_due=due)
    _after_assign(db, task, assignee, user, record, f"assigned you \"{title}\" (part of \"{parent.title}\") — due {due.strftime('%d %b %Y')}.",
                  background_tasks=background_tasks)
    db.commit()
    return _serialize_tasks(db, [task])[0]


class TaskEditPayload(BaseModel):
    title: str | None = None
    remarks: str | None = None
    due_date: date | None = None
    assigned_to_id: int | None = None
    priority: str | None = None
    start_date: date | None = None
    work_status: str | None = None
    # [{id?, text, done?}] — the whole list; items keep their id / who ticked them.
    checklist: list[dict] | None = None


class TaskProgressPayload(BaseModel):
    """A new work status, one checklist step ticked / unticked, or the progress
    percentage (0-100; only for a task without a checklist)."""
    work_status: str | None = None
    item_id: str | None = None
    done: bool | None = None
    progress_percent: int | None = None


@router.patch("/tasks/{task_id}")
async def edit_task(task_id: int, payload: TaskEditPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The person who gave the task (or the R&D head) changes what, who or when — only while it is open."""
    task = _task(db, task_id)
    _ensure_reviewer(db, task, user, "edit it")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "tasks", "edit")
    if task.status != "open":
        raise HTTPException(status_code=409, detail=f"This task is {task.status} — only an open task can be edited." + (" Reopen it first if it needs changes." if task.status == "closed" else ""))
    data = payload.model_dump(exclude_unset=True)
    changes: list[str] = []
    old_due, old_assignee = task.due_date, task.assigned_to_id

    if "title" in data:
        title = (data["title"] or "").strip()
        if not title:
            raise HTTPException(status_code=422, detail="Task title can't be empty — say what should be done.")
        if len(title) > 200:
            raise HTTPException(status_code=422, detail=f"Title is {len(title)} characters — keep it under 200 and put details in Remarks.")
        if title != task.title:
            changes.append(f"Task: \"{task.title}\" → \"{title}\"")
            task.title = title
    if "remarks" in data:
        remarks = (data["remarks"] or "").strip() or None
        if remarks != task.remarks:
            changes.append("Remarks updated")
            task.remarks = remarks
    if data.get("due_date") and data["due_date"] != task.due_date:
        due = data["due_date"]
        if due < today_ist():
            raise HTTPException(status_code=422, detail=f"Response Due Date {due.strftime('%d %b %Y')} is in the past — pick today or a later date.")
        if task.parent_task_id:
            parent = _task(db, task.parent_task_id)
            if due > parent.due_date:
                raise HTTPException(status_code=422, detail=f"A sub-task can't be due after its main task ({parent.due_date.strftime('%d %b %Y')}).")
        else:
            later = [t for t in db.query(RndRequirementTask).filter(
                RndRequirementTask.parent_task_id == task.id, RndRequirementTask.status == "open", RndRequirementTask.due_date > due,
            ).all()]
            if later:
                names = ", ".join(f"\"{t.title}\" ({t.due_date:%d %b %Y})" for t in later[:3]) + (f" and {len(later) - 3} more" if len(later) > 3 else "")
                raise HTTPException(status_code=422, detail=f"Open sub-task(s) are due after {due.strftime('%d %b %Y')}: {names}. "
                                                            "Move those sub-tasks earlier first, or pick a later due date for the main task.")
        changes.append(f"Due date: {task.due_date.strftime('%d %b %Y')} → {due.strftime('%d %b %Y')}")
        task.due_date = due
    new_assignee: User | None = None
    if data.get("assigned_to_id") and data["assigned_to_id"] != task.assigned_to_id:
        new_assignee = ra.check_assignee(db, data["assigned_to_id"])
        assignee_rules.ensure_allowed(db, user, RULE_KEY, new_assignee)
        prev = db.query(User).filter(User.id == task.assigned_to_id).first()
        changes.append(f"Assignee: {_name(prev)} → {_name(new_assignee)}")
        task.assigned_to_id = new_assignee.id
    changes += task_fields.apply_edit(task, data, _name(user))

    if not changes:
        return _serialize_tasks(db, [task])[0]
    _event(db, task, "edited", user, remarks="\n".join(changes),
           old_due=old_due if task.due_date != old_due else None, new_due=task.due_date if task.due_date != old_due else None)
    record = _record(db, task.source, task.record_id)
    summary = "; ".join(changes)
    if new_assignee and new_assignee.id != old_assignee:
        # The new assignee (and their head) hear about it as a new task.
        _after_assign(db, task, new_assignee, user, record, f"assigned you \"{task.title}\" — due {task.due_date.strftime('%d %b %Y')}.")
    for uid in ({task.assigned_to_id, old_assignee} - {user.id}):
        if uid == old_assignee and uid != task.assigned_to_id:
            msg = f"{_name(user)} reassigned \"{task.title}\" to someone else — it's no longer yours."
        elif uid != old_assignee:
            continue  # told by _after_assign above
        else:
            msg = f"{_name(user)} changed \"{task.title}\": {summary}"
        _notify(db, [uid], task.source, task.record_id, title=f"Task updated ({_ref(task.source, record)})", message=msg,
                notification_type="rnd_task_edited")
    db.commit()
    return _serialize_tasks(db, [task])[0]


@router.post("/tasks/{task_id}/progress")
async def task_progress(task_id: int, payload: TaskProgressPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Tick / untick a checklist step, change the work status or enter the progress
    percentage of an open task — the assignee, or whoever reviews the task (its
    creator or the R&D head). Progress follows the ticked steps when there is a checklist."""
    task = _task(db, task_id)
    if task.assigned_to_id != user.id:
        _ensure_reviewer(db, task, user, "update its checklist or status")
        if ra.is_rnd_side(user):
            ensure_feature_action(user, "rnd", "requirements", "tasks", "edit")
    if task.status != "open":
        raise HTTPException(status_code=409, detail=f"This task is {task.status} — the checklist and status can change only while it is open. Reopen it first if needed.")
    line = task_fields.apply_progress(task, work_status=payload.work_status, item_id=payload.item_id, done=payload.done,
                                      actor_name=_name(user), progress_percent=payload.progress_percent)
    if line:
        _event(db, task, "progress", user, remarks=line)
        db.commit()
    return _serialize_tasks(db, [task])[0]


@router.post("/tasks/{task_id}/update")
async def add_task_update(task_id: int, remarks: str = Form(...), files: list[UploadFile] | None = File(None),
                          db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Assignee posts progress (remarks + any files); the task stays open."""
    task = _task(db, task_id)
    _ensure_assignee(task, user, "post an update on it")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "tasks", "view")
    if task.status != "open":
        raise HTTPException(status_code=409, detail=f"This task is {task.status} — updates can be added only while it is open.")
    remarks = (remarks or "").strip()
    if not remarks:
        raise HTTPException(status_code=422, detail="Write the update — what you did or found so far.")
    record = _record(db, task.source, task.record_id)
    await _store_files(db, source=task.source, record=record, files=files or [], sub_module=TASK_DOC, sub_id=task.id,
                       category=TASK_WORK, user=user, folder=f"rnd-tasks/{task.id}")
    _event(db, task, "update", user, remarks=remarks)
    for uid in {task.created_by_id} - {user.id}:
        _notify(db, [uid], task.source, task.record_id, title=f"Update on task ({_ref(task.source, record)})",
                    message=f"{_name(user)} on \"{task.title}\": {remarks[:200]}",
                    notification_type="rnd_task_update")
    db.commit()
    return _serialize_tasks(db, [task])[0]


class ReviewPayload(BaseModel):
    remarks: str | None = None
    new_due_date: date | None = None


@router.post("/tasks/{task_id}/reopen")
async def reopen_task(task_id: int, payload: ReviewPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    task = _task(db, task_id)
    _ensure_reviewer(db, task, user, "reopen it")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "tasks", "edit")
    if task.status != "closed":
        raise HTTPException(status_code=409, detail="Only a completed task can be reopened.")
    if task.parent_task_id:
        parent = _task(db, task.parent_task_id)
        if parent.status != "open":
            raise HTTPException(status_code=409, detail=f"Its main task \"{parent.title}\" is {parent.status} — reopen the main task first, then this sub-task.")
    reason = (payload.remarks or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Enter what still needs to be done — the assignee sees it as the reason.")
    old = task.due_date
    if payload.new_due_date:
        if payload.new_due_date < today_ist():
            raise HTTPException(status_code=422, detail=f"New due date {payload.new_due_date.strftime('%d %b %Y')} is in the past — pick today or a later date.")
        task.due_date = payload.new_due_date
    elif task.due_date < today_ist():
        raise HTTPException(status_code=422, detail=f"The due date ({task.due_date.strftime('%d %b %Y')}) has passed — set a new due date when reopening the task.")
    task.status = "open"
    task.closed_at = None
    task_fields.on_reopen(task)
    _event(db, task, "reopened", user, remarks=reason, old_due=old if task.due_date != old else None,
           new_due=task.due_date if task.due_date != old else None)
    if task.assigned_to_id != user.id:
        record = _record(db, task.source, task.record_id)
        _notify(db, [task.assigned_to_id], task.source, task.record_id, title=f"Task reopened ({_ref(task.source, record)})",
                    message=f"{_name(user)} reopened \"{task.title}\" — due {task.due_date.strftime('%d %b %Y')}. Reason: {reason}",
                    notification_type="rnd_task_reopened")
    db.commit()
    return _serialize_tasks(db, [task])[0]


@router.post("/tasks/{task_id}/cancel")
async def cancel_task(task_id: int, payload: ReviewPayload, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    task = _task(db, task_id)
    _ensure_reviewer(db, task, user, "cancel it")
    if ra.is_rnd_side(user):
        ensure_feature_action(user, "rnd", "requirements", "tasks", "cancel")
    if task.status in ("closed", "cancelled"):
        raise HTTPException(status_code=409, detail=f"This task is already {task.status}.")
    reason = (payload.remarks or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Enter why the task is cancelled — the assignee sees it.")
    task.status = "cancelled"
    _event(db, task, "cancelled", user, remarks=reason)
    cancelled_ids = [task.id]
    for sub in db.query(RndRequirementTask).filter(RndRequirementTask.parent_task_id == task.id, RndRequirementTask.status.in_(("open", "submitted"))).all():
        sub.status = "cancelled"
        _event(db, sub, "cancelled", user, remarks=f"Main task \"{task.title}\" was cancelled: {reason}")
        cancelled_ids.append(sub.id)
    task_approvals.withdraw_pending(db, KIND, cancelled_ids)
    if task.assigned_to_id != user.id:
        record = _record(db, task.source, task.record_id)
        _notify(db, [task.assigned_to_id], task.source, task.record_id, title=f"Task cancelled ({_ref(task.source, record)})",
                    message=f"{_name(user)} cancelled \"{task.title}\". Reason: {reason}",
                    notification_type="rnd_task_cancelled")
    db.commit()
    return _serialize_tasks(db, [task])[0]
