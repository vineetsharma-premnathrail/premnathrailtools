"""One user action = one timeline entry.

The automatic audit trail (core/audit.py) writes a row per changed record, so a
single "Create order" logs the header, every line / delivery row / milestone,
then the totals and amounts the server worked out. That is right for the audit
log (Organization › Audit Log keeps every row) but noise on a record's
timeline: the user did one thing. `compact_timeline()` folds the rows one user
wrote in the same save into one entry; the folded rows stay readable under
`details`.
"""

import json
import re
from datetime import timedelta
from typing import Any

# Rows written by one request share the same user and (to within a commit or
# two) the same timestamp.
_SAME_SAVE = timedelta(seconds=2)

# Never shown on a timeline, including rows written before audit.py ignored them.
_HIDDEN_FIELDS = {"lock_version", "lock_changed_by_id", "created_at", "updated_at", "deleted_at"}

_PLURAL = {"line": "line", "schedule": "delivery row", "billing": "billing milestone", "item": "item"}


def _load(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _clean(log: Any) -> dict | None:
    """The row as a dict, internal fields dropped; None when nothing is left."""
    old, new = _load(log.old_value), _load(log.new_value)
    summary = log.summary or f"{log.action} {log.field_name or ''}".strip()
    if log.action.endswith("updated") and (set(new) & _HIDDEN_FIELDS):
        new = {k: v for k, v in new.items() if k not in _HIDDEN_FIELDS}
        old = {k: v for k, v in old.items() if k not in _HIDDEN_FIELDS}
        if not new:
            return None
        # Drop the hidden "field (a → b)" parts from the stored one-liner.
        head, _, tail = summary.partition(": ")
        parts = [p for p in re.split(r", (?=\w+ \()", tail.rstrip(".")) if p.split(" (")[0] not in _HIDDEN_FIELDS]
        summary = f"{head}: {', '.join(parts)}." if parts else f"{head}."
    return {"id": log.id, "at": log.performed_at, "action": log.action, "field": log.field_name,
            "summary": summary, "old": old or None, "new": new or None, "by_id": log.performed_by_id}


def _child_counts(rows: list[dict]) -> str:
    counts: dict[str, int] = {}
    for r in rows:
        if r["action"].endswith("_added"):
            kind = r["action"][: -len("_added")]
            counts[kind] = counts.get(kind, 0) + 1
    words = []
    for kind, n in counts.items():
        noun = _PLURAL.get(kind, kind.replace("_", " "))
        words.append(f"{n} {noun}{'' if n == 1 else 's'}")
    return ", ".join(words)


def _headline(rows: list[dict]) -> str:
    created = next((r for r in rows if r["action"] == "created"), None)
    if created:
        extra = _child_counts(rows)
        base = created["summary"].rstrip(".")
        return f"{base} with {extra}." if extra else f"{base}."
    if len(rows) == 1:
        return rows[0]["summary"]
    first = rows[0]["summary"].rstrip(".")
    return f"{first} (+{len(rows) - 1} related change{'' if len(rows) == 2 else 's'})."


def compact_timeline(logs: list[Any], names: dict[int, str], newest_first: bool = False) -> list[dict]:
    """`logs` are AuditLog rows in time order (either direction); `names` maps
    user id -> display name. Returns entries shaped like the old per-row ones
    (id, at, action, field, summary, old, new, by) plus `details`: the
    summaries of every row folded into the entry (empty for a single row)."""
    ordered = sorted(logs, key=lambda l: (l.performed_at, l.id))
    groups: list[list[dict]] = []
    for log in ordered:
        row = _clean(log)
        if row is None:
            continue
        last = groups[-1] if groups else None
        if last and last[0]["by_id"] == row["by_id"] and row["at"] - last[0]["at"] <= _SAME_SAVE:
            last.append(row)
        else:
            groups.append([row])

    out = []
    for rows in groups:
        lead = next((r for r in rows if r["action"] == "created"), rows[0])
        out.append({
            "id": lead["id"], "at": rows[0]["at"], "action": lead["action"], "field": lead["field"] if len(rows) == 1 else None,
            "summary": _headline(rows), "old": lead["old"] if len(rows) == 1 else None,
            "new": lead["new"] if len(rows) == 1 else None, "by": names.get(lead["by_id"]),
            "details": [r["summary"] for r in rows] if len(rows) > 1 else [],
        })
    if newest_first:
        out.reverse()
    return out
