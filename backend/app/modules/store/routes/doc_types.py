import re

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.models.doc_type import (
    STORE_APPROVER_RULES,
    STORE_DOC_TYPE_DEFAULTS,
    STORE_DOC_TYPE_EFFECTS,
    STORE_DOC_TYPE_KINDS,
    StoreDocType,
)

router = APIRouter(prefix="/store/doc-types", tags=["Store"])

KIND_LABELS = {
    "stock_entry": "stock entry type",
    "issue": "issue type",
    "return_source": "return source type",
    "return_condition": "return condition",
}
EFFECT_LABELS = {"in": "Stock in", "out": "Stock out", "usable": "Usable stock", "quarantine": "Quarantine"}


class DocTypeIn(BaseModel):
    label: str
    stock_effect: str | None = None
    requires_issue: bool = False
    approver_rule: str = "none"
    approver_user_ids: list[int] = []
    is_active: bool = True


def doc_types(db: Session, kind: str, active_only: bool = False) -> list[StoreDocType]:
    """All rows of one kind, seeding the defaults on an empty kind (fresh
    DBs built without the migration, e.g. tests)."""
    q = db.query(StoreDocType).filter(StoreDocType.kind == kind)
    if not q.first():
        db.add_all([StoreDocType(kind=kind, approver_user_ids=[], **d) for d in STORE_DOC_TYPE_DEFAULTS[kind]])
        db.commit()
    if active_only:
        q = q.filter(StoreDocType.is_active.is_(True))
    return q.order_by(StoreDocType.id).all()


def get_doc_type(db: Session, kind: str, value: str | None, *, field: str) -> StoreDocType:
    """Resolves a submitted value to its active master row, or raises a 422
    that lists the valid choices and where to add a new one."""
    rows = doc_types(db, kind, active_only=True)
    if not value:
        raise HTTPException(status_code=422, detail=f"Choose a {field}: {', '.join(r.label for r in rows)}.")
    match = next((r for r in rows if r.value == value), None)
    if not match:
        raise HTTPException(
            status_code=422,
            detail=f"'{value}' isn't a valid {field}. Choose one of: {', '.join(r.label for r in rows)} — or add it under Store → Settings.",
        )
    return match


def doc_type_labels(db: Session, kind: str) -> dict[str, str]:
    return {r.value: r.label for r in doc_types(db, kind)}


def _to_dict(db: Session, t: StoreDocType) -> dict:
    ids = t.approver_user_ids or []
    users = db.query(User).filter(User.id.in_(ids)).all() if ids else []
    return {
        "value": t.value, "label": t.label, "stock_effect": t.stock_effect,
        "requires_issue": t.requires_issue, "approver_rule": t.approver_rule,
        "approver_user_ids": ids,
        "approver_names": [u.name or u.email for u in users],
        "is_active": t.is_active,
    }


def _check_kind(kind: str) -> None:
    if kind not in STORE_DOC_TYPE_KINDS:
        raise HTTPException(status_code=404, detail=f"Unknown type list '{kind}'. Valid lists: {', '.join(STORE_DOC_TYPE_KINDS)}.")


def _clean(db: Session, kind: str, payload: DocTypeIn, current: StoreDocType | None = None) -> dict:
    noun = KIND_LABELS[kind]
    label = payload.label.strip()
    if not label:
        raise HTTPException(status_code=400, detail=f"Enter the {noun} name.")
    if len(label) > 100:
        raise HTTPException(status_code=400, detail=f"The {noun} name is too long — keep it to 100 characters or fewer.")
    dup = db.query(StoreDocType).filter(StoreDocType.kind == kind, func.lower(StoreDocType.label) == label.lower())
    if current:
        dup = dup.filter(StoreDocType.id != current.id)
    if dup.first():
        raise HTTPException(status_code=409, detail=f"A {noun} named '{label}' already exists — edit that one instead.")

    effects = STORE_DOC_TYPE_EFFECTS.get(kind)
    effect = None
    if effects:
        if current and payload.stock_effect != current.stock_effect:
            # Changing direction would silently re-interpret every document
            # already posted with this type — make a new type instead.
            raise HTTPException(
                status_code=409,
                detail=f"The stock effect of '{current.label}' can't be changed once created — existing documents were posted with it. Deactivate it and add a new {noun} instead.",
            )
        if payload.stock_effect not in effects:
            raise HTTPException(status_code=400, detail=f"Choose what this {noun} does to stock: {' or '.join(EFFECT_LABELS[e] for e in effects)}.")
        effect = payload.stock_effect

    rule, user_ids = "none", []
    if kind in ("return_source", "return_condition"):
        if payload.approver_rule not in STORE_APPROVER_RULES:
            raise HTTPException(status_code=400, detail=f"Approval must be one of: {', '.join(STORE_APPROVER_RULES)}.")
        rule = payload.approver_rule
        if rule == "specific_users":
            user_ids = sorted(set(payload.approver_user_ids))
            if not user_ids:
                raise HTTPException(status_code=400, detail="Pick at least one approver for 'Specific users' (e.g. the QC in-charge).")
            found = {u.id for u in db.query(User).filter(User.id.in_(user_ids), User.is_active.is_(True)).all()}
            if missing := [i for i in user_ids if i not in found]:
                raise HTTPException(status_code=400, detail=f"Approver user(s) {missing} not found or inactive — pick active users.")

    return {
        "label": label, "stock_effect": effect,
        "requires_issue": payload.requires_issue if kind == "return_source" else False,
        "approver_rule": rule, "approver_user_ids": user_ids,
    }


@router.get("/{kind}")
async def list_doc_types(
    kind: str,
    include_inactive: bool = Query(False),
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    _check_kind(kind)
    return [_to_dict(db, t) for t in doc_types(db, kind, active_only=not include_inactive)]


@router.post("/{kind}")
async def create_doc_type(
    kind: str,
    payload: DocTypeIn,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    _check_kind(kind)
    doc_types(db, kind)
    fields = _clean(db, kind, payload)
    value = re.sub(r"[^a-z0-9]+", "_", fields["label"].lower()).strip("_")[:45] or "type"
    base, n = value, 2
    while db.query(StoreDocType.id).filter(StoreDocType.kind == kind, StoreDocType.value == value).first():
        value, n = f"{base}_{n}", n + 1
    t = StoreDocType(kind=kind, value=value, is_active=True, **fields)
    db.add(t)
    db.commit()
    return _to_dict(db, t)


@router.put("/{kind}/{value}")
async def update_doc_type(
    kind: str,
    value: str,
    payload: DocTypeIn,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    """Edits label / approval / active flag. The stored value never changes,
    so documents already using this type keep resolving to it."""
    _check_kind(kind)
    doc_types(db, kind)
    t = db.query(StoreDocType).filter(StoreDocType.kind == kind, StoreDocType.value == value).first()
    if not t:
        raise HTTPException(status_code=404, detail=f"That {KIND_LABELS[kind]} wasn't found — reload the page and try again.")
    fields = _clean(db, kind, payload, t)
    if not payload.is_active and t.is_active:
        others = db.query(StoreDocType).filter(StoreDocType.kind == kind, StoreDocType.is_active.is_(True), StoreDocType.id != t.id).count()
        if not others:
            raise HTTPException(status_code=409, detail=f"'{t.label}' is the only active {KIND_LABELS[kind]} — add another before deactivating it.")
    for k, v in fields.items():
        setattr(t, k, v)
    t.is_active = payload.is_active
    db.commit()
    return _to_dict(db, t)


@router.delete("/{kind}/{value}")
async def delete_doc_type(
    kind: str,
    value: str,
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("store")),
):
    """Removes a stock entry / issue type that no document has used yet. One
    that's been used keeps existing (old documents show its label) — it can
    only be deactivated."""
    from app.modules.store.models.material_issue import StoreMaterialIssue
    from app.modules.store.models.setting import (
        STORE_SETTING_CHALLAN_RULES, STORE_SETTING_RETURN_DATE_ISSUE_TYPES, STORE_SETTING_VENDOR_ISSUE_TYPES, StoreSetting,
    )
    from app.modules.store.models.stock_transaction import StoreStockTransaction

    _check_kind(kind)
    noun = KIND_LABELS[kind]
    if kind not in ("stock_entry", "issue"):
        raise HTTPException(status_code=409, detail=f"A {noun} can't be deleted — deactivate it instead (Edit → untick Active).")
    doc_types(db, kind)
    t = db.query(StoreDocType).filter(StoreDocType.kind == kind, StoreDocType.value == value).first()
    if not t:
        raise HTTPException(status_code=404, detail=f"That {noun} wasn't found — it may already be deleted. Reload the page.")
    if kind == "stock_entry":
        used, where = db.query(StoreStockTransaction).filter(StoreStockTransaction.entry_type == t.value).count(), "stock entr(ies)"
    else:
        used, where = db.query(StoreMaterialIssue).filter(StoreMaterialIssue.issue_type == t.value).count(), "material issue(s)"
    if used:
        raise HTTPException(status_code=409, detail=f"'{t.label}' can't be deleted — {used} {where} already use it and still show its name. Deactivate it instead (Edit → untick Active) so it's no longer offered.")
    if t.is_active and db.query(StoreDocType).filter(StoreDocType.kind == kind, StoreDocType.is_active.is_(True), StoreDocType.id != t.id).count() == 0:
        raise HTTPException(status_code=409, detail=f"'{t.label}' is the only active {noun} — add another before deleting it.")

    if kind == "issue":
        # Drop it from Issue Rules too, so the rules page doesn't keep a ghost tick.
        for key in (STORE_SETTING_CHALLAN_RULES, STORE_SETTING_VENDOR_ISSUE_TYPES, STORE_SETTING_RETURN_DATE_ISSUE_TYPES):
            row = db.query(StoreSetting).filter(StoreSetting.key == key).first()
            if not row or not row.value:
                continue
            if isinstance(row.value, dict):
                row.value = {**row.value, "issue_types": [v for v in row.value.get("issue_types", []) if v != t.value]}
            else:
                row.value = [v for v in row.value if v != t.value]
    db.delete(t)
    db.commit()
    return {"deleted": value}
