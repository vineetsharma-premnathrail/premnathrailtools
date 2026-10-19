from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_tab_access, require_tab_action, require_feature_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.services import gst_returns
from app.modules.accounts.routes._common import write_audit, who, service_errors, require_finance_manager

router = APIRouter(prefix="/accounts/gst", tags=["Accounts"])


def _period(period: str | None) -> str:
    return period or date.today().strftime("%Y-%m")


@router.get("/register")
async def gst_register_route(
    kind: str = Query("sales", description="sales | purchase"),
    from_date: date = Query(...),
    to_date: date = Query(...),
    db: Session = Depends(get_db),
    _user: User = Depends(require_tab_access("accounts", "gst")),
):
    if kind not in ("sales", "purchase"):
        raise HTTPException(status_code=400, detail="kind must be 'sales' or 'purchase'.")
    return gst_returns.gst_register(db, kind=kind, from_date=from_date, to_date=to_date)


@router.get("/gstr1")
async def gstr1_route(period: str | None = Query(None), db: Session = Depends(get_db), _user: User = Depends(require_feature_action("accounts", "gst", "gstr1", "view"))):
    with service_errors(db):
        return gst_returns.gstr1(db, period=_period(period))


@router.get("/gstr3b")
async def gstr3b_route(period: str | None = Query(None), db: Session = Depends(get_db), _user: User = Depends(require_feature_action("accounts", "gst", "gstr3b", "view"))):
    with service_errors(db):
        return gst_returns.gstr3b(db, period=_period(period))


@router.get("/setoff")
async def setoff_preview_route(period: str | None = Query(None), db: Session = Depends(get_db), _user: User = Depends(require_feature_action("accounts", "gst", "itc_setoff", "view"))):
    with service_errors(db):
        calc = gst_returns.compute_setoff(db, period=_period(period))
    calc.pop("ledger_ids", None)
    return calc


@router.post("/setoff")
async def setoff_post_route(period: str = Query(...), db: Session = Depends(get_db), user: User = Depends(require_feature_action("accounts", "gst", "itc_setoff", "approve"))):
    require_finance_manager(user, "post the GST set-off")
    with service_errors(db):
        entry = gst_returns.post_setoff(db, period=period, user_id=user.id)
    write_audit(db, "journal_entry", entry.id, "posted", user, f"{who(user)} posted the GST set-off for {period} ({entry.entry_number}).")
    db.commit()
    return {"journal_entry_id": entry.id, "entry_number": entry.entry_number, "amount": entry.total_debit}
