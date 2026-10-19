"""Store settings endpoints.

The Issue Rules (which issue types need a vendor / return date / challan)
were retired on 2026-10-12: what every issue type asks for is now a fixed
standard in code (store/issue_forms.py, GET /store/material-issues/form-standard)."""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User

router = APIRouter(prefix="/store/settings", tags=["Store"])


# ── Plant visibility label ─────────────────────────────────────────────────
# The old Plant Access list (GET/PUT /plant-access) moved to the central data
# scope: Organization › Role & Permissions (Data access) and the user page.
# See services/plant_access.py (migrate_store_plant_access).

@router.get("/plant-access/me")
async def my_plant_access(db: Session = Depends(get_db), user: User = Depends(require_app_access("store"))):
    """What the Stock pages show as "Showing stock of: <plant>"."""
    from app.modules.organization.models.branch import Branch
    from app.modules.store.services.plant_access import user_plant_ids

    plants = user_plant_ids(db, user)
    if plants is None:
        return {"restricted": False, "plant_names": []}
    names = [b.name for b in db.query(Branch).filter(Branch.id.in_(plants or {-1})).order_by(Branch.name.asc()).all()]
    return {"restricted": True, "plant_names": names}
