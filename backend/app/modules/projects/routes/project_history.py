"""History lists on a project's History tab: Store Issues, Purchases (requisition -> PO -> GRN) and Tasks.

Included into the Project Management router (routes/project.py), so the module gate applies too.
Each list needs Project Management > History (view) plus its own feature
(projects:project_history.<feature>) and the project inside the caller's data scope."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.data_scope import ensure_in_scope
from app.core.permissions import require_app_access, require_feature_action, require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.projects import history
from app.modules.projects.models.project import PmProject

router = APIRouter(dependencies=[Depends(require_app_access("projects")), Depends(require_tab_access("projects", "project_history"))])


def _project_or_404(db: Session, project_id: int, user: User) -> PmProject:
    project = db.get(PmProject, project_id)
    if not project:
        raise HTTPException(status_code=404, detail=f"Project #{project_id} not found — it may have been deleted. Go back to All Projects.")
    ensure_in_scope(db, user, project)
    return project


@router.get("/{project_id}/store-issues")
async def project_store_issues(
    project_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("projects", "project_history", "store_issues", "view")),
):
    """Material issued from Store to this project, newest first."""
    project = _project_or_404(db, project_id, user)
    return history.store_issues(db, project.id)


@router.get("/{project_id}/purchases")
async def project_purchases(
    project_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("projects", "project_history", "purchases", "view")),
):
    """Requisitions charged to this project with their purchase orders and goods receipts, newest first.
    PO values are blank unless the caller holds Procurement > Purchase Orders > Prices."""
    project = _project_or_404(db, project_id, user)
    return history.purchases(db, project.id, history.sees_po_values(user))


@router.get("/{project_id}/task-history")
async def project_task_history(
    project_id: int, db: Session = Depends(get_db),
    user: User = Depends(require_feature_action("projects", "project_history", "task_history", "view")),
):
    """Every task of this project: open ones first by due date, then finished ones."""
    project = _project_or_404(db, project_id, user)
    return history.task_history(db, project.id)
