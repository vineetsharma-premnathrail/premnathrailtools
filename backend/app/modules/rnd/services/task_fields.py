"""Planning fields shared by R&D requirement tasks and R&D project tasks:
priority (Standard / Urgent), start date, work status, a checklist and the
progress percentage.

`status` on a task stays the workflow state (open → closed / cancelled).
`work_status` is where the assignee says how the open work stands (not
started / in progress / on hold). The checklist is the task's definition of
done: the giver lists the steps, the assignee ticks them, and the task can't
be completed while any step is unticked.

Progress (0-100): with a checklist it follows the ticked steps (read-only);
without one the assignee enters it. Completing a task sets 100, reopening caps
it at 99, cancelling keeps the last value."""
from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timezone

from fastapi import HTTPException

from app.core.priority import PRIORITY_LABELS, map_legacy_priority
from app.core.priority import parse_priority as _parse_priority

PRIORITIES = dict(PRIORITY_LABELS)
WORK_STATUSES = {"not_started": "Not started", "in_progress": "In progress", "on_hold": "On hold"}
MAX_CHECKLIST_ITEMS = 50
MAX_ITEM_LEN = 300


def parse_priority(value: str | None) -> str:
    """Standard or Urgent (any case); anything else is a 422 — "Priority must be Standard or Urgent."."""
    return _parse_priority(value)


def priority_label(value: str | None) -> str:
    """Label of a stored value; a legacy value that survived the migration reads as its mapped value."""
    return PRIORITIES[map_legacy_priority(value)]


def parse_progress(value) -> int:
    """A whole number 0-100 (a string from a form is fine); anything else is a 422."""
    bad = HTTPException(status_code=422, detail="Progress must be a whole number from 0 to 100.")
    if isinstance(value, bool) or value is None:
        raise bad
    try:
        number = float(str(value).strip())
    except ValueError:
        raise bad from None
    if number != int(number) or not 0 <= number <= 100:
        raise bad
    return int(number)


def checklist_progress(task) -> int | None:
    """Progress implied by the checklist (ticked / total, rounded), None without a checklist."""
    items = [i for i in (task.checklist or []) if isinstance(i, dict)]
    if not items:
        return None
    return round(100 * sum(1 for i in items if i.get("done")) / len(items))


def sync_progress(task) -> None:
    """A checklist task's progress follows its ticked steps."""
    derived = checklist_progress(task)
    if derived is not None:
        task.progress_percent = derived


def set_progress(task, value) -> str | None:
    """The assignee enters progress on a task without a checklist. Returns the activity-log line."""
    if task.checklist:
        raise HTTPException(status_code=422, detail="This task has a checklist — progress follows the ticked steps. Tick the steps instead of typing a percentage.")
    new = parse_progress(value)
    old = task.progress_percent or 0
    if new == old:
        return None
    task.progress_percent = new
    return f"Progress: {old}% → {new}%"


def mark_complete(task) -> None:
    task.progress_percent = 100


def on_reopen(task) -> None:
    """Reopening a completed task: at most 99 (the work is not done any more)."""
    derived = checklist_progress(task)
    current = derived if derived is not None else (task.progress_percent or 0)
    task.progress_percent = min(current, 99)


def parse_work_status(value: str | None) -> str:
    v = (value or "not_started").strip().lower().replace(" ", "_")
    if v not in WORK_STATUSES:
        raise HTTPException(status_code=422, detail=f"Status \"{value}\" isn't valid — pick one of {', '.join(WORK_STATUSES.values())}.")
    return v


def parse_start_date(value: str | date | None, due: date) -> date | None:
    if value in (None, ""):
        return None
    if isinstance(value, date):
        start = value
    else:
        try:
            start = date.fromisoformat(str(value))
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Start date \"{value}\" isn't a valid date (use YYYY-MM-DD).")
    if start > due:
        raise HTTPException(status_code=422, detail=f"Start date {start.strftime('%d %b %Y')} is after the due date {due.strftime('%d %b %Y')} — the task must start on or before it is due.")
    return start


def _item(text: str, done: bool = False, item_id: str | None = None, done_by: str | None = None, done_at: str | None = None) -> dict:
    return {"id": item_id or uuid.uuid4().hex[:10], "text": text, "done": bool(done), "done_by": done_by if done else None, "done_at": done_at if done else None}


def build_checklist(raw_items: list, existing: list | None = None, actor_name: str | None = None) -> list[dict]:
    """Normalise a checklist sent by the form: a list of strings or
    {id?, text, done?}. Items keep their id (and who ticked them) when the
    text matches an existing item's id; blank lines are dropped."""
    by_id = {i.get("id"): i for i in (existing or []) if isinstance(i, dict)}
    out: list[dict] = []
    for raw in raw_items or []:
        if isinstance(raw, str):
            raw = {"text": raw}
        if not isinstance(raw, dict):
            continue
        text = " ".join(str(raw.get("text") or "").split())
        if not text:
            continue
        if len(text) > MAX_ITEM_LEN:
            raise HTTPException(status_code=422, detail=f"Checklist item \"{text[:40]}…\" is {len(text)} characters — keep each step under {MAX_ITEM_LEN} and put details in Task details.")
        prev = by_id.get(raw.get("id"))
        done = bool(raw.get("done", prev["done"] if prev else False))
        if prev and prev["done"] == done:
            out.append(_item(text, done, prev["id"], prev.get("done_by"), prev.get("done_at")))
        else:
            out.append(_item(text, done, prev["id"] if prev else None, actor_name if done else None,
                             datetime.now(timezone.utc).isoformat() if done else None))
    if len(out) > MAX_CHECKLIST_ITEMS:
        raise HTTPException(status_code=422, detail=f"A checklist can have at most {MAX_CHECKLIST_ITEMS} steps — this one has {len(out)}. Split the work into sub-tasks instead.")
    return out


def parse_checklist_form(raw: str | None) -> list[dict]:
    """Checklist sent as a JSON string in a multipart form (create / sub-task)."""
    if not raw or not raw.strip():
        return []
    try:
        items = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=422, detail="The checklist couldn't be read — reload the page and add the steps again.")
    if not isinstance(items, list):
        raise HTTPException(status_code=422, detail="The checklist must be a list of steps.")
    return build_checklist(items)


def fields_out(task) -> dict:
    checklist = list(task.checklist or [])
    return {
        "priority": map_legacy_priority(task.priority),
        "start_date": task.start_date.isoformat() if task.start_date else None,
        "work_status": task.work_status or "not_started",
        "checklist": checklist,
        "checklist_done": sum(1 for i in checklist if i.get("done")),
        "progress_percent": task.progress_percent or 0,
        "progress_from_checklist": bool(checklist),
    }


def apply_create(task, *, priority: str | None, start_date: str | None, work_status: str | None, checklist: str | None) -> None:
    task.priority = parse_priority(priority)
    task.start_date = parse_start_date(start_date, task.due_date)
    task.work_status = parse_work_status(work_status)
    task.checklist = parse_checklist_form(checklist)
    task.progress_percent = checklist_progress(task) or 0


def apply_edit(task, data: dict, actor_name: str) -> list[str]:
    """Edit-form changes to the planning fields; returns lines for the activity log."""
    changes: list[str] = []
    if "priority" in data and data["priority"] is not None:
        p = parse_priority(data["priority"])
        if p != map_legacy_priority(task.priority):
            changes.append(f"Priority: {priority_label(task.priority)} → {PRIORITIES[p]}")
            task.priority = p
    if "start_date" in data:
        s = parse_start_date(data["start_date"], task.due_date)
        if s != task.start_date:
            fmt = lambda d: d.strftime('%d %b %Y') if d else 'none'  # noqa: E731
            changes.append(f"Start date: {fmt(task.start_date)} → {fmt(s)}")
            task.start_date = s
    elif task.start_date and task.start_date > task.due_date:
        raise HTTPException(status_code=422, detail=f"The start date {task.start_date.strftime('%d %b %Y')} is after the new due date — change the start date too.")
    if "work_status" in data and data["work_status"] is not None:
        w = parse_work_status(data["work_status"])
        if w != (task.work_status or "not_started"):
            changes.append(f"Status: {WORK_STATUSES.get(task.work_status or 'not_started')} → {WORK_STATUSES[w]}")
            task.work_status = w
    if "checklist" in data and data["checklist"] is not None:
        new = build_checklist(data["checklist"], task.checklist, actor_name)
        old_texts = [i["text"] for i in (task.checklist or [])]
        if [i["text"] for i in new] != old_texts or [i["done"] for i in new] != [i.get("done") for i in (task.checklist or [])]:
            changes.append(f"Checklist updated ({len(new)} step{'s' if len(new) != 1 else ''})")
        task.checklist = new
        sync_progress(task)
    return changes


def apply_progress(task, *, work_status: str | None, item_id: str | None, done: bool | None, actor_name: str,
                   progress_percent=None) -> str | None:
    """Assignee / reviewer ticks a checklist step, changes the work status or
    enters the progress percentage (tasks without a checklist).
    Returns the activity-log line, or None when nothing changed."""
    if progress_percent is not None:
        return set_progress(task, progress_percent)
    if work_status is not None:
        w = parse_work_status(work_status)
        if w == (task.work_status or "not_started"):
            return None
        line = f"Status: {WORK_STATUSES.get(task.work_status or 'not_started')} → {WORK_STATUSES[w]}"
        task.work_status = w
        return line
    if item_id:
        items = [dict(i) for i in (task.checklist or [])]
        hit = next((i for i in items if i.get("id") == item_id), None)
        if not hit:
            raise HTTPException(status_code=404, detail="That checklist step no longer exists — the task was edited. Refresh the page.")
        if bool(done) == bool(hit.get("done")):
            return None
        hit["done"] = bool(done)
        hit["done_by"] = actor_name if done else None
        hit["done_at"] = datetime.now(timezone.utc).isoformat() if done else None
        task.checklist = items   # reassign so SQLAlchemy sees the JSON change
        sync_progress(task)
        # Ticking the first step means the work has started.
        if done and (task.work_status or "not_started") == "not_started":
            task.work_status = "in_progress"
        return f"{'Ticked' if done else 'Unticked'}: {hit['text']}"
    raise HTTPException(status_code=422, detail="Nothing to change — send a status, a progress percentage or a checklist step.")


def ensure_checklist_done(task) -> None:
    left = [i["text"] for i in (task.checklist or []) if not i.get("done")]
    if left:
        names = ", ".join(f'"{t}"' for t in left[:3]) + (f" and {len(left) - 3} more" if len(left) > 3 else "")
        raise HTTPException(status_code=409, detail=f"{len(left)} checklist step(s) are not ticked yet: {names}. Tick them off (or ask the person who gave the task to remove them) before completing.")
