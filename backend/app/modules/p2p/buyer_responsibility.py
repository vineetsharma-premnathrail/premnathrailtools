"""Buyer responsibility (2026-11-06): which buyer owns which Item Master category.

Procurement > Settings > Buyer responsibility. One category has exactly one
buyer; one buyer may own many categories. Only top-level Item Master
categories (parent_id NULL) take a buyer. The map is one module_settings row
(module_key "p2p", key "buyer_responsibility", value {"<category_id>": user_id}),
kept outside the generic settings list like the Purpose rules, so no migration.

A requisition line's buyer is resolved by resolve_line_buyer_id() in
p2p/models/p2p_request.py: the buyer of the item's category, else the buyer of
the item type (Settings > Buyer for each item type), else the "Default buyer"
setting, else nobody (the requisition's main buyer then applies)."""
from __future__ import annotations

from typing import Any

from sqlalchemy import event
from sqlalchemy.orm import Session

from app.modules.main.models.module_setting import ModuleSetting
from app.modules.main.models.user import User
from app.modules.store.models.category import StoreItemCategory
from app.modules.store.models.item import STORE_ITEM_TYPE_LABELS, StoreItem, StoreItemType

MAP_KEY = "buyer_responsibility"
BUYER_APPS = ("p2p", "purchase")  # same rule as the "Buyer for each item type" settings


class BuyerResponsibilityError(ValueError):
    """A save the user must fix; the message says what and how."""


class BuyerResponsibilityConflict(Exception):
    """Someone else saved buyer responsibility after this editor loaded it."""

    def __init__(self) -> None:
        super().__init__("Someone else just changed buyer responsibility — reload and make your change again.")


# ------------------------------------------------------------------ storage

def _row(db: Session) -> ModuleSetting | None:
    return db.query(ModuleSetting).filter(
        ModuleSetting.module_key == "p2p", ModuleSetting.branch_id.is_(None), ModuleSetting.key == MAP_KEY).first()


def _as_map(value: Any) -> dict[int, int]:
    out: dict[int, int] = {}
    if isinstance(value, dict):
        for k, v in value.items():
            try:
                out[int(k)] = int(v)
            except (TypeError, ValueError):
                continue  # a damaged entry is ignored, never a crash on a PR
    return out


def load_map(db: Session) -> dict[int, int]:
    """Saved category_id -> buyer user_id, exactly as stored (not filtered)."""
    row = _row(db)
    return _as_map(row.value) if row is not None else {}


def is_buyer(user: User) -> bool:
    return bool(set(BUYER_APPS) & set(user.get_apps()))


def eligible_buyers(db: Session) -> list[User]:
    users = db.query(User).filter(User.is_active.is_(True)).all()
    return sorted((u for u in users if is_buyer(u)), key=lambda u: ((u.name or u.email or "").lower(), u.id))


# --------------------------------------------------------------- resolution

_CTX_KEY = "p2p_buyer_responsibility_ctx"


def _context(db: Session) -> dict:
    """Top-level active categories, the saved map and the active owners, loaded
    once per database session (a 30-line requisition would otherwise load them
    30 times). Dropped on commit / rollback and when the map is saved."""
    ctx = db.info.get(_CTX_KEY)
    if ctx is None:
        saved = load_map(db)
        rows = db.query(StoreItemCategory).filter(
            StoreItemCategory.parent_id.is_(None), StoreItemCategory.is_active.is_(True)).order_by(StoreItemCategory.id).all()
        active = {u.id for u in db.query(User).filter(User.is_active.is_(True), User.id.in_(set(saved.values()))).all()} if saved else set()
        ctx = {"cats": [(c.id, (c.name or "").strip().lower(), (c.code or "").strip().lower(), (c.item_type or "").strip().lower())
                        for c in rows], "map": saved, "active": active}
        db.info[_CTX_KEY] = ctx
    return ctx


def _drop_context(session: Session, *_args) -> None:
    session.info.pop(_CTX_KEY, None)


event.listen(Session, "after_commit", _drop_context)
event.listen(Session, "after_rollback", _drop_context)


def _find_category_id(ctx: dict, category: str | None, item_type: str | None) -> int | None:
    """The top-level category an item's category text points at: matched on name
    or code, case-insensitive; the one of the item's own type wins, then one
    for every type, then any."""
    text = (category or "").strip().lower()
    if not text:
        return None
    hits = [c for c in ctx["cats"] if c[1] == text or c[2] == text]
    if not hits:
        return None
    t = (item_type or "").strip().lower()

    def rank(c: tuple) -> int:
        if t and c[3] == t:
            return 0
        return 1 if not c[3] else 2
    return sorted(hits, key=lambda c: (rank(c), c[0]))[0][0]


def category_buyer_id(db: Session, category: str | None = None, item_type: str | None = None,
                      item_id: int | None = None) -> int | None:
    """Active buyer who owns the item's category, or None. The category comes
    from the Item Master item when item_id is given (its own type and category),
    else from the text passed in."""
    if item_id:
        item = db.get(StoreItem, item_id)
        if item is not None:
            category = category or item.category
            item_type = item_type or item.item_type
    ctx = _context(db)
    cid = _find_category_id(ctx, category, item_type)
    uid = ctx["map"].get(cid) if cid is not None else None
    return uid if uid and uid in ctx["active"] else None


def buyer_duties(db: Session, user_id: int) -> dict:
    """What a person is buyer of: category names (Buyer responsibility), item
    type labels (Buyer for each item type) and whether they are the Default
    buyer. Used by the HR exit checklist."""
    from app.modules.p2p.settings import get_setting
    mine = [cid for cid, uid in load_map(db).items() if uid == user_id]
    cats = db.query(StoreItemCategory).filter(StoreItemCategory.id.in_(mine), StoreItemCategory.is_active.is_(True)).all() if mine else []
    labels = _type_labels(db)
    types = [labels.get(t, t) if t != "other" else "other-type"
             for t in ("material", "consumable", "tool_equipment", "service", "asset", "other")
             if get_setting(db, f"buyer_type_{t}") == user_id]
    return {"categories": sorted(c.name for c in cats), "item_types": types,
            "default": get_setting(db, "default_buyer") == user_id}


# ------------------------------------------------------------------ reading

def _type_labels(db: Session) -> dict[str, str]:
    labels = dict(STORE_ITEM_TYPE_LABELS)
    for t in db.query(StoreItemType).all():
        labels[t.value] = t.label
    return labels


def _version_of(saved: dict[int, int]) -> str:
    import hashlib
    import json
    return hashlib.sha1(json.dumps(_jsonable(saved), sort_keys=True).encode("utf-8")).hexdigest()[:16]


def current_version(db: Session) -> str:
    """A fingerprint of the saved map. A PUT may send it back as "version" so an
    editor who loaded an older map is refused instead of overwriting a change."""
    return _version_of(load_map(db))


def build_payload(db: Session, can_edit: bool) -> dict:
    cats = db.query(StoreItemCategory).filter(
        StoreItemCategory.parent_id.is_(None), StoreItemCategory.is_active.is_(True)).order_by(
        StoreItemCategory.code, StoreItemCategory.id).all()
    saved = load_map(db)
    buyers = eligible_buyers(db)
    active_ids = {u.id for u in db.query(User).filter(User.is_active.is_(True), User.id.in_(set(saved.values()))).all()} if saved else set()
    labels = _type_labels(db)
    names = {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(set(saved.values()))).all()} if saved else {}
    owner = {c.id: saved[c.id] for c in cats if saved.get(c.id) in active_ids}
    by_buyer: dict[int, list[int]] = {}
    for c in cats:
        if c.id in owner:
            by_buyer.setdefault(owner[c.id], []).append(c.id)
    return {
        "buyers": [{"user_id": uid, "user_name": names.get(uid), "category_ids": ids}
                   for uid, ids in sorted(by_buyer.items(), key=lambda kv: ((names.get(kv[0]) or "").lower(), kv[0]))],
        "categories": [{"id": c.id, "code": c.code, "name": c.name, "item_type": c.item_type,
                        "item_type_label": labels.get(c.item_type, (c.item_type or "").replace("_", " ").capitalize()) if c.item_type else None,
                        "buyer_id": owner.get(c.id)} for c in cats],
        "unassigned_category_ids": [c.id for c in cats if c.id not in owner],
        "eligible_buyers": [{"id": u.id, "name": u.name or u.email} for u in buyers],
        "can_edit": can_edit,
        "version": current_version(db),
    }


# ------------------------------------------------------------------ writing

def _int(value: Any, what: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        raise BuyerResponsibilityError(f"{what} must be a number — reload the page and try again.")
    try:
        f = float(value)
    except ValueError:
        raise BuyerResponsibilityError(f"{what} must be a number — reload the page and try again.") from None
    if not f.is_integer():
        raise BuyerResponsibilityError(f"{what} must be a whole number — reload the page and try again.")
    return int(f)


def validate(db: Session, body: Any) -> dict[int, int]:
    """Body {"buyers": [{"user_id", "category_ids"}]} -> clean category_id -> user_id.
    Raises BuyerResponsibilityError (message = reason + how to fix) and saves nothing."""
    if not isinstance(body, dict) or not isinstance(body.get("buyers"), list):
        raise BuyerResponsibilityError('Send the buyers as {"buyers": [{"user_id": 1, "category_ids": [2, 3]}]} — '
                                       "check the request body.")
    per_buyer: dict[int, list[int]] = {}
    for n, entry in enumerate(body["buyers"], start=1):
        if not isinstance(entry, dict) or "user_id" not in entry:
            raise BuyerResponsibilityError(f"Buyer row {n} has no user_id — pick the buyer for each row.")
        uid = _int(entry["user_id"], f"Buyer row {n}: user_id")
        cids = entry.get("category_ids") or []
        if not isinstance(cids, list):
            raise BuyerResponsibilityError(f"Buyer row {n}: category_ids must be a list of category numbers.")
        bucket = per_buyer.setdefault(uid, [])
        for c in cids:
            cid = _int(c, f"Buyer row {n}: category")
            if cid not in bucket:
                bucket.append(cid)

    users = {u.id: u for u in db.query(User).filter(User.id.in_(list(per_buyer))).all()} if per_buyer else {}
    for uid in per_buyer:
        u = users.get(uid)
        if u is None:
            raise BuyerResponsibilityError(f"User #{uid} does not exist — pick the buyer from the list.")
        if not u.is_active:
            raise BuyerResponsibilityError(f"{u.name} is deactivated — pick an active buyer, or reactivate them in Users first.")
        if not is_buyer(u):
            raise BuyerResponsibilityError(
                f"{u.name} has no access to Procurement or Purchase — pick a buyer who does, or give them the module in Users first.")

    all_ids = sorted({cid for ids in per_buyer.values() for cid in ids})
    cats = {c.id: c for c in db.query(StoreItemCategory).filter(StoreItemCategory.id.in_(all_ids)).all()} if all_ids else {}
    clean: dict[int, int] = {}
    for uid, ids in per_buyer.items():
        for cid in ids:
            c = cats.get(cid)
            who = users[uid].name
            if c is None:
                raise BuyerResponsibilityError(
                    f"Category #{cid} (given to {who}) does not exist — reload the page and pick from the category list.")
            if c.parent_id is not None:
                raise BuyerResponsibilityError(
                    f"{c.name} ({c.code}) is a sub-category — a buyer is picked for the main category above it. Remove it from {who}.")
            if not c.is_active:
                raise BuyerResponsibilityError(
                    f"{c.name} ({c.code}) is inactive — remove it from {who}, or make the category active again in the Store item categories.")
            if cid in clean:
                other = users[clean[cid]].name
                raise BuyerResponsibilityError(f"{c.name} is with both {other} and {who} — keep it with one buyer.")
            clean[cid] = uid
    return clean


def _jsonable(m: dict[int, int]) -> dict[str, int]:
    return {str(k): m[k] for k in sorted(m)}


def save(db: Session, user: User, clean: dict[int, int], expected_version: str | None = None) -> bool:
    """Replace the saved map with `clean` and audit the change. Returns whether
    anything changed. The caller commits. The row is locked while saving, so two
    editors never write at once; when the editor sent the version it loaded and
    the map has changed since, BuyerResponsibilityConflict is raised."""
    import json

    from app.modules.main.models.audit_log import AuditLog

    row = db.query(ModuleSetting).filter(
        ModuleSetting.module_key == "p2p", ModuleSetting.branch_id.is_(None), ModuleSetting.key == MAP_KEY
    ).with_for_update().first()
    if expected_version is not None:
        if _version_of(_as_map(row.value) if row is not None else {}) != expected_version:
            raise BuyerResponsibilityConflict()
    old = _as_map(row.value) if row is not None else {}
    if old == clean:
        return False
    new_json = _jsonable(clean)
    _drop_context(db)
    if row is None:
        row = ModuleSetting(module_key="p2p", key=MAP_KEY, branch_id=None, value=new_json, updated_by_id=user.id)
        db.add(row)
    else:
        row.value = new_json
        row.updated_by_id = user.id
    db.flush()
    cat_names = {c.id: c.name for c in db.query(StoreItemCategory).filter(StoreItemCategory.id.in_(set(old) | set(clean))).all()}
    user_names = {u.id: (u.name or u.email) for u in db.query(User).filter(User.id.in_(set(old.values()) | set(clean.values()))).all()}
    changes = []
    for cid in sorted(set(old) | set(clean), key=lambda i: (cat_names.get(i) or "").lower()):
        if old.get(cid) != clean.get(cid):
            was = user_names.get(old.get(cid)) if old.get(cid) else "no buyer"
            now = user_names.get(clean.get(cid)) if clean.get(cid) else "no buyer"
            changes.append(f"{cat_names.get(cid, f'category #{cid}')}: {was} -> {now}")
    db.add(AuditLog(
        entity_type="module_setting", entity_id=row.id, action="updated", field_name=MAP_KEY,
        old_value=json.dumps(_jsonable(old), ensure_ascii=False), new_value=json.dumps(new_json, ensure_ascii=False),
        summary=f"Buyer responsibility changed: {'; '.join(changes)}"[:900],
        performed_by_id=getattr(user, "id", None), module_key="p2p", subtab_key="settings"))
    return True
