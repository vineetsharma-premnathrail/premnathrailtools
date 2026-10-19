from datetime import date, datetime
from pydantic import BaseModel


class AssetMasterFields(BaseModel):
    """The register fields of a new asset whose cost comes from elsewhere
    (an invoice line or a capital order)."""
    asset_code: str
    name: str
    description: str | None = None
    accumulated_depreciation_gl_account_id: int | None = None
    depreciation_expense_gl_account_id: int | None = None
    cost_center_id: int | None = None
    location: str | None = None
    purchase_date: date | None = None
    put_to_use_date: date | None = None
    residual_value: float = 0
    depreciation_method: str = "slm"
    useful_life_months: int | None = None
    wdv_rate_pct: float | None = None
    quantity: float = 1
    it_block_id: int | None = None


class AssetFromInvoiceLineCreate(AssetMasterFields):
    vendor_invoice_line_id: int
    # Blank = everything still open on the line.
    cost: float | None = None
    # Only for a line booked to a non-asset ledger (reclassified on capitalisation).
    asset_gl_account_id: int | None = None


class AssetFromOrderCreate(AssetMasterFields):
    internal_order_id: int
    settlement_date: date
    asset_gl_account_id: int
    # Blank = the order's whole unsettled spend.
    amount: float | None = None


class AssetRetirementCreate(BaseModel):
    retirement_date: date
    retirement_type: str  # scrap | sale
    retire_percent: float | None = None
    retire_quantity: float | None = None
    sale_value: float = 0
    customer_id: int | None = None
    gst_rate: float | None = None
    hsn_sac_code: str | None = None
    reason: str


class AssetTaxBlockPayload(BaseModel):
    it_block_id: int | None = None


class ITAssetBlockCreate(BaseModel):
    code: str
    name: str
    rate_pct: float
    is_active: bool = True


class ITAssetBlockUpdate(BaseModel):
    name: str | None = None
    rate_pct: float | None = None
    is_active: bool | None = None


class ITBlockOpeningPayload(BaseModel):
    fy_code: str
    opening_wdv: float


class AssetRetirementResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    fixed_asset_id: int
    retirement_date: date
    retirement_type: str
    retire_percent: float
    retire_quantity: float | None = None
    catch_up_depreciation: float
    retired_cost: float
    retired_accumulated_depreciation: float
    sale_value: float
    gain_loss: float
    customer_id: int | None = None
    gst_rate: float | None = None
    hsn_sac_code: str | None = None
    ar_transaction_id: int | None = None
    journal_entry_id: int | None = None
    reason: str | None = None
    status: str
    created_at: datetime | None = None

    asset_code: str | None = None
    asset_name: str | None = None
    customer_name: str | None = None
    ar_invoice_number: str | None = None
    ar_status: str | None = None
    journal_entry_number: str | None = None


class ITAssetBlockResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    code: str
    name: str
    rate_pct: float
    is_active: bool

    asset_count: int = 0
