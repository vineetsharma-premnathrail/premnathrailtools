"""Engineering Change Notices. Normally created from an approved ECR (the
change board already decided), so they start Open (`approved`): the
affected drawings' and BOMs' next revisions are raised under them. Release
(`implemented`) is only accepted once each affected drawing and BOM has a
released revision under the ECN; it then asks each department to
acknowledge, and the ECN closes when all have. Legacy ECNs without an ECR
still go draft → submitted → approved themselves. Notifications only —
never an automatic stock or purchase change."""
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session, selectinload

from app.core.permissions import ensure_can_delete, ensure_tab_action, require_app_access, require_tab_access
from app.db.session import get_db
from app.core.priority import parse_priority
from app.modules.design.access import check_signatory_role, get_settings, is_head, require_team
from app.modules.design.approvals import ECN_ENTITY, ECN_KEY, can_decide, pending_request
from app.modules.design.scope import apply_scope, ensure_in_scope
from app.modules.design.features import ensure_design_feature, gate_actions
from app.modules.design.bom_service import released_bom_revision
from app.modules.design.models.bom import DesignBom, DesignBomRevision
from app.modules.design.models.change_notice import (
    DesignChangeNotice, DesignChangeNoticeBom, DesignChangeNoticeDocument, DesignEcnAcknowledgement,
    DESIGN_ECN_ACK_DEPARTMENTS, DESIGN_ECN_DISPOSITIONS, DESIGN_ECN_EFFECTIVITY,
    DESIGN_ECN_REASONS,
)
from app.modules.design.models.change_request import DesignChangeRequest
from app.modules.design.models.document import DesignDocument, DesignDocumentRevision
from app.modules.design.models.event import DesignEvent
from app.modules.design.routes.documents import machine_label, validate_links
from app.modules.design.schemas.change_notice import (
    DesignChangeNoticeBomPayload, DesignChangeNoticeBomResponse, DesignChangeNoticeCancelPayload,
    DesignChangeNoticeCreate, DesignChangeNoticeDecisionPayload, DesignChangeNoticeDetail,
    DesignChangeNoticeDocumentPayload, DesignChangeNoticeDocumentResponse, DesignChangeNoticeResponse,
    DesignChangeNoticeUpdate, DesignEcnAcknowledgementResponse, DesignEcnAcknowledgePayload, DesignEcnEffectivityPayload,
)
from app.modules.design.schemas.event import DesignCommentPayload, DesignEventResponse
from app.modules.design.service import (
    add_event, allowed_ecn_actions, check_ecn_cancel, check_ecn_decide, check_ecn_delete, check_ecn_edit,
    check_ecn_implement, ensure, generate_ecn_number, get_workflow_user, notify, released_revision, user_name,
    users_by_id, utcnow,
)
from app.modules.erp.models.project import Project
from app.modules.main.models.user import User
from app.modules.organization.services import approval_engine as engine
from app.modules.projects.models.project import PmProject
from app.utils.notifications import broadcast_notification

router = APIRouter(
    prefix="/design/change-notices", tags=["Design"],
    dependencies=[Depends(require_app_access("design"))],
)

_NOTIFY_ENTITY = "design_ecn"
# Department → the app whose holders may acknowledge for it when Settings
# names nobody specific.
ACK_APPS = {"production": "production", "purchase": "p2p", "store": "store", "quality": "quality", "project": "projects"}
ACK_LABELS = {"production": "Production", "purchase": "Purchase", "store": "Store", "quality": "Quality", "project": "Project management"}


def _get_ecn(db: Session, ecn_id: int, lock: bool = False, user: User | None = None) -> DesignChangeNotice:
    if lock:
        db.query(DesignChangeNotice.id).filter(DesignChangeNotice.id == ecn_id).with_for_update().first()
    ecn = db.query(DesignChangeNotice).options(
        selectinload(DesignChangeNotice.documents), selectinload(DesignChangeNotice.boms),
        selectinload(DesignChangeNotice.acknowledgements),
    ).populate_existing().filter(
        DesignChangeNotice.id == ecn_id, DesignChangeNotice.is_deleted == False  # noqa: E712
    ).first()
    if not ecn:
        raise HTTPException(status_code=404, detail=f"Change notice #{ecn_id} not found — it may have been deleted.")
    if user is not None:
        ensure_in_scope(db, user, ecn)
    return ecn


def _implementation_state(db: Session, ecn_ids: list[int]) -> dict[tuple[int, int], DesignDocumentRevision]:
    """(ecn_id, document_id) → the latest live revision raised under that ECN."""
    if not ecn_ids:
        return {}
    revs = db.query(DesignDocumentRevision).filter(
        DesignDocumentRevision.ecn_id.in_(ecn_ids), DesignDocumentRevision.is_deleted == False  # noqa: E712
    ).order_by(DesignDocumentRevision.revision_index).all()
    return {(r.ecn_id, r.document_id): r for r in revs}


def _bom_implementation_state(db: Session, ecn_ids: list[int]) -> dict[tuple[int, int], DesignBomRevision]:
    if not ecn_ids:
        return {}
    revs = db.query(DesignBomRevision).filter(
        DesignBomRevision.ecn_id.in_(ecn_ids), DesignBomRevision.is_deleted == False  # noqa: E712
    ).order_by(DesignBomRevision.revision_index).all()
    return {(r.ecn_id, r.bom_id): r for r in revs}


def released_under_ecn(db: Session, ecn: DesignChangeNotice) -> list[str]:
    """'DOC-NO R1' / 'BOM-NO R2' for every drawing or BOM revision raised
    under this ECN that is already released (or since superseded) — an ECN
    with any of these can no longer be cancelled."""
    refs = [
        f"{num} {label}" for num, label in db.query(DesignDocument.doc_number, DesignDocumentRevision.revision_label)
        .join(DesignDocument, DesignDocument.id == DesignDocumentRevision.document_id)
        .filter(DesignDocumentRevision.ecn_id == ecn.id, DesignDocumentRevision.is_deleted == False,  # noqa: E712
                DesignDocumentRevision.status.in_(("released", "superseded"))).all()
    ]
    refs += [
        f"{num} {label}" for num, label in db.query(DesignBom.bom_number, DesignBomRevision.revision_label)
        .join(DesignBom, DesignBom.id == DesignBomRevision.bom_id)
        .filter(DesignBomRevision.ecn_id == ecn.id, DesignBomRevision.is_deleted == False,  # noqa: E712
                DesignBomRevision.status.in_(("released", "superseded"))).all()
    ]
    return refs


def in_flight_under_ecn(db: Session, ecn: DesignChangeNotice) -> list[str]:
    """'DOC-NO R1 is in review' etc. for every drawing revision under this ECN
    in review / awaiting approval / awaiting the customer, and every BOM
    revision in review / awaiting approval — they must be settled before an
    approved ECN can be cancelled."""
    phrase = {"in_review": "is in review", "in_approval": "is awaiting approval",
              "approved": "is approved and waiting for the customer"}
    refs = [
        f"{num} {label} {phrase[status]}" for num, label, status in
        db.query(DesignDocument.doc_number, DesignDocumentRevision.revision_label, DesignDocumentRevision.status)
        .join(DesignDocument, DesignDocument.id == DesignDocumentRevision.document_id)
        .filter(DesignDocumentRevision.ecn_id == ecn.id, DesignDocumentRevision.is_deleted == False,  # noqa: E712
                DesignDocumentRevision.status.in_(("in_review", "in_approval", "approved"))).all()
    ]
    refs += [
        f"{num} {label} {phrase[status]}" for num, label, status in
        db.query(DesignBom.bom_number, DesignBomRevision.revision_label, DesignBomRevision.status)
        .join(DesignBom, DesignBom.id == DesignBomRevision.bom_id)
        .filter(DesignBomRevision.ecn_id == ecn.id, DesignBomRevision.is_deleted == False,  # noqa: E712
                DesignBomRevision.status.in_(("in_review", "in_approval"))).all()
    ]
    return refs


def _cancel_refs(db: Session, ecn: DesignChangeNotice) -> dict:
    if ecn.status != "approved":
        return {}
    return {"released_refs": released_under_ecn(db, ecn), "in_flight_refs": in_flight_under_ecn(db, ecn)}


def can_acknowledge(db: Session, user: User, department: str) -> bool:
    if user.role == "admin":
        return True
    named = (get_settings(db).ecn_acknowledger_ids or {}).get(department) or []
    if named:
        return user.id in named
    return ACK_APPS.get(department, "") in user.get_apps()


def _responses(db: Session, ecns: list[DesignChangeNotice], cls=DesignChangeNoticeResponse, viewer_user: User | None = None) -> list:
    doc_ids = {d.document_id for e in ecns for d in e.documents}
    docs = {
        d.id: d for d in db.query(DesignDocument).options(selectinload(DesignDocument.revisions)).filter(DesignDocument.id.in_(doc_ids)).all()
    } if doc_ids else {}
    impl = _implementation_state(db, [e.id for e in ecns])
    user_ids = {u for e in ecns for u in (e.created_by_id, e.approver_id, e.decided_by_id, e.implemented_by_id)}
    user_ids |= {a.acknowledged_by_id for e in ecns for a in e.acknowledgements}
    user_ids |= {d.owner_id for d in docs.values()}
    users = users_by_id(db, user_ids)
    pm_ids = {e.pm_project_id for e in ecns} - {None}
    pm = {p.id: p for p in db.query(PmProject).filter(PmProject.id.in_(pm_ids)).all()} if pm_ids else {}
    erp_ids = {e.erp_project_id for e in ecns} - {None}
    machines = {p.id: p for p in db.query(Project).filter(Project.id.in_(erp_ids)).all()} if erp_ids else {}
    bom_ids = {b.bom_id for e in ecns for b in e.boms}
    boms = {
        b.id: b for b in db.query(DesignBom).options(selectinload(DesignBom.revisions)).filter(DesignBom.id.in_(bom_ids)).all()
    } if bom_ids else {}
    bom_impl = _bom_implementation_state(db, [e.id for e in ecns])
    ecr_ids = {e.ecr_id for e in ecns} - {None}
    ecrs = {r.id: r.ecr_number for r in db.query(DesignChangeRequest).filter(DesignChangeRequest.id.in_(ecr_ids)).all()} if ecr_ids else {}
    ack_rights: dict[str, bool] = {}

    out = []
    for ecn in ecns:
        resp = cls.model_validate(ecn)
        resp.created_by_name = user_name(users.get(ecn.created_by_id))
        resp.approver_name = user_name(users.get(ecn.approver_id))
        resp.decided_by_name = user_name(users.get(ecn.decided_by_id))
        resp.implemented_by_name = user_name(users.get(ecn.implemented_by_id))
        project = pm.get(ecn.pm_project_id)
        resp.pm_project_label = f"{project.project_code} — {project.name}" if project else None
        resp.erp_project_label = machine_label(machines.get(ecn.erp_project_id))
        resp.documents = []
        for link in ecn.documents:
            row = DesignChangeNoticeDocumentResponse.model_validate(link)
            doc = docs.get(link.document_id)
            if doc:
                row.doc_number = doc.doc_number
                row.title = doc.title
                row.document_status = doc.status
                row.owner_name = user_name(users.get(doc.owner_id))
                released = released_revision(doc)
                row.released_revision_label = released.revision_label if released else None
            rev = impl.get((ecn.id, link.document_id))
            if rev:
                row.ecn_revision_id = rev.id
                row.ecn_revision_label = rev.revision_label
                row.implementation_status = "released" if rev.status in ("released", "superseded") else rev.status
            resp.documents.append(row)
        resp.boms = []
        for link in ecn.boms:
            row = DesignChangeNoticeBomResponse.model_validate(link)
            bom = boms.get(link.bom_id)
            if bom:
                row.bom_number, row.title = bom.bom_number, bom.title
                released = released_bom_revision(bom)
                row.released_revision_label = released.revision_label if released else None
            rev = bom_impl.get((ecn.id, link.bom_id))
            if rev:
                row.ecn_revision_id, row.ecn_revision_label = rev.id, rev.revision_label
                row.implementation_status = "released" if rev.status in ("released", "superseded") else rev.status
            resp.boms.append(row)
        resp.acknowledgements = []
        for ack in ecn.acknowledgements:
            ar = DesignEcnAcknowledgementResponse.model_validate(ack)
            ar.acknowledged_by_name = user_name(users.get(ack.acknowledged_by_id))
            if viewer_user is not None and not ack.acknowledged_at:
                if ack.department not in ack_rights:
                    ack_rights[ack.department] = can_acknowledge(db, viewer_user, ack.department)
                ar.can_acknowledge = ack_rights[ack.department]
            resp.acknowledgements.append(ar)
        resp.ecr_number = ecrs.get(ecn.ecr_id)
        resp.document_count = len(resp.documents) + len(resp.boms)
        resp.released_count = sum(1 for d in resp.documents if d.implementation_status == "released") + sum(
            1 for b in resp.boms if b.implementation_status == "released")
        resp.acknowledged_count = sum(1 for a in ecn.acknowledgements if a.acknowledged_at)
        out.append(resp)
    return out


def _detail(db: Session, ecn: DesignChangeNotice, user: User) -> DesignChangeNoticeDetail:
    ecn = _get_ecn(db, ecn.id)
    resp: DesignChangeNoticeDetail = _responses(db, [ecn], DesignChangeNoticeDetail, viewer_user=user)[0]
    events = db.query(DesignEvent).filter(DesignEvent.ecn_id == ecn.id).order_by(DesignEvent.created_at.desc(), DesignEvent.id.desc()).all()
    actors = users_by_id(db, {e.actor_id for e in events})
    doc_numbers = {d.document_id: d.doc_number for d in resp.documents}
    rev_ids = {e.revision_id for e in events} - {None}
    rev_labels = {r.id: r.revision_label for r in db.query(DesignDocumentRevision).filter(DesignDocumentRevision.id.in_(rev_ids)).all()} if rev_ids else {}
    resp.events = []
    for e in events:
        er = DesignEventResponse.model_validate(e)
        er.actor_name = user_name(actors.get(e.actor_id))
        er.doc_number = doc_numbers.get(e.document_id)
        er.revision_label = rev_labels.get(e.revision_id)
        resp.events.append(er)
    resp.allowed_actions = allowed_ecn_actions(user, ecn, head=is_head(db, user), **_cancel_refs(db, ecn))
    if ecn.status == "submitted" and pending_request(db, ECN_ENTITY, ecn.id) is not None:
        # Engine-backed: approve / reject happen on the approval panel.
        resp.approval_engine = True
        resp.allowed_actions = [a for a in resp.allowed_actions if a not in ("approve", "reject")]
        if can_decide(db, user, ECN_ENTITY, ecn.id):
            resp.allowed_actions += ["approve", "reject"]
    if ecn.status in ("draft", "submitted", "approved") and (is_head(db, user) or user.id in (ecn.created_by_id, ecn.approver_id)):
        resp.allowed_actions.append("edit_effectivity")
    if any(a.can_acknowledge for a in resp.acknowledgements):
        resp.allowed_actions.append("acknowledge")
    resp.allowed_actions = gate_actions(user, "ecn", resp.allowed_actions)
    return resp


def _validate_fields(values: dict) -> None:
    if values.get("effectivity_type") is not None and values["effectivity_type"] not in DESIGN_ECN_EFFECTIVITY:
        raise HTTPException(status_code=400, detail=f"'{values['effectivity_type']}' isn't a valid effectivity. Choose one of: {', '.join(DESIGN_ECN_EFFECTIVITY)}.")
    for key in ("stock_disposition", "wip_disposition"):
        if values.get(key) is not None and values[key] not in DESIGN_ECN_DISPOSITIONS:
            raise HTTPException(status_code=400, detail=f"'{values[key]}' isn't a valid disposition. Choose one of: {', '.join(DESIGN_ECN_DISPOSITIONS)}.")
    if values.get("reason") is not None and values["reason"] not in DESIGN_ECN_REASONS:
        raise HTTPException(status_code=400, detail=f"'{values['reason']}' isn't a valid reason. Choose one of: {', '.join(DESIGN_ECN_REASONS)}.")
    if values.get("priority") is not None:
        values["priority"] = parse_priority(values["priority"])


def set_documents(db: Session, ecn: DesignChangeNotice, rows: list[DesignChangeNoticeDocumentPayload]) -> None:
    seen: set[int] = set()
    for row in rows:
        if row.document_id in seen:
            raise HTTPException(status_code=400, detail="The same document is listed twice on this ECN — keep one entry per document.")
        seen.add(row.document_id)
    docs = {d.id: d for d in db.query(DesignDocument).filter(DesignDocument.id.in_(seen), DesignDocument.is_deleted == False).all()} if seen else {}  # noqa: E712
    for doc_id in seen:
        doc = docs.get(doc_id)
        if not doc:
            raise HTTPException(status_code=400, detail=f"Design document #{doc_id} wasn't found — it may have been deleted. Remove it from the ECN.")
        if doc.status == "obsolete":
            raise HTTPException(status_code=400, detail=f"{doc.doc_number} is obsolete, so it can't be changed under an ECN. Remove it, or ask an admin to reactivate it.")
    ecn.documents = [
        DesignChangeNoticeDocument(document_id=row.document_id, change_description=(row.change_description or "").strip() or None)
        for row in rows
    ]


def set_boms(db: Session, ecn: DesignChangeNotice, rows: list[DesignChangeNoticeBomPayload]) -> None:
    seen: set[int] = set()
    for row in rows:
        if row.bom_id in seen:
            raise HTTPException(status_code=400, detail="The same BOM is listed twice on this ECN — keep one entry per BOM.")
        seen.add(row.bom_id)
    boms = {b.id: b for b in db.query(DesignBom).filter(DesignBom.id.in_(seen), DesignBom.is_deleted == False).all()} if seen else {}  # noqa: E712
    for bom_id in seen:
        bom = boms.get(bom_id)
        if not bom:
            raise HTTPException(status_code=400, detail=f"BOM #{bom_id} wasn't found — it may have been deleted. Remove it from the ECN.")
        if bom.status == "obsolete":
            raise HTTPException(status_code=400, detail=f"{bom.bom_number} is obsolete, so it can't be changed under an ECN.")
    ecn.boms = [DesignChangeNoticeBom(bom_id=row.bom_id, change_description=(row.change_description or "").strip() or None) for row in rows]


def _check_effectivity(ecn: DesignChangeNotice) -> None:
    if ecn.effectivity_type == "date" and not ecn.effectivity_date:
        raise HTTPException(status_code=400, detail=f"{ecn.ecn_number}: give the date the change takes effect, or pick another effectivity.")
    if ecn.effectivity_type == "serial" and not (ecn.effectivity_serial or "").strip():
        raise HTTPException(status_code=400, detail=f"{ecn.ecn_number}: give the first serial number the change applies to.")
    if ecn.effectivity_type == "project" and not (ecn.pm_project_id or ecn.erp_project_id):
        raise HTTPException(status_code=400, detail=f"{ecn.ecn_number}: pick the project the change applies to.")


@router.get("", response_model=list[DesignChangeNoticeResponse])
async def list_change_notices(
    status_filter: str | None = Query(None, alias="status"),
    priority: str | None = None,
    document_id: int | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    _tab: User = Depends(require_tab_access("design", "change_notices")),
):
    query = db.query(DesignChangeNotice).options(selectinload(DesignChangeNotice.documents)).filter(
        DesignChangeNotice.is_deleted == False  # noqa: E712
    )
    query = apply_scope(query, _tab, DesignChangeNotice)
    if status_filter:
        query = query.filter(DesignChangeNotice.status.in_(status_filter.split(",")))
    if priority:
        query = query.filter(DesignChangeNotice.priority.in_(priority.split(",")))
    if document_id:
        query = query.filter(DesignChangeNotice.documents.any(DesignChangeNoticeDocument.document_id == document_id))
    if search:
        like = f"%{search.strip()}%"
        query = query.filter(DesignChangeNotice.ecn_number.ilike(like) | DesignChangeNotice.title.ilike(like) | DesignChangeNotice.description.ilike(like))
    return _responses(db, query.order_by(DesignChangeNotice.created_at.desc(), DesignChangeNotice.id.desc()).limit(1000).all())


@router.post("", response_model=DesignChangeNoticeDetail, status_code=201)
async def create_change_notice(
    payload: DesignChangeNoticeCreate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    # Legacy direct ECN (no ECR): only the Design team may raise one, and
    # the approver must be the Design head — otherwise anyone holding the
    # Design app could open drawings for revision without the change board.
    require_team(db, user, "raise an ECN directly — raise an ECR (change request) instead so the change board can review it")
    _validate_fields(payload.model_dump())
    validate_links(db, pm_project_id=payload.pm_project_id, erp_project_id=payload.erp_project_id)
    if payload.approver_id:
        if payload.approver_id == user.id:
            raise HTTPException(status_code=400, detail="You can't approve an ECN you're raising — pick someone else as approver.")
        get_workflow_user(db, payload.approver_id, "approver")
        check_signatory_role(db, payload.approver_id, "approver", "ECN approver")
    ecn = DesignChangeNotice(
        ecn_number=generate_ecn_number(db), title=payload.title.strip(), reason=payload.reason, priority=parse_priority(payload.priority),
        description=payload.description, impact_assessment=payload.impact_assessment, target_date=payload.target_date,
        pm_project_id=payload.pm_project_id, erp_project_id=payload.erp_project_id, approver_id=payload.approver_id,
        status="draft", created_by_id=user.id, effectivity_type=payload.effectivity_type,
        effectivity_date=payload.effectivity_date, effectivity_serial=payload.effectivity_serial,
        effectivity_note=payload.effectivity_note, stock_disposition=payload.stock_disposition,
        wip_disposition=payload.wip_disposition, disposition_note=payload.disposition_note,
    )
    set_documents(db, ecn, payload.documents)
    set_boms(db, ecn, payload.boms)
    db.add(ecn)
    db.flush()
    add_event(db, "ecn_created", user, ecn_id=ecn.id)
    db.commit()
    return _detail(db, ecn, user)


@router.get("/{ecn_id}", response_model=DesignChangeNoticeDetail)
async def get_change_notice(
    ecn_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    return _detail(db, _get_ecn(db, ecn_id, user=user), user)


@router.patch("/{ecn_id}", response_model=DesignChangeNoticeDetail)
async def update_change_notice(
    ecn_id: int,
    payload: DesignChangeNoticeUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    ecn = _get_ecn(db, ecn_id, lock=True, user=user)
    ensure(check_ecn_edit(user, ecn))
    changes = payload.model_dump(exclude_unset=True)
    documents = changes.pop("documents", None)
    boms_rows = changes.pop("boms", None)
    _validate_fields(changes)
    if "title" in changes and not (changes["title"] or "").strip():
        raise HTTPException(status_code=400, detail="Title can't be empty.")
    for key in ("reason", "priority"):
        if key in changes and changes[key] is None:
            raise HTTPException(status_code=400, detail=f"{key.title()} can't be empty.")
    validate_links(db, **{k: v for k, v in changes.items() if k in ("pm_project_id", "erp_project_id")})
    if changes.get("approver_id"):
        if changes["approver_id"] == ecn.created_by_id:
            raise HTTPException(status_code=400, detail=f"The person who raised {ecn.ecn_number} can't also approve it — pick someone else.")
        get_workflow_user(db, changes["approver_id"], "approver")
        check_signatory_role(db, changes["approver_id"], "approver", "ECN approver")
    for key, value in changes.items():
        setattr(ecn, key, value.strip() if key == "title" else value)
    if documents is not None:
        set_documents(db, ecn, payload.documents or [])
    if boms_rows is not None:
        set_boms(db, ecn, payload.boms or [])
    add_event(db, "ecn_updated", user, ecn_id=ecn.id)
    db.commit()
    return _detail(db, ecn, user)


@router.post("/{ecn_id}/submit", response_model=DesignChangeNoticeDetail)
async def submit_change_notice(
    ecn_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    ecn = _get_ecn(db, ecn_id, lock=True, user=user)
    ensure_tab_action(user, "design", "change_notices", "submit")
    ensure(check_ecn_edit(user, ecn))
    if not ecn.documents and not ecn.boms:
        raise HTTPException(status_code=400, detail=f"{ecn.ecn_number} doesn't list any affected documents. Add the drawings/documents this change touches before submitting.")
    _check_effectivity(ecn)
    if not ecn.approver_id:
        raise HTTPException(status_code=400, detail=f"Name an approver before submitting {ecn.ecn_number}.")
    if ecn.approver_id == ecn.created_by_id:
        raise HTTPException(status_code=400, detail=f"The person who raised {ecn.ecn_number} can't also approve it — pick someone else.")
    get_workflow_user(db, ecn.approver_id, "approver")
    check_signatory_role(db, ecn.approver_id, "approver", "ECN approver")
    obsolete = db.query(DesignDocument.doc_number).filter(
        DesignDocument.id.in_([d.document_id for d in ecn.documents]), DesignDocument.status == "obsolete"
    ).all()
    if obsolete:
        raise HTTPException(status_code=400, detail=f"{', '.join(n for (n,) in obsolete)} became obsolete since this ECN was drafted. Remove them before submitting.")
    ecn.status = "submitted"
    ecn.submitted_at = utcnow()
    add_event(db, "ecn_submitted", user, ecn_id=ecn.id)
    # Routing to the named approver + notifications: central approval engine.
    engine.submit(
        db, ECN_KEY, entity_id=ecn.id, requester=user, title=f"{ecn.ecn_number} — {ecn.title}", reference=ecn.ecn_number,
        context={"approver_id": ecn.approver_id, "priority": ecn.priority},
    )
    db.commit()
    return _detail(db, ecn, user)


@router.post("/{ecn_id}/approve", response_model=DesignChangeNoticeDetail)
async def approve_change_notice(
    ecn_id: int,
    payload: DesignChangeNoticeDecisionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    ecn = _get_ecn(db, ecn_id, lock=True, user=user)
    req = pending_request(db, ECN_ENTITY, ecn.id)
    if req is not None:
        if not can_decide(db, user, ECN_ENTITY, ecn.id):
            ensure(check_ecn_decide(user, ecn, db.query(User).filter(User.id == ecn.approver_id).first() if ecn.approver_id else None))
        engine.decide(db, req.id, user, "approve", (payload.comment or "").strip() or None)
        db.commit()
        return _detail(db, ecn, user)
    approver = db.query(User).filter(User.id == ecn.approver_id).first() if ecn.approver_id else None
    ensure(check_ecn_decide(user, ecn, approver))
    ecn.status = "approved"
    ecn.decided_by_id = user.id
    ecn.decided_at = utcnow()
    ecn.decision_comment = (payload.comment or "").strip() or None
    add_event(db, "ecn_approved", user, ecn_id=ecn.id, comment=ecn.decision_comment)
    notify(
        db, ecn.created_by_id, user, f"ECN approved: {ecn.ecn_number}",
        f"{user_name(user)} approved {ecn.ecn_number}. Raise the new revisions of the affected documents under it.",
        "design_ecn_approved", _NOTIFY_ENTITY, ecn.id,
    )
    owners = {
        o for (o,) in db.query(DesignDocument.owner_id).filter(DesignDocument.id.in_([d.document_id for d in ecn.documents])).all()
    } - {ecn.created_by_id}
    for owner_id in owners:
        notify(
            db, owner_id, user, f"Revision needed under {ecn.ecn_number}",
            f"{ecn.ecn_number} ({ecn.title}) was approved and affects a document you own — start its next revision under this ECN.",
            "design_ecn_approved", _NOTIFY_ENTITY, ecn.id,
        )
    db.commit()
    return _detail(db, ecn, user)


@router.post("/{ecn_id}/reject", response_model=DesignChangeNoticeDetail)
async def reject_change_notice(
    ecn_id: int,
    payload: DesignChangeNoticeDecisionPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    ecn = _get_ecn(db, ecn_id, lock=True, user=user)
    comment = (payload.comment or "").strip()
    if not comment:
        raise HTTPException(status_code=400, detail=f"Give a reason for rejecting {ecn.ecn_number} — the person who raised it sees it.")
    req = pending_request(db, ECN_ENTITY, ecn.id)
    if req is not None:
        if not can_decide(db, user, ECN_ENTITY, ecn.id):
            ensure(check_ecn_decide(user, ecn, db.query(User).filter(User.id == ecn.approver_id).first() if ecn.approver_id else None))
        engine.decide(db, req.id, user, "reject", comment)
        db.commit()
        return _detail(db, ecn, user)
    approver = db.query(User).filter(User.id == ecn.approver_id).first() if ecn.approver_id else None
    ensure(check_ecn_decide(user, ecn, approver))
    ecn.status = "rejected"
    ecn.decided_by_id = user.id
    ecn.decided_at = utcnow()
    ecn.decision_comment = comment
    add_event(db, "ecn_rejected", user, ecn_id=ecn.id, comment=comment)
    notify(
        db, ecn.created_by_id, user, f"ECN rejected: {ecn.ecn_number}",
        f"{user_name(user)} rejected {ecn.ecn_number}: {comment}",
        "design_ecn_rejected", _NOTIFY_ENTITY, ecn.id,
    )
    db.commit()
    return _detail(db, ecn, user)


@router.post("/{ecn_id}/implement", response_model=DesignChangeNoticeDetail)
async def implement_change_notice(
    ecn_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    ensure_design_feature(user, "change_notices", "ecn_release", "approve")
    ecn = _get_ecn(db, ecn_id, lock=True, user=user)
    ensure(check_ecn_implement(user, ecn))
    detail = _responses(db, [ecn])[0]
    pending = [(d.doc_number, d.implementation_status, d.ecn_revision_label) for d in detail.documents if d.implementation_status != "released"]
    pending += [(b.bom_number, b.implementation_status, b.ecn_revision_label) for b in detail.boms if b.implementation_status != "released"]
    if pending:
        listing = "; ".join(
            f"{number} ({'no revision raised yet' if status == 'pending' else label + ' is ' + status.replace('_', ' ')})"
            for number, status, label in pending
        )
        raise HTTPException(
            status_code=409,
            detail=f"{ecn.ecn_number} can't be marked implemented yet — these documents don't have a released revision under it: {listing}.",
        )
    _check_effectivity(ecn)
    ecn.status = "implemented"
    ecn.implemented_by_id = user.id
    ecn.implemented_at = utcnow()
    add_event(db, "ecn_implemented", user, ecn_id=ecn.id)
    changed = ", ".join([f"{d.doc_number} {d.ecn_revision_label}" for d in detail.documents] + [f"{b.bom_number} {b.ecn_revision_label}" for b in detail.boms])
    departments = [d for d in DESIGN_ECN_ACK_DEPARTMENTS if d != "project" or ecn.pm_project_id or ecn.erp_project_id]
    existing = {a.department for a in ecn.acknowledgements}
    for dept in departments:
        if dept not in existing:
            ecn.acknowledgements.append(DesignEcnAcknowledgement(department=dept))
    effect = {
        "immediate": "immediately", "date": f"from {ecn.effectivity_date:%d-%m-%Y}" if ecn.effectivity_date else "from the given date",
        "serial": f"from serial {ecn.effectivity_serial}", "next_order": "from the next production order", "project": "for the linked project only",
    }.get(ecn.effectivity_type, ecn.effectivity_type)
    disposition = f"Stock: {ecn.stock_disposition.replace('_', ' ')}, WIP: {ecn.wip_disposition.replace('_', ' ')}."
    named = get_settings(db).ecn_acknowledger_ids or {}
    for dept in departments:
        message = (f"{ecn.ecn_number} ({ecn.title}) is released — new controlled revisions: {changed}. Effective {effect}. {disposition} "
                   f"Please acknowledge for {ACK_LABELS[dept]} on the ECN.")
        if named.get(dept):
            for uid in named[dept]:
                notify(db, uid, user, f"ECN released — acknowledge: {ecn.ecn_number}", message, "design_ecn_implemented", _NOTIFY_ENTITY, ecn.id)
        elif dept != "project":
            broadcast_notification(db, f"Engineering change released: {ecn.ecn_number}", message, "design_ecn_implemented",
                                   _NOTIFY_ENTITY, ecn.id, exclude_user_id=user.id, app_name=ACK_APPS[dept])
    notify(
        db, ecn.created_by_id, user, f"ECN implemented: {ecn.ecn_number}",
        f"{user_name(user)} marked {ecn.ecn_number} implemented ({changed}).",
        "design_ecn_implemented", _NOTIFY_ENTITY, ecn.id,
    )
    if ecn.pm_project_id and not named.get("project"):
        pm = db.query(PmProject).filter(PmProject.id == ecn.pm_project_id).first()
        manager_id = pm.project_manager_id if pm else None
        notify(db, manager_id, user, f"Engineering change on your project: {ecn.ecn_number}",
               f"{ecn.ecn_number} ({ecn.title}) is released for {pm.project_code if pm else 'your project'} — revisions: {changed}. Effective {effect}.",
               "design_ecn_implemented", _NOTIFY_ENTITY, ecn.id)
    # CC01/ECM: revise the Production BOM (draft, with the ECN's effectivity)
    # and flag open work orders on the old structure.
    from app.modules.production.ecm import on_ecn_implemented
    pp_notes = on_ecn_implemented(db, ecn, user)
    if pp_notes:
        add_event(db, "ecn_production_update", user, ecn_id=ecn.id, comment="Production: " + "; ".join(pp_notes)[:1900])
    # Role-based notices (core/events/design.py); named acknowledgers and the raiser were told above.
    from app.modules.design.events import notify_design_event
    told = {uid for ids in named.values() for uid in (ids or [])} | {ecn.created_by_id}
    reached = notify_design_event(
        db, background_tasks, "ecn_acknowledgement_needed", ecn, entity_type=_NOTIFY_ENTITY, actor=user,
        title=f"ECN released — acknowledge: {ecn.ecn_number}",
        message=f"{ecn.ecn_number} ({ecn.title}) is released — new controlled revisions: {changed}. Effective {effect}. {disposition} "
                "Acknowledge it for your department on the ECN.",
        skip=told,
    )
    notify_design_event(
        db, background_tasks, "ecn_released", ecn, entity_type=_NOTIFY_ENTITY, actor=user,
        title=f"Engineering change released: {ecn.ecn_number}",
        message=f"{user_name(user)} released {ecn.ecn_number} ({ecn.title}) — new controlled revisions: {changed}. Effective {effect}.",
        skip=told | reached,
    )
    db.commit()
    return _detail(db, ecn, user)


@router.post("/{ecn_id}/cancel", response_model=DesignChangeNoticeDetail)
async def cancel_change_notice(
    ecn_id: int,
    payload: DesignChangeNoticeCancelPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    ecn = _get_ecn(db, ecn_id, lock=True, user=user)
    ensure(check_ecn_cancel(user, ecn, head=is_head(db, user), **_cancel_refs(db, ecn)))
    was_submitted = ecn.status == "submitted"
    req = pending_request(db, ECN_ENTITY, ecn.id) if was_submitted else None
    if req is not None:
        # Close the live approval request first (it notifies the approver).
        engine.cancel_for_entity(db, ECN_ENTITY, ecn.id, user, payload.reason.strip())
        was_submitted = False
    ecn.status = "cancelled"
    ecn.cancelled_at = utcnow()
    ecn.cancel_reason = payload.reason.strip()
    add_event(db, "ecn_cancelled", user, ecn_id=ecn.id, comment=ecn.cancel_reason)
    if was_submitted:
        notify(
            db, ecn.approver_id, user, f"ECN cancelled: {ecn.ecn_number}",
            f"{user_name(user)} cancelled {ecn.ecn_number} — no decision is needed from you.",
            "design_ecn_cancelled", _NOTIFY_ENTITY, ecn.id,
        )
    db.commit()
    return _detail(db, ecn, user)


@router.post("/{ecn_id}/comments", response_model=DesignChangeNoticeDetail)
async def comment_change_notice(
    ecn_id: int,
    payload: DesignCommentPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    ecn = _get_ecn(db, ecn_id, user=user)
    add_event(db, "comment", user, ecn_id=ecn.id, comment=payload.comment)
    db.commit()
    return _detail(db, ecn, user)


@router.delete("/{ecn_id}")
async def delete_change_notice(
    ecn_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    ecn = _get_ecn(db, ecn_id, lock=True, user=user)
    ensure_can_delete(user, ecn, "design", "change_notices", what="change notice")
    ensure(check_ecn_delete(user, ecn))
    ecn.is_deleted = True
    ecn.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"{ecn.ecn_number} deleted"}


@router.patch("/{ecn_id}/effectivity", response_model=DesignChangeNoticeDetail)
async def update_effectivity(
    ecn_id: int,
    payload: DesignEcnEffectivityPayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    """Effectivity and stock/WIP disposition — settable until release."""
    ensure_design_feature(user, "change_notices", "ecn_effectivity", "edit")
    ecn = _get_ecn(db, ecn_id, lock=True, user=user)
    if ecn.status not in ("draft", "submitted", "approved"):
        raise HTTPException(status_code=409, detail=f"{ecn.ecn_number} is {ecn.status} — effectivity is fixed once the ECN is released.")
    if not (is_head(db, user) or user.id in (ecn.created_by_id, ecn.approver_id)):
        raise HTTPException(status_code=403, detail=f"Only the Design head, the person who raised {ecn.ecn_number} or its approver can change its effectivity.")
    changes = payload.model_dump(exclude_unset=True)
    _validate_fields(changes)
    for key, value in changes.items():
        if value is not None or key in ("effectivity_date", "effectivity_serial", "effectivity_note", "disposition_note", "target_date"):
            setattr(ecn, key, value)
    add_event(db, "ecn_effectivity_updated", user, ecn_id=ecn.id)
    db.commit()
    return _detail(db, ecn, user)


@router.post("/{ecn_id}/acknowledge", response_model=DesignChangeNoticeDetail)
async def acknowledge_change_notice(
    ecn_id: int,
    payload: DesignEcnAcknowledgePayload,
    db: Session = Depends(get_db),
    user: User = Depends(require_app_access("design")),
):
    """A department confirms it has acted on the released ECN; the last
    acknowledgement closes it."""
    ensure_design_feature(user, "change_notices", "ecn_acknowledge", "submit")
    ecn = _get_ecn(db, ecn_id, lock=True, user=user)
    ack = next((a for a in ecn.acknowledgements if a.department == payload.department), None)
    if not ack:
        raise HTTPException(status_code=400, detail=f"{ecn.ecn_number} isn't waiting on '{payload.department}' — nothing to acknowledge.")
    if ack.acknowledged_at:
        raise HTTPException(status_code=409, detail=f"{ACK_LABELS.get(ack.department, ack.department)} already acknowledged {ecn.ecn_number}.")
    if not can_acknowledge(db, user, ack.department):
        raise HTTPException(
            status_code=403,
            detail=f"You can't acknowledge {ecn.ecn_number} for {ACK_LABELS.get(ack.department, ack.department)} — "
                   "that's for the people named in Design › Settings (or holders of that department's app).",
        )
    ack.acknowledged_by_id, ack.acknowledged_at = user.id, utcnow()
    ack.remarks = (payload.remarks or "").strip() or None
    add_event(db, "ecn_acknowledged", user, ecn_id=ecn.id, comment=f"{ACK_LABELS.get(ack.department, ack.department)}" + (f": {ack.remarks}" if ack.remarks else ""))
    if all(a.acknowledged_at for a in ecn.acknowledgements):
        ecn.status = "closed"
        ecn.closed_at = utcnow()
        add_event(db, "ecn_closed", user, ecn_id=ecn.id, comment="All departments acknowledged")
        notify(db, ecn.created_by_id, user, f"ECN closed: {ecn.ecn_number}",
               f"Every department acknowledged {ecn.ecn_number}; it is closed.", "design_ecn_closed", _NOTIFY_ENTITY, ecn.id)
    db.commit()
    return _detail(db, ecn, user)
