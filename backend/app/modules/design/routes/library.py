"""Design Library — standards, standard parts, templates, approved makes —
and the review checklists. Everyone with the Design app reads it; the
Design head maintains standards, templates and checklists, designers add
standard parts and approved makes."""
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import ensure_can_delete, require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.design.access import require_head, require_team
from app.modules.design.features import ensure_design_feature
from app.modules.design.files import remove_file, store_file, stream_file
from app.modules.design.models.document import DesignDocument, DESIGN_DISCIPLINES, DESIGN_DOCUMENT_TYPES
from app.modules.design.models.library import (
    DesignChecklist, DesignChecklistItem, DesignItemApprovedMake, DesignStandard, DesignStandardPart, DesignTemplate,
    DESIGN_MAKE_STATUSES, DESIGN_STANDARD_BODIES, DESIGN_TEMPLATE_KINDS,
)
from app.modules.design.routes.documents import standard_label
from app.modules.design.schemas.library import (
    DesignApprovedMakeCreate, DesignApprovedMakeResponse, DesignApprovedMakeUpdate, DesignChecklistCreate,
    DesignChecklistItemPayload, DesignChecklistResponse, DesignChecklistUpdate, DesignStandardCreate,
    DesignStandardPartCreate, DesignStandardPartResponse, DesignStandardPartUpdate, DesignStandardResponse,
    DesignStandardUpdate, DesignTemplateResponse,
)
from app.modules.design.service import released_revision, user_name, users_by_id, utcnow
from app.modules.main.models.user import User
from app.modules.store.models.item import StoreItem
from app.utils.sharepoint import sanitize_folder_name

router = APIRouter(prefix="/design/library", tags=["Design"], dependencies=[Depends(require_app_access("design"))])


def _choice(value, choices, what):
    if value is not None and value not in choices:
        raise HTTPException(status_code=400, detail=f"'{value}' isn't a valid {what}. Choose one of: {', '.join(choices)}.")


# ---------------------------------------------------------------------------
# Standards
# ---------------------------------------------------------------------------

def _standard_rows(db: Session, rows: list[DesignStandard]) -> list[DesignStandardResponse]:
    counts = dict(db.query(DesignDocument.standard_id, func.count(DesignDocument.id)).filter(
        DesignDocument.standard_id.in_([s.id for s in rows]), DesignDocument.is_deleted == False  # noqa: E712
    ).group_by(DesignDocument.standard_id).all()) if rows else {}
    out = []
    for s in rows:
        r = DesignStandardResponse.model_validate(s)
        r.drawing_count = counts.get(s.id, 0)
        out.append(r)
    return out


def _get_standard(db: Session, standard_id: int) -> DesignStandard:
    s = db.query(DesignStandard).filter(DesignStandard.id == standard_id, DesignStandard.is_deleted == False).first()  # noqa: E712
    if not s:
        raise HTTPException(status_code=404, detail=f"Standard #{standard_id} isn't in the library.")
    return s


@router.get("/standards", response_model=list[DesignStandardResponse])
async def list_standards(current_only: bool = False, search: str | None = None, db: Session = Depends(get_db),
                         _tab: User = Depends(require_tab_access("design", "library"))):
    ensure_design_feature(_tab, "library", "standards", "view")
    q = db.query(DesignStandard).filter(DesignStandard.is_deleted == False)  # noqa: E712
    if current_only:
        q = q.filter(DesignStandard.is_current == True)  # noqa: E712
    if search:
        like = f"%{search.strip()}%"
        q = q.filter(DesignStandard.code.ilike(like) | DesignStandard.title.ilike(like))
    return _standard_rows(db, q.order_by(DesignStandard.body, DesignStandard.code, DesignStandard.version).all())


@router.post("/standards", response_model=DesignStandardResponse, status_code=201)
async def create_standard(payload: DesignStandardCreate, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    require_head(db, user, "add standards to the library")
    ensure_design_feature(user, "library", "standards", "create")
    _choice(payload.body, DESIGN_STANDARD_BODIES, "standards body")
    dup = db.query(DesignStandard.id).filter(
        func.lower(DesignStandard.code) == payload.code.strip().lower(),
        func.coalesce(DesignStandard.version, "") == (payload.version or "").strip(), DesignStandard.is_deleted == False,  # noqa: E712
    ).first()
    if dup:
        raise HTTPException(status_code=409, detail=f"{payload.code} {payload.version or ''} is already in the library — edit that entry instead.")
    s = DesignStandard(**{**payload.model_dump(), "code": payload.code.strip(), "version": (payload.version or "").strip() or None}, created_by_id=user.id)
    db.add(s)
    db.commit()
    return _standard_rows(db, [s])[0]


@router.patch("/standards/{standard_id}", response_model=DesignStandardResponse)
async def update_standard(standard_id: int, payload: DesignStandardUpdate, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    require_head(db, user, "edit standards")
    ensure_design_feature(user, "library", "standards", "edit")
    s = _get_standard(db, standard_id)
    changes = payload.model_dump(exclude_unset=True)
    _choice(changes.get("body"), DESIGN_STANDARD_BODIES, "standards body")
    for k, v in changes.items():
        if v is None and k in ("body", "code", "title", "is_current"):
            continue
        setattr(s, k, v)
    db.commit()
    return _standard_rows(db, [s])[0]


@router.delete("/standards/{standard_id}")
async def delete_standard(standard_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    require_head(db, user, "remove standards")
    ensure_design_feature(user, "library", "standards", "delete")
    s = _get_standard(db, standard_id)
    ensure_can_delete(user, s, "design", "library", what="standard")
    used = db.query(DesignDocument.id).filter(DesignDocument.standard_id == s.id, DesignDocument.is_deleted == False).count()  # noqa: E712
    if used:
        raise HTTPException(status_code=409, detail=f"{s.code} is cited by {used} drawing(s), so it stays on record. Mark it 'not current' instead.")
    s.is_deleted, s.deleted_at = True, utcnow()
    db.commit()
    await remove_file(s.sharepoint_path)
    return {"message": f"{s.code} removed"}


@router.post("/standards/{standard_id}/file", response_model=DesignStandardResponse)
async def upload_standard_file(standard_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    require_head(db, user, "attach standard documents")
    ensure_design_feature(user, "library", "standards", "edit")
    s = _get_standard(db, standard_id)
    old = s.sharepoint_path
    stored = await store_file(f"Design-media/Library/Standards/{sanitize_folder_name(s.code)}", file)
    s.file_name, s.sharepoint_path, s.file_size = stored["name"], stored["path"], stored["size"]
    db.commit()
    if old and old != stored["path"]:
        await remove_file(old)
    return _standard_rows(db, [s])[0]


@router.get("/standards/{standard_id}/file")
async def get_standard_file(standard_id: int, download: bool = False, db: Session = Depends(get_db),
                            _tab: User = Depends(require_tab_access("design", "library"))):
    ensure_design_feature(_tab, "library", "standards", "view")
    s = _get_standard(db, standard_id)
    return await stream_file(s.sharepoint_path, s.file_name or f"{s.code}.pdf", download)


# ---------------------------------------------------------------------------
# Approved makes
# ---------------------------------------------------------------------------

def _make_rows(db: Session, rows: list[DesignItemApprovedMake]) -> list[DesignApprovedMakeResponse]:
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({r.store_item_id for r in rows})).all()} if rows else {}
    users = users_by_id(db, {r.approved_by_id for r in rows})
    out = []
    for m in rows:
        r = DesignApprovedMakeResponse.model_validate(m)
        item = items.get(m.store_item_id)
        r.item_code, r.item_name = (item.item_code, item.item_name) if item else (None, None)
        r.approved_by_name = user_name(users.get(m.approved_by_id))
        out.append(r)
    return out


@router.get("/approved-makes", response_model=list[DesignApprovedMakeResponse])
async def list_makes(store_item_id: int | None = None, search: str | None = None, db: Session = Depends(get_db),
                     _user: User = Depends(require_app_access("design"))):
    q = db.query(DesignItemApprovedMake)
    if store_item_id:
        q = q.filter(DesignItemApprovedMake.store_item_id == store_item_id)
    if search:
        like = f"%{search.strip()}%"
        ids = [i for (i,) in db.query(StoreItem.id).filter(StoreItem.item_code.ilike(like) | StoreItem.item_name.ilike(like)).limit(500).all()]
        q = q.filter(DesignItemApprovedMake.make.ilike(like) | DesignItemApprovedMake.store_item_id.in_(ids))
    return _make_rows(db, q.order_by(DesignItemApprovedMake.store_item_id, DesignItemApprovedMake.id).limit(2000).all())


@router.post("/approved-makes", response_model=DesignApprovedMakeResponse, status_code=201)
async def create_make(payload: DesignApprovedMakeCreate, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    require_team(db, user, "approve makes")
    ensure_design_feature(user, "library", "approved_makes", "create")
    _choice(payload.status, DESIGN_MAKE_STATUSES, "status")
    if not db.query(StoreItem.id).filter(StoreItem.id == payload.store_item_id).first():
        raise HTTPException(status_code=400, detail=f"Item #{payload.store_item_id} isn't in Item Master.")
    dup = db.query(DesignItemApprovedMake.id).filter(
        DesignItemApprovedMake.store_item_id == payload.store_item_id,
        func.lower(DesignItemApprovedMake.make) == payload.make.strip().lower(),
        func.coalesce(DesignItemApprovedMake.part_number, "") == (payload.part_number or "").strip(),
    ).first()
    if dup:
        raise HTTPException(status_code=409, detail=f"{payload.make} is already listed for this item — edit that entry instead.")
    m = DesignItemApprovedMake(store_item_id=payload.store_item_id, make=payload.make.strip(),
                               part_number=(payload.part_number or "").strip() or None, status=payload.status,
                               remarks=payload.remarks, approved_by_id=user.id)
    db.add(m)
    db.commit()
    return _make_rows(db, [m])[0]


@router.patch("/approved-makes/{make_id}", response_model=DesignApprovedMakeResponse)
async def update_make(make_id: int, payload: DesignApprovedMakeUpdate, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    require_team(db, user, "change approved makes")
    ensure_design_feature(user, "library", "approved_makes", "edit")
    m = db.query(DesignItemApprovedMake).filter(DesignItemApprovedMake.id == make_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="That approved make no longer exists.")
    changes = payload.model_dump(exclude_unset=True)
    _choice(changes.get("status"), DESIGN_MAKE_STATUSES, "status")
    for k, v in changes.items():
        if v is None and k in ("make", "status"):
            continue
        setattr(m, k, v)
    m.approved_by_id = user.id
    db.commit()
    return _make_rows(db, [m])[0]


@router.delete("/approved-makes/{make_id}")
async def delete_make(make_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    require_head(db, user, "delete approved makes (withdraw them instead to keep the record)")
    ensure_design_feature(user, "library", "approved_makes", "delete")
    m = db.query(DesignItemApprovedMake).filter(DesignItemApprovedMake.id == make_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="That approved make no longer exists.")
    ensure_can_delete(user, m, "design", "library", what="approved make")
    db.delete(m)
    db.commit()
    return {"message": "Removed"}


# ---------------------------------------------------------------------------
# Standard parts
# ---------------------------------------------------------------------------

def _part_rows(db: Session, rows: list[DesignStandardPart]) -> list[DesignStandardPartResponse]:
    items = {i.id: i for i in db.query(StoreItem).filter(StoreItem.id.in_({r.store_item_id for r in rows})).all()} if rows else {}
    docs = {d.id: d for d in db.query(DesignDocument).options(selectinload(DesignDocument.revisions)).filter(
        DesignDocument.id.in_({r.document_id for r in rows} - {None})).all()}
    stds = {s.id: s for s in db.query(DesignStandard).filter(DesignStandard.id.in_({r.standard_id for r in rows} - {None})).all()}
    makes: dict[int, list[str]] = {}
    for m in db.query(DesignItemApprovedMake).filter(
        DesignItemApprovedMake.store_item_id.in_(items), DesignItemApprovedMake.status != "withdrawn"
    ).all() if items else []:
        makes.setdefault(m.store_item_id, []).append(m.make)
    out = []
    for p in rows:
        r = DesignStandardPartResponse.model_validate(p)
        item = items.get(p.store_item_id)
        if item:
            r.item_code, r.item_name, r.item_status = item.item_code, item.item_name, item.status
        doc = docs.get(p.document_id)
        if doc:
            rel = released_revision(doc)
            r.doc_number, r.released_revision_label = doc.doc_number, rel.revision_label if rel else None
        r.standard_label = standard_label(stds.get(p.standard_id))
        r.approved_makes = makes.get(p.store_item_id, [])
        out.append(r)
    return out


@router.get("/standard-parts", response_model=list[DesignStandardPartResponse])
async def list_parts(discipline: str | None = None, search: str | None = None, db: Session = Depends(get_db),
                     _user: User = Depends(require_app_access("design"))):
    q = db.query(DesignStandardPart).filter(DesignStandardPart.is_deleted == False)  # noqa: E712
    if discipline:
        q = q.filter(DesignStandardPart.discipline == discipline)
    if search:
        like = f"%{search.strip()}%"
        ids = [i for (i,) in db.query(StoreItem.id).filter(StoreItem.item_code.ilike(like) | StoreItem.item_name.ilike(like)).limit(500).all()]
        q = q.filter(DesignStandardPart.store_item_id.in_(ids) | DesignStandardPart.notes.ilike(like))
    return _part_rows(db, q.order_by(DesignStandardPart.id.desc()).limit(2000).all())


def _validate_part(db: Session, values: dict) -> None:
    _choice(values.get("discipline"), DESIGN_DISCIPLINES, "discipline")
    if values.get("document_id") and not db.query(DesignDocument.id).filter(DesignDocument.id == values["document_id"], DesignDocument.is_deleted == False).first():  # noqa: E712
        raise HTTPException(status_code=400, detail=f"Drawing #{values['document_id']} wasn't found.")
    if values.get("standard_id"):
        _get_standard(db, values["standard_id"])


@router.post("/standard-parts", response_model=DesignStandardPartResponse, status_code=201)
async def create_part(payload: DesignStandardPartCreate, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    require_team(db, user, "add standard parts")
    ensure_design_feature(user, "library", "standard_parts", "create")
    _validate_part(db, payload.model_dump())
    if not db.query(StoreItem.id).filter(StoreItem.id == payload.store_item_id).first():
        raise HTTPException(status_code=400, detail=f"Item #{payload.store_item_id} isn't in Item Master.")
    existing = db.query(DesignStandardPart).filter(DesignStandardPart.store_item_id == payload.store_item_id).first()
    if existing and not existing.is_deleted:
        raise HTTPException(status_code=409, detail="That item is already a standard part — edit the existing entry.")
    if existing:  # re-add a removed one (unique per item)
        for k, v in payload.model_dump().items():
            setattr(existing, k, v)
        existing.is_deleted, existing.deleted_at, existing.created_by_id = False, None, user.id
        part = existing
    else:
        part = DesignStandardPart(**payload.model_dump(), created_by_id=user.id)
        db.add(part)
    db.commit()
    return _part_rows(db, [part])[0]


@router.patch("/standard-parts/{part_id}", response_model=DesignStandardPartResponse)
async def update_part(part_id: int, payload: DesignStandardPartUpdate, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    require_team(db, user, "edit standard parts")
    ensure_design_feature(user, "library", "standard_parts", "edit")
    part = db.query(DesignStandardPart).filter(DesignStandardPart.id == part_id, DesignStandardPart.is_deleted == False).first()  # noqa: E712
    if not part:
        raise HTTPException(status_code=404, detail="That standard part no longer exists.")
    changes = payload.model_dump(exclude_unset=True)
    _validate_part(db, changes)
    for k, v in changes.items():
        if v is None and k == "discipline":
            continue
        setattr(part, k, v)
    db.commit()
    return _part_rows(db, [part])[0]


@router.delete("/standard-parts/{part_id}")
async def delete_part(part_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    require_team(db, user, "remove standard parts")
    ensure_design_feature(user, "library", "standard_parts", "delete")
    part = db.query(DesignStandardPart).filter(DesignStandardPart.id == part_id, DesignStandardPart.is_deleted == False).first()  # noqa: E712
    if not part:
        raise HTTPException(status_code=404, detail="That standard part no longer exists.")
    ensure_can_delete(user, part, "design", "library", what="standard part")
    part.is_deleted, part.deleted_at = True, utcnow()
    db.commit()
    return {"message": "Removed"}


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

def _template_rows(db: Session, rows: list[DesignTemplate]) -> list[DesignTemplateResponse]:
    users = users_by_id(db, {t.created_by_id for t in rows})
    out = []
    for t in rows:
        r = DesignTemplateResponse.model_validate(t)
        r.created_by_name = user_name(users.get(t.created_by_id))
        out.append(r)
    return out


@router.get("/templates", response_model=list[DesignTemplateResponse])
async def list_templates(db: Session = Depends(get_db), _user: User = Depends(require_app_access("design"))):
    return _template_rows(db, db.query(DesignTemplate).filter(DesignTemplate.is_deleted == False).order_by(DesignTemplate.kind, DesignTemplate.name).all())  # noqa: E712


@router.post("/templates", response_model=DesignTemplateResponse, status_code=201)
async def upload_template(
    kind: str = Form(...), name: str = Form(...), description: str | None = Form(None), file: UploadFile = File(...),
    db: Session = Depends(get_db), user: User = Depends(require_app_access("design")),
):
    require_head(db, user, "publish templates")
    ensure_design_feature(user, "library", "templates", "create")
    _choice(kind, DESIGN_TEMPLATE_KINDS, "template kind")
    if not name.strip():
        raise HTTPException(status_code=400, detail="Give the template a name.")
    stored = await store_file(f"Design-media/Library/Templates/{sanitize_folder_name(kind)}", file)
    t = DesignTemplate(kind=kind, name=name.strip(), description=(description or "").strip() or None, file_name=stored["name"],
                       sharepoint_path=stored["path"], file_size=stored["size"], created_by_id=user.id)
    db.add(t)
    db.commit()
    return _template_rows(db, [t])[0]


@router.get("/templates/{template_id}/file")
async def get_template_file(template_id: int, download: bool = True, db: Session = Depends(get_db)):
    t = db.query(DesignTemplate).filter(DesignTemplate.id == template_id, DesignTemplate.is_deleted == False).first()  # noqa: E712
    if not t:
        raise HTTPException(status_code=404, detail="That template no longer exists.")
    return await stream_file(t.sharepoint_path, t.file_name, download)


@router.delete("/templates/{template_id}")
async def delete_template(template_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    require_head(db, user, "remove templates")
    ensure_design_feature(user, "library", "templates", "delete")
    t = db.query(DesignTemplate).filter(DesignTemplate.id == template_id, DesignTemplate.is_deleted == False).first()  # noqa: E712
    if not t:
        raise HTTPException(status_code=404, detail="That template no longer exists.")
    ensure_can_delete(user, t, "design", "library", what="template")
    t.is_deleted, t.deleted_at = True, utcnow()
    db.commit()
    await remove_file(t.sharepoint_path)
    return {"message": f"{t.name} removed"}


# ---------------------------------------------------------------------------
# Review checklists
# ---------------------------------------------------------------------------

_CHECKLIST_TYPES = list(DESIGN_DOCUMENT_TYPES) + ["bom"]


def _get_checklist(db: Session, checklist_id: int) -> DesignChecklist:
    c = db.query(DesignChecklist).options(selectinload(DesignChecklist.items)).filter(
        DesignChecklist.id == checklist_id, DesignChecklist.is_deleted == False  # noqa: E712
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail=f"Checklist #{checklist_id} not found.")
    return c


def _set_items(c: DesignChecklist, rows: list[DesignChecklistItemPayload]) -> None:
    """Edits keep item ids (answers already given point at them); removed
    items go — the answers keep their copied text."""
    if not rows:
        raise HTTPException(status_code=400, detail="A checklist needs at least one item.")
    existing = {i.id: i for i in c.items}
    new_items = []
    for order, row in enumerate(rows, start=1):
        if row.id and row.id in existing:
            item = existing[row.id]
            item.text, item.sort_order = row.text.strip(), order
        else:
            item = DesignChecklistItem(text=row.text.strip(), sort_order=order)
        new_items.append(item)
    c.items = new_items


def _ensure_unique(db: Session, document_type: str, discipline: str | None, exclude_id: int | None = None) -> None:
    q = db.query(DesignChecklist.id).filter(
        DesignChecklist.document_type == document_type, DesignChecklist.is_active == True, DesignChecklist.is_deleted == False,  # noqa: E712
        (DesignChecklist.discipline == discipline) if discipline else DesignChecklist.discipline.is_(None),
    )
    if exclude_id:
        q = q.filter(DesignChecklist.id != exclude_id)
    if q.first():
        raise HTTPException(status_code=409, detail="There's already an active checklist for this document type and discipline — edit it, or deactivate it first.")


@router.get("/checklists", response_model=list[DesignChecklistResponse])
async def list_checklists(db: Session = Depends(get_db), _user: User = Depends(require_app_access("design"))):
    return db.query(DesignChecklist).options(selectinload(DesignChecklist.items)).filter(
        DesignChecklist.is_deleted == False  # noqa: E712
    ).order_by(DesignChecklist.document_type, DesignChecklist.discipline).all()


@router.post("/checklists", response_model=DesignChecklistResponse, status_code=201)
async def create_checklist(payload: DesignChecklistCreate, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    require_head(db, user, "manage review checklists")
    ensure_design_feature(user, "library", "checklists", "create")
    _choice(payload.document_type, _CHECKLIST_TYPES, "document type")
    _choice(payload.discipline, DESIGN_DISCIPLINES, "discipline")
    if payload.is_active:
        _ensure_unique(db, payload.document_type, payload.discipline)
    c = DesignChecklist(name=payload.name.strip(), document_type=payload.document_type, discipline=payload.discipline,
                        is_active=payload.is_active, created_by_id=user.id)
    _set_items(c, payload.items)
    db.add(c)
    db.commit()
    return _get_checklist(db, c.id)


@router.patch("/checklists/{checklist_id}", response_model=DesignChecklistResponse)
async def update_checklist(checklist_id: int, payload: DesignChecklistUpdate, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    require_head(db, user, "manage review checklists")
    ensure_design_feature(user, "library", "checklists", "edit")
    c = _get_checklist(db, checklist_id)
    changes = payload.model_dump(exclude_unset=True)
    _choice(changes.get("discipline"), DESIGN_DISCIPLINES, "discipline")
    discipline = changes.get("discipline", c.discipline)
    if changes.get("is_active", c.is_active):
        _ensure_unique(db, c.document_type, discipline, exclude_id=c.id)
    if changes.get("name"):
        c.name = changes["name"].strip()
    if "discipline" in changes:
        c.discipline = discipline
    if changes.get("is_active") is not None:
        c.is_active = changes["is_active"]
    if payload.items is not None:
        _set_items(c, payload.items)
    db.commit()
    return _get_checklist(db, c.id)


@router.delete("/checklists/{checklist_id}")
async def delete_checklist(checklist_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    require_head(db, user, "manage review checklists")
    ensure_design_feature(user, "library", "checklists", "delete")
    c = _get_checklist(db, checklist_id)
    ensure_can_delete(user, c, "design", "library", what="review checklist")
    c.is_deleted, c.deleted_at, c.is_active = True, utcnow(), False
    db.commit()
    return {"message": f"{c.name} removed"}
