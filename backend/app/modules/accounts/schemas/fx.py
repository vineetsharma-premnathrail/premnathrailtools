from datetime import date, datetime
from pydantic import BaseModel, Field


class CurrencyCreate(BaseModel):
    code: str
    name: str
    symbol: str | None = None
    is_active: bool = True


class CurrencyUpdate(BaseModel):
    name: str | None = None
    symbol: str | None = None
    is_active: bool | None = None


class ExchangeRateCreate(BaseModel):
    currency: str
    rate_date: date
    rate: float
    rate_type: str = "bank"
    source: str | None = None


class FxRevaluationCreate(BaseModel):
    accounting_period: str
    # Closing rates to use, {currency: rate}; blank = the rate master's rate on the month end.
    rates: dict[str, float] = Field(default_factory=dict)


class FxRevaluationCancelPayload(BaseModel):
    reason: str


class CurrencyResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    code: str
    name: str
    symbol: str | None = None
    is_active: bool

    latest_rate: float | None = None
    latest_rate_date: date | None = None


class ExchangeRateResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    currency: str
    rate_date: date
    rate_type: str
    rate: float
    source: str | None = None
    created_at: datetime | None = None


class FxRevaluationResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    accounting_period: str
    revaluation_date: date
    rates: dict | None = None
    lines: list | None = None
    total_gain: float
    total_loss: float
    status: str
    journal_entry_id: int | None = None
    reversal_reason: str | None = None
    created_at: datetime | None = None

    journal_entry_number: str | None = None
