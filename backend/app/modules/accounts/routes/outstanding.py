from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import ensure_feature_action, require_tab_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.services import outstanding
from app.modules.accounts.services import fiscal
from app.modules.accounts.routes._common import service_errors

router = APIRouter(prefix="/accounts/outstanding", tags=["Accounts"])


def _party_type(v: str, user: User | None = None) -> str:
    if v not in ("vendor", "customer"):
        raise HTTPException(status_code=400, detail="party_type must be 'vendor' (payables) or 'customer' (receivables).")
    if user is not None:
        if v == "customer":
            ensure_feature_action(user, "accounts", "outstanding", "receivables", "view")
        else:
            ensure_feature_action(user, "accounts", "outstanding", "payables", "view")
    return v


@router.get("")
async def party_outstanding_route(party_type: str = Query(...), as_of: date | None = Query(None), db: Session = Depends(get_db),
                                  user: User = Depends(require_tab_access("accounts", "outstanding"))):
    """as_of = key date (S_ALR_87012078/87012168): what was open on that date."""
    return outstanding.party_outstanding(db, party_type=_party_type(party_type, user), as_of=as_of)


@router.get("/bills")
async def open_bills_route(party_type: str = Query(...), party_id: int | None = Query(None), as_of: date | None = Query(None),
                           db: Session = Depends(get_db), user: User = Depends(require_tab_access("accounts", "outstanding"))):
    return {"documents": outstanding.open_documents(db, party_type=_party_type(party_type, user), party_id=party_id, as_of=as_of),
            "credits": outstanding.open_credits(db, party_type=party_type, party_id=party_id, as_of=as_of)}


@router.get("/statement")
async def party_statement_route(
    party_type: str = Query(...),
    party_id: int = Query(...),
    from_date: date | None = Query(None),
    to_date: date | None = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(require_tab_access("accounts", "outstanding")),
):
    to_date = to_date or date.today()
    with service_errors(db):
        from_date = from_date or fiscal.fiscal_year_for(db, to_date).start_date
        return outstanding.party_statement(db, party_type=_party_type(party_type, user), party_id=party_id, from_date=from_date, to_date=to_date)
