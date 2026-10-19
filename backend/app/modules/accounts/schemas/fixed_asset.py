from datetime import date, datetime
from pydantic import BaseModel, Field


class FixedAssetCreate(BaseModel):
    asset_code: str
    name: str
    description: str | None = None
    asset_gl_account_id: int
    accumulated_depreciation_gl_account_id: int | None = None
    depreciation_expense_gl_account_id: int | None = None
    cost_center_id: int | None = None
    vendor_invoice_id: int | None = None
    location: str | None = None
    purchase_date: date
    put_to_use_date: date
    cost: float
    residual_value: float = 0
    depreciation_method: str = "slm"
    useful_life_months: int | None = None
    wdv_rate_pct: float | None = None
    opening_accumulated_depreciation: float = 0


class FixedAssetUpdate(BaseModel):
    """Only descriptive fields — cost, dates and method drive depreciation
    already charged, so they can't change after the asset is registered."""
    name: str | None = None
    description: str | None = None
    location: str | None = None
    cost_center_id: int | None = None


class FixedAssetDisposePayload(BaseModel):
    disposal_date: date
    proceeds: float = 0
    proceeds_gl_account_id: int | None = None


class DepreciationRunCreate(BaseModel):
    accounting_period: str


class DepreciationRunReversePayload(BaseModel):
    reason: str


class FixedAssetResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    asset_code: str
    name: str
    description: str | None = None
    asset_gl_account_id: int
    accumulated_depreciation_gl_account_id: int | None = None
    depreciation_expense_gl_account_id: int | None = None
    cost_center_id: int | None = None
    vendor_invoice_id: int | None = None
    location: str | None = None
    purchase_date: date
    put_to_use_date: date
    cost: float
    residual_value: float
    depreciation_method: str
    useful_life_months: int | None = None
    wdv_rate_pct: float | None = None
    opening_accumulated_depreciation: float
    accumulated_depreciation: float
    depreciated_up_to: date | None = None
    status: str
    disposal_date: date | None = None
    disposal_proceeds: float | None = None
    disposal_journal_entry_id: int | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None

    book_value: float = 0
    asset_gl_account_name: str | None = None


class DepreciationRunLineResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    fixed_asset_id: int
    amount: float
    book_value_before: float
    days: int
    asset_code: str | None = None
    asset_name: str | None = None


class DepreciationRunResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    accounting_period: str
    run_date: date
    total_amount: float
    status: str
    journal_entry_id: int | None = None
    created_at: datetime | None = None
    lines: list[DepreciationRunLineResponse] = Field(default_factory=list)
