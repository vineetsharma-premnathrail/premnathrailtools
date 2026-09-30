"""Design document register: create (with its R0 draft), list, detail,
edit, start next revision, obsolete/reactivate, delete, comments.
Revision-level workflow (files, submit, check, approve) is in revisions.py."""
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.core.permissions import require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.design.models.change_notice import DesignChangeNotice, DesignChangeNoticeDocument
from app.modules.design.models.document import (
    DesignDocument, DesignDocumentRevision, DESIGN_DISCIPLINES, DESIGN_DOCUMENT_TYPES,
)
from app.modules.design.models.event import DesignEvent
from app.modules.design.schemas.document import (
    DesignDocumentCreate, DesignDocumentDetail, DesignDocumentEcnRef, DesignDocumentObsoletePayload,
    DesignDocumentResponse, DesignDocumentUpdate,
)
from app.modules.design.schemas.event import DesignCommentPayload, DesignEventResponse
from app.modules.design.schemas.revision import (
    DesignDocumentRevisionResponse, DesignRevisionCreate, DesignRevisionFileResponse,
)
from app.modules.design.service import (
    add_event, allowed_document_actions, check_delete_document, check_edit_document, check_new_revision,
    check_obsolete, check_reactivate, display_status, ensure, generate_document_number, get_workflow_user,
    live_revisions, open_revision, released_revision, revision_label, user_name, users_by_id, utcnow,
    validate_signatories,
)
from app.modules.erp.models.project import Project
from app.modules.main.models.user import User
from app.modules.organization.models.department import Department
from app.modules.projects.models.project import PmProject
from app.modules.store.models.item import StoreItem
from app.utils.sharepoint import delete_file_from_sharepoint

router = APIRouter(
    prefix="/design/documents", tags=["Design"],
    dependencies=[Depends(require_app_access("design"))],
)


# ---------------------------------------------------------------------------
# Loading + presentation (also used by revisions.py / reports.py)
# ---------------------------------------------------------------------------

def get_document(db: Session, document_id: int, lock: bool = False) -> DesignDocument:
    if lock:
        # Row lock first (no eager joins — FOR UPDATE can't sit on an outer
        # join), then load the graph separately.
        db.query(DesignDocument.id).filter(DesignDocument.id == document_id).with_for_update().first()
    doc = db.query(DesignDocument).options(
        selectinload(DesignDocument.revisions).selectinload(DesignDocumentRevision.files)
    ).populate_existing().filter(DesignDocument.id == document_id, DesignDocument.is_deleted == False).first()  # noqa: E712
    if not doc:
        raise HTTPException(status_code=404, detail=f"Design document #{document_id} not found — it may have been deleted.")
    return doc


def machine_label(project: Project | None) -> str | None:
    if not project:
        return None
    what = project.model_name or project.machine_type
    label = f"{project.serial_number} — {what}" if what else project.serial_number
    return f"{label} ({project.client_company})" if project.client_company else label


class _Labels:
    """Batch-resolves every id → display name the given documents need, so
    the register doesn't issue one query per row."""

    def __init__(self, db: Session, docs: list[DesignDocument]):
        revs = [r for d in docs for r in live_revisions(d)]
        user_ids = {d.owner_id for d in docs} | {d.created_by_id for d in docs} | {d.obsoleted_by_id for d in docs}
        for r in revs:
            user_ids |= {r.created_by_id, r.reviewer_id, r.approver_id, r.reviewed_by_id, r.approved_by_id}
            user_ids |= {f.uploaded_by_id for f in r.files}
        self.users = users_by_id(db, user_ids)
        self.pm = self._load(db, PmProject, {d.pm_project_id for d in docs})
        self.machines = self._load(db, Project, {d.erp_project_id for d in docs})
        self.items = self._load(db, StoreItem, {d.store_item_id for d in docs})
        self.departments = self._load(db, Department, {d.department_id for d in docs})
        ecn_ids = {r.ecn_id for r in revs} - {None}
        self.ecns = {e.id: e.ecn_number for e in db.query(DesignChangeNotice).filter(DesignChangeNotice.id.in_(ecn_ids)).all()} if ecn_ids else {}

    @staticmethod
    def _load(db: Session, model, ids):
        ids = {i for i in ids if i}
        return {o.id: o for o in db.query(model).filter(model.id.in_(ids)).all()} if ids else {}

    def name(self, user_id: int | None) -> str | None:
        return user_name(self.users.get(user_id)) if user_id else None


def _revision_response(rev: DesignDocumentRevision, labels: _Labels) -> DesignDocumentRevisionResponse:
    resp = DesignDocumentRevisionResponse.model_validate(rev)
    resp.files = []
    for f in rev.files:
        if f.is_deleted:
            continue
        fr = DesignRevisionFileResponse.model_validate(f)
        fr.uploaded_by_name = labels.name(f.uploaded_by_id)
        resp.files.append(fr)
    resp.created_by_name = labels.name(rev.created_by_id)
    resp.reviewer_name = labels.name(rev.reviewer_id)
    resp.approver_name = labels.name(rev.approver_id)
    resp.reviewed_by_name = labels.name(rev.reviewed_by_id)
    resp.approved_by_name = labels.name(rev.approved_by_id)
    resp.ecn_number = labels.ecns.get(rev.ecn_id) if rev.ecn_id else None
    return resp


def _document_response(doc: DesignDocument, labels: _Labels, cls=DesignDocumentResponse):
    resp = cls.model_validate(doc)
    resp.owner_name = labels.name(doc.owner_id)
    resp.created_by_name = labels.name(doc.created_by_id)
    resp.obsoleted_by_name = labels.name(doc.obsoleted_by_id)
    pm = labels.pm.get(doc.pm_project_id)
    resp.pm_project_label = f"{pm.project_code} — {pm.name}" if pm else None
    resp.erp_project_label = machine_label(labels.machines.get(doc.erp_project_id))
    item = labels.items.get(doc.store_item_id)
    resp.store_item_label = f"{item.item_code} — {item.item_name}" if item else None
    dept = labels.departments.get(doc.department_id)
    resp.department_name = dept.name if dept else None
    resp.display_status = display_status(doc)
    released = released_revision(doc)
    if released:
        resp.released_revision_id = released.id
        resp.released_revision_label = released.revision_label
        resp.released_at = released.released_at
    current = open_revision(doc)
    if current:
        resp.open_revision_id = current.id
        resp.open_revision_label = current.revision_label
        resp.open_revision_status = current.status
        pending_id = {"draft": current.created_by_id, "in_review": current.reviewer_id, "in_approval": current.approver_id}.get(current.status)
        resp.pending_with_name = labels.name(pending_id)
    return resp


def document_responses(db: Session, docs: list[DesignDocument]) -> list[DesignDocumentResponse]:
    labels = _Labels(db, docs)
    return [_document_response(d, labels) for d in docs]


def document_detail(db: Session, doc: DesignDocument, user: User) -> DesignDocumentDetail:
    doc = get_document(db, doc.id)
    labels = _Labels(db, [doc])
    resp: DesignDocumentDetail = _document_response(doc, labels, DesignDocumentDetail)
    resp.revisions = [_revision_response(r, labels) for r in reversed(live_revisions(doc))]

    events = db.query(DesignEvent).filter(DesignEvent.document_id == doc.id).order_by(DesignEvent.created_at.desc(), DesignEvent.id.desc()).all()
    actors = users_by_id(db, {e.actor_id for e in events})
    rev_labels = {r.id: r.revision_label for r in doc.revisions}
    resp.events = []
    for e in events:
        er = DesignEventResponse.model_validate(e)
        er.actor_name = user_name(actors.get(e.actor_id))
        er.revision_label = rev_labels.get(e.revision_id)
        er.doc_number = doc.doc_number
        resp.events.append(er)

    ecns = db.query(DesignChangeNotice).join(
        DesignChangeNoticeDocument, DesignChangeNoticeDocument.ecn_id == DesignChangeNotice.id
    ).filter(
        DesignChangeNoticeDocument.document_id == doc.id,
        DesignChangeNotice.status == "approved",
        DesignChangeNotice.is_deleted == False,  # noqa: E712
    ).order_by(DesignChangeNotice.id.desc()).all()
    resp.open_ecns = [DesignDocumentEcnRef(id=e.id, ecn_number=e.ecn_number, title=e.title, status=e.status) for e in ecns]
    resp.allowed_actions = allowed_document_actions(user, doc)
    return resp


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _require_choice(value: str, choices, field: str) -> None:
    if value not in choices:
        raise HTTPException(status_code=400, detail=f"'{value}' isn't a valid {field}. Choose one of: {', '.join(choices)}.")


def validate_links(db: Session, *, pm_project_id=None, erp_project_id=None, store_item_id=None, department_id=None) -> None:
    if pm_project_id and not db.query(PmProject.id).filter(PmProject.id == pm_project_id).first():
        raise HTTPException(status_code=400, detail=f"Project #{pm_project_id} wasn't found — it may have been deleted. Pick another project or leave it blank.")
    if erp_project_id and not db.query(Project.id).filter(Project.id == erp_project_id, Project.is_deleted == False).first():  # noqa: E712
        raise HTTPException(status_code=400, detail=f"Machine #{erp_project_id} wasn't found — it may have been deleted. Pick another machine or leave it blank.")
    if store_item_id and not db.query(StoreItem.id).filter(StoreItem.id == store_item_id).first():
        raise HTTPException(status_code=400, detail=f"Store item #{store_item_id} wasn't found. Pick another item or leave it blank.")
    if department_id and not db.query(Department.id).filter(Department.id == department_id).first():
        raise HTTPException(status_code=400, detail=f"Department #{department_id} wasn't found. Pick another department or leave it blank.")


def validate_ecn_link(db: Session, doc: DesignDocument, ecn_id: int | None) -> None:
    """A revision can only be raised under an approved ECN that lists this document."""
    if not ecn_id:
        return
    ecn = db.query(DesignChangeNotice).filter(DesignChangeNotice.id == ecn_id, DesignChangeNotice.is_deleted == False).first()  # noqa: E712
    if not ecn:
        raise HTTPException(status_code=400, detail=f"ECN #{ecn_id} wasn't found — it may have been deleted.")
    if ecn.status != "approved":
        raise HTTPException(status_code=400, detail=f"{ecn.ecn_number} is {ecn.status} — revisions can only be raised under an approved, not-yet-implemented ECN.")
    listed = db.query(DesignChangeNoticeDocument.id).filter(
        DesignChangeNoticeDocument.ecn_id == ecn.id, DesignChangeNoticeDocument.document_id == doc.id
    ).first()
    if not listed:
        raise HTTPException(status_code=400, detail=f"{ecn.ecn_number} doesn't list {doc.doc_number} as an affected document. Add it to the ECN first, or pick the right ECN.")


def list_documents_query(
    db: Session, *, status: str | None = None, document_type: str | None = None, discipline: str | None = None,
    pm_project_id: int | None = None, erp_project_id: int | None = None, store_item_id: int | None = None,
    owner_id: int | None = None, search: str | None = None, limit: int = 1000,
) -> list[DesignDocument]:
    """Shared by the register and the Master Document List export. `status`
    is a comma list of display statuses (see service.display_status)."""
    query = db.query(DesignDocument).options(
        selectinload(DesignDocument.revisions).selectinload(DesignDocumentRevision.files)
    ).filter(DesignDocument.is_deleted == False)  # noqa: E712
    if document_type:
        query = query.filter(DesignDocument.document_type.in_(document_type.split(",")))
    if discipline:
        query = query.filter(DesignDocument.discipline.in_(discipline.split(",")))
    if pm_project_id:
        query = query.filter(DesignDocument.pm_project_id == pm_project_id)
    if erp_project_id:
        query = query.filter(DesignDocument.erp_project_id == erp_project_id)
    if store_item_id:
        query = query.filter(DesignDocument.store_item_id == store_item_id)
    if owner_id:
        query = query.filter(DesignDocument.owner_id == owner_id)
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(
            DesignDocument.doc_number.ilike(like) | DesignDocument.title.ilike(like) | DesignDocument.description.ilike(like)
        )
    docs = query.order_by(DesignDocument.updated_at.desc(), DesignDocument.id.desc()).limit(limit).all()
    if status:
        wanted = set(status.split(","))
        docs = [d for d in docs if display_status(d) in wanted]
    return docs


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=list[DesignDocumentResponse])
async def list_documents(
    status_filter: str | None = Query(None, alias="status"),
    document_type: str | None = None,
    discipline: str | None = None,
    pm_project_id: int | None = None,
    erp_project_id: int | None = None,
    store_item_id: int | None = None,
    owner_id: int | None = None,
    search: str | None = None,
    limit: int = Query(1000, ge=1, le=5000),
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("design", "documents")),
):
    docs = list_documents_query(
        db, status=status_filter, document_type=document_type, discipline=discipline, pm_project_id=pm_project_id,
        erp_project_id=erp_project_id, store_item_id=store_item_id, owner_id=owner_id, search=search, limit=limit,
    )
    return document_responses(db, docs)


@router.post("", response_model=DesignDocumentDetail, status_code=201)
async def create_document(
    payload: DesignDocumentCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    _require_choice(payload.document_type, list(DESIGN_DOCUMENT_TYPES), "document type")
    _require_choice(payload.discipline, DESIGN_DISCIPLINES, "discipline")
    validate_links(
        db, pm_project_id=payload.pm_project_id, erp_project_id=payload.erp_project_id,
        store_item_id=payload.store_item_id, department_id=payload.department_id,
    )
    owner_id = payload.owner_id or user.id
    if owner_id != user.id:
        get_workflow_user(db, owner_id, "owner")
    validate_signatories(db, user.id, payload.reviewer_id, payload.approver_id)

    doc = DesignDocument(
        doc_number=generate_document_number(db, payload.document_type),
        title=payload.title.strip(),
        description=payload.description,
        document_type=payload.document_type,
        discipline=payload.discipline,
        pm_project_id=payload.pm_project_id,
        erp_project_id=payload.erp_project_id,
        store_item_id=payload.store_item_id,
        department_id=payload.department_id,
        owner_id=owner_id,
        created_by_id=user.id,
        status="active",
    )
    db.add(doc)
    db.flush()
    rev = DesignDocumentRevision(
        document_id=doc.id, revision_index=0, revision_label=revision_label(0), status="draft",
        change_summary=(payload.change_summary or "").strip() or "Initial issue",
        created_by_id=user.id, reviewer_id=payload.reviewer_id, approver_id=payload.approver_id,
    )
    db.add(rev)
    db.flush()
    add_event(db, "created", user, document_id=doc.id, revision_id=rev.id)
    db.commit()
    return document_detail(db, doc, user)


@router.get("/{document_id}", response_model=DesignDocumentDetail)
async def get_document_detail(
    document_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    return document_detail(db, get_document(db, document_id), user)


@router.patch("/{document_id}", response_model=DesignDocumentDetail)
async def update_document(
    document_id: int,
    payload: DesignDocumentUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    doc = get_document(db, document_id, lock=True)
    ensure(check_edit_document(user, doc))
    changes = payload.model_dump(exclude_unset=True)
    if "title" in changes and not (changes["title"] or "").strip():
        raise HTTPException(status_code=400, detail="Title can't be empty.")
    if "discipline" in changes:
        if not changes["discipline"]:
            raise HTTPException(status_code=400, detail="Discipline can't be empty.")
        _require_choice(changes["discipline"], DESIGN_DISCIPLINES, "discipline")
    if "owner_id" in changes:
        if not changes["owner_id"]:
            raise HTTPException(status_code=400, detail=f"{doc.doc_number} must have an owner — pick the engineer responsible for it.")
        get_workflow_user(db, changes["owner_id"], "owner")
    validate_links(db, **{k: v for k, v in changes.items() if k in ("pm_project_id", "erp_project_id", "store_item_id", "department_id")})

    changed = [k for k, v in changes.items() if getattr(doc, k) != v]
    for key in changed:
        setattr(doc, key, changes[key].strip() if key == "title" else changes[key])
    if changed:
        add_event(db, "details_updated", user, document_id=doc.id, comment="Changed " + ", ".join(k.replace("_id", "").replace("_", " ") for k in changed))
    db.commit()
    return document_detail(db, doc, user)


@router.delete("/{document_id}")
async def delete_document(
    document_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    doc = get_document(db, document_id, lock=True)
    ensure(check_delete_document(user, doc))
    now = datetime.now(timezone.utc)
    paths = []
    for rev in live_revisions(doc):
        for f in rev.files:
            if not f.is_deleted:
                f.is_deleted, f.deleted_at = True, now
                if f.sharepoint_path:
                    paths.append(f.sharepoint_path)
        rev.is_deleted, rev.deleted_at = True, now
    doc.is_deleted, doc.deleted_at = True, now
    add_event(db, "deleted", user, document_id=doc.id)
    db.commit()
    # A never-released draft's files aren't controlled records — clean them
    # out of SharePoint too, best-effort (the DB delete already stands).
    if settings.SHAREPOINT_SITE_ID:
        for path in paths:
            try:
                await delete_file_from_sharepoint(settings.SHAREPOINT_SITE_ID, path)
            except Exception:
                pass
    return {"message": f"{doc.doc_number} deleted"}


@router.post("/{document_id}/obsolete", response_model=DesignDocumentDetail)
async def obsolete_document(
    document_id: int,
    payload: DesignDocumentObsoletePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    doc = get_document(db, document_id, lock=True)
    ensure(check_obsolete(user, doc))
    doc.status = "obsolete"
    doc.obsoleted_at = utcnow()
    doc.obsoleted_by_id = user.id
    doc.obsolete_reason = payload.reason.strip()
    add_event(db, "obsoleted", user, document_id=doc.id, comment=doc.obsolete_reason)
    db.commit()
    return document_detail(db, doc, user)


@router.post("/{document_id}/reactivate", response_model=DesignDocumentDetail)
async def reactivate_document(
    document_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    doc = get_document(db, document_id, lock=True)
    ensure(check_reactivate(user, doc))
    doc.status = "active"
    doc.obsoleted_at = None
    doc.obsoleted_by_id = None
    doc.obsolete_reason = None
    add_event(db, "reactivated", user, document_id=doc.id)
    db.commit()
    return document_detail(db, doc, user)


@router.post("/{document_id}/revisions", response_model=DesignDocumentDetail, status_code=201)
async def start_revision(
    document_id: int,
    payload: DesignRevisionCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    doc = get_document(db, document_id, lock=True)
    ensure(check_new_revision(user, doc))
    validate_signatories(db, user.id, payload.reviewer_id, payload.approver_id)
    validate_ecn_link(db, doc, payload.ecn_id)
    last_index = db.query(func.max(DesignDocumentRevision.revision_index)).filter(
        DesignDocumentRevision.document_id == doc.id, DesignDocumentRevision.is_deleted == False  # noqa: E712
    ).scalar() or 0
    index = last_index + 1
    rev = DesignDocumentRevision(
        document_id=doc.id, revision_index=index, revision_label=revision_label(index), status="draft",
        change_summary=payload.change_summary.strip(), ecn_id=payload.ecn_id, created_by_id=user.id,
        reviewer_id=payload.reviewer_id, approver_id=payload.approver_id,
    )
    db.add(rev)
    db.flush()
    add_event(db, "revision_started", user, document_id=doc.id, revision_id=rev.id, comment=rev.change_summary)
    if payload.ecn_id:
        add_event(db, "document_revision_started", user, ecn_id=payload.ecn_id, document_id=doc.id, revision_id=rev.id)
    db.commit()
    return document_detail(db, doc, user)


@router.post("/{document_id}/comments", response_model=DesignDocumentDetail)
async def add_comment(
    document_id: int,
    payload: DesignCommentPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    doc = get_document(db, document_id)
    if payload.revision_id and payload.revision_id not in {r.id for r in live_revisions(doc)}:
        raise HTTPException(status_code=400, detail=f"Revision #{payload.revision_id} doesn't belong to {doc.doc_number}.")
    add_event(db, "comment", user, document_id=doc.id, revision_id=payload.revision_id, comment=payload.comment)
    db.commit()
    return document_detail(db, doc, user)
