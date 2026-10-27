"""Project lifecycle stage (Planned -> ... -> Closed / Delivered).

One definition for the whole app. The stage is separate from the PM workflow
`status` (planning / active / on_hold / ... which still drives hold, cancel,
close). The project manager moves the stage forward; a machine linked to the
project mirrors it; Service only works on machines at a serviceable stage.

Imports of other modules are lazy on purpose: erp schemas import this file."""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.modules.main.models.user import User
from app.modules.projects.models.project import PmProject

LIFECYCLE_STAGES = (
    "planned", "design", "manufacturing", "assembly", "testing",
    "ready_for_dispatch", "dispatched", "commissioning", "handover", "closed",
)
STAGE_LABELS = {
    "planned": "Planned", "design": "Design", "manufacturing": "Manufacturing", "assembly": "Assembly",
    "testing": "Testing", "ready_for_dispatch": "Ready for Dispatch", "dispatched": "Dispatched",
    "commissioning": "Commissioning", "handover": "Handover", "closed": "Closed / Delivered",
}
SERVICEABLE_STAGES = ("dispatched", "commissioning", "handover", "closed")
_UNIT_DISPATCHED = ("dispatched", "delivered")


def stage_label(key: str | None) -> str:
    return STAGE_LABELS.get(key or "", key or "-")


def stage_index(key: str | None) -> int:
    """Position in the lifecycle; -1 for an unknown key."""
    try:
        return LIFECYCLE_STAGES.index(key)  # type: ignore[arg-type]
    except ValueError:
        return -1


def is_serviceable(key: str | None) -> bool:
    return key in SERVICEABLE_STAGES


def stage_options() -> list[dict]:
    return [{"key": k, "label": STAGE_LABELS[k]} for k in LIFECYCLE_STAGES]


def validate_stage(stage: str | None) -> str:
    key = (stage or "").strip()
    if key not in LIFECYCLE_STAGES:
        raise HTTPException(
            status_code=422,
            detail=f"'{stage}' is not a project stage. Pick one of: {', '.join(STAGE_LABELS[k] for k in LIFECYCLE_STAGES)}.",
        )
    return key


def mirror_to_machines(db: Session, project: PmProject, stage: str) -> int:
    """Copies the stage onto every live machine registered with the project."""
    from app.modules.erp.models.project import Project as Machine
    n = 0
    for m in db.query(Machine).filter(Machine.pm_project_id == project.id, Machine.is_deleted == False).all():  # noqa: E712
        if m.lifecycle_stage != stage:
            m.lifecycle_stage = stage
            n += 1
    return n


def set_stage(db: Session, project: PmProject, stage: str, user: User, reason: str | None = None,
              auto: bool = False) -> bool:
    """Moves the project to `stage`. No commit. Returns False when nothing changed.

    Forward (any number of steps) is the project manager's / management's call, checked by the
    route. Going back needs an admin or Partner and a reason (422 without)."""
    from app.modules.projects import workflow as wf
    stage = validate_stage(stage)
    old = project.lifecycle_stage or "planned"
    if stage == old:
        return False
    backwards = stage_index(stage) < stage_index(old)
    reason = (reason or "").strip() or None
    if backwards:
        if auto:
            return False  # never backwards automatically
        if not (wf.is_admin(user) or bool(getattr(user, "is_partner", False))):
            raise HTTPException(
                status_code=403,
                detail=f"Only an admin or a Partner can move {project.project_code} back from {stage_label(old)} to "
                       f"{stage_label(stage)}. Ask one of them, or move the project forward instead.",
            )
        if not reason:
            raise HTTPException(
                status_code=422,
                detail=f"Give a reason for moving {project.project_code} back from {stage_label(old)} to {stage_label(stage)} "
                       f"- it is written in the project's history.",
            )
    project.lifecycle_stage = stage
    mirrored = mirror_to_machines(db, project, stage)
    who = "the system (all units dispatched)" if auto else wf.user_label(user)
    wf.audit(
        db, project.id, user, "stage_changed",
        f"Stage: {stage_label(old)} → {stage_label(stage)} by {who}." + (f" Reason: {reason}" if reason else "")
        + (f" {mirrored} linked machine(s) updated." if mirrored else ""),
        subtab_key="overview", field_name="lifecycle_stage", old_value=old, new_value=stage,
    )
    return True


def on_units_changed(db: Session, project: PmProject, user: User | None = None) -> bool:
    """D5: every live unit dispatched / delivered and the stage is earlier than 'dispatched'
    -> move to 'dispatched' (never backwards). No commit."""
    from app.modules.projects.models.element import PmProjectElement
    if stage_index(project.lifecycle_stage) >= stage_index("dispatched"):
        return False
    units = db.query(PmProjectElement.status).filter(
        PmProjectElement.project_id == project.id, PmProjectElement.status != "cancelled").all()
    if not units or any(s not in _UNIT_DISPATCHED for (s,) in units):
        return False
    actor = user
    if actor is None:
        actor = db.get(User, project.project_manager_id or project.created_by_id) if (project.project_manager_id or project.created_by_id) else None
    if actor is None:
        # audit needs a user id; stage still moves.
        project.lifecycle_stage = "dispatched"
        mirror_to_machines(db, project, "dispatched")
        return True
    return set_stage(db, project, "dispatched", actor, auto=True)


def machine_not_serviceable_message(serial: str | None, stage: str | None) -> str:
    return (f"Machine {serial} is at stage {stage_label(stage)} - it can be serviced once it is Dispatched. "
            f"Project Management moves the stage.")


def require_serviceable(machine) -> None:
    """422 when a service document is raised on a machine that has not been dispatched yet."""
    stage = getattr(machine, "lifecycle_stage", None) or "planned"
    if not is_serviceable(stage):
        raise HTTPException(status_code=422, detail=machine_not_serviceable_message(machine.serial_number, stage))
