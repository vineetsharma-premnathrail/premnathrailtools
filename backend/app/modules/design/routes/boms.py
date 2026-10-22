"""Engineering BOMs: register, R0 draft with lines, check → release with
the release checks, new revisions (copied from the released one), the
multi-level explosion, export, where-used and new-item requests.

The released BOM is what Purchase buys, Store issues and Production builds,
so release notifies those apps — a notification, never an automatic stock
or purchase document (PM/Store stay unlinked for now)."""
import csv
import io
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import ensure_can_delete, ensure_tab_action, require_app_access, require_tab_access
from app.db.session import get_db
from app.modules.design.access import (
    get_settings, is_team, next_number, require_team, year_prefix,
)
from app.modules.design.approvals import BOM_ENTITY, BOM_KEY, can_decide, mark_checklist_done, pending_request
from app.modules.design.scope import apply_scope, ensure_in_scope
from app.modules.design.bom_service import (
    allowed_bom_actions, bom_display_status, bom_ever_released, bom_ref, check_bom_approve, check_bom_delete,
    check_bom_discard, check_bom_edit, check_bom_manage_draft, check_bom_new_revision, check_bom_obsolete,
    check_bom_recall, check_bom_review, line_blockers, live_bom_revisions, open_bom_revision, released_bom_revision,
    snapshot_drawing_revisions,
)
from app.modules.design.checklists import active_checklist, record_answers
from app.modules.design.features import ensure_design_feature, gate_actions, has
from app.modules.design.order_project_links import clean_op_link, op_label_maps, set_op_label
from app.modules.design.models.bom import DesignBom, DesignBomLine, DesignBomRevision, DESIGN_MAKE_BUY
from app.modules.design.models.change_notice import DesignChangeNotice, DesignChangeNoticeBom
from app.modules.design.models.document import DesignDocument
from app.modules.design.models.event import DesignEvent
from app.modules.design.models.library import DesignItemApprovedMake, DesignReviewResult
from app.modules.design.models.request import DesignRequest
from app.modules.design.routes.documents import machine_label, validate_links
from app.modules.design.schemas.bom import (
    DesignBomCreate, DesignBomDecisionPayload, DesignBomDetail, DesignBomExplosionRow, DesignBomLinePayload,
    DesignBomLineResponse, DesignBomObsoletePayload, DesignBomResponse, DesignBomRevisionCreate,
    DesignBomRevisionResponse, DesignBomRevisionUpdate, DesignBomSubmitPayload, DesignBomUpdate, DesignNewItemRequest,
)
from app.modules.design.schemas.document import DesignWhereUsedRow
from app.modules.design.schemas.event import DesignCommentPayload, DesignEventResponse
from app.modules.design.schemas.library import DesignChecklistResponse, DesignReviewResultResponse
from app.modules.design.service import (
    add_event, ensure, ensure_assignee_rule, get_workflow_user, notify, released_revision, revision_label, user_name,
    users_by_id, utcnow, validate_signatories,
)
from app.modules.design.whereused import drawings_for_item, where_used_document, where_used_item
from app.modules.erp.models.project import Project
from app.modules.main.models.user import User
from app.modules.organization.services import approval_engine as engine
from app.modules.projects.models.project import PmProject
from app.modules.store.models.item import StoreItem
from app.utils.notifications import broadcast_notification

# "Assign to" rules (core/features/design.py).
OWNER_RULE = "design:boms.owner"
CHECKER_RULE = "design:boms.check_release"

router = APIRouter(
    prefix="/design/boms", tags=["Design"],
    dependencies=[Depends(require_app_access("design"))],
)
where_used_router = APIRouter(
    prefix="/design/where-used", tags=["Design"],
    dependencies=[Depends(require_app_access("design"))],
)

_NOTIFY_ENTITY = "design_bom"
VIEWER_STATUSES = ("released", "superseded")


# ---------------------------------------------------------------------------
# Loading + presentation
# ---------------------------------------------------------------------------

def get_bom(db: Session, bom_id: int, lock: bool = False, user: User | None = None) -> DesignBom:
    if lock:
        db.query(DesignBom.id).filter(DesignBom.id == bom_id).with_for_update().first()
    bom = db.query(DesignBom).options(
        selectinload(DesignBom.revisions).selectinload(DesignBomRevision.lines)
    ).populate_existing().filter(DesignBom.id == bom_id, DesignBom.is_deleted == False).first()  # noqa: E712
    if not bom:
        raise HTTPException(status_code=404, detail=f"BOM #{bom_id} not found — it may have been deleted.")
    if user is not None:
        ensure_in_scope(db, user, bom)
    return bom


def _load_rev(db: Session, revision_id: int, lock: bool = False, user: User | None = None) -> tuple[DesignBom, DesignBomRevision]:
    rev = db.query(DesignBomRevision).filter(
        DesignBomRevision.id == revision_id, DesignBomRevision.is_deleted == False  # noqa: E712
    ).first()
    if not rev:
        raise HTTPException(status_code=404, detail=f"BOM revision #{revision_id} not found — it may have been discarded.")
    bom = get_bom(db, rev.bom_id, lock=lock, user=user)
    return bom, next(r for r in bom.revisions if r.id == rev.id)


class _Labels:
    def __init__(self, db: Session, boms: list[DesignBom], lines: list[DesignBomLine] | None = None):
        lines = lines or []
        revs = [r for b in boms for r in live_bom_revisions(b)]
        user_ids = {b.owner_id for b in boms} | {b.created_by_id for b in boms}
        for r in revs:
            user_ids |= {r.created_by_id, r.reviewer_id, r.approver_id, r.reviewed_by_id, r.approved_by_id}
        self.users = users_by_id(db, user_ids)
        item_ids = {b.product_item_id for b in boms} | {line.store_item_id for line in lines if line.store_item_id}
        self.items = self._load(db, StoreItem, item_ids)
        doc_ids = {b.document_id for b in boms} | {line.document_id for line in lines if line.document_id}
        self.docs = {
            d.id: d for d in db.query(DesignDocument).options(selectinload(DesignDocument.revisions)).filter(DesignDocument.id.in_(doc_ids)).all()
        } if doc_ids else {}
        self.pm = self._load(db, PmProject, {b.pm_project_id for b in boms})
        self.machines = self._load(db, Project, {b.erp_project_id for b in boms})
        self.requests = self._load(db, DesignRequest, {b.design_request_id for b in boms})
        self.op = op_label_maps(db, boms)
        ecn_ids = {r.ecn_id for r in revs} - {None}
        self.ecns = {e.id: e.ecn_number for e in db.query(DesignChangeNotice).filter(DesignChangeNotice.id.in_(ecn_ids)).all()} if ecn_ids else {}
        line_item_ids = {line.store_item_id for line in lines if line.store_item_id}
        self.makes: dict[int, list[str]] = {}
        if line_item_ids:
            for m in db.query(DesignItemApprovedMake).filter(
                DesignItemApprovedMake.store_item_id.in_(line_item_ids), DesignItemApprovedMake.status != "withdrawn"
            ).order_by(DesignItemApprovedMake.id).all():
                self.makes.setdefault(m.store_item_id, []).append(m.make + (f" ({m.part_number})" if m.part_number else ""))
        # Sub-assemblies: line items that have their own released BOM.
        self.sub_boms: dict[int, DesignBom] = {}
        if line_item_ids:
            for b in db.query(DesignBom).options(selectinload(DesignBom.revisions)).filter(
                DesignBom.product_item_id.in_(line_item_ids), DesignBom.is_deleted == False, DesignBom.status == "active"  # noqa: E712
            ).order_by(DesignBom.pm_project_id.isnot(None), DesignBom.id).all():
                if released_bom_revision(b) and b.product_item_id not in self.sub_boms:
                    self.sub_boms[b.product_item_id] = b

    @staticmethod
    def _load(db: Session, model, ids):
        ids = {i for i in ids if i}
        return {o.id: o for o in db.query(model).filter(model.id.in_(ids)).all()} if ids else {}

    def name(self, user_id: int | None) -> str | None:
        return user_name(self.users.get(user_id)) if user_id else None


def _line_response(line: DesignBomLine, labels: _Labels, blockers: dict[int, str]) -> DesignBomLineResponse:
    resp = DesignBomLineResponse.model_validate(line)
    item = labels.items.get(line.store_item_id)
    if item:
        resp.item_code, resp.item_name, resp.item_status = item.item_code, item.item_name, item.status
    doc = labels.docs.get(line.document_id)
    if doc:
        resp.doc_number = doc.doc_number
        released = released_revision(doc)
        resp.current_drawing_revision = released.revision_label if released else None
        resp.drawing_status = doc.status
    resp.approved_makes = labels.makes.get(line.store_item_id, [])
    sub = labels.sub_boms.get(line.store_item_id)
    if sub:
        resp.sub_bom_id, resp.sub_bom_number = sub.id, sub.bom_number
    resp.release_blocker = blockers.get(line.id)
    return resp


def _revision_response(rev: DesignBomRevision, labels: _Labels, blockers: dict[int, str], with_lines: bool) -> DesignBomRevisionResponse:
    resp = DesignBomRevisionResponse.model_validate(rev)
    resp.lines = [_line_response(line, labels, blockers) for line in rev.lines] if with_lines else []
    resp.line_count = len(rev.lines)
    resp.created_by_name = labels.name(rev.created_by_id)
    resp.reviewer_name = labels.name(rev.reviewer_id)
    resp.approver_name = labels.name(rev.approver_id)
    resp.reviewed_by_name = labels.name(rev.reviewed_by_id)
    resp.approved_by_name = labels.name(rev.approved_by_id)
    resp.ecn_number = labels.ecns.get(rev.ecn_id) if rev.ecn_id else None
    return resp


def _bom_response(bom: DesignBom, labels: _Labels, cls=DesignBomResponse):
    resp = cls.model_validate(bom)
    item = labels.items.get(bom.product_item_id)
    if item:
        resp.product_item_code, resp.product_item_name = item.item_code, item.item_name
    doc = labels.docs.get(bom.document_id)
    resp.doc_number = doc.doc_number if doc else None
    pm = labels.pm.get(bom.pm_project_id)
    resp.pm_project_label = f"{pm.project_code} — {pm.name}" if pm else None
    resp.erp_project_label = machine_label(labels.machines.get(bom.erp_project_id))
    request = labels.requests.get(bom.design_request_id)
    resp.request_number = request.request_number if request else None
    set_op_label(resp, bom, labels.op)
    resp.owner_name = labels.name(bom.owner_id)
    resp.display_status = bom_display_status(bom)
    released = released_bom_revision(bom)
    if released:
        resp.released_revision_id = released.id
        resp.released_revision_label = released.revision_label
        resp.released_at = released.released_at
        resp.line_count = len(released.lines)
    current = open_bom_revision(bom)
    if current:
        resp.open_revision_id = current.id
        resp.open_revision_label = current.revision_label
        resp.open_revision_status = current.status
        pending = {"draft": current.created_by_id, "in_review": current.reviewer_id, "in_approval": current.approver_id}.get(current.status)
        resp.pending_with_name = labels.name(pending)
        if not released:
            resp.line_count = len(current.lines)
    return resp


def bom_detail(db: Session, bom: DesignBom, user: User) -> DesignBomDetail:
    bom = get_bom(db, bom.id)
    viewer = not is_team(db, user)
    visible = [r for r in reversed(live_bom_revisions(bom)) if not viewer or r.status in VIEWER_STATUSES]
    all_lines = [line for r in visible for line in r.lines]
    labels = _Labels(db, [bom], all_lines)
    resp: DesignBomDetail = _bom_response(bom, labels, DesignBomDetail)
    resp.viewer_only = viewer
    current = open_bom_revision(bom)
    blockers = line_blockers(db, current.lines) if current and not viewer else {}
    resp.revisions = [_revision_response(r, labels, blockers if current and r.id == current.id else {}, True) for r in visible]

    rev_ids = [r.id for r in visible]
    results = db.query(DesignReviewResult).filter(DesignReviewResult.bom_revision_id.in_(rev_ids)).order_by(DesignReviewResult.id).all() if rev_ids else []
    reviewers = users_by_id(db, {r.reviewer_id for r in results})
    for rr in resp.revisions:
        rr.review_results = []
        for r in results:
            if r.bom_revision_id == rr.id:
                out = DesignReviewResultResponse.model_validate(r)
                out.reviewer_name = user_name(reviewers.get(r.reviewer_id))
                rr.review_results.append(out)

    events = db.query(DesignEvent).filter(DesignEvent.bom_id == bom.id).order_by(DesignEvent.created_at.desc(), DesignEvent.id.desc()).all()
    visible_ids = set(rev_ids)
    if viewer:
        events = [e for e in events if e.bom_revision_id is None or e.bom_revision_id in visible_ids]
    actors = users_by_id(db, {e.actor_id for e in events})
    rev_labels = {r.id: r.revision_label for r in bom.revisions}
    resp.events = []
    for e in events:
        er = DesignEventResponse.model_validate(e)
        er.actor_name = user_name(actors.get(e.actor_id))
        er.revision_label = rev_labels.get(e.bom_revision_id)
        er.doc_number = bom.bom_number
        resp.events.append(er)

    ecns = db.query(DesignChangeNotice).join(DesignChangeNoticeBom, DesignChangeNoticeBom.ecn_id == DesignChangeNotice.id).filter(
        DesignChangeNoticeBom.bom_id == bom.id, DesignChangeNotice.status == "approved", DesignChangeNotice.is_deleted == False,  # noqa: E712
    ).order_by(DesignChangeNotice.id.desc()).all()
    resp.open_ecns = [{"id": e.id, "ecn_number": e.ecn_number, "title": e.title, "status": e.status} for e in ecns]
    resp.allowed_actions = allowed_bom_actions(user, bom, viewer=viewer)
    if current and not viewer and pending_request(db, BOM_ENTITY, bom.id) is not None:
        # Engine-backed: the engine decides who acts on the current stage.
        resp.approval_engine = True
        resp.allowed_actions = [a for a in resp.allowed_actions if a not in ("review", "approve")]
        if can_decide(db, user, BOM_ENTITY, bom.id):
            resp.allowed_actions.append("review" if current.status == "in_review" else "approve")
    if current and current.status == "in_review" and not viewer:
        checklist = active_checklist(db, "bom", None)
        resp.checklist = DesignChecklistResponse.model_validate(checklist) if checklist and checklist.items else None
    resp.where_used = where_used_item(db, bom.product_item_id) if has(user, "boms", "where_used") else []
    if not has(user, "boms", "timeline"):
        resp.events = []
    resp.allowed_actions = gate_actions(user, "boms", resp.allowed_actions)
    return resp


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _validate_item(db: Session, item_id: int, what: str) -> StoreItem:
    item = db.query(StoreItem).filter(StoreItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=400, detail=f"{what}: item #{item_id} isn't in Item Master. Pick another item.")
    return item


def _validate_ecn_link(db: Session, bom: DesignBom, ecn_id: int | None) -> None:
    if not ecn_id:
        return
    ecn = db.query(DesignChangeNotice).filter(DesignChangeNotice.id == ecn_id, DesignChangeNotice.is_deleted == False).first()  # noqa: E712
    if not ecn:
        raise HTTPException(status_code=400, detail=f"ECN #{ecn_id} wasn't found — it may have been deleted.")
    if ecn.status != "approved":
        raise HTTPException(status_code=400, detail=f"{ecn.ecn_number} isn't open (it's {ecn.status}) — BOM revisions can only be raised under an open ECN.")
    listed = db.query(DesignChangeNoticeBom.id).filter(DesignChangeNoticeBom.ecn_id == ecn.id, DesignChangeNoticeBom.bom_id == bom.id).first()
    if not listed:
        raise HTTPException(status_code=400, detail=f"{ecn.ecn_number} doesn't list {bom.bom_number} as an affected BOM. Add it to the ECN first, or pick the right ECN.")


def _build_lines(db: Session, bom: DesignBom | None, rows: list[DesignBomLinePayload], product_item_id: int, actor: User) -> list[DesignBomLine]:
    """Validates payload lines and returns new line objects (positions 10,
    20, 30… unless given). Lines with only a new-item name are new-item
    requests: Store is told the first time one appears."""
    lines: list[DesignBomLine] = []
    seen_positions: set[int] = set()
    doc_ids = {r.document_id for r in rows if r.document_id}
    docs = {d.id: d for d in db.query(DesignDocument).filter(DesignDocument.id.in_(doc_ids)).all()} if doc_ids else {}
    for index, row in enumerate(rows, start=1):
        position = row.position or index * 10
        label = f"Line {position}"
        if position in seen_positions:
            raise HTTPException(status_code=400, detail=f"Two lines use position {position} — give each line its own position number.")
        seen_positions.add(position)
        if row.make_buy not in DESIGN_MAKE_BUY:
            raise HTTPException(status_code=400, detail=f"{label}: make/buy must be 'make' or 'buy'.")
        new_name = (row.new_item_name or "").strip() or None
        if not row.store_item_id and not new_name:
            raise HTTPException(status_code=400, detail=f"{label}: pick an item from Item Master, or describe the new item Store should create.")
        uom = (row.uom or "").strip().upper() or None
        if row.store_item_id:
            if row.store_item_id == product_item_id:
                raise HTTPException(status_code=400, detail=f"{label}: an assembly can't contain itself — pick the component item, not the product.")
            item = _validate_item(db, row.store_item_id, label)
            uom = uom or (item.uom or None)
            new_name = None
        if row.document_id:
            doc = docs.get(row.document_id)
            if not doc or doc.is_deleted:
                raise HTTPException(status_code=400, detail=f"{label}: drawing #{row.document_id} wasn't found. Pick another drawing or clear it.")
        line = DesignBomLine(
            position=position, store_item_id=row.store_item_id, new_item_name=new_name,
            new_item_spec=((row.new_item_spec or "").strip() or None) if new_name else None,
            quantity=row.quantity, uom=uom, document_id=row.document_id, make_buy=row.make_buy,
            remarks=(row.remarks or "").strip() or None,
        )
        if new_name:
            line.new_item_requested_at = utcnow()
        lines.append(line)
    return sorted(lines, key=lambda line: line.position)


def _announce_new_items(db: Session, bom: DesignBom, rev: DesignBomRevision, previous_names: set[str], actor: User) -> None:
    new = [line.new_item_name for line in rev.lines if line.new_item_name and line.new_item_name.lower() not in previous_names]
    if not new:
        return
    broadcast_notification(
        db, f"New item code needed for {bom_ref(bom, rev)}",
        f"{user_name(actor)} needs Item Master codes for: {', '.join(new[:8])}{' …' if len(new) > 8 else ''}. "
        f"Create them in Store › Items; Design will link them to {bom.bom_number}.",
        "design_new_item_request", None, None, exclude_user_id=actor.id, app_name="store",
    )


def _replace_lines(db: Session, bom: DesignBom, rev: DesignBomRevision, rows: list[DesignBomLinePayload], actor: User) -> None:
    previous = {line.new_item_name.lower() for line in rev.lines if line.new_item_name}
    keep_requested = {line.new_item_name.lower(): line.new_item_requested_at for line in rev.lines if line.new_item_name}
    new_lines = _build_lines(db, bom, rows, bom.product_item_id, actor)
    for line in new_lines:
        if line.new_item_name and line.new_item_name.lower() in keep_requested:
            line.new_item_requested_at = keep_requested[line.new_item_name.lower()]
    rev.lines = new_lines
    _announce_new_items(db, bom, rev, previous, actor)


# ---------------------------------------------------------------------------
# Register
# ---------------------------------------------------------------------------

@router.get("", response_model=list[DesignBomResponse])
async def list_boms(
    status_filter: str | None = Query(None, alias="status"),
    product_item_id: int | None = None,
    pm_project_id: int | None = None,
    erp_project_id: int | None = None,
    order_project_id: int | None = None,
    owner_id: int | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("design", "boms")),
):
    query = db.query(DesignBom).options(
        selectinload(DesignBom.revisions).selectinload(DesignBomRevision.lines)
    ).filter(DesignBom.is_deleted == False)  # noqa: E712
    query = apply_scope(query, user, DesignBom)
    if product_item_id:
        query = query.filter(DesignBom.product_item_id == product_item_id)
    if pm_project_id:
        query = query.filter(DesignBom.pm_project_id == pm_project_id)
    if erp_project_id:
        query = query.filter(DesignBom.erp_project_id == erp_project_id)
    if order_project_id:
        query = query.filter(DesignBom.order_project_id == order_project_id)
    if owner_id:
        query = query.filter(DesignBom.owner_id == owner_id)
    if search:
        like = f"%{search.strip()}%"
        item_ids = [i for (i,) in db.query(StoreItem.id).filter(StoreItem.item_code.ilike(like) | StoreItem.item_name.ilike(like)).limit(500).all()]
        query = query.filter(DesignBom.bom_number.ilike(like) | DesignBom.title.ilike(like) | DesignBom.product_item_id.in_(item_ids))
    boms = query.order_by(DesignBom.updated_at.desc(), DesignBom.id.desc()).limit(2000).all()
    if not is_team(db, user):
        boms = [b for b in boms if any(r.status in VIEWER_STATUSES for r in live_bom_revisions(b))]
    if status_filter:
        wanted = set(status_filter.split(","))
        boms = [b for b in boms if bom_display_status(b) in wanted]
    labels = _Labels(db, boms)
    return [_bom_response(b, labels) for b in boms]


BOM_IMPORT_COLUMNS = ["position", "item_code", "new_item_name", "new_item_spec", "quantity", "uom", "drawing_no", "make_buy", "remarks"]


@router.get("/import-lines/template")
async def bom_lines_template(db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    """Excel template for loading BOM lines into the New BOM / draft revision form."""
    from app.modules.erp.importing import xlsx_response
    require_team(db, user, "import BOM lines")
    return xlsx_response("BOM lines", BOM_IMPORT_COLUMNS, [
        [10, "MT-ELE-0017", "", "", 2, "NOS", "", "buy", "Example — an Item Master item (replace with your lines)"],
        [20, "", "Side frame weldment", "IS 2062 E250, 12 mm", 1, "NOS", "", "make", "A new item: no code yet — Store creates it"],
    ], "bom_lines_template.xlsx", widths=[10, 18, 26, 30, 10, 8, 16, 10, 44])


@router.post("/import-lines")
async def import_bom_lines(file: UploadFile = File(...), db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    """Reads BOM lines from Excel / CSV into the form — nothing is saved; the
    user reviews the lines and saves the BOM as usual. item_code matches the
    Item Master (active items); a row without a code but with new_item_name is
    a new-item request. drawing_no matches a Design document number. Bad rows
    come back per row so the file can be fixed."""
    from app.modules.erp.importing import check_rows, norm_key, parse_number, read_rows, text
    require_team(db, user, "import BOM lines")
    rows = [r for r in read_rows(file.filename, await file.read()) if any(str(v).strip() for v in r.values())]
    check_rows(rows, ["quantity"])
    if "item_code" not in rows[0] and "new_item_name" not in rows[0]:
        raise HTTPException(status_code=422, detail="Missing the item_code column (or new_item_name for new items) — download the template and keep its header row.")
    if len(rows) > 1000:
        raise HTTPException(status_code=422, detail=f"The file has {len(rows)} lines — one BOM level holds at most 1000; split it into sub-assembly BOMs.")
    codes = {norm_key(text(r, "item_code")) for r in rows} - {""}
    items = {norm_key(i.item_code): i for i in db.query(StoreItem).filter(StoreItem.item_code.isnot(None)).all()
             if norm_key(i.item_code) in codes}
    drawings_wanted = {norm_key(text(r, "drawing_no")) for r in rows} - {""}
    drawings = {norm_key(d.doc_number): d for d in db.query(DesignDocument).filter(DesignDocument.is_deleted == False).all()  # noqa: E712
                if norm_key(d.doc_number) in drawings_wanted} if drawings_wanted else {}
    lines, errors, used = [], [], set()
    for idx, r in enumerate(rows, start=2):
        code = text(r, "item_code") or ""
        new_name = text(r, "new_item_name") or ""
        try:
            item = None
            if code:
                item = items.get(norm_key(code))
                if item is None:
                    raise ValueError(f"'{code}' isn't in the Item Master — check the code, or leave it blank and fill new_item_name to request a new item.")
                if item.status != "active":
                    raise ValueError(f"{item.item_code} {item.item_name} is {item.status} in the Item Master — a BOM can't be released with it. Pick an active item.")
            elif len(new_name) < 2:
                raise ValueError("Give an item_code, or a new_item_name (at least 2 characters) for a part that has no code yet.")
            qty = parse_number(r, "quantity", "Quantity", minimum=0)
            if not qty:
                raise ValueError("Quantity must be greater than 0.")
            pos_raw = text(r, "position")
            pos = None
            if pos_raw:
                pos = parse_number(r, "position", "Position", minimum=1)
                if pos is None or not float(pos).is_integer():
                    raise ValueError(f"Position '{pos_raw}' must be a whole number (e.g. 10, 20, 30).")
                pos = int(pos)
                if pos in used:
                    raise ValueError(f"Position {pos} is used twice — every line needs its own position.")
            mb = (text(r, "make_buy") or "buy").lower()
            if mb not in DESIGN_MAKE_BUY:
                raise ValueError(f"make_buy '{mb}' isn't valid — write make or buy.")
            dwg_no = text(r, "drawing_no")
            dwg = drawings.get(norm_key(dwg_no)) if dwg_no else None
            if dwg_no and dwg is None:
                raise ValueError(f"Drawing '{dwg_no}' isn't a Design document number — check it, or leave drawing_no blank.")
        except ValueError as exc:
            errors.append({"row": idx, "item_code": code or new_name, "reason": str(exc)})
            continue
        if pos is not None:
            used.add(pos)
        lines.append({
            "position": pos, "store_item_id": item.id if item else None,
            "item_code": item.item_code if item else None, "item_name": item.item_name if item else None,
            "new_item_name": None if item else new_name, "new_item_spec": None if item else text(r, "new_item_spec"),
            "quantity": qty, "uom": (text(r, "uom") or (item.uom if item else None) or "NOS").upper(),
            "document_id": dwg.id if dwg else None, "document_label": f"{dwg.doc_number} — {dwg.title}" if dwg else None,
            "make_buy": mb, "remarks": text(r, "remarks"),
        })
    # Rows without a position follow the numbered ones in steps of 10.
    nxt = (max(used) if used else 0) + 10
    for ln in lines:
        if ln["position"] is None:
            while nxt in used:
                nxt += 10
            ln["position"] = nxt
            used.add(nxt)
            nxt += 10
    return {"lines": lines, "errors": errors}


@router.get("/new-item-requests", response_model=list[DesignNewItemRequest])
async def new_item_requests(db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    """Open BOM lines still waiting for an Item Master code."""
    rows = db.query(DesignBomLine, DesignBomRevision, DesignBom).join(
        DesignBomRevision, DesignBomRevision.id == DesignBomLine.revision_id
    ).join(DesignBom, DesignBom.id == DesignBomRevision.bom_id).filter(
        DesignBomLine.store_item_id.is_(None),
        DesignBomRevision.is_deleted == False,  # noqa: E712
        DesignBomRevision.status.in_(("draft", "in_review", "in_approval")),
        DesignBom.is_deleted == False,  # noqa: E712
    ).order_by(DesignBomLine.new_item_requested_at).all()
    authors = users_by_id(db, {r.created_by_id for _, r, _ in rows})
    return [
        DesignNewItemRequest(
            line_id=line.id, bom_id=bom.id, bom_number=bom.bom_number, revision_label=rev.revision_label,
            new_item_name=line.new_item_name or "", new_item_spec=line.new_item_spec, uom=line.uom,
            requested_at=line.new_item_requested_at, requested_by_name=user_name(authors.get(rev.created_by_id)),
        )
        for line, rev, bom in rows
    ]


@router.post("", response_model=DesignBomDetail, status_code=201)
async def create_bom(
    payload: DesignBomCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    require_team(db, user, "create BOMs")
    product = _validate_item(db, payload.product_item_id, "Product")
    if product.status != "active":
        raise HTTPException(status_code=400, detail=f"{product.item_code} is {product.status} in Item Master — a BOM needs an active product item.")
    validate_links(db, pm_project_id=payload.pm_project_id, erp_project_id=payload.erp_project_id, design_request_id=payload.design_request_id)
    link = {"order_project_id": payload.order_project_id, "order_project_element_id": payload.order_project_element_id}
    clean_op_link(db, link)
    if not link["order_project_id"] and payload.design_request_id:
        # A BOM made for an Order Project's design request belongs to that project.
        src = db.get(DesignRequest, payload.design_request_id)
        if src and src.order_project_id:
            link = {"order_project_id": src.order_project_id, "order_project_element_id": src.order_project_element_id}
    if payload.document_id and not db.query(DesignDocument.id).filter(DesignDocument.id == payload.document_id, DesignDocument.is_deleted == False).first():  # noqa: E712
        raise HTTPException(status_code=400, detail=f"Drawing #{payload.document_id} wasn't found. Pick another drawing or leave it blank.")
    owner_id = payload.owner_id or user.id
    if owner_id != user.id:
        get_workflow_user(db, owner_id, "owner")
    approver_id = payload.approver_id
    if approver_id is None:
        default = get_settings(db).default_approver_id
        approver_id = default if default not in (None, user.id, payload.reviewer_id) else None
    validate_signatories(db, user.id, payload.reviewer_id, approver_id)
    ensure_assignee_rule(db, user, OWNER_RULE, owner_id, user.id)
    ensure_assignee_rule(db, user, CHECKER_RULE, payload.reviewer_id)

    rows = payload.lines
    if payload.copy_from_bom_id:
        source = get_bom(db, payload.copy_from_bom_id)
        src_rev = released_bom_revision(source) or open_bom_revision(source)
        if not src_rev:
            raise HTTPException(status_code=400, detail=f"{source.bom_number} has no revision to copy lines from.")
        rows = [
            DesignBomLinePayload(
                position=line.position, store_item_id=line.store_item_id, new_item_name=line.new_item_name,
                new_item_spec=line.new_item_spec, quantity=line.quantity, uom=line.uom, document_id=line.document_id,
                make_buy=line.make_buy, remarks=line.remarks,
            )
            for line in src_rev.lines
        ]

    bom = DesignBom(
        bom_number=next_number(db, DesignBom.bom_number, year_prefix("BOM")), product_item_id=product.id,
        title=payload.title.strip(), description=payload.description, document_id=payload.document_id,
        pm_project_id=payload.pm_project_id, erp_project_id=payload.erp_project_id,
        design_request_id=payload.design_request_id, owner_id=owner_id, created_by_id=user.id, status="active", **link,
    )
    db.add(bom)
    db.flush()
    rev = DesignBomRevision(
        bom_id=bom.id, revision_index=0, revision_label=revision_label(0), status="draft",
        change_summary="Initial issue", created_by_id=user.id, reviewer_id=payload.reviewer_id, approver_id=approver_id,
    )
    rev.lines = _build_lines(db, bom, rows, product.id, user)
    db.add(rev)
    db.flush()
    _announce_new_items(db, bom, rev, set(), user)
    add_event(db, "bom_created", user, bom_id=bom.id, bom_revision_id=rev.id)
    if payload.design_request_id:
        add_event(db, "bom_created", user, request_id=payload.design_request_id, bom_id=bom.id, comment=bom.bom_number)
    db.commit()
    return bom_detail(db, bom, user)


@router.get("/{bom_id}", response_model=DesignBomDetail)
async def get_bom_detail(bom_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    bom = get_bom(db, bom_id, user=user)
    if not is_team(db, user) and not any(r.status in VIEWER_STATUSES for r in live_bom_revisions(bom)):
        raise HTTPException(status_code=404, detail=f"{bom.bom_number} isn't released yet, so it's only visible to the Design team.")
    return bom_detail(db, bom, user)


@router.patch("/{bom_id}", response_model=DesignBomDetail)
async def update_bom(bom_id: int, payload: DesignBomUpdate, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    bom = get_bom(db, bom_id, lock=True, user=user)
    ensure(check_bom_edit(user, bom))
    changes = payload.model_dump(exclude_unset=True)
    if "title" in changes and not (changes["title"] or "").strip():
        raise HTTPException(status_code=400, detail="Title can't be empty.")
    if "owner_id" in changes:
        if not changes["owner_id"]:
            raise HTTPException(status_code=400, detail=f"{bom.bom_number} must have an owner.")
        get_workflow_user(db, changes["owner_id"], "owner")
        ensure_assignee_rule(db, user, OWNER_RULE, changes["owner_id"], bom.owner_id)
    validate_links(db, **{k: v for k, v in changes.items() if k in ("pm_project_id", "erp_project_id", "design_request_id")})
    clean_op_link(db, changes, current_project_id=bom.order_project_id, current_element_id=bom.order_project_element_id)
    if changes.get("document_id") and not db.query(DesignDocument.id).filter(DesignDocument.id == changes["document_id"]).first():
        raise HTTPException(status_code=400, detail=f"Drawing #{changes['document_id']} wasn't found.")
    changed = [k for k, v in changes.items() if getattr(bom, k) != v]
    for key in changed:
        setattr(bom, key, changes[key].strip() if key == "title" else changes[key])
    if changed:
        add_event(db, "bom_updated", user, bom_id=bom.id, comment="Changed " + ", ".join(k.replace("_id", "").replace("_", " ") for k in changed))
    db.commit()
    return bom_detail(db, bom, user)


@router.delete("/{bom_id}")
async def delete_bom(bom_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    bom = get_bom(db, bom_id, lock=True, user=user)
    ensure_can_delete(user, bom, "design", "boms", what="BOM")
    ensure(check_bom_delete(user, bom))
    now = datetime.now(timezone.utc)
    for rev in live_bom_revisions(bom):
        rev.is_deleted, rev.deleted_at = True, now
    bom.is_deleted, bom.deleted_at = True, now
    add_event(db, "bom_deleted", user, bom_id=bom.id)
    db.commit()
    return {"message": f"{bom.bom_number} deleted"}


@router.post("/{bom_id}/obsolete", response_model=DesignBomDetail)
async def obsolete_bom(bom_id: int, payload: DesignBomObsoletePayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ensure_design_feature(user, "boms", "obsolete", "cancel")
    bom = get_bom(db, bom_id, lock=True, user=user)
    ensure(check_bom_obsolete(user, bom))
    bom.status, bom.obsoleted_at, bom.obsolete_reason = "obsolete", utcnow(), payload.reason.strip()
    add_event(db, "bom_obsoleted", user, bom_id=bom.id, comment=bom.obsolete_reason)
    db.commit()
    return bom_detail(db, bom, user)


@router.post("/{bom_id}/reactivate", response_model=DesignBomDetail)
async def reactivate_bom(bom_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ensure_design_feature(user, "boms", "obsolete", "cancel")
    bom = get_bom(db, bom_id, lock=True, user=user)
    if bom.status != "obsolete":
        raise HTTPException(status_code=409, detail=f"{bom.bom_number} isn't obsolete.")
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Only an admin can reactivate an obsolete BOM.")
    bom.status, bom.obsoleted_at, bom.obsolete_reason = "active", None, None
    add_event(db, "bom_reactivated", user, bom_id=bom.id)
    db.commit()
    return bom_detail(db, bom, user)


@router.post("/{bom_id}/revisions", response_model=DesignBomDetail, status_code=201)
async def start_bom_revision(bom_id: int, payload: DesignBomRevisionCreate, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    """Next revision, starting as a copy of the released lines."""
    require_team(db, user, "revise BOMs")
    ensure_design_feature(user, "boms", "revisions", "create")
    bom = get_bom(db, bom_id, lock=True, user=user)
    ensure(check_bom_new_revision(user, bom))
    validate_signatories(db, user.id, payload.reviewer_id, payload.approver_id)
    ensure_assignee_rule(db, user, CHECKER_RULE, payload.reviewer_id)
    _validate_ecn_link(db, bom, payload.ecn_id)
    released = released_bom_revision(bom)
    last_index = db.query(func.max(DesignBomRevision.revision_index)).filter(
        DesignBomRevision.bom_id == bom.id, DesignBomRevision.is_deleted == False  # noqa: E712
    ).scalar() or 0
    index = last_index + 1
    rev = DesignBomRevision(
        bom_id=bom.id, revision_index=index, revision_label=revision_label(index), status="draft",
        change_summary=payload.change_summary.strip(), ecn_id=payload.ecn_id, created_by_id=user.id,
        reviewer_id=payload.reviewer_id, approver_id=payload.approver_id,
    )
    rev.lines = [
        DesignBomLine(
            position=line.position, store_item_id=line.store_item_id, new_item_name=line.new_item_name,
            new_item_spec=line.new_item_spec, new_item_requested_at=line.new_item_requested_at, quantity=line.quantity,
            uom=line.uom, document_id=line.document_id, make_buy=line.make_buy, remarks=line.remarks,
        )
        for line in released.lines
    ]
    db.add(rev)
    db.flush()
    add_event(db, "bom_revision_started", user, bom_id=bom.id, bom_revision_id=rev.id, comment=rev.change_summary)
    if payload.ecn_id:
        add_event(db, "bom_revision_started", user, ecn_id=payload.ecn_id, bom_id=bom.id, bom_revision_id=rev.id, comment=bom_ref(bom, rev))
    db.commit()
    return bom_detail(db, bom, user)


@router.post("/{bom_id}/comments", response_model=DesignBomDetail)
async def comment_bom(bom_id: int, payload: DesignCommentPayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ensure_design_feature(user, "boms", "timeline", "create")
    bom = get_bom(db, bom_id, user=user)
    if not is_team(db, user) and not bom_ever_released(bom):
        raise HTTPException(status_code=404, detail=f"{bom.bom_number} isn't released yet, so it's only visible to the Design team.")
    add_event(db, "comment", user, bom_id=bom.id, comment=payload.comment)
    db.commit()
    return bom_detail(db, bom, user)


# ---------------------------------------------------------------------------
# Revision workflow
# ---------------------------------------------------------------------------

@router.patch("/revisions/{revision_id}", response_model=DesignBomDetail)
async def update_bom_revision(revision_id: int, payload: DesignBomRevisionUpdate, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ensure_design_feature(user, "boms", "revisions", "edit")
    bom, rev = _load_rev(db, revision_id, lock=True, user=user)
    ensure(check_bom_manage_draft(user, bom, rev))
    changes = payload.model_dump(exclude_unset=True)
    rows = changes.pop("lines", None)
    validate_signatories(db, rev.created_by_id, changes.get("reviewer_id", rev.reviewer_id), changes.get("approver_id", rev.approver_id))
    ensure_assignee_rule(db, user, CHECKER_RULE, changes.get("reviewer_id"), rev.reviewer_id)
    if "ecn_id" in changes:
        _validate_ecn_link(db, bom, changes["ecn_id"])
    if "change_summary" in changes:
        changes["change_summary"] = (changes["change_summary"] or "").strip() or None
        if rev.revision_index > 0 and not changes["change_summary"]:
            raise HTTPException(status_code=400, detail=f"{bom_ref(bom, rev)} needs a change summary — say what changed from the previous revision and why.")
    changed = [k for k, v in changes.items() if getattr(rev, k) != v]
    for key in changed:
        setattr(rev, key, changes[key])
    if rows is not None:
        _replace_lines(db, bom, rev, payload.lines or [], user)
        changed.append("lines")
    if changed:
        add_event(db, "bom_revision_updated", user, bom_id=bom.id, bom_revision_id=rev.id,
                  comment="Changed " + ", ".join(k.replace("_id", "").replace("_", " ") for k in changed))
    db.commit()
    return bom_detail(db, bom, user)


@router.delete("/revisions/{revision_id}", response_model=DesignBomDetail)
async def discard_bom_revision(revision_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    bom, rev = _load_rev(db, revision_id, lock=True, user=user)
    ensure_can_delete(user, rev, "design", "boms", what="BOM revision")
    ensure_design_feature(user, "boms", "revisions", "delete")
    ensure(check_bom_discard(user, bom, rev))
    rev.is_deleted, rev.deleted_at = True, datetime.now(timezone.utc)
    add_event(db, "bom_revision_discarded", user, bom_id=bom.id, bom_revision_id=rev.id)
    db.commit()
    return bom_detail(db, bom, user)


@router.post("/revisions/{revision_id}/submit", response_model=DesignBomDetail)
async def submit_bom_revision(revision_id: int, payload: DesignBomSubmitPayload, background_tasks: BackgroundTasks,
                              db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    bom, rev = _load_rev(db, revision_id, lock=True, user=user)
    ensure_tab_action(user, "design", "boms", "submit")
    ensure_design_feature(user, "boms", "check_release", "submit")
    ensure(check_bom_manage_draft(user, bom, rev))
    if payload.reviewer_id:
        ensure_assignee_rule(db, user, CHECKER_RULE, payload.reviewer_id, rev.reviewer_id)
        rev.reviewer_id = payload.reviewer_id
    if payload.approver_id:
        rev.approver_id = payload.approver_id
    if not rev.reviewer_id or not rev.approver_id:
        missing = " and ".join(x for x, v in (("a checker", rev.reviewer_id), ("an approver", rev.approver_id)) if not v)
        raise HTTPException(status_code=400, detail=f"Name {missing} before submitting {bom_ref(bom, rev)}.")
    validate_signatories(db, rev.created_by_id, rev.reviewer_id, rev.approver_id)
    if not rev.lines:
        raise HTTPException(status_code=400, detail=f"{bom_ref(bom, rev)} has no lines. Add the components before submitting it for check.")
    if rev.revision_index > 0 and not (rev.change_summary or "").strip():
        raise HTTPException(status_code=400, detail=f"{bom_ref(bom, rev)} needs a change summary — say what changed and why.")
    if rev.ecn_id:
        _validate_ecn_link(db, bom, rev.ecn_id)
    rev.status = "in_review"
    rev.submitted_at = utcnow()
    rev.reviewed_by_id = rev.reviewed_at = rev.review_comment = None
    rev.approved_by_id = rev.approved_at = rev.approval_comment = None
    add_event(db, "bom_submitted", user, bom_id=bom.id, bom_revision_id=rev.id, comment=payload.comment)
    # Check -> release routing and notifications: central approval engine.
    engine.submit(
        db, BOM_KEY, entity_id=bom.id, requester=user, title=f"{bom_ref(bom, rev)} — {bom.title}", reference=bom_ref(bom, rev),
        context={"checker_id": rev.reviewer_id, "approver_id": rev.approver_id, "revision_id": rev.id,
                 "revision_index": rev.revision_index},
    )
    # Role-based notice (core/events/design.py); the named checker / approver hear from the engine.
    from app.modules.design.events import notify_design_event
    notify_design_event(
        db, background_tasks, "bom_submitted", bom, entity_type=_NOTIFY_ENTITY, actor=user, team_only=True,
        title=f"Sent for check: {bom_ref(bom, rev)}",
        message=f"{user_name(user)} submitted {bom_ref(bom, rev)} ({bom.title}) for check and release.",
        skip={rev.reviewer_id, rev.approver_id, rev.created_by_id},
    )
    db.commit()
    return bom_detail(db, bom, user)


@router.post("/revisions/{revision_id}/recall", response_model=DesignBomDetail)
async def recall_bom_revision(revision_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ensure_design_feature(user, "boms", "check_release", "cancel")
    bom, rev = _load_rev(db, revision_id, lock=True, user=user)
    ensure(check_bom_recall(user, bom, rev))
    req = pending_request(db, BOM_ENTITY, bom.id)
    if req is not None:
        engine.cancel(db, req.id, user)  # on_decided puts the revision back to draft
        db.commit()
        return bom_detail(db, bom, user)
    waiting_on = rev.reviewer_id if rev.status == "in_review" else rev.approver_id
    rev.status = "draft"
    add_event(db, "bom_recalled", user, bom_id=bom.id, bom_revision_id=rev.id)
    notify(db, waiting_on, user, f"Recalled: {bom_ref(bom, rev)}",
           f"{user_name(user)} recalled {bom_ref(bom, rev)} to draft — no action is needed from you for now.",
           "design_revision_recalled", _NOTIFY_ENTITY, bom.id)
    db.commit()
    return bom_detail(db, bom, user)


@router.post("/revisions/{revision_id}/review", response_model=DesignBomDetail)
async def review_bom_revision(revision_id: int, payload: DesignBomDecisionPayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ensure_design_feature(user, "boms", "check_release", "approve")
    bom, rev = _load_rev(db, revision_id, lock=True, user=user)
    req = pending_request(db, BOM_ENTITY, bom.id)
    if req is not None:
        return _engine_decide(db, req, bom, rev, user, payload, stage="in_review")
    ensure(check_bom_review(user, bom, rev))
    comment = (payload.comment or "").strip() or None
    if payload.decision == "return" and not comment:
        raise HTTPException(status_code=400, detail=f"Say what needs fixing when returning {bom_ref(bom, rev)} — the author sees your comment.")
    record_answers(db, active_checklist(db, "bom", None), payload.checklist, decision=payload.decision, reviewer=user,
                   cycle=rev.returned_count, ref=bom_ref(bom, rev), bom_revision_id=rev.id)
    rev.reviewed_by_id, rev.reviewed_at, rev.review_comment = user.id, utcnow(), comment
    if payload.decision == "return":
        rev.status = "draft"
        rev.returned_count += 1
        add_event(db, "bom_review_returned", user, bom_id=bom.id, bom_revision_id=rev.id, comment=comment)
        notify(db, rev.created_by_id, user, f"Returned by checker: {bom_ref(bom, rev)}",
               f"{user_name(user)} returned {bom_ref(bom, rev)} to you: {comment}", "design_revision_returned", _NOTIFY_ENTITY, bom.id)
    else:
        rev.status = "in_approval"
        add_event(db, "bom_review_passed", user, bom_id=bom.id, bom_revision_id=rev.id, comment=comment)
        notify(db, rev.approver_id, user, f"BOM release needed: {bom_ref(bom, rev)}",
               f"{user_name(user)} checked {bom_ref(bom, rev)} ({bom.title}) — it's waiting for you to release it.",
               "design_approval_requested", _NOTIFY_ENTITY, bom.id, teams=True)
    db.commit()
    return bom_detail(db, bom, user)


@router.post("/revisions/{revision_id}/approve", response_model=DesignBomDetail)
async def approve_bom_revision(revision_id: int, payload: DesignBomDecisionPayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ensure_design_feature(user, "boms", "check_release", "approve")
    bom, rev = _load_rev(db, revision_id, lock=True, user=user)
    req = pending_request(db, BOM_ENTITY, bom.id)
    if req is not None:
        return _engine_decide(db, req, bom, rev, user, payload, stage="in_approval")
    ensure(check_bom_approve(user, bom, rev))
    comment = (payload.comment or "").strip() or None
    if payload.decision == "return":
        if not comment:
            raise HTTPException(status_code=400, detail=f"Say what needs fixing when returning {bom_ref(bom, rev)}.")
        rev.status, rev.approval_comment = "draft", comment
        rev.returned_count += 1
        add_event(db, "bom_approval_returned", user, bom_id=bom.id, bom_revision_id=rev.id, comment=comment)
        for recipient in {rev.created_by_id, rev.reviewed_by_id}:
            notify(db, recipient, user, f"Returned by approver: {bom_ref(bom, rev)}",
                   f"{user_name(user)} returned {bom_ref(bom, rev)} to draft: {comment}", "design_revision_returned", _NOTIFY_ENTITY, bom.id)
        db.commit()
        return bom_detail(db, bom, user)

    release_bom_revision(db, bom, rev, user, comment)
    db.commit()
    return bom_detail(db, bom, user)


def _engine_decide(db: Session, req, bom: DesignBom, rev: DesignBomRevision, user: User,
                   payload: DesignBomDecisionPayload, stage: str) -> DesignBomDetail:
    """Check / release of a BOM revision submitted through the approval
    engine: checklist answers are recorded here, the decision is the engine's."""
    if rev.status != stage:
        ensure(check_bom_review(user, bom, rev) if stage == "in_review" else check_bom_approve(user, bom, rev))
    comment = (payload.comment or "").strip() or None
    if payload.decision == "return" and not comment:
        raise HTTPException(status_code=400, detail=f"Say what needs fixing when returning {bom_ref(bom, rev)} — the author sees your comment.")
    if not engine.can_act_on_entity(db, user, BOM_ENTITY, bom.id) and user.role != "admin":
        # Not an approver / delegate of the current stage: Design's own reason first.
        ensure(check_bom_review(user, bom, rev) if stage == "in_review" else check_bom_approve(user, bom, rev))
    if stage == "in_review":
        record_answers(db, active_checklist(db, "bom", None), payload.checklist, decision=payload.decision, reviewer=user,
                       cycle=rev.returned_count, ref=bom_ref(bom, rev), bom_revision_id=rev.id)
        if payload.decision == "pass":
            mark_checklist_done(db, rev.id)
    engine.decide(db, req.id, user, "approve" if payload.decision == "pass" else "return", comment)
    db.commit()
    return bom_detail(db, bom, user)


def release_bom_revision(db: Session, bom: DesignBom, rev: DesignBomRevision, user: User, comment: str | None,
                         approved_by_id: int | None = None) -> None:
    """Makes `rev` the released BOM (release blockers checked first — 409
    with the blocking lines), supersedes the previous one and tells Store,
    Purchase and Production. Shared by the old approve route and the
    approval engine's on_decided."""
    now = utcnow()
    blockers = line_blockers(db, rev.lines)
    if blockers:
        listing = " ".join(list(blockers.values())[:5])
        more = f" (+{len(blockers) - 5} more)" if len(blockers) > 5 else ""
        raise HTTPException(status_code=409, detail=f"{bom_ref(bom, rev)} can't be released yet: {listing}{more}")
    snapshot_drawing_revisions(db, rev.lines)
    previous = released_bom_revision(bom)
    if previous and previous.id != rev.id:
        previous.status, previous.superseded_at = "superseded", now
        add_event(db, "bom_superseded", user, bom_id=bom.id, bom_revision_id=previous.id, comment=f"Superseded by {rev.revision_label}")
    else:
        previous = None
    rev.status = "released"
    rev.approved_by_id, rev.approved_at, rev.approval_comment, rev.released_at = approved_by_id or user.id, now, comment, now
    add_event(db, "bom_released", user, bom_id=bom.id, bom_revision_id=rev.id, comment=comment)
    if rev.ecn_id:
        add_event(db, "bom_released", user, ecn_id=rev.ecn_id, bom_id=bom.id, bom_revision_id=rev.id, comment=bom_ref(bom, rev))
    for recipient in {rev.created_by_id, rev.reviewed_by_id, bom.owner_id}:
        notify(db, recipient, user, f"Released: {bom_ref(bom, rev)}",
               f"{user_name(user)} released {bom_ref(bom, rev)} ({bom.title}).", "design_revision_released", _NOTIFY_ENTITY, bom.id)
    item = db.query(StoreItem).filter(StoreItem.id == bom.product_item_id).first()
    product = f"{item.item_code} {item.item_name}" if item else bom.title
    project = ""
    if bom.pm_project_id:
        pm = db.query(PmProject).filter(PmProject.id == bom.pm_project_id).first()
        project = f" for project {pm.project_code}" if pm else ""
    for app_name, what in (("store", "material planning"), ("p2p", "purchasing"), ("production", "production")):
        broadcast_notification(
            db, f"BOM released: {bom_ref(bom, rev)}",
            f"{bom_ref(bom, rev)} ({product}){project} is released with {len(rev.lines)} line(s)"
            + (f" and supersedes {previous.revision_label}" if previous else "") + f" — use it for {what}.",
            "design_bom_released", None, None, exclude_user_id=user.id, app_name=app_name,
        )
    from app.modules.design.events import notify_design_event
    notify_design_event(
        db, None, "bom_released", bom, entity_type=_NOTIFY_ENTITY, actor=user,
        title=f"BOM released: {bom_ref(bom, rev)}",
        message=f"{bom_ref(bom, rev)} ({product}){project} is released with {len(rev.lines)} line(s)"
        + (f" and supersedes {previous.revision_label}" if previous else "") + ".",
        skip={rev.created_by_id, rev.reviewed_by_id, bom.owner_id},
    )


# ---------------------------------------------------------------------------
# Explosion + export
# ---------------------------------------------------------------------------

def _explode(db: Session, bom: DesignBom, rev: DesignBomRevision) -> list[DesignBomExplosionRow]:
    rows: list[DesignBomExplosionRow] = []
    item_cache: dict[int, StoreItem] = {}
    doc_cache: dict[int, DesignDocument] = {}

    def item(item_id):
        if item_id and item_id not in item_cache:
            item_cache[item_id] = db.query(StoreItem).filter(StoreItem.id == item_id).first()
        return item_cache.get(item_id)

    def doc(doc_id):
        if doc_id and doc_id not in doc_cache:
            doc_cache[doc_id] = db.query(DesignDocument).filter(DesignDocument.id == doc_id).first()
        return doc_cache.get(doc_id)

    def sub_bom(item_id) -> tuple[DesignBom, DesignBomRevision] | None:
        candidates = db.query(DesignBom).options(
            selectinload(DesignBom.revisions).selectinload(DesignBomRevision.lines)
        ).filter(
            DesignBom.product_item_id == item_id, DesignBom.is_deleted == False, DesignBom.status == "active"  # noqa: E712
        ).order_by(DesignBom.pm_project_id.isnot(None), DesignBom.id).all()
        for b in candidates:
            released = released_bom_revision(b)
            if released:
                return b, released
        return None

    def walk(current: DesignBomRevision, level: int, prefix: str, multiplier: float, ancestors: set[int]) -> None:
        for line in current.lines:
            it = item(line.store_item_id)
            d = doc(line.document_id)
            path = f"{prefix}{line.position}" if not prefix else f"{prefix}.{line.position}"
            total = line.quantity * multiplier
            child = sub_bom(line.store_item_id) if line.store_item_id and line.store_item_id not in ancestors else None
            rows.append(DesignBomExplosionRow(
                level=level, path=path, store_item_id=line.store_item_id,
                item_code=it.item_code if it else None, item_name=it.item_name if it else None,
                quantity=line.quantity, total_quantity=total, uom=line.uom, make_buy=line.make_buy,
                doc_number=d.doc_number if d else None, drawing_revision=line.document_revision_label,
                bom_id=child[0].id if child else None, bom_number=child[0].bom_number if child else None,
                new_item_name=line.new_item_name,
            ))
            if child and level < 15:
                walk(child[1], level + 1, path, total, ancestors | {line.store_item_id})

    walk(rev, 1, "", 1.0, {bom.product_item_id})
    return rows


def _pick_revision(bom: DesignBom, revision_id: int | None, viewer: bool) -> DesignBomRevision:
    if revision_id:
        rev = next((r for r in live_bom_revisions(bom) if r.id == revision_id), None)
        if not rev or (viewer and rev.status not in VIEWER_STATUSES):
            raise HTTPException(status_code=404, detail=f"Revision #{revision_id} isn't a visible revision of {bom.bom_number}.")
        return rev
    rev = released_bom_revision(bom) or (None if viewer else open_bom_revision(bom))
    if not rev:
        raise HTTPException(status_code=404, detail=f"{bom.bom_number} has no released revision yet.")
    return rev


@router.get("/{bom_id}/explosion", response_model=list[DesignBomExplosionRow])
async def explode_bom(bom_id: int, revision_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ensure_design_feature(user, "boms", "explosion", "view")
    bom = get_bom(db, bom_id, user=user)
    return _explode(db, bom, _pick_revision(bom, revision_id, not is_team(db, user)))


@router.get("/{bom_id}/export")
async def export_bom(bom_id: int, revision_id: int | None = None, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    """Multi-level BOM sheet (CSV, opens in Excel) — the hand-over to Store/Purchase."""
    ensure_design_feature(user, "boms", "explosion", "export")
    bom = get_bom(db, bom_id, user=user)
    rev = _pick_revision(bom, revision_id, not is_team(db, user))
    rows = _explode(db, bom, rev)
    product = db.query(StoreItem).filter(StoreItem.id == bom.product_item_id).first()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([f"{bom.bom_number} {rev.revision_label} ({rev.status})", bom.title,
                     f"Product: {product.item_code} {product.item_name}" if product else ""])
    writer.writerow(["Level", "Position", "Item Code", "Item Name", "Qty / Assy", "Total Qty", "UOM", "Make/Buy", "Drawing", "Drawing Rev", "Sub-BOM"])
    for r in rows:
        writer.writerow([
            r.level, r.path, r.item_code or "(new item)", r.item_name or r.new_item_name or "", f"{r.quantity:g}",
            f"{r.total_quantity:g}", r.uom or "", r.make_buy, r.doc_number or "", r.drawing_revision or "", r.bom_number or "",
        ])
    filename = f"{bom.bom_number}_{rev.revision_label}.csv"
    return Response(
        content=buf.getvalue().encode("utf-8-sig"), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


# ---------------------------------------------------------------------------
# Where-used
# ---------------------------------------------------------------------------

@where_used_router.get("")
async def where_used(
    store_item_id: int | None = None,
    document_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    """For an item: BOMs using it + its drawings. For a drawing: BOMs whose
    lines reference it. Both list the projects those BOMs belong to."""
    if not store_item_id and not document_id:
        raise HTTPException(status_code=400, detail="Pick an item or a drawing to see where it's used.")
    if store_item_id:
        item = _validate_item(db, store_item_id, "Where-used")
        boms = where_used_item(db, store_item_id)
        drawings = [{"id": d.id, "doc_number": d.doc_number, "title": d.title, "status": d.status} for d in drawings_for_item(db, store_item_id)]
        own = db.query(DesignBom).filter(DesignBom.product_item_id == store_item_id, DesignBom.is_deleted == False).all()  # noqa: E712
        return {
            "subject": f"{item.item_code} — {item.item_name}", "boms": [b.model_dump() for b in boms], "drawings": drawings,
            "own_boms": [{"id": b.id, "bom_number": b.bom_number, "title": b.title} for b in own],
            "projects": sorted({b.pm_project_label or b.erp_project_label for b in boms if b.pm_project_label or b.erp_project_label}),
        }
    doc = db.query(DesignDocument).filter(DesignDocument.id == document_id, DesignDocument.is_deleted == False).first()  # noqa: E712
    if not doc:
        raise HTTPException(status_code=404, detail=f"Drawing #{document_id} not found.")
    boms: list[DesignWhereUsedRow] = where_used_document(db, document_id)
    return {
        "subject": f"{doc.doc_number} — {doc.title}", "boms": [b.model_dump() for b in boms], "drawings": [],
        "own_boms": [{"id": b.id, "bom_number": b.bom_number, "title": b.title} for b in db.query(DesignBom).filter(DesignBom.document_id == doc.id, DesignBom.is_deleted == False).all()],  # noqa: E712
        "projects": sorted({b.pm_project_label or b.erp_project_label for b in boms if b.pm_project_label or b.erp_project_label}),
    }
