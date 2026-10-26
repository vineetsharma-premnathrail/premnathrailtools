"""Shared module settings framework (docs/MODULE_DETAILED_PLAN.md §27, §49).

Every module declares its admin-tunable values (limits, lead days, prefixes,
approvers, defaults) once, in code, as a ModuleSettingsDef of SettingSpecs:

    register_module_settings(ModuleSettingsDef(
        module_key="maintenance", label="Maintenance",
        groups={"pm": "Preventive maintenance"},
        specs={"pm_lead_days": SettingSpec("pm_lead_days", "pm", "PM lead days", "int", 7, min=0, max=365)},
    ))
    router = make_settings_router("maintenance")   # include in main.py with prefix /api/v1

Rules (no metadata customization — admins change values, never keys/types):
- Code defaults stay live: a `module_settings` row exists only while a value
  differs from the code default (saving the default back deletes the row).
- Typed validation: `coerce()` normalizes each value and raises ValueError
  naming the field, the rule and the fix.
- A save validates every value (and the module's cross-field rule) before
  writing anything — one bad value saves nothing.
- Every change and reset writes an AuditLog row (entity_type
  "module_setting", module_key, summary "Label: old → new").
- Editing needs admin or an *explicit* Permission Matrix grant
  `<module>:settings:edit` (same rule as Quality's `_explicit`: the matrix's
  opt-in fallthrough does not apply to authority actions).
- Per-plant values: a spec marked per_plant may also hold a branch row; the
  lookup order is branch row → company-wide row → code default.

TODO (§27, not built yet): number series (prefix + FY counter per document
type) and simple master lists (value/label/active) belong in this framework
too; until then modules keep their own.
"""
from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any, Callable

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.permission_registry import has_grant, permission_id
from app.db.session import get_db
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.module_setting import ModuleSetting
from app.modules.main.models.user import User

SETTING_TYPES = (
    "bool", "int", "decimal", "text", "longtext", "prefix", "select", "multi_select",
    "user", "users", "json_list", "json",
)
_NUMERIC = ("int", "decimal")
_TEXT_MAX = 500
_LONGTEXT_MAX = 5000


@dataclass(frozen=True)
class SettingSpec:
    key: str
    group: str
    label: str
    type: str
    default: Any
    options: list[tuple[str, str]] | None = None
    min: float | int | None = None
    max: float | int | None = None
    help: str = ""
    locked: bool = False
    per_plant: bool = False
    # user / users only: modules a picked person may hold (any one). None = the settings module's own app.
    user_apps: tuple[str, ...] | None = None
    # required: may never be saved blank. default_resolver: computes the shown default
    # (e.g. a standard buyer's current user id) when nothing is stored; not sent to the browser.
    required: bool = False
    default_resolver: Callable[[Session], Any] | None = field(default=None, compare=False, repr=False)

    def __post_init__(self) -> None:
        if self.type not in SETTING_TYPES:
            raise ValueError(f"Setting '{self.key}' has unknown type '{self.type}' — use one of {', '.join(SETTING_TYPES)}.")
        if self.type in ("select", "multi_select") and not self.options:
            raise ValueError(f"Setting '{self.key}' is a {self.type} but has no options.")


@dataclass
class ModuleSettingsDef:
    module_key: str
    label: str
    specs: dict[str, SettingSpec]
    groups: dict[str, str]
    cross_validate: Callable[[dict], None] | None = None
    app_key: str | None = None
    model: type = field(default=ModuleSetting)

    def __post_init__(self) -> None:
        if self.app_key is None:
            self.app_key = self.module_key
        for k, spec in self.specs.items():
            if spec.key != k:
                raise ValueError(f"Setting key mismatch in {self.module_key}: dict key '{k}' vs spec.key '{spec.key}'.")
            if spec.group not in self.groups:
                raise ValueError(f"Setting '{k}' uses group '{spec.group}' that {self.module_key} does not declare.")


_REGISTRY: dict[str, ModuleSettingsDef] = {}


def register_module_settings(defn: ModuleSettingsDef) -> ModuleSettingsDef:
    _REGISTRY[defn.module_key] = defn
    return defn


def get_def(module: str) -> ModuleSettingsDef:
    try:
        return _REGISTRY[module]
    except KeyError:
        raise KeyError(f"No settings registered for module '{module}' — call register_module_settings() first.") from None


def _spec(defn: ModuleSettingsDef, key: str) -> SettingSpec:
    spec = defn.specs.get(key)
    if spec is None:
        raise KeyError(f"'{key}' is not a {defn.label} setting.")
    return spec


# ---------------------------------------------------------------- validation

def _fmt_num(n: Any) -> str:
    return f"{n:g}" if isinstance(n, float) else str(n)


def _range_error(spec: SettingSpec, kind: str) -> ValueError:
    lo, hi = spec.min, spec.max
    if lo is not None and hi is not None:
        return ValueError(f"{spec.label} must be {kind} between {_fmt_num(lo)} and {_fmt_num(hi)} — enter a number in that range.")
    if lo is not None:
        return ValueError(f"{spec.label} must be {kind} of at least {_fmt_num(lo)} — enter {_fmt_num(lo)} or more.")
    return ValueError(f"{spec.label} must be {kind} of at most {_fmt_num(hi)} — enter {_fmt_num(hi)} or less.")


def _check_range(spec: SettingSpec, v: float, kind: str) -> None:
    if (spec.min is not None and v < spec.min) or (spec.max is not None and v > spec.max):
        raise _range_error(spec, kind)


def _option_values(spec: SettingSpec) -> list[str]:
    return [o[0] for o in (spec.options or [])]


def _option_labels(spec: SettingSpec) -> str:
    return ", ".join(o[1] for o in (spec.options or []))


def _as_user_id(spec: SettingSpec, value: Any) -> int:
    if isinstance(value, bool):
        raise ValueError(f"{spec.label} must be a user — pick a person from the list.")
    try:
        f = float(value)
    except (TypeError, ValueError):
        raise ValueError(f"{spec.label} must be a user — pick a person from the list.") from None
    if not f.is_integer():
        raise ValueError(f"{spec.label} must be a user — pick a person from the list.")
    return int(f)


def _check_user(db: Session, spec: SettingSpec, uid: int, app_key: str | None) -> None:
    u = db.get(User, uid)
    if u is None:
        raise ValueError(f"{spec.label}: user #{uid} does not exist — pick a person from the list.")
    if not u.is_active:
        raise ValueError(f"{spec.label}: {u.name} is deactivated — pick an active user.")
    allowed = spec.user_apps or ((app_key,) if app_key else ())
    if allowed and not set(allowed) & set(u.get_apps()):
        need = " or ".join(allowed)
        raise ValueError(
            f"{spec.label}: {u.name} has no access to the {need} module — pick someone who does, "
            f"or give them the module in Users first."
        )


def _numeric_list_kind(spec: SettingSpec) -> str | None:
    """'int' / 'decimal' when a json_list's code default is a non-empty list of
    numbers (e.g. reminder days [30, 7, 1]); None for text lists."""
    d = spec.default
    if not isinstance(d, (list, tuple)) or not d:
        return None
    if not all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in d):
        return None
    return "int" if all(isinstance(x, int) for x in d) else "decimal"


def _list_number(label: str, item: Any, kind: str) -> int | float:
    bad = ValueError(f"{label}: \"{item}\" is not a number — enter numbers separated by commas.")
    if isinstance(item, bool):
        raise bad
    try:
        n = float(item)
    except (TypeError, ValueError):
        raise bad from None
    if not math.isfinite(n):
        raise bad
    if kind == "int":
        if n != int(n):
            raise ValueError(f"{label}: \"{item}\" must be a whole number — remove the decimal part.")
        return int(n)
    return int(n) if isinstance(item, int) else n


def coerce(spec: SettingSpec, value: Any, db: Session | None = None, *, app_key: str | None = None) -> Any:
    """Validate and normalize one value for `spec`. Raises ValueError whose
    text names the field, the rule and how to fix it."""
    t = spec.type
    label = spec.label

    if t in _NUMERIC:
        if value is None or (isinstance(value, str) and not value.strip()):
            raise ValueError(f"{label} is required — enter a number.")
        if isinstance(value, bool):
            raise ValueError(f"{label} must be a number — enter digits only.")
        kind = "a whole number" if t == "int" else "a number"
        try:
            f = float(value.strip() if isinstance(value, str) else value)
        except (TypeError, ValueError):
            if spec.min is not None or spec.max is not None:
                raise _range_error(spec, kind) from None
            raise ValueError(f"{label} must be {kind} — enter digits only.") from None
        if math.isnan(f) or math.isinf(f):
            raise ValueError(f"{label} must be {kind} — enter digits only.")
        if t == "int":
            if not f.is_integer():
                if spec.min is not None or spec.max is not None:
                    raise _range_error(spec, "a whole number")
                raise ValueError(f"{label} must be a whole number — remove the decimal part.")
            v_int = int(f)
            _check_range(spec, v_int, "a whole number")
            return v_int
        _check_range(spec, f, "a number")
        return f

    if t == "bool":
        if not isinstance(value, bool):
            raise ValueError(f"{label} must be Yes or No — tick or untick the box.")
        return value

    if t == "text":
        v = "" if value is None else str(value).strip()
        if len(v) > _TEXT_MAX:
            raise ValueError(f"{label} can be at most {_TEXT_MAX} characters — it has {len(v)}; shorten it.")
        return v

    if t == "longtext":
        v = "" if value is None else str(value).replace(chr(13) + chr(10), chr(10)).strip()
        if len(v) > _LONGTEXT_MAX:
            raise ValueError(f"{label} can be at most {_LONGTEXT_MAX} characters — it has {len(v)}; shorten it.")
        return v

    if t == "prefix":
        v = str(value or "").strip().upper()
        if not v or len(v) > 10 or not v.replace("-", "").isalnum():
            raise ValueError(f"{label} must be 1–10 letters, digits or dashes (e.g. IL) — fix the prefix.")
        return v

    if t == "select":
        v = "" if value is None else str(value)
        if v not in _option_values(spec):
            raise ValueError(f"{label} must be one of: {_option_labels(spec)} — pick one from the list.")
        return v

    if t == "multi_select":
        if not isinstance(value, (list, tuple)):
            raise ValueError(f"{label} must be a list of choices — pick from: {_option_labels(spec)}.")
        allowed = _option_values(spec)
        out: list[str] = []
        for item in value:
            s = str(item)
            if s not in allowed:
                raise ValueError(f"{label}: '{s}' is not an allowed choice — pick from: {_option_labels(spec)}.")
            if s not in out:
                out.append(s)
        # Canonical order = the options order, so picking the same set in a
        # different click order is not a change.
        out.sort(key=allowed.index)
        return out

    if t == "user":
        if value is None or value == "":
            if spec.default is None:
                return None
            raise ValueError(f"{label} is required — pick a person from the list.")
        uid = _as_user_id(spec, value)
        if db is not None:
            _check_user(db, spec, uid, app_key)
        return uid

    if t == "users":
        if value is None:
            value = []
        if not isinstance(value, (list, tuple)):
            raise ValueError(f"{label} must be a list of users — pick people from the list.")
        ids: list[int] = []
        for item in value:
            uid = _as_user_id(spec, item)
            if db is not None:
                _check_user(db, spec, uid, app_key)
            if uid not in ids:
                ids.append(uid)
        return ids

    if t == "json_list":
        if value is None:
            value = []
        if not isinstance(value, (list, tuple)):
            raise ValueError(f"{label} must be a list of values — separate entries with commas.")
        numeric = _numeric_list_kind(spec)
        out_list: list[Any] = []
        for item in value:
            if item is None or isinstance(item, (list, tuple, dict)):
                raise ValueError(f"{label} can only hold plain values (text or numbers) — remove nested or empty entries.")
            if isinstance(item, str):
                item = item.strip()
                if not item:
                    continue
            if numeric is not None:
                item = _list_number(label, item, numeric)
            out_list.append(item)
        return out_list

    # json
    try:
        json.dumps(value)
    except (TypeError, ValueError):
        raise ValueError(f"{label} must be valid JSON data — check the value.") from None
    return value


# ---------------------------------------------------------------- reads

def _row(db: Session, defn: ModuleSettingsDef, key: str, branch_id: int | None) -> ModuleSetting | None:
    model = defn.model
    q = db.query(model).filter(model.module_key == defn.module_key, model.key == key)
    q = q.filter(model.branch_id.is_(None)) if branch_id is None else q.filter(model.branch_id == branch_id)
    return q.first()


def get_setting(db: Session, module: str, key: str, branch_id: int | None = None) -> Any:
    """branch row (per_plant specs only) → company-wide row → code default.
    Unknown key raises KeyError (a programming error, not user input)."""
    defn = get_def(module)
    spec = _spec(defn, key)
    if spec.per_plant and branch_id is not None:
        row = _row(db, defn, key, branch_id)
        if row is not None and row.value is not None:
            return row.value
    row = _row(db, defn, key, None)
    if row is not None and row.value is not None:
        return row.value
    return spec.default


def _global_rows(db: Session, defn: ModuleSettingsDef) -> dict[str, ModuleSetting]:
    model = defn.model
    rows = db.query(model).filter(model.module_key == defn.module_key, model.branch_id.is_(None)).all()
    return {r.key: r for r in rows if r.key in defn.specs}


def get_all(db: Session, module: str) -> dict:
    defn = get_def(module)
    rows = _global_rows(db, defn)
    user_ids = {r.updated_by_id for r in rows.values() if r.updated_by_id}
    names = {u.id: u.name for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    values: dict[str, Any] = {}
    is_default: dict[str, bool] = {}
    meta: dict[str, dict] = {}
    for key, spec in defn.specs.items():
        row = rows.get(key)
        if row is not None and row.value is not None:
            values[key] = row.value
            is_default[key] = False
            meta[key] = {
                "updated_by_name": names.get(row.updated_by_id),
                "updated_at": row.updated_at.isoformat() if isinstance(row.updated_at, datetime) else None,
            }
        else:
            resolved = spec.default_resolver(db) if spec.default_resolver is not None else None
            values[key] = resolved if resolved is not None else spec.default
            is_default[key] = True
    return {"values": values, "is_default": is_default, "meta": meta}


# ---------------------------------------------------------------- writes

def _display(db: Session, spec: SettingSpec, value: Any) -> str:
    if value is None or value == "" or value == []:
        return "(blank)"
    if spec.type == "bool":
        return "Yes" if value else "No"
    if spec.type in ("select", "multi_select"):
        labels = dict(spec.options or [])
        items = value if isinstance(value, list) else [value]
        return ", ".join(labels.get(str(v), str(v)) for v in items)
    if spec.type in ("user", "users"):
        ids = value if isinstance(value, list) else [value]
        names = {u.id: u.name for u in db.query(User).filter(User.id.in_(ids)).all()}
        return ", ".join(names.get(i, f"user #{i}") for i in ids)
    if isinstance(value, float):
        return f"{value:g}"
    if isinstance(value, list):
        return ", ".join(str(v) for v in value)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


def _audit(db: Session, defn: ModuleSettingsDef, spec: SettingSpec, user: User, action: str,
           old: Any, new: Any, summary: str, row_id: int | None, branch_id: int | None) -> None:
    db.add(AuditLog(
        entity_type="module_setting", entity_id=row_id, action=action, field_name=spec.key,
        old_value=json.dumps(old, default=str, ensure_ascii=False),
        new_value=json.dumps(new, default=str, ensure_ascii=False),
        summary=summary, performed_by_id=getattr(user, "id", None),
        module_key=defn.module_key, subtab_key="settings", branch_id=branch_id,
    ))


def _same(spec: SettingSpec, a: Any, b: Any) -> bool:
    """Equality for change detection. `users` and `multi_select` values are
    sets, so the same members in a different order are not a change (this also
    covers a code default written in a different order)."""
    if spec.type in ("users", "multi_select") and isinstance(a, (list, tuple)) and isinstance(b, (list, tuple)):
        return sorted(a, key=str) == sorted(b, key=str)
    return a == b


def save(db: Session, module: str, values: dict, user: User, branch_id: int | None = None) -> dict:
    """Partial update. Validates every value and the module's cross-field
    rule first; writes only keys that changed; a value equal to the code
    default deletes the company-wide row so later default changes stay live.
    Raises ValueError (user-readable) and saves nothing on any bad value."""
    defn = get_def(module)
    if not isinstance(values, dict):
        raise ValueError("Settings must be sent as {\"values\": {key: value}} — check the request body.")
    clean: dict[str, Any] = {}
    for key, raw in values.items():
        spec = defn.specs.get(key)
        if spec is None:
            raise ValueError(f"'{key}' is not a {defn.label} setting — reload the page and try again.")
        if spec.locked:
            raise ValueError(f"{spec.label} is locked and can only be changed in code — ask the system administrator.")
        if branch_id is not None and not spec.per_plant:
            raise ValueError(f"{spec.label} is company-wide and can't be set per plant — change it without a plant.")
        if spec.required and (raw is None or (isinstance(raw, str) and not raw.strip())
                              or (isinstance(raw, (list, tuple, dict)) and not raw)):
            raise ValueError(f"{spec.label}: pick a person — this setting can't be left blank.")
        clean[key] = coerce(spec, raw, db, app_key=defn.app_key)

    current = {k: get_setting(db, module, k, branch_id) for k in defn.specs}
    merged = {**current, **clean}
    if defn.cross_validate is not None:
        defn.cross_validate(merged)

    for key, new in clean.items():
        spec = defn.specs[key]
        old = current[key]
        if _same(spec, old, new):
            continue
        row = _row(db, defn, key, branch_id)
        if branch_id is None and _same(spec, new, spec.default):
            row_id = row.id if row is not None else None
            if row is not None:
                db.delete(row)
        else:
            if row is None:
                row = defn.model(module_key=defn.module_key, key=key, branch_id=branch_id, value=new,
                                 updated_by_id=getattr(user, "id", None))
                db.add(row)
            else:
                row.value = new
                row.updated_by_id = getattr(user, "id", None)
            db.flush()
            row_id = row.id
        summary = f"{spec.label}: {_display(db, spec, old)} → {_display(db, spec, new)}"
        _audit(db, defn, spec, user, "updated", old, new, summary, row_id, branch_id)
    db.commit()
    return get_all(db, module)


def reset(db: Session, module: str, key: str, user: User, branch_id: int | None = None) -> dict:
    """Delete the stored value so the code default (or, for a plant, the
    company-wide value) applies again."""
    defn = get_def(module)
    spec = defn.specs.get(key)
    if spec is None:
        raise ValueError(f"'{key}' is not a {defn.label} setting — reload the page and try again.")
    if spec.locked:
        raise ValueError(f"{spec.label} is locked and can only be changed in code — ask the system administrator.")
    if spec.required and spec.default_resolver is None:
        raise ValueError(f"{spec.label}: there is no default to go back to — pick a person instead.")
    row = _row(db, defn, key, branch_id)
    if row is not None:
        old = row.value
        row_id = row.id
        db.delete(row)
        db.flush()
        new = get_setting(db, module, key, branch_id)
        summary = f"{spec.label} reset to default ({_display(db, spec, new)})"
        _audit(db, defn, spec, user, "reset", old, new, summary, row_id, branch_id)
        db.commit()
    return get_all(db, module)


# ---------------------------------------------------------------- access

def can_edit_settings(user: User, module: str) -> bool:
    """Admin, or an explicit `<module>:settings:edit` grant. Deliberately not
    can_perform(): its opt-in fallthrough would make every user with no grants
    in the module a settings editor."""
    if user is None:
        return False
    return has_grant(user, permission_id(module, "settings", "edit"))


def _editors_note(defn: ModuleSettingsDef) -> str:
    return (f"Only admins or users granted Settings → Edit in the {defn.label} permission matrix can change "
            f"these settings — ask an admin.")


def _spec_dto(spec: SettingSpec) -> dict:
    d = asdict(spec)
    d.pop("default_resolver", None)  # a function; the browser gets the resolved value in `values`
    d["options"] = [{"value": v, "label": lbl} for v, lbl in (spec.options or [])] if spec.options else None
    return d


def settings_payload(db: Session, module: str, user: User) -> dict:
    defn = get_def(module)
    data = get_all(db, module)
    return {
        "values": data["values"],
        "specs": [_spec_dto(s) for s in defn.specs.values()],
        "groups": [{"key": k, "label": v} for k, v in defn.groups.items()],
        "is_default": data["is_default"],
        "meta": data["meta"],
        "can_edit": can_edit_settings(user, module),
        "editors_note": _editors_note(defn),
    }


_CONCURRENT_SAVE = ("Someone else changed this setting at the same moment — nothing was saved; "
                    "reload the page and save again.")


def make_settings_router(module_key: str, *, app_access_dep: Callable | None = None) -> APIRouter:
    """GET/PUT /{module_key}/settings and POST /{module_key}/settings/reset/{key}.
    Include in main.py with prefix="/api/v1". The module must be registered
    (register_module_settings) before the first request."""
    if app_access_dep is None:
        from app.modules.main.routes.auth import get_current_user

        def app_access_dep(user: User = Depends(get_current_user)) -> User:
            # Resolved per request: the def may register after the router is
            # built, and its app_key can differ from the settings module_key.
            defn = get_def(module_key)
            if defn.app_key not in user.get_apps():
                raise HTTPException(
                    status_code=403,
                    detail=(f"You don't have access to the {defn.label} module, so you can't open its settings — "
                            f"ask an admin to give you {defn.label} in Users."),
                )
            return user

    router = APIRouter(prefix=f"/{module_key}/settings", tags=["Settings"])

    def _require_editor(user: User) -> None:
        if not can_edit_settings(user, module_key):
            raise HTTPException(status_code=403, detail=_editors_note(get_def(module_key)))

    @router.get("")
    def read_settings(db: Session = Depends(get_db), user: User = Depends(app_access_dep)):
        return settings_payload(db, module_key, user)

    @router.put("")
    def update_settings(body: dict = Body(...), db: Session = Depends(get_db), user: User = Depends(app_access_dep)):
        _require_editor(user)
        values = body.get("values") if isinstance(body, dict) else None
        if not isinstance(values, dict):
            raise HTTPException(status_code=422, detail="Send the changed settings as {\"values\": {key: value}} — nothing was saved.")
        try:
            save(db, module_key, values, user)
        except ValueError as exc:
            db.rollback()
            raise HTTPException(status_code=422, detail=str(exc)) from None
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail=_CONCURRENT_SAVE) from None
        return settings_payload(db, module_key, user)

    @router.post("/reset/{key}")
    def reset_setting(key: str, db: Session = Depends(get_db), user: User = Depends(app_access_dep)):
        _require_editor(user)
        try:
            reset(db, module_key, key, user)
        except ValueError as exc:
            db.rollback()
            raise HTTPException(status_code=422, detail=str(exc)) from None
        except IntegrityError:
            db.rollback()
            raise HTTPException(status_code=409, detail=_CONCURRENT_SAVE) from None
        return settings_payload(db, module_key, user)

    return router
