"""GET/PUT /p2p/settings and POST /p2p/settings/reset/{key} — Procurement
company terms and notification rules (app/modules/p2p/settings.py), plus the
read-only GET /p2p/approval-flow summary of the approval workflows."""
from fastapi import Depends, HTTPException

from app.core.permissions import ensure_tab_action
from app.core.settings_framework import make_settings_router
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
import app.modules.p2p.settings  # noqa: F401 — registers the Procurement settings


def _procurement_user(user: User = Depends(get_current_user)) -> User:
    # Requesters hold `p2p`, the purchase team `purchase` — either may read the settings.
    if user.role == "admin" or {"p2p", "purchase"} & set(user.get_apps()):
        return user
    raise HTTPException(status_code=403, detail="You don't have access to Procurement, so you can't open its settings — "
                                                "ask an admin to give you Procurement in Users.")


def _settings_viewer(user: User = Depends(get_current_user)) -> User:
    # Reading Procurement › Settings needs 'View' on that tab; saving is
    # additionally gated by the framework on p2p:settings:edit.
    ensure_tab_action(user, "p2p", "settings", "view")
    return user


router = make_settings_router("p2p", app_access_dep=_settings_viewer)


# ---- read-only summary of who approves what (Settings card, New PR form)
from fastapi import APIRouter  # noqa: E402
from sqlalchemy.orm import Session  # noqa: E402

from app.db.session import get_db  # noqa: E402
from app.modules.organization.services import approval_engine as engine  # noqa: E402
from app.modules.p2p.approvals import PO_KEY, PR_KEY, seed_workflows  # noqa: E402

flow_router = APIRouter(prefix="/p2p/approval-flow", tags=["P2P"])


# Read-only "who approves what" card shown on the New PR form and Settings —
# a lookup every Procurement user needs, so it stays on module access only.
# The routing itself is Organization › Approval Workflows ("Purchase
# requisition" / "Purchase order"); this previews it for the viewer.
@flow_router.get("")
def approval_flow(db: Session = Depends(get_db), user: User = Depends(_procurement_user)):
    seed_workflows(db)
    db.commit()
    out = {}
    for name, key in (("pr", PR_KEY), ("po", PO_KEY)):
        wf = engine.ensure_workflow(db, key)
        out[name] = {
            "key": key, "is_active": wf.is_active,
            "stages": engine.preview(db, key, requester=user, context={}, branch_id=getattr(user, "branch_id", None)),
        }
    return out
