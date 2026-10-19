"""Quality analysis reports (Phase 3: defect Pareto). Phase 4 adds the
KPI dashboard and the registers."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.permission_registry import can_feature, can_view_tab
from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.quality.services.pareto import defect_pareto

router = APIRouter(prefix="/quality/analysis", tags=["Quality"], dependencies=[Depends(require_app_access("quality"))])


@router.get("/defect-pareto")
async def get_defect_pareto(basis: str = "ncr", date_from: date | None = None, date_to: date | None = None,
                            item_id: int | None = None, vendor: str | None = None, source: str | None = None,
                            db: Session = Depends(get_db), user: User = Depends(require_app_access("quality"))):
    try:
        out = defect_pareto(db, basis=basis, date_from=date_from, date_to=date_to, item_id=item_id,
                            vendor_name=vendor, source=source, user=user)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    # NCR cost of non-quality follows Quality › NCR › costs for roles holding the NCR tab.
    if can_view_tab(user, "quality", "ncr") and not can_feature(user, "quality", "ncr", "costs", "view"):
        for row in out["rows"]:
            row["cost"] = None
    return out
