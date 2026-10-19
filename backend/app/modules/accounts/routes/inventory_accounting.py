from datetime import date
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.permissions import require_tab_access, require_tab_action, require_feature_action
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.models.inventory_valuation import InventoryValuation
from app.modules.accounts.schemas.inventory_valuation import (
    InventoryValuationCreate, InventoryValuationLineUpdate, InventoryValuationCancelPayload, InventoryValuationResponse,
)
from app.modules.accounts.services import inventory, fiscal
from app.modules.accounts.routes._common import write_audit, who, service_errors, require_finance_manager

router = APIRouter(prefix="/accounts/inventory", tags=["Accounts"])


@router.get("/stock-value")
async def stock_value_route(db: Session = Depends(get_db), _user: User = Depends(require_tab_access("accounts", "inventory"))):
    return inventory.stock_value_summary(db)


@router.get("/purchase-sales-impact")
async def impact_route(from_date: date | None = Query(None), to_date: date | None = Query(None), db: Session = Depends(get_db),
                       _user: User = Depends(require_feature_action("accounts", "inventory", "purchase_sales_impact", "view"))):
    to_date = to_date or date.today()
    with service_errors(db):
        from_date = from_date or fiscal.fiscal_year_for(db, to_date).start_date
        return inventory.purchase_sales_impact(db, from_date=from_date, to_date=to_date)


@router.get("/valuations", response_model=list[InventoryValuationResponse])
async def list_valuations(db: Session = Depends(get_db), _user: User = Depends(require_feature_action("accounts", "inventory", "closing_stock", "view"))):
    return db.query(InventoryValuation).order_by(InventoryValuation.accounting_period.desc(), InventoryValuation.id.desc()).all()


@router.get("/valuations/{valuation_id}", response_model=InventoryValuationResponse)
async def get_valuation(valuation_id: int, db: Session = Depends(get_db), _user: User = Depends(require_feature_action("accounts", "inventory", "closing_stock", "view"))):
    val = inventory.load_valuation(db, valuation_id)
    if not val:
        raise HTTPException(status_code=404, detail="Valuation not found")
    return val


@router.post("/valuations", response_model=InventoryValuationResponse, status_code=201)
async def create_valuation_route(payload: InventoryValuationCreate, db: Session = Depends(get_db),
                                 user: User = Depends(require_feature_action("accounts", "inventory", "closing_stock", "create"))):
    with service_errors(db):
        val = inventory.create_valuation(db, accounting_period=payload.accounting_period, created_by_id=user.id, notes=payload.notes)
    write_audit(db, "inventory_valuation", val.id, "created", user, f"{who(user)} drafted the closing-stock valuation for {val.accounting_period} ({val.total_value:,.2f}).")
    db.commit()
    return inventory.load_valuation(db, val.id)


@router.patch("/valuation-lines/{line_id}", response_model=InventoryValuationResponse)
async def update_valuation_line_route(line_id: int, payload: InventoryValuationLineUpdate, db: Session = Depends(get_db),
                                      _user: User = Depends(require_feature_action("accounts", "inventory", "closing_stock", "edit"))):
    with service_errors(db):
        line = inventory.update_valuation_line(db, line_id=line_id, quantity=payload.quantity, rate=payload.rate)
    db.commit()
    return inventory.load_valuation(db, line.inventory_valuation_id)


@router.post("/valuations/{valuation_id}/post", response_model=InventoryValuationResponse)
async def post_valuation_route(valuation_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db),
                               user: User = Depends(require_feature_action("accounts", "inventory", "closing_stock", "approve"))):
    from app.modules.accounts import role_events_b
    require_finance_manager(user, "post closing stock")
    with service_errors(db):
        val = inventory.post_valuation(db, valuation_id=valuation_id, posted_by_id=user.id)
    write_audit(db, "inventory_valuation", val.id, "posted", user, f"{who(user)} posted closing stock for {val.accounting_period} ({val.total_value:,.2f}).")
    role_events_b.fire(
        db, "closing_stock_posted", title=f"Closing stock for {val.accounting_period} posted",
        message=(f"{who(user)} posted closing stock of {val.total_value:,.2f} for {val.accounting_period}; it reverses on the 1st as "
                 "opening stock. The month's P&L now shows cost of materials consumed (Finance › Inventory › Closing Stock)."),
        entity_type="inventory_valuation", entity_id=val.id, actor=user, background_tasks=background_tasks)
    db.commit()
    return inventory.load_valuation(db, val.id)


@router.post("/valuations/{valuation_id}/cancel", response_model=InventoryValuationResponse)
async def cancel_valuation_route(valuation_id: int, payload: InventoryValuationCancelPayload, db: Session = Depends(get_db),
                                 user: User = Depends(require_feature_action("accounts", "inventory", "closing_stock", "cancel"))):
    require_finance_manager(user, "cancel a closing-stock valuation")
    with service_errors(db):
        val = inventory.cancel_valuation(db, valuation_id=valuation_id, user_id=user.id, reason=payload.reason)
    write_audit(db, "inventory_valuation", val.id, "cancelled", user, f"{who(user)} cancelled closing stock for {val.accounting_period}: {payload.reason}")
    db.commit()
    return inventory.load_valuation(db, val.id)
