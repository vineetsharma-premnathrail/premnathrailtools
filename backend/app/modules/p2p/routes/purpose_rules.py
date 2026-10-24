"""Procurement > Settings > Purpose rules: GET / PUT / reset of what the
Purchase Requisition form offers and locks for each purpose (category,
requirement type, item types, Charged To, line project mode).

The code defaults live in app/modules/p2p/purpose.py; a saved rule is one
module_settings row per purpose (key "purpose_rules.<purpose>"). A rule equal to
the default deletes the row so later changes to the code defaults stay live.
Reading needs View on Procurement > Settings; saving needs the same explicit
Settings > Edit grant as every other settings save. Every change is audited."""
import json
from datetime import datetime

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.permissions import ensure_tab_action
from app.core.settings_framework import can_edit_settings
from app.db.session import get_db
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.module_setting import ModuleSetting
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.p2p import purpose as pr_purpose
from app.modules.p2p.models.p2p_request import P2P_CATEGORIES, P2P_PURPOSES, P2P_REQUIREMENT_TYPES

router = APIRouter(prefix="/p2p/purpose-rules", tags=["P2P"])

_EDITORS_NOTE = ("Only admins or users granted Settings → Edit in the Procurement permission matrix can change "
                 "purpose rules — ask an admin.")
_RULE_FIELDS = tuple(pr_purpose.default_rules("stock"))


def _viewer(user: User = Depends(get_current_user)) -> User:
    ensure_tab_action(user, "p2p", "settings", "view")
    return user


def _editor(user: User = Depends(_viewer)) -> User:
    if not can_edit_settings(user, "p2p"):
        raise HTTPException(status_code=403, detail=_EDITORS_NOTE)
    return user


def _row(db: Session, purpose: str) -> ModuleSetting | None:
    return db.query(ModuleSetting).filter(
        ModuleSetting.module_key == "p2p", ModuleSetting.branch_id.is_(None),
        ModuleSetting.key == pr_purpose.RULES_KEY_PREFIX + purpose).first()


def _check_purpose(purpose: str) -> None:
    if purpose not in P2P_PURPOSES:
        raise HTTPException(status_code=404, detail=f"'{purpose}' is not a purpose — use one of: {', '.join(P2P_PURPOSES)}.")


def _payload(db: Session) -> dict:
    from app.modules.store.models.item import STORE_ITEM_TYPES
    resolved = pr_purpose.resolve_purpose_rules(db)
    overrides = pr_purpose.load_overrides(db)
    rows = {r.key[len(pr_purpose.RULES_KEY_PREFIX):]: r for r in db.query(ModuleSetting).filter(
        ModuleSetting.module_key == "p2p", ModuleSetting.key.like(pr_purpose.RULES_KEY_PREFIX + "%"),
        ModuleSetting.branch_id.is_(None)).all()}
    names = {u.id: u.name for u in db.query(User).filter(User.id.in_([r.updated_by_id for r in rows.values() if r.updated_by_id])).all()} if rows else {}
    purposes = []
    for code, label in P2P_PURPOSES.items():
        row = rows.get(code)
        res = resolved[code]
        purposes.append({
            "code": code, "label": label,
            "rules": {k: res[k] for k in _RULE_FIELDS},
            "defaults": pr_purpose.default_rules(code),
            "is_default": code not in overrides or res_equal(res, pr_purpose.default_rules(code)),
            # what the PR form will show for this purpose (the live preview)
            "form": {k: res[k] for k in ("category", "category_locked", "requirement_type", "requirement_type_locked")},
            "charged_to_options": [{"value": k, "label": pr_purpose.CHARGED_TO_LABELS[k]} for k in pr_purpose.VALID_CHARGED_TO[code]],
            "updated_by_name": names.get(row.updated_by_id) if row else None,
            "updated_at": row.updated_at.isoformat() if row and isinstance(row.updated_at, datetime) else None,
        })
    return {
        "purposes": purposes,
        "options": {
            "categories": [{"value": c, "label": f"{n} ({c})"} for c, n in P2P_CATEGORIES.items() if c != "OTH"],
            "requirement_types": [{"value": t, "label": t} for t in P2P_REQUIREMENT_TYPES],
            "item_types": [{"value": t, "label": t.replace("_", " ").capitalize()} for t in STORE_ITEM_TYPES],
            "line_project_modes": [{"value": k, "label": v} for k, v in pr_purpose.LINE_PROJECT_MODES.items()],
        },
    }


def res_equal(resolved: dict, default: dict) -> bool:
    return all(resolved[k] == default[k] for k in default)


def _response(db: Session, user: User) -> dict:
    return {**_payload(db), "can_edit": can_edit_settings(user, "p2p"), "editors_note": _EDITORS_NOTE}


def _audit(db: Session, user: User, purpose: str, action: str, old, new, summary: str, row_id) -> None:
    db.add(AuditLog(
        entity_type="module_setting", entity_id=row_id, action=action, field_name=pr_purpose.RULES_KEY_PREFIX + purpose,
        old_value=json.dumps(old, ensure_ascii=False), new_value=json.dumps(new, ensure_ascii=False),
        summary=summary, performed_by_id=getattr(user, "id", None), module_key="p2p", subtab_key="settings"))


_CONCURRENT = ("Someone else changed these rules at the same moment — nothing was saved; reload the page and save again.")


@router.get("")
def read_rules(db: Session = Depends(get_db), user: User = Depends(_viewer)):
    return _response(db, user)


@router.put("/{purpose}")
def save_rules(purpose: str, body: dict = Body(...), db: Session = Depends(get_db), user: User = Depends(_editor)):
    _check_purpose(purpose)
    rules = body.get("rules") if isinstance(body, dict) and "rules" in body else body
    try:
        clean = pr_purpose.validate_rules(purpose, rules)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    row = _row(db, purpose)
    old = row.value if row is not None else pr_purpose.default_rules(purpose)
    label = P2P_PURPOSES[purpose]
    try:
        if clean == pr_purpose.default_rules(purpose):
            if row is not None:
                row_id = row.id
                db.delete(row)
                db.flush()
                _audit(db, user, purpose, "reset", old, clean, f"{label} purpose rules back to default", row_id)
        elif row is None or row.value != clean:
            if row is None:
                row = ModuleSetting(module_key="p2p", key=pr_purpose.RULES_KEY_PREFIX + purpose, branch_id=None,
                                    value=clean, updated_by_id=user.id)
                db.add(row)
            else:
                row.value = clean
                row.updated_by_id = user.id
            db.flush()
            changed = [k for k in clean if clean[k] != old.get(k)]
            _audit(db, user, purpose, "updated", old, clean, f"{label} purpose rules changed: {', '.join(changed) or 'saved'}", row.id)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail=_CONCURRENT) from None
    return _response(db, user)


@router.post("/{purpose}/reset")
def reset_rules(purpose: str, db: Session = Depends(get_db), user: User = Depends(_editor)):
    _check_purpose(purpose)
    row = _row(db, purpose)
    if row is not None:
        old, row_id = row.value, row.id
        db.delete(row)
        db.flush()
        _audit(db, user, purpose, "reset", old, pr_purpose.default_rules(purpose),
               f"{P2P_PURPOSES[purpose]} purpose rules reset to default", row_id)
        db.commit()
    return _response(db, user)
