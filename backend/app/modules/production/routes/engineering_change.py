"""CC01/ECM read-out shared by Design (ECN page) and Production: open work
orders hit by an engineering change, and the Production BOMs raised under it."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.modules.design.models.change_notice import DesignChangeNotice
from app.modules.main.models.user import User
from app.modules.main.routes.auth import get_current_user
from app.modules.production import ecm

router = APIRouter(prefix="/production/ecm", tags=["Production"])


def _design_or_production(user: User = Depends(get_current_user)) -> User:
    apps = set(user.get_apps())
    if not apps & {"production", "design"}:
        raise HTTPException(status_code=403, detail="You need the Production or Design module to see the orders an ECN affects. "
                                                    "Ask an admin to grant one in Users › Permission Matrix.")
    return user


@router.get("/change-notices/{ecn_id}/affected-orders")
async def ecn_affected_orders(ecn_id: int, db: Session = Depends(get_db), _user: User = Depends(_design_or_production)):
    ecn = db.query(DesignChangeNotice).filter(DesignChangeNotice.id == ecn_id, DesignChangeNotice.is_deleted == False).first()  # noqa: E712
    if ecn is None:
        raise HTTPException(status_code=404, detail=f"ECN #{ecn_id} not found")
    return ecm.affected_orders(db, ecn)
