"""GET /p2p/account-assignment/options — open sales orders, cost centres,
work orders and internal orders a requisition can be charged to (PR form
picker; requesters need no access to Sales / Production / Finance for it)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.p2p.account_assignment import P2P_ACCOUNT_ASSIGNMENTS, options

router = APIRouter(prefix="/p2p/account-assignment", tags=["P2P"])


@router.get("/options")
async def account_assignment_options(kind: str = Query(...), search: str | None = Query(None), db: Session = Depends(get_db),
                                     _user: User = Depends(require_app_access("p2p"))):
    try:
        return {"kind": kind, "label": P2P_ACCOUNT_ASSIGNMENTS.get(kind), "options": options(db, kind, search)}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
