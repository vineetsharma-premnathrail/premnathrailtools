"""GET /store/reorder — items at or below their reorder point, net of what
is already on order (store/services/reorder.py), with a suggested quantity
for a one-click purchase requisition."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.store.services.reorder import reorder_rows

router = APIRouter(prefix="/store/reorder", tags=["Store"])


@router.get("")
async def reorder_list(
    category: str | None = Query(None),
    due_only: bool = Query(True, description="Only items at / below their reorder point"),
    branch_id: int | None = Query(None, description="Plan one plant (material master plant views)"),
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_access("store", "stock")),
):
    return reorder_rows(db, category=category, due_only=due_only, branch_id=branch_id)
