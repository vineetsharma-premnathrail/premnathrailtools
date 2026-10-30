"""Engineering Change Requests: anyone with the Design app (including
Production, Quality and Purchase viewers) raises one against released
drawings/BOMs → Design records the impact (helped by where-used) → the
change board votes → the Design head decides → an approved ECR becomes an
ECN, which carries the implementation."""
from datetime import date
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import require_app_access, require_tab_access
from app.core.priority import map_legacy_priority
from app.db.session import get_db
from app.modules.design.access import get_settings, head_ids, is_head, is_team, next_number, require_head, require_team, year_prefix
from app.modules.design.bom_service import released_bom_revision
from app.modules.design.events import notify_design_event
from app.modules.design.features import ensure_design_feature, gate_actions, has
from app.modules.design.models.bom import DesignBom
from app.modules.design.models.change_notice import DesignChangeNotice, DesignChangeNoticeBom, DesignChangeNoticeDocument
from app.modules.design.models.change_request import (
    DesignChangeRequest, DesignChangeRequestItem, DesignEcrVote, DESIGN_ECR_SOURCES, DESIGN_ECR_URGENCIES, DESIGN_ECR_VOTES,
)
from app.modules.design.models.document import DesignDocument
from app.modules.design.models.event import DesignEvent
from app.modules.design.routes.documents import machine_label, validate_links
from app.modules.design.schemas.change_request import (
    DesignChangeRequestCreate, DesignChangeRequestDetail, DesignChangeRequestItemPayload, DesignChangeRequestItemResponse,
    DesignChangeRequestResponse, DesignChangeRequestUpdate, DesignEcrDecisionPayload, DesignEcrImpactPayload,
    DesignEcrToEcnPayload, DesignEcrVotePayload, DesignEcrVoteResponse,
)
from app.modules.design.schemas.event import DesignCommentPayload, DesignEventResponse
from app.modules.design.service import (
    Denied, add_event, days_since, ensure, generate_ecn_number, get_workflow_user, is_admin, notify, released_revision,
    user_name, users_by_id, utcnow,
)
from app.modules.design.whereused import where_used_document, where_used_item
from app.modules.erp.models.project import Project
from app.modules.design.scope import apply_scope, ensure_in_scope
from app.modules.main.models.user import User
from app.modules.projects.models.project import PmProject
from app.modules.quality.models.capa import QualityCapa
from app.modules.quality.models.ncr import QualityNcr

router = APIRouter(
    prefix="/design/change-requests", tags=["Design"],
    dependencies=[Depends(require_app_access("design"))],
)

_NOTIFY_ENTITY = "design_ecr"
_PHRASE = {
    "open": "open (waiting for the impact check)", "impact_checked": "with the change board",
    "approved": "approved", "rejected": "rejected", "deferred": "deferred", "withdrawn": "withdrawn",
}
# ECR source → ECN reason.
_REASON = {
    "ncr": "quality_issue", "capa": "quality_issue", "quality": "quality_issue", "service": "quality_issue",
    "customer": "customer_request", "production": "manufacturing_issue", "purchase": "other", "design": "design_improvement",
    "other": "other",
}
# ECR urgency (low/normal/high/critical) -> ECN priority (standard/urgent): high and critical are urgent.


def _get(db: Session, ecr_id: int, lock: bool = False, user: User | None = None) -> DesignChangeRequest:
    if lock:
        db.query(DesignChangeRequest.id).filter(DesignChangeRequest.id == ecr_id).with_for_update().first()
    ecr = db.query(DesignChangeRequest).options(
        selectinload(DesignChangeRequest.items), selectinload(DesignChangeRequest.votes)
    ).populate_existing().filter(DesignChangeRequest.id == ecr_id, DesignChangeRequest.is_deleted == False).first()  # noqa: E712
    if not ecr:
        raise HTTPException(status_code=404, detail=f"Change request #{ecr_id} not found — it may have been deleted.")
    if user is not None:
        ensure_in_scope(db, user, ecr)
    return ecr


def _ph(ecr: DesignChangeRequest) -> str:
    return _PHRASE.get(ecr.status, ecr.status)


# ---------------------------------------------------------------------------
# Rules
# ---------------------------------------------------------------------------

def check_edit(user: User, ecr: DesignChangeRequest, head: bool) -> Denied | None:
    if ecr.status != "open":
        return Denied(409, f"{ecr.ecr_number} is {_ph(ecr)}, so it can no longer be edited.")
    if not (head or user.id == ecr.raised_by_id):
        return Denied(403, f"Only the person who raised {ecr.ecr_number} or the Design head can edit it.")
    return None


def check_impact(user: User, ecr: DesignChangeRequest, head: bool, team: bool) -> Denied | None:
    if ecr.status not in ("open", "impact_checked"):
        return Denied(409, f"{ecr.ecr_number} is {_ph(ecr)} — the impact can only be recorded before the decision.")
    if not team:
        return Denied(403, "The impact check is done by the Design team.")
    return None


def check_vote(user: User, ecr: DesignChangeRequest) -> Denied | None:
    if ecr.status != "impact_checked":
        return Denied(409, f"{ecr.ecr_number} is {_ph(ecr)} — the board votes once the impact is checked and before the decision.")
    if user.id not in (ecr.board_member_ids or []):
        return Denied(403, f"You're not on the change board for {ecr.ecr_number}, so you can't vote on it.")
    return None


def check_decide(user: User, ecr: DesignChangeRequest, head: bool) -> Denied | None:
    if ecr.status != "impact_checked":
        return Denied(409, f"{ecr.ecr_number} is {_ph(ecr)} — it needs its impact checked before the board can decide.")
    if not head:
        return Denied(403, "Only the Design head (chair of the change board) or an admin decides an ECR.")
    return None


def check_withdraw(user: User, ecr: DesignChangeRequest) -> Denied | None:
    if ecr.status not in ("open", "impact_checked"):
        return Denied(409, f"{ecr.ecr_number} is {_ph(ecr)} — only an undecided ECR can be withdrawn.")
    if not (is_admin(user) or user.id == ecr.raised_by_id):
        return Denied(403, f"Only the person who raised {ecr.ecr_number} can withdraw it.")
    return None


def allowed_actions(db: Session, user: User, ecr: DesignChangeRequest, ecn_id: int | None) -> list[str]:
    head = is_head(db, user)
    team = is_team(db, user)
    out = ["comment"]
    if not check_edit(user, ecr, head):
        out.append("edit")
    if not check_impact(user, ecr, head, team):
        out.append("impact")
    if not check_vote(user, ecr):
        out.append("vote")
    if not check_decide(user, ecr, head):
        out.append("decide")
    if ecr.status == "deferred" and head:
        out.append("reopen")
    if not check_withdraw(user, ecr):
        out.append("withdraw")
    if ecr.status == "approved" and head and not ecn_id:
        out.append("create_ecn")
    return out


# ---------------------------------------------------------------------------
# Presentation
# ---------------------------------------------------------------------------

def _responses(db: Session, ecrs: list[DesignChangeRequest], cls=DesignChangeRequestResponse, with_where_used: bool = False,
               user: User | None = None) -> list:
    see_cost = user is None or has(user, "change_notices", "cost_impact")
    doc_ids = {i.document_id for e in ecrs for i in e.items if i.document_id}
    docs = {d.id: d for d in db.query(DesignDocument).options(selectinload(DesignDocument.revisions)).filter(DesignDocument.id.in_(doc_ids)).all()} if doc_ids else {}
    bom_ids = {i.bom_id for e in ecrs for i in e.items if i.bom_id}
    boms = {b.id: b for b in db.query(DesignBom).options(selectinload(DesignBom.revisions)).filter(DesignBom.id.in_(bom_ids)).all()} if bom_ids else {}
    users = users_by_id(db, {u for e in ecrs for u in (e.raised_by_id, e.impact_checked_by_id, e.decided_by_id)})
    ncr_ids = {e.quality_ncr_id for e in ecrs} - {None}
    ncrs = {n.id: n.ncr_number for n in db.query(QualityNcr).filter(QualityNcr.id.in_(ncr_ids)).all()} if ncr_ids else {}
    capa_ids = {e.quality_capa_id for e in ecrs} - {None}
    capas = {c.id: c.capa_number for c in db.query(QualityCapa).filter(QualityCapa.id.in_(capa_ids)).all()} if capa_ids else {}
    pm_ids = {e.pm_project_id for e in ecrs} - {None}
    pms = {p.id: p for p in db.query(PmProject).filter(PmProject.id.in_(pm_ids)).all()} if pm_ids else {}
    erp_ids = {e.erp_project_id for e in ecrs} - {None}
    machines = {p.id: p for p in db.query(Project).filter(Project.id.in_(erp_ids)).all()} if erp_ids else {}
    ecns = {
        n.ecr_id: n for n in db.query(DesignChangeNotice).filter(
            DesignChangeNotice.ecr_id.in_([e.id for e in ecrs]), DesignChangeNotice.is_deleted == False,  # noqa: E712
            # A cancelled ECN no longer carries the ECR — the head can raise a replacement.
            DesignChangeNotice.status != "cancelled",
        ).all()
    } if ecrs else {}
    out = []
    for ecr in ecrs:
        resp = cls.model_validate(ecr)
        resp.items = []
        for item in ecr.items:
            ir = DesignChangeRequestItemResponse.model_validate(item)
            if item.document_id and item.document_id in docs:
                d = docs[item.document_id]
                rel = released_revision(d)
                ir.number, ir.title, ir.released_revision_label = d.doc_number, d.title, rel.revision_label if rel else None
                if with_where_used:
                    ir.where_used = where_used_document(db, d.id)
            elif item.bom_id and item.bom_id in boms:
                b = boms[item.bom_id]
                rel = released_bom_revision(b)
                ir.number, ir.title, ir.released_revision_label = b.bom_number, b.title, rel.revision_label if rel else None
                if with_where_used:
                    ir.where_used = where_used_item(db, b.product_item_id)
            resp.items.append(ir)
        resp.raised_by_name = user_name(users.get(ecr.raised_by_id))
        resp.impact_checked_by_name = user_name(users.get(ecr.impact_checked_by_id))
        resp.decided_by_name = user_name(users.get(ecr.decided_by_id))
        resp.ncr_number = ncrs.get(ecr.quality_ncr_id)
        resp.capa_number = capas.get(ecr.quality_capa_id)
        pm = pms.get(ecr.pm_project_id)
        resp.pm_project_label = f"{pm.project_code} — {pm.name}" if pm else None
        resp.erp_project_label = machine_label(machines.get(ecr.erp_project_id))
        ecn = ecns.get(ecr.id)
        if ecn:
            resp.ecn_id, resp.ecn_number = ecn.id, ecn.ecn_number
        board = ecr.board_member_ids or []
        resp.votes_needed = len(board)
        resp.votes_cast = sum(1 for v in ecr.votes if v.user_id in board)
        end = ecr.decided_at if ecr.decided_at else None
        resp.days_open = (end.date() - ecr.created_at.date()).days if end and ecr.created_at else days_since(ecr.created_at)
        if not see_cost:
            resp.impact_cost = None  # sensitive: design:change_notices.cost_impact:view
        out.append(resp)
    return out


def _detail(db: Session, ecr: DesignChangeRequest, user: User) -> DesignChangeRequestDetail:
    ecr = _get(db, ecr.id)
    resp: DesignChangeRequestDetail = _responses(db, [ecr], DesignChangeRequestDetail, with_where_used=True, user=user)[0]
    board = ecr.board_member_ids or []
    users = users_by_id(db, set(board) | {v.user_id for v in ecr.votes})
    resp.votes = []
    for v in ecr.votes:
        vr = DesignEcrVoteResponse.model_validate(v)
        vr.user_name = user_name(users.get(v.user_id))
        resp.votes.append(vr)
    voted = {v.user_id: v.vote for v in ecr.votes}
    resp.board_members = [{"user_id": uid, "name": user_name(users.get(uid)), "vote": voted.get(uid)} for uid in board]
    events = db.query(DesignEvent).filter(DesignEvent.ecr_id == ecr.id).order_by(DesignEvent.created_at.desc(), DesignEvent.id.desc()).all()
    actors = users_by_id(db, {e.actor_id for e in events})
    resp.events = []
    for e in events:
        er = DesignEventResponse.model_validate(e)
        er.actor_name = user_name(actors.get(e.actor_id))
        resp.events.append(er)
    if not has(user, "change_notices", "ecr_vote"):
        resp.votes, resp.board_members = [], []
    raw = allowed_actions(db, user, ecr, resp.ecn_id)
    actions = gate_actions(user, "ecr", raw)
    # Deciding is approve (Approve ECR) or reject (Reject / Defer): offer it when either is held.
    if "decide" in raw and "decide" not in actions and has(user, "change_notices", "ecr_decision", "reject"):
        actions.append("decide")
    resp.allowed_actions = actions
    return resp


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _validate(db: Session, values: dict) -> None:
    if values.get("source") is not None and values["source"] not in DESIGN_ECR_SOURCES:
        raise HTTPException(status_code=400, detail=f"'{values['source']}' isn't a valid source. Choose one of: {', '.join(DESIGN_ECR_SOURCES)}.")
    if values.get("urgency") is not None and values["urgency"] not in DESIGN_ECR_URGENCIES:
        raise HTTPException(status_code=400, detail=f"'{values['urgency']}' isn't a valid urgency. Choose one of: {', '.join(DESIGN_ECR_URGENCIES)}.")
    if values.get("quality_ncr_id") and not db.query(QualityNcr.id).filter(QualityNcr.id == values["quality_ncr_id"]).first():
        raise HTTPException(status_code=400, detail=f"NCR #{values['quality_ncr_id']} wasn't found in Quality. Pick another NCR or leave it blank.")
    if values.get("quality_capa_id") and not db.query(QualityCapa.id).filter(QualityCapa.id == values["quality_capa_id"]).first():
        raise HTTPException(status_code=400, detail=f"CAPA #{values['quality_capa_id']} wasn't found in Quality. Pick another CAPA or leave it blank.")


def _set_items(db: Session, ecr: DesignChangeRequest, rows: list[DesignChangeRequestItemPayload]) -> None:
    """Affected items must be released — before release, a drawing is simply
    revised in Draft; ECRs are for controlled (released) definitions."""
    seen: set[tuple[str, int]] = set()
    items = []
    for row in rows:
        if bool(row.document_id) == bool(row.bom_id):
            raise HTTPException(status_code=400, detail="Each affected item is either a drawing or a BOM — pick exactly one per line.")
        key = ("doc", row.document_id) if row.document_id else ("bom", row.bom_id)
        if key in seen:
            raise HTTPException(status_code=400, detail="The same drawing or BOM is listed twice — keep one line each.")
        seen.add(key)
        if row.document_id:
            doc = db.query(DesignDocument).options(selectinload(DesignDocument.revisions)).filter(
                DesignDocument.id == row.document_id, DesignDocument.is_deleted == False  # noqa: E712
            ).first()
            if not doc:
                raise HTTPException(status_code=400, detail=f"Drawing #{row.document_id} wasn't found.")
            if not released_revision(doc):
                raise HTTPException(status_code=400, detail=f"{doc.doc_number} has no released revision — an unreleased drawing is simply changed in draft; no ECR is needed.")
        else:
            bom = db.query(DesignBom).options(selectinload(DesignBom.revisions)).filter(DesignBom.id == row.bom_id, DesignBom.is_deleted == False).first()  # noqa: E712
            if not bom:
                raise HTTPException(status_code=400, detail=f"BOM #{row.bom_id} wasn't found.")
            if not released_bom_revision(bom):
                raise HTTPException(status_code=400, detail=f"{bom.bom_number} has no released revision — change it in draft; no ECR is needed.")
        items.append(DesignChangeRequestItem(document_id=row.document_id, bom_id=row.bom_id, note=(row.note or "").strip() or None))
    ecr.items = items


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("", response_model=list[DesignChangeRequestResponse])
async def list_change_requests(
    status_filter: str | None = Query(None, alias="status"),
    source: str | None = None,
    mine: bool = False,
    search: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("design", "change_notices")),
):
    query = db.query(DesignChangeRequest).options(
        selectinload(DesignChangeRequest.items), selectinload(DesignChangeRequest.votes)
    ).filter(DesignChangeRequest.is_deleted == False)  # noqa: E712
    query = apply_scope(query, user, DesignChangeRequest)
    if status_filter:
        query = query.filter(DesignChangeRequest.status.in_(status_filter.split(",")))
    if source:
        query = query.filter(DesignChangeRequest.source.in_(source.split(",")))
    if mine:
        query = query.filter(DesignChangeRequest.raised_by_id == user.id)
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(DesignChangeRequest.ecr_number.ilike(like) | DesignChangeRequest.title.ilike(like))
    return _responses(db, query.order_by(DesignChangeRequest.created_at.desc(), DesignChangeRequest.id.desc()).limit(1000).all(), user=user)


@router.post("", response_model=DesignChangeRequestDetail, status_code=201)
async def create_change_request(payload: DesignChangeRequestCreate, background_tasks: BackgroundTasks,
                                db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    """Anyone with the Design app may raise an ECR (plan: Production, Quality,
    Purchase, customer via BD, Design)."""
    _validate(db, payload.model_dump())
    validate_links(db, pm_project_id=payload.pm_project_id, erp_project_id=payload.erp_project_id)
    if not payload.items:
        raise HTTPException(status_code=400, detail="List at least one released drawing or BOM this change affects.")
    ecr = DesignChangeRequest(
        ecr_number=next_number(db, DesignChangeRequest.ecr_number, year_prefix("ECR")), title=payload.title.strip(),
        source=payload.source, quality_ncr_id=payload.quality_ncr_id, quality_capa_id=payload.quality_capa_id,
        source_reference=payload.source_reference, urgency=payload.urgency, reason=payload.reason.strip(),
        proposed_change=payload.proposed_change.strip(), pm_project_id=payload.pm_project_id,
        erp_project_id=payload.erp_project_id, status="open", raised_by_id=user.id, board_member_ids=[],
    )
    _set_items(db, ecr, payload.items)
    db.add(ecr)
    db.flush()
    add_event(db, "ecr_raised", user, ecr_id=ecr.id)
    for uid in head_ids(db):
        notify(db, uid, user, f"New ECR: {ecr.ecr_number}",
               f"{user_name(user)} raised {ecr.ecr_number} ({ecr.title}, {ecr.urgency} urgency) — check its impact and take it to the change board.",
               "design_ecr_raised", _NOTIFY_ENTITY, ecr.id)
    notify_design_event(
        db, background_tasks, "ecr_raised", ecr, entity_type=_NOTIFY_ENTITY, actor=user, team_only=True,
        title=f"New ECR: {ecr.ecr_number}",
        message=f"{user_name(user)} raised {ecr.ecr_number} ({ecr.title}, {ecr.urgency} urgency) — its impact needs checking before the change board votes.",
        skip=set(head_ids(db)),
    )
    db.commit()
    return _detail(db, ecr, user)


@router.get("/{ecr_id}", response_model=DesignChangeRequestDetail)
async def get_change_request(ecr_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    return _detail(db, _get(db, ecr_id, user=user), user)


@router.patch("/{ecr_id}", response_model=DesignChangeRequestDetail)
async def update_change_request(ecr_id: int, payload: DesignChangeRequestUpdate, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ecr = _get(db, ecr_id, lock=True, user=user)
    ensure(check_edit(user, ecr, is_head(db, user)))
    changes = payload.model_dump(exclude_unset=True)
    rows = changes.pop("items", None)
    _validate(db, changes)
    validate_links(db, **{k: v for k, v in changes.items() if k in ("pm_project_id", "erp_project_id")})
    for key in ("title", "reason", "proposed_change", "source", "urgency"):
        if key in changes and not changes[key]:
            raise HTTPException(status_code=400, detail=f"{key.replace('_', ' ').capitalize()} can't be empty.")
    for key, value in changes.items():
        setattr(ecr, key, value.strip() if isinstance(value, str) and key in ("title", "reason", "proposed_change") else value)
    if rows is not None:
        if not payload.items:
            raise HTTPException(status_code=400, detail="Keep at least one affected drawing or BOM.")
        _set_items(db, ecr, payload.items)
    add_event(db, "ecr_updated", user, ecr_id=ecr.id)
    db.commit()
    return _detail(db, ecr, user)


@router.post("/{ecr_id}/impact", response_model=DesignChangeRequestDetail)
async def record_impact(ecr_id: int, payload: DesignEcrImpactPayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ensure_design_feature(user, "change_notices", "ecr_impact", "edit")
    ecr = _get(db, ecr_id, lock=True, user=user)
    ensure(check_impact(user, ecr, is_head(db, user), is_team(db, user)))
    board = payload.board_member_ids if payload.board_member_ids is not None else list(get_settings(db).change_board_member_ids or [])
    board = list(dict.fromkeys(board))
    for uid in board:
        get_workflow_user(db, uid, "change board member")
    ecr.impact_summary = payload.impact_summary.strip()
    ecr.impact_stock = (payload.impact_stock or "").strip() or None
    ecr.impact_open_orders = (payload.impact_open_orders or "").strip() or None
    if has(user, "change_notices", "cost_impact"):
        ecr.impact_cost = payload.impact_cost
    # else: the figure is hidden from this user, so it keeps its current value.
    ecr.impact_delivery_days = payload.impact_delivery_days
    ecr.impact_checked_by_id, ecr.impact_checked_at = user.id, utcnow()
    first = ecr.status == "open"
    ecr.board_member_ids = board
    ecr.status = "impact_checked"
    # Votes from people no longer on the board don't count.
    ecr.votes = [v for v in ecr.votes if v.user_id in board]
    add_event(db, "ecr_impact_checked", user, ecr_id=ecr.id, comment=ecr.impact_summary)
    if first:
        for uid in board:
            notify(db, uid, user, f"Change board vote needed: {ecr.ecr_number}",
                   f"{ecr.ecr_number} ({ecr.title}) has its impact checked — please vote Approve, Reject or Defer.",
                   "design_ecr_vote", _NOTIFY_ENTITY, ecr.id, teams=True)
    db.commit()
    return _detail(db, ecr, user)


@router.post("/{ecr_id}/vote", response_model=DesignChangeRequestDetail)
async def vote(ecr_id: int, payload: DesignEcrVotePayload, background_tasks: BackgroundTasks,
               db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ensure_design_feature(user, "change_notices", "ecr_vote", "submit")
    ecr = _get(db, ecr_id, lock=True, user=user)
    ensure(check_vote(user, ecr))
    if payload.vote not in DESIGN_ECR_VOTES:
        raise HTTPException(status_code=400, detail="Vote Approve, Reject or Defer.")
    comment = (payload.comment or "").strip() or None
    if payload.vote != "approve" and not comment:
        raise HTTPException(status_code=400, detail=f"Say why you vote to {payload.vote} — the board and the raiser see it.")
    existing = next((v for v in ecr.votes if v.user_id == user.id), None)
    if existing:
        existing.vote, existing.comment = payload.vote, comment
    else:
        ecr.votes.append(DesignEcrVote(user_id=user.id, vote=payload.vote, comment=comment))
    add_event(db, "ecr_vote", user, ecr_id=ecr.id, comment=f"{payload.vote}" + (f": {comment}" if comment else ""))
    voted = {v.user_id for v in ecr.votes} | {user.id}
    if set(ecr.board_member_ids or []) <= voted:
        for uid in head_ids(db):
            notify(db, uid, user, f"Change board has voted: {ecr.ecr_number}",
                   f"Every board member has voted on {ecr.ecr_number} — it's ready for your decision.",
                   "design_ecr_ready", _NOTIFY_ENTITY, ecr.id, teams=True)
        notify_design_event(
            db, background_tasks, "ecr_ready_for_decision", ecr, entity_type=_NOTIFY_ENTITY, actor=user,
            title=f"ECR ready for decision: {ecr.ecr_number}",
            message=f"Every change-board member has voted on {ecr.ecr_number} ({ecr.title}) — approve, reject or defer it.",
            skip=set(head_ids(db)),
        )
    db.commit()
    return _detail(db, ecr, user)


@router.post("/{ecr_id}/decide", response_model=DesignChangeRequestDetail)
async def decide(ecr_id: int, payload: DesignEcrDecisionPayload, background_tasks: BackgroundTasks,
                 db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ecr = _get(db, ecr_id, lock=True, user=user)
    ensure(check_decide(user, ecr, is_head(db, user)))
    if payload.decision not in ("approved", "rejected", "deferred"):
        raise HTTPException(status_code=400, detail="Decide Approved, Rejected or Deferred.")
    if payload.decision == "approved":
        ensure_design_feature(user, "change_notices", "ecr_decision", "approve")
    else:
        ensure_design_feature(user, "change_notices", "ecr_decision", "reject")
    comment = (payload.comment or "").strip() or None
    if payload.decision != "approved" and not comment:
        raise HTTPException(status_code=400, detail=f"Give the reason the ECR is {payload.decision} — the person who raised it sees it.")
    voted = {v.user_id for v in ecr.votes}
    missing = [uid for uid in (ecr.board_member_ids or []) if uid not in voted]
    if missing and not is_admin(user):
        names = ", ".join(user_name(u) or f"#{u.id}" for u in users_by_id(db, missing).values())
        raise HTTPException(status_code=409, detail=f"Waiting for the change board: {names} haven't voted on {ecr.ecr_number} yet.")
    ecr.status, ecr.decided_by_id, ecr.decided_at, ecr.decision_comment = payload.decision, user.id, utcnow(), comment
    add_event(db, f"ecr_{payload.decision}", user, ecr_id=ecr.id, comment=comment)
    notify(db, ecr.raised_by_id, user, f"ECR {payload.decision}: {ecr.ecr_number}",
           f"{user_name(user)} {payload.decision} {ecr.ecr_number} ({ecr.title})" + (f": {comment}" if comment else "."),
           "design_ecr_decided", _NOTIFY_ENTITY, ecr.id)
    notify_design_event(
        db, background_tasks, "ecr_decided", ecr, entity_type=_NOTIFY_ENTITY, actor=user,
        title=f"ECR {payload.decision}: {ecr.ecr_number}",
        message=f"{user_name(user)} {payload.decision} {ecr.ecr_number} ({ecr.title})" + (f": {comment}" if comment else "."),
        skip={ecr.raised_by_id},
    )
    db.commit()
    return _detail(db, ecr, user)


@router.post("/{ecr_id}/reopen", response_model=DesignChangeRequestDetail)
async def reopen(ecr_id: int, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ensure_design_feature(user, "change_notices", "ecr_decision", "approve")
    ecr = _get(db, ecr_id, lock=True, user=user)
    require_head(db, user, "reopen a deferred ECR")
    if ecr.status != "deferred":
        raise HTTPException(status_code=409, detail=f"{ecr.ecr_number} is {_ph(ecr)} — only a deferred ECR can be reopened.")
    ecr.status, ecr.decided_by_id, ecr.decided_at = "impact_checked", None, None
    add_event(db, "ecr_reopened", user, ecr_id=ecr.id)
    db.commit()
    return _detail(db, ecr, user)


@router.post("/{ecr_id}/withdraw", response_model=DesignChangeRequestDetail)
async def withdraw(ecr_id: int, payload: DesignCommentPayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ecr = _get(db, ecr_id, lock=True, user=user)
    ensure(check_withdraw(user, ecr))
    ecr.status = "withdrawn"
    add_event(db, "ecr_withdrawn", user, ecr_id=ecr.id, comment=payload.comment)
    db.commit()
    return _detail(db, ecr, user)


@router.post("/{ecr_id}/comments", response_model=DesignChangeRequestDetail)
async def comment(ecr_id: int, payload: DesignCommentPayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    ecr = _get(db, ecr_id, user=user)
    add_event(db, "comment", user, ecr_id=ecr.id, comment=payload.comment)
    db.commit()
    return _detail(db, ecr, user)


@router.post("/{ecr_id}/ecn")
async def create_ecn(ecr_id: int, payload: DesignEcrToEcnPayload, db: Session = Depends(get_db), user: User = Depends(require_app_access("design"))):
    """Turns an approved ECR into its ECN — already approved (the board
    decided), so revisions can be raised under it straight away."""
    require_team(db, user, "create ECNs")
    require_head(db, user, "create the ECN from an approved ECR")
    ensure_design_feature(user, "change_notices", "ecr_to_ecn", "create")
    ecr = _get(db, ecr_id, lock=True, user=user)
    if ecr.status != "approved":
        raise HTTPException(status_code=409, detail=f"{ecr.ecr_number} is {_ph(ecr)} — only an approved ECR becomes an ECN.")
    existing = db.query(DesignChangeNotice).filter(
        DesignChangeNotice.ecr_id == ecr.id, DesignChangeNotice.is_deleted == False,  # noqa: E712
        DesignChangeNotice.status != "cancelled",
    ).first()
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"{ecr.ecr_number} already has {existing.ecn_number} ({existing.status}) — work under that ECN. "
                   f"To replace it, cancel {existing.ecn_number} first, then create the ECN again from this ECR.",
        )

    def _date(value: str | None, label: str) -> date | None:
        if not value:
            return None
        try:
            return date.fromisoformat(value)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"{label} '{value}' isn't a valid date (use YYYY-MM-DD).")

    from app.modules.design.routes.change_notices import _check_effectivity, _validate_fields
    _validate_fields(payload.model_dump())
    now = utcnow()
    ecn = DesignChangeNotice(
        ecn_number=generate_ecn_number(db), title=ecr.title, reason=_REASON.get(ecr.source, "other"),
        priority=map_legacy_priority(ecr.urgency), description=f"{ecr.reason}\n\nProposed change:\n{ecr.proposed_change}",
        impact_assessment=ecr.impact_summary, target_date=_date(payload.target_date, "Target date"),
        pm_project_id=ecr.pm_project_id, erp_project_id=ecr.erp_project_id, ecr_id=ecr.id,
        status="approved", created_by_id=user.id, approver_id=ecr.decided_by_id, submitted_at=now,
        decided_by_id=ecr.decided_by_id, decided_at=ecr.decided_at or now,
        decision_comment=f"Approved by the change board on {ecr.ecr_number}",
        effectivity_type=payload.effectivity_type, effectivity_date=_date(payload.effectivity_date, "Effectivity date"),
        effectivity_serial=payload.effectivity_serial, effectivity_note=payload.effectivity_note,
        stock_disposition=payload.stock_disposition, wip_disposition=payload.wip_disposition,
        disposition_note=payload.disposition_note,
    )
    ecn.documents = [DesignChangeNoticeDocument(document_id=i.document_id, change_description=i.note) for i in ecr.items if i.document_id]
    ecn.boms = [DesignChangeNoticeBom(bom_id=i.bom_id, change_description=i.note) for i in ecr.items if i.bom_id]
    _check_effectivity(ecn)
    db.add(ecn)
    db.flush()
    add_event(db, "ecn_created_from_ecr", user, ecn_id=ecn.id, ecr_id=ecr.id, comment=ecr.ecr_number)
    owners = {o for (o,) in db.query(DesignDocument.owner_id).filter(DesignDocument.id.in_([i.document_id for i in ecr.items if i.document_id])).all()}
    owners |= {o for (o,) in db.query(DesignBom.owner_id).filter(DesignBom.id.in_([i.bom_id for i in ecr.items if i.bom_id])).all()}
    for owner_id in owners:
        notify(db, owner_id, user, f"Revision needed under {ecn.ecn_number}",
               f"{ecn.ecn_number} (from {ecr.ecr_number}: {ecr.title}) is open and affects something you own — start its next revision under this ECN.",
               "design_ecn_approved", "design_ecn", ecn.id)
    db.commit()
    return {"id": ecn.id, "ecn_number": ecn.ecn_number}
