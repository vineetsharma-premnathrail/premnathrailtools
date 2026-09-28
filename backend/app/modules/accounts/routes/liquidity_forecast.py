from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.permissions import require_app_access
from app.db.session import get_db
from app.modules.main.models.user import User
from app.modules.accounts.schemas.liquidity_forecast import LiquidityForecastResponse
from app.modules.accounts.service import get_liquidity_forecast

router = APIRouter(prefix="/accounts/liquidity-forecast", tags=["Accounts"])


@router.get("", response_model=LiquidityForecastResponse)
async def liquidity_forecast_route(
    db: Session = Depends(get_db),
    _user: User = Depends(require_app_access("accounts")),
):
    return LiquidityForecastResponse(**get_liquidity_forecast(db))
