"""Timeline of an R&D requirement (a CRM Inquiry / Tender sent to R&D).

Milestones, Share Department and the Access tab were removed on 2026-10-30
(R&D rework: tasks only). Their tables stay as history; what is left in this
module is the requirement's Timeline (the old "History" tab, same endpoint and
the same `history` feature key so existing role grants keep working).

Newest first: every revision BD sent (who, when, which fields changed — old to
new), accept / return with the reason, the response, task events, offers,
documents and project links. Source: the revision table, audit_logs
(entity_type "rnd_req_<source>") and the task events.
"""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permissions import ensure_feature_action
from app.db.session import get_db
from app.modules.crm.services import requirement_movement
from app.modules.main.models.audit_log import AuditLog
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.rnd.models.requirement_work import RndRequirementTask, RndTaskEvent
from app.modules.rnd.routes.project_milestones import task_event_text
from app.modules.rnd.routes.requirement_work import _name, _record, _require_requirement_side
from app.modules.rnd.routes.requirements import dropped_snapshot_fields, hidden_sections_for
from app.modules.rnd.services import requirement_access as ra
from app.modules.rnd.services import requirements as intake

router = APIRouter(
    prefix="/requirement-work", tags=["RnD Requirement Timeline"],
    dependencies=[Depends(_require_requirement_side)],
)

Source = Literal["inquiry", "tender"]

# Audit rows of features that no longer exist (milestones, department shares, per-document visibility,
# the Access tab) and the plain "sent" row — the revision rows below carry it with the changed fields.
_HIDDEN_ACTIONS = ("milestone", "access_", "shared_with_departments", "document_visibility", "requirement_submitted")


@router.get("/{source}/{record_id}/history")
async def requirement_history(source: Source, record_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """The requirement's Timeline, newest first (R&D side only)."""
    record = _record(db, source, record_id)
    ra.ensure(db, user, source, record_id, "view")
    if not ra.is_rnd_side(user):
        raise HTTPException(status_code=403, detail="The Timeline is on R&D's requirement page. Ask the R&D head to give you access to R&D › Requirements if you need it.")
    ensure_feature_action(user, "rnd", "requirements", "history", "view")
    logs = db.query(AuditLog).filter(AuditLog.entity_type == f"rnd_req_{source}", AuditLog.entity_id == record_id).order_by(AuditLog.id.desc()).limit(500).all()
    logs = [lg for lg in logs if not (lg.action or "").startswith(_HIDDEN_ACTIONS)]
    tasks = {t.id: t for t in db.query(RndRequirementTask).filter(RndRequirementTask.source == source, RndRequirementTask.record_id == record_id).all()}
    events = db.query(RndTaskEvent).filter(RndTaskEvent.task_id.in_(list(tasks))).order_by(RndTaskEvent.id.desc()).limit(500).all() if tasks else []
    uids = {lg.performed_by_id for lg in logs if lg.performed_by_id} | {e.user_id for e in events if e.user_id} | {t.assigned_to_id for t in tasks.values()}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(uids)).all()} if uids else {}
    rows = [{
        "id": f"a{lg.id}", "kind": "requirement", "action": lg.action, "summary": lg.summary or lg.action,
        "performed_by": _name(users.get(lg.performed_by_id)) if lg.performed_by_id else "System",
        "performed_at": lg.performed_at.isoformat() if lg.performed_at else None,
    } for lg in logs]
    for e in events:
        t = tasks[e.task_id]
        rows.append({
            "id": f"t{e.id}", "kind": "task", "action": e.action, "summary": task_event_text(e, t, users),
            "performed_by": _name(users.get(e.user_id)) if e.user_id else "System",
            "performed_at": e.created_at.isoformat() if e.created_at else None,
        })
    # Revisions: who sent each one and which fields changed (hidden sections stay hidden).
    req = intake.get(db, source, record_id)
    if req is not None:
        movements = requirement_movement.list_movements(db, module=source, record=record)
        dropped = dropped_snapshot_fields(hidden_sections_for(user))
        for rev in intake.revisions_out(db, req, movements, mask=dropped):
            rows.append({
                "id": f"r{rev['revision_no']}", "kind": "revision", "action": "requirement_submitted",
                "summary": f"{rev['revision_code']} received from BD — sent by {rev['submitted_by'] or 'BD'}"
                           + (f"; changed: {', '.join(rev['changed_fields'])}" if rev["changed_fields"] else ""),
                "performed_by": rev["submitted_by"] or "System", "performed_at": rev["submitted_at"],
                "revision_code": rev["revision_code"], "status": rev["status"], "changes": rev["changes"],
            })
    rows.sort(key=lambda r: r["performed_at"] or "", reverse=True)
    return rows
