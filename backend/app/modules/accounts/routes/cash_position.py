"""Cash position & liquidity forecast (FF7A / FF7B) and the planned cash
items that feed it — on the Liquidity Forecast tab (view; create / edit /
delete for planned items)."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_tab_access, require_tab_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.models.bank_account import BankAccount
from app.modules.accounts.models.cash_forecast_item import (
    CASH_FORECAST_CATEGORIES, CASH_FORECAST_DIRECTIONS, CASH_FORECAST_RECURRENCES, CashForecastItem,
)
from app.modules.accounts.routes._common import service_errors, user_names
from app.modules.accounts.schemas.cash_position import (
    CashForecastItemCreate, CashForecastItemResponse, CashForecastItemUpdate, CashPositionResponse,
)
from app.modules.accounts.services.cash_position import get_cash_position

router = APIRouter(prefix="/accounts/cash-position", tags=["Accounts"])


def _check(db: Session, item: CashForecastItem) -> None:
    if item.direction not in CASH_FORECAST_DIRECTIONS:
        raise HTTPException(status_code=400, detail="Direction must be 'inflow' (money coming in) or 'outflow' (money going out).")
    if item.category not in CASH_FORECAST_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Unknown category '{item.category}' — use one of: {', '.join(CASH_FORECAST_CATEGORIES)}.")
    if item.recurrence not in CASH_FORECAST_RECURRENCES:
        raise HTTPException(status_code=400, detail="Repeat must be none, weekly or monthly.")
    if item.end_date and item.end_date < item.expected_date:
        raise HTTPException(status_code=400, detail="The repeat-until date is before the first date.")
    if item.bank_account_id and not db.query(BankAccount).filter(BankAccount.id == item.bank_account_id).first():
        raise HTTPException(status_code=400, detail="The bank account picked no longer exists — pick another or leave it blank.")


def _out(db: Session, items: list[CashForecastItem]) -> list[CashForecastItemResponse]:
    names = user_names(db, {i.created_by_id for i in items})
    return [CashForecastItemResponse.model_validate(i).model_copy(update={
        "category_label": CASH_FORECAST_CATEGORIES.get(i.category), "created_by_name": names.get(i.created_by_id)}) for i in items]


@router.get("", response_model=CashPositionResponse)
async def cash_position(weeks: int = Query(13, ge=1, le=52), db: Session = Depends(get_db),
                        _user: User = Depends(require_tab_access("accounts", "liquidity"))):
    with service_errors(db):
        return CashPositionResponse(**get_cash_position(db, weeks=weeks))


@router.get("/categories")
async def categories(_user: User = Depends(require_tab_access("accounts", "liquidity"))):
    return [{"value": k, "label": v} for k, v in CASH_FORECAST_CATEGORIES.items()]


@router.get("/items", response_model=list[CashForecastItemResponse])
async def list_items(db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "liquidity"))):
    items = db.query(CashForecastItem).order_by(CashForecastItem.is_active.desc(), CashForecastItem.expected_date).all()
    return _out(db, items)


@router.post("/items", response_model=CashForecastItemResponse, status_code=201)
async def create_item(payload: CashForecastItemCreate, db: Session = Depends(get_db),
                      user: User = Depends(require_tab_action("accounts", "liquidity", "create"))):
    item = CashForecastItem(**payload.model_dump(), is_active=True, created_by_id=user.id)
    item.amount = round(item.amount, 2)
    _check(db, item)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _out(db, [item])[0]


@router.patch("/items/{item_id}", response_model=CashForecastItemResponse)
async def update_item(item_id: int, payload: CashForecastItemUpdate, db: Session = Depends(get_db),
                      _user: User = Depends(require_tab_action("accounts", "liquidity", "edit"))):
    item = db.query(CashForecastItem).filter(CashForecastItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail=f"Planned item #{item_id} doesn't exist — reload the list.")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    _check(db, item)
    db.commit()
    db.refresh(item)
    return _out(db, [item])[0]


@router.delete("/items/{item_id}", status_code=204)
async def delete_item(item_id: int, db: Session = Depends(get_db),
                      _user: User = Depends(require_tab_action("accounts", "liquidity", "delete"))):
    item = db.query(CashForecastItem).filter(CashForecastItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail=f"Planned item #{item_id} doesn't exist — reload the list.")
    db.delete(item)
    db.commit()
