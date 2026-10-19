import re

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.permissions import ensure_can_delete, ensure_tab_action, require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.services.plant_access import is_unrestricted_user
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
    elif kind in _FIXED_KINDS:
        _heal_fixed_kind(db, kind, q.all())
    if active_only:
        q = q.filter(StoreDocType.is_active.is_(True))
    rows = q.order_by(StoreDocType.id).all()
    if kind in _FIXED_KINDS:
        # Fixed lists show in their code order (e.g. the Issue Type dropdown).
        order = {d["value"]: i for i, d in enumerate(STORE_DOC_TYPE_DEFAULTS[kind])}
        rows.sort(key=lambda t: order.get(t.value, len(order)))
    return rows


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


# Which Store › Settings tab manages each list. Return sources / conditions
# are fixed in code (only renamed by an admin) and have no tab of their own —
# they fall under Store › Settings › General settings.
_KIND_TAB = {"stock_entry": "entry_types", "issue": "issue_types", "return_source": "settings", "return_condition": "settings"}


def _ensure_kind_action(user: User, kind: str, action: str) -> None:
    tab = _KIND_TAB[kind]
    if tab == "settings":
        ensure_tab_action(user, "store", "settings", "edit")
    elif action == "create":
        ensure_tab_action(user, "store", tab, "create")
    else:
        ensure_tab_action(user, "store", tab, "edit")


def _ensure_editable_kind(kind: str) -> None:
    """Stock entry types are history only since Record Stock Entry was removed
    (2026-10-12) — kept so old entries show their labels, never changed."""
    if kind == "stock_entry":
        raise HTTPException(status_code=410, detail="Stock entry types can't be added or changed any more — Record Stock Entry was "
                                                    "removed (every stock movement has its own document). The existing names stay "
                                                    "only so older entries keep their labels.")


def _check_kind(kind: str) -> None:
    if kind not in STORE_DOC_TYPE_KINDS:
        raise HTTPException(status_code=404, detail=f"Unknown type list '{kind}'. Valid lists: {', '.join(STORE_DOC_TYPE_KINDS)}.")


# Return sources and conditions drive Material Return approvals (C-09): the
# list, each row's approval rule, stock effect and "needs an issue" flag are
# fixed in code. An admin may only rename a row. Who approves a return is no
# longer set here: the rule became the default stages of the central workflow
# "store.material_return" (Organization › Approval Workflows › Material
# return), which an admin edits there — incl. the designated approvers of
# "Rejected (quality)" that used to be named on this row.
_FIXED_KINDS = ("return_source", "return_condition", "issue")


def _heal_fixed_kind(db: Session, kind: str, rows: list[StoreDocType]) -> None:
    """Return sources/conditions are fixed in code (C-09), but databases
    configured before the lock may hold weakened rows — a default switched to
    "no approval" or turned off, or extra custom rows with no approval. Each
    load puts the code defaults back (approval rule, "needs an issue",
    active) and switches off rows that aren't in the code list, so the
    approval bypass can't survive in old data. Labels and the named
    approvers of a "Specific users" row stay as the admin set them; switched-
    off custom rows still resolve to their label on old documents."""
    defaults = {d["value"]: d for d in STORE_DOC_TYPE_DEFAULTS[kind]}
    changed = False
    for t in rows:
        d = defaults.get(t.value)
        if d is None:
            if t.is_active:
                t.is_active, changed = False, True
            continue
        rule = d.get("approver_rule", "none")
        need_issue = bool(d.get("requires_issue", False))
        if t.approver_rule != rule:
            t.approver_rule, changed = rule, True
            if rule != "specific_users" and t.approver_user_ids:
                t.approver_user_ids = []
        if kind == "return_source" and bool(t.requires_issue) != need_issue:
            t.requires_issue, changed = need_issue, True
        if not t.is_active:
            t.is_active, changed = True, True
    present = {t.value for t in rows}
    for value, d in defaults.items():
        if value not in present:
            db.add(StoreDocType(kind=kind, approver_user_ids=[], **d))
            changed = True
    if changed:
        db.commit()


def _fixed_kind_error(kind: str) -> HTTPException:
    return HTTPException(
        status_code=409,
        detail=f"{KIND_LABELS[kind].capitalize()}s are fixed in code and can't be added, switched off or changed here — only renamed. "
               + ("Who approves a Material Return is set in Organization › Approval Workflows › Material return." if kind != "issue"
                  else "Extra mandatory fields per type (vendor, return date, challan) are set in Store › Settings › Issue Rules."),
    )


def _guard_fixed_kind_update(kind: str, user: User, payload: DocTypeIn, current: StoreDocType) -> None:
    if kind not in _FIXED_KINDS:
        return
    if not is_unrestricted_user(user):
        raise _fixed_kind_error(kind)
    if (payload.approver_rule != current.approver_rule
            or payload.is_active != current.is_active
            or (kind == "return_source" and bool(payload.requires_issue) != bool(current.requires_issue))):
        raise _fixed_kind_error(kind)
    if sorted(set(payload.approver_user_ids or [])) != sorted(set(current.approver_user_ids or [])):
        raise HTTPException(
            status_code=409,
            detail="Material Return approvers are now set in Organization › Approval Workflows › Material return "
                   "(edit the stage of this condition there). Only the name can be changed here.",
        )


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


# Listing stays open to every Store user: the Stock / Issue / Return forms
# read these lists to offer their type dropdowns.
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
    user: User = Depends(require_app_access("store")),
):
    _check_kind(kind)
    if kind in _FIXED_KINDS:
        raise _fixed_kind_error(kind)
    _ensure_kind_action(user, kind, "create")
    _ensure_editable_kind(kind)
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
    user: User = Depends(require_app_access("store")),
):
    """Edits label / approval / active flag. The stored value never changes,
    so documents already using this type keep resolving to it."""
    _check_kind(kind)
    if kind in _FIXED_KINDS and not is_unrestricted_user(user):
        raise _fixed_kind_error(kind)
    doc_types(db, kind)
    t = db.query(StoreDocType).filter(StoreDocType.kind == kind, StoreDocType.value == value).first()
    if not t:
        raise HTTPException(status_code=404, detail=f"That {KIND_LABELS[kind]} wasn't found — reload the page and try again.")
    _guard_fixed_kind_update(kind, user, payload, t)
    _ensure_kind_action(user, kind, "edit")
    _ensure_editable_kind(kind)
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
    user: User = Depends(require_app_access("store")),
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
    if kind == "issue":
        raise _fixed_kind_error(kind)
    if kind != "stock_entry":
        raise HTTPException(status_code=409, detail=f"A {noun} can't be deleted — deactivate it instead (Edit → untick Active).")
    doc_types(db, kind)
    t = db.query(StoreDocType).filter(StoreDocType.kind == kind, StoreDocType.value == value).first()
    if not t:
        raise HTTPException(status_code=404, detail=f"That {noun} wasn't found — it may already be deleted. Reload the page.")
    ensure_can_delete(user, t, "store", _KIND_TAB[kind], what=noun)
    _ensure_editable_kind(kind)
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
