"""History lists on a machine page: Store Issues, Purchases (requisition -> PO -> GRN) and Tasks.

Included into the machine router (routes/projects.py, /erp/projects). Each list needs Past Projects
(machines) view plus its own feature (projects:all_projects.<feature>) and the machine inside the
caller's data scope. Purchases and tasks are those of the machine's linked Project Management project
(empty when the machine has none); issues also include those made to the machine itself and to its
service requests."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.data_scope import ensure_in_scope
from app.core.permissions import require_any_app_access, require_feature_action, require_tab_access
from app.db.session import get_db
from app.modules.erp.models.project import Project
from app.modules.main.models.user import User
from app.modules.projects import history

router = APIRouter(dependencies=[
    Depends(require_any_app_access("erp", "projects")), Depends(require_tab_access("projects", "all_projects")),
])


def _machine_or_404(db: Session, machine_id: int, user: User) -> Project:
    machine = db.query(Project).filter(Project.id == machine_id, Project.is_deleted == False).first()  # noqa: E712
    if not machine:
        raise HTTPException(
            status_code=404,
            detail=f"No machine with id {machine_id} — it may have been deleted or moved to the Recycle Bin. Open it from the Machines list.")
    ensure_in_scope(db, user, machine)
    return machine


@router.get("/{machine_id}/store-issues")
async def machine_store_issues(
    machine_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("projects", "all_projects", "store_issues", "view")),
):
    """Material issued to the machine, to its service requests or to its project, newest first."""
    machine = _machine_or_404(db, machine_id, user)
    return history.store_issues(db, machine.pm_project_id, machine.id)


@router.get("/{machine_id}/purchases")
async def machine_purchases(
    machine_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("projects", "all_projects", "purchases", "view")),
):
    """Requisitions charged to the machine's project with their POs and goods receipts, newest first.
    PO values are blank unless the caller holds Procurement > Purchase Orders > Prices."""
    machine = _machine_or_404(db, machine_id, user)
    return history.purchases(db, machine.pm_project_id, history.sees_po_values(user))


@router.get("/{machine_id}/task-history")
async def machine_task_history(
    machine_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("projects", "all_projects", "task_history", "view")),
):
    """Every task of the machine's project: open ones first by due date, then finished ones."""
    machine = _machine_or_404(db, machine_id, user)
    return history.task_history(db, machine.pm_project_id)
