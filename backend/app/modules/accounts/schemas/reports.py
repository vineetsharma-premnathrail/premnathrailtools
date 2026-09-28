from datetime import date
from pydantic import BaseModel, Field


class TrialBalanceRow(BaseModel):
    gl_account_id: int
    code: str
    name: str
    account_type: str
    opening_balance: float
    total_debits: float
    total_credits: float
    closing_balance: float


class TrialBalanceResponse(BaseModel):
    period: str
    rows: list[TrialBalanceRow]
    total_debits: float
    total_credits: float


class GLLedgerRow(BaseModel):
    entry_number: str
    posting_date: date
    description: str | None = None
    debit_amount: float
    credit_amount: float
    running_balance: float


class GLLedgerResponse(BaseModel):
    gl_account_code: str
    gl_account_name: str
    opening_balance: float
    closing_balance: float
    rows: list[GLLedgerRow]


class AgingRow(BaseModel):
    invoice_number: str
    party_name: str
    due_date: date
    amount_due: float
    bucket: str


class AgingResponse(BaseModel):
    rows: list[AgingRow]
    total_due: float


class ProfitAndLossLine(BaseModel):
    code: str
    name: str
    amount: float


class ProfitAndLossResponse(BaseModel):
    period: str
    revenue_rows: list[ProfitAndLossLine]
    expense_rows: list[ProfitAndLossLine]
    total_revenue: float
    total_expense: float
    net_profit: float


class BalanceSheetLine(BaseModel):
    gl_account_id: int
    code: str
    name: str
    amount: float


class BalanceSheetResponse(BaseModel):
    period: str
    asset_rows: list[BalanceSheetLine]
    liability_rows: list[BalanceSheetLine]
    equity_rows: list[BalanceSheetLine]
    total_assets: float
    total_liabilities: float
    total_equity: float
    current_period_earnings: float
    total_equity_and_earnings: float
    total_liabilities_and_equity: float
    is_balanced: bool


class VarianceRow(BaseModel):
    type: str
    code: str
    name: str
    budgeted_amount: float
    actual_amount: float
    variance: float
    variance_pct: float | None = None


class VarianceAnalysisResponse(BaseModel):
    from_period: str
    to_period: str
    rows: list[VarianceRow]
    note: str | None = None


class MonthlyReportPackResponse(BaseModel):
    period: str
    trial_balance: TrialBalanceResponse
    profit_and_loss: ProfitAndLossResponse
    balance_sheet: BalanceSheetResponse
    ap_aging: AgingResponse
    ar_aging: AgingResponse
    aging_note: str
