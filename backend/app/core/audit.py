"""Automatic, ORM-level audit trail for records that must be traceable —
Quality (ISO 9001 / ISO 22163 quality records), Store (stock movements and
masters) and Organization (company, plants, departments and their heads,
cost centres).

Unlike the older per-route `_write_audit()` helpers (CRM, ERP, P2P), nothing
here depends on a route remembering to log: every model registered with
`register_audited()` gets an `audit_logs` row for each insert, update and
delete that goes through the ORM, from any code path (routes, Azure
provisioning, background jobs). Updates store only the changed fields, as
JSON, in old_value/new_value; deletes store a full snapshot of the row in
old_value, so a hard-deleted record can still be reconstructed.

A flip of `is_deleted` (SoftDeleteMixin) is logged as "deleted"/"restored"
rather than "updated".

Limits: bulk `Query.update()` / `Query.delete()` bypass ORM events and are
not captured — audited models must be changed through loaded instances.

Registrations live in app/core/audit_registry.py, imported once from
app/main.py."""

import json
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Callable

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.core.audit_context import get_current_user_id
from app.modules.main.models.audit_log import AuditLog, request_context_fields
from app.modules.main.models.user import User

# Bookkeeping columns whose change is never interesting on its own.
_IGNORED_FIELDS = {"created_at", "updated_at", "deleted_at"}

# How many changed fields the one-line summary spells out before "+N more".
_SUMMARY_FIELD_LIMIT = 4
_SUMMARY_VALUE_LIMIT = 60


@dataclass(frozen=True)
class AuditSpec:
    entity_type: str
    module_key: str
    label: str
    # Human identifier shown in the summary, e.g. lambda n: n.ncr_number.
    ref: Callable[[Any], Any] | None = None
    # Child rows (line items, inspection results) are logged against their
    # parent document so one document's full history reads as one trail:
    # entity_type/entity_id become the parent's, actions become
    # "<child_action>_added" / "_updated" / "_removed".
    parent_attr: str | None = None
    parent_entity_type: str | None = None
    child_action: str = "item"
    # Return True to skip auditing a particular row (e.g. a ledger posting
    # already covered by its source document's own audit rows).
    skip: Callable[[Any], bool] | None = None


_REGISTRY: dict[type, AuditSpec] = {}


def register_audited(model: type, **spec: Any) -> None:
    _REGISTRY[model] = AuditSpec(**spec)


def audited_entity_modules() -> dict[str, str]:
    """entity_type -> module_key for every registered model, so the audit
    log screen can classify and filter these rows."""
    out: dict[str, str] = {}
    for spec in _REGISTRY.values():
        out[spec.parent_entity_type or spec.entity_type] = spec.module_key
    return out


def _json_safe(value: Any) -> Any:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (list, tuple)):
        return [_json_safe(v) for v in value]
    if isinstance(value, dict):
        return {k: _json_safe(v) for k, v in value.items()}
    return value


def _dumps(data: dict | None) -> str | None:
    if not data:
        return None
    return json.dumps(data, default=str, ensure_ascii=False)


def _column_keys(obj: Any) -> list[str]:
    return [attr.key for attr in inspect(obj).mapper.column_attrs]


def _snapshot(obj: Any) -> dict:
    # Reads the already-loaded state only, never triggering a lazy load
    # mid-flush.
    state = inspect(obj)
    return {
        key: _json_safe(state.dict[key])
        for key in _column_keys(obj)
        if key in state.dict and key not in _IGNORED_FIELDS
    }


def _changes(obj: Any) -> tuple[dict, dict]:
    state = inspect(obj)
    old: dict = {}
    new: dict = {}
    for key in _column_keys(obj):
        if key in _IGNORED_FIELDS:
            continue
        hist = state.attrs[key].history
        if not hist.has_changes():
            continue
        before = hist.deleted[0] if hist.deleted else None
        after = hist.added[0] if hist.added else None
        if before == after:
            continue
        old[key] = _json_safe(before)
        new[key] = _json_safe(after)
    return old, new


def _is_user_ref(key: str) -> bool:
    return key.endswith("user_id") or key.endswith("_by_id") or key.endswith("user_ids")


def _user_names(connection, old: dict, new: dict) -> dict[int, str]:
    ids: set[int] = set()
    for data in (old, new):
        for key, value in data.items():
            if not _is_user_ref(key):
                continue
            if isinstance(value, int):
                ids.add(value)
            elif isinstance(value, list):
                ids.update(v for v in value if isinstance(v, int))
    if not ids:
        return {}
    rows = connection.execute(
        User.__table__.select().with_only_columns(User.__table__.c.id, User.__table__.c.name, User.__table__.c.email)
        .where(User.__table__.c.id.in_(ids))
    ).all()
    return {r.id: r.name or r.email for r in rows}


def _display(key: str, value: Any, names: dict[int, str]) -> str:
    if value is None or value == "" or value == []:
        return "—"
    if _is_user_ref(key):
        if isinstance(value, int):
            return names.get(value, f"user #{value}")
        if isinstance(value, list):
            return ", ".join(names.get(v, f"user #{v}") for v in value)
    text = str(value)
    return text if len(text) <= _SUMMARY_VALUE_LIMIT else text[: _SUMMARY_VALUE_LIMIT - 1] + "…"


def _change_text(old: dict, new: dict, names: dict[int, str]) -> str:
    keys = list(new.keys())
    parts = [f"{k} ({_display(k, old.get(k), names)} → {_display(k, new.get(k), names)})" for k in keys[:_SUMMARY_FIELD_LIMIT]]
    if len(keys) > _SUMMARY_FIELD_LIMIT:
        parts.append(f"+{len(keys) - _SUMMARY_FIELD_LIMIT} more")
    return ", ".join(parts)


def _ref_text(spec: AuditSpec, obj: Any) -> str:
    ref = None
    if spec.ref:
        try:
            ref = spec.ref(obj)
        except Exception:
            ref = None
    return str(ref) if ref not in (None, "") else f"#{getattr(obj, 'id', '?')}"


def _build_row(spec: AuditSpec, obj: Any, kind: str, old: dict, new: dict, connection) -> dict | None:
    """kind is one of created / updated / deleted / soft_deleted / restored."""
    names = _user_names(connection, old, new)
    ref = _ref_text(spec, obj)

    if spec.parent_attr:
        entity_type = spec.parent_entity_type or spec.entity_type
        entity_id = getattr(obj, spec.parent_attr, None)
        verb = {"created": "added", "updated": "updated", "deleted": "removed",
                "soft_deleted": "removed", "restored": "restored"}[kind]
        action = f"{spec.child_action}_{verb}"
        summary = f"{spec.label} {ref} {verb}"
    else:
        entity_type = spec.entity_type
        entity_id = getattr(obj, "id", None)
        action = {"created": "created", "updated": "updated", "deleted": "deleted",
                  "soft_deleted": "deleted", "restored": "restored"}[kind]
        summary = {
            "created": f"{spec.label} {ref} created",
            "updated": f"{spec.label} {ref} updated",
            "deleted": f"{spec.label} {ref} permanently deleted",
            "soft_deleted": f"{spec.label} {ref} deleted (record retained)",
            "restored": f"{spec.label} {ref} restored",
        }[kind]

    if kind == "updated":
        summary += f": {_change_text(old, new, names)}"
    summary += "."

    return {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "action": action,
        "field_name": next(iter(new)) if kind == "updated" and len(new) == 1 else None,
        "old_value": _dumps(old),
        "new_value": _dumps(new),
        "summary": summary,
        "module_key": spec.module_key,
    }


def _after_flush(session: Session, flush_context) -> None:
    if not _REGISTRY:
        return
    # Session state (new/dirty/deleted and attribute history) is still the
    # pre-flush picture here, but primary keys of new rows are now assigned.
    pending: list[tuple[AuditSpec, Any, str, dict, dict]] = []

    for obj in session.new:
        spec = _REGISTRY.get(type(obj))
        if spec and not (spec.skip and spec.skip(obj)):
            pending.append((spec, obj, "created", {}, _snapshot(obj)))

    for obj in session.dirty:
        spec = _REGISTRY.get(type(obj))
        if not spec or (spec.skip and spec.skip(obj)):
            continue
        old, new = _changes(obj)
        if not new:
            continue
        if "is_deleted" in new and len(new) == 1:
            kind = "soft_deleted" if new["is_deleted"] else "restored"
            pending.append((spec, obj, kind, _snapshot(obj) if new["is_deleted"] else {}, {}))
        else:
            pending.append((spec, obj, "updated", old, new))

    for obj in session.deleted:
        spec = _REGISTRY.get(type(obj))
        if spec and not (spec.skip and spec.skip(obj)):
            pending.append((spec, obj, "deleted", _snapshot(obj), {}))

    if not pending:
        return

    connection = session.connection()
    context = request_context_fields(connection)
    performed_by_id = get_current_user_id()
    rows = []
    for spec, obj, kind, old, new in pending:
        row = _build_row(spec, obj, kind, old, new, connection)
        if row:
            rows.append({**row, **context, "performed_by_id": performed_by_id})
    if rows:
        connection.execute(AuditLog.__table__.insert(), rows)


event.listen(Session, "after_flush", _after_flush)


def record_audit(
    db: Session,
    *,
    entity_type: str,
    entity_id: int | None,
    action: str,
    module_key: str,
    summary: str,
    old_value: dict | None = None,
    new_value: dict | None = None,
    user_id: int | None = None,
) -> None:
    """Explicit audit row for an event the ORM hook can't see as a change
    to a registered model, e.g. adding a user to a department (which edits
    the users table)."""
    db.add(AuditLog(
        entity_type=entity_type, entity_id=entity_id, action=action, module_key=module_key,
        summary=summary, old_value=_dumps(_json_safe(old_value or {})), new_value=_dumps(_json_safe(new_value or {})),
        performed_by_id=user_id if user_id is not None else get_current_user_id(),
    ))
