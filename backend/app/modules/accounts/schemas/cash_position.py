from datetime import date
from datetime import date as _Date
from pydantic import BaseModel, Field


class CashForecastItemCreate(BaseModel):
    direction: str
    category: str
    description: str = Field(min_length=1, max_length=255)
    amount: float = Field(gt=0)
    expected_date: date
    recurrence: str = "none"
    end_date: date | None = None
    bank_account_id: int | None = None


class CashForecastItemUpdate(BaseModel):
    direction: str | None = None
    category: str | None = None
    description: str | None = Field(default=None, min_length=1, max_length=255)
    amount: float | None = Field(default=None, gt=0)
    expected_date: date | None = None
    recurrence: str | None = None
    end_date: date | None = None
    bank_account_id: int | None = None
    is_active: bool | None = None


class CashForecastItemResponse(BaseModel):
    id: int
    direction: str
    category: str
    description: str
    amount: float
    expected_date: date
    recurrence: str
    end_date: date | None = None
    bank_account_id: int | None = None
    is_active: bool

    model_config = {"from_attributes": True}

    category_label: str | None = None
    created_by_name: str | None = None


class CashPositionRow(BaseModel):
    category: str
    direction: str
    label: str
    overdue: float
    weeks: list[float]
    later: float
    unscheduled: float
    total: float


class CashPositionColumn(BaseModel):
    key: str
    inflows: float
    outflows: float
    net: float
    closing_balance: float


class CashPositionWeek(BaseModel):
    key: str
    start: date
    end: date
    label: str


class CashPositionBank(BaseModel):
    bank_account_id: int
    label: str
    kind: str
    balance: float


class CashPositionItem(BaseModel):
    category: str
    direction: str
    bucket: str
    date: _Date | None = None
    reference: str | None = None
    party: str | None = None
    amount: float
    note: str | None = None


class CashPositionResponse(BaseModel):
    as_of: date
    horizon_weeks: int
    horizon_end: date
    weeks: list[CashPositionWeek]
    opening_balance: float
    bank_balances: list[CashPositionBank]
    rows: list[CashPositionRow]
    columns: list[CashPositionColumn]
    later: dict
    unscheduled: dict
    lowest_balance: float
    lowest_balance_key: str | None = None
    items: list[CashPositionItem]
