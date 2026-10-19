from datetime import date
from pydantic import BaseModel


class AccountGroupCreate(BaseModel):
    code: str
    name: str
    parent_id: int
    schedule_iii_head: str | None = None
    affects_gross_profit: bool | None = None
    sequence: int = 0


class AccountGroupUpdate(BaseModel):
    name: str | None = None
    schedule_iii_head: str | None = None
    sequence: int | None = None


class AccountGroupResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    code: str
    name: str
    parent_id: int | None = None
    nature: str
    schedule_iii_head: str
    affects_gross_profit: bool
    sequence: int
    is_system: bool
    parent_name: str | None = None
    schedule_iii_label: str | None = None
    ledger_count: int = 0


class LedgerSettingUpdate(BaseModel):
    role: str
    gl_account_id: int | None = None


class LedgerSettingResponse(BaseModel):
    role: str
    label: str
    default_code: str
    gl_account_id: int | None = None
    gl_account_code: str | None = None
    gl_account_name: str | None = None
    is_default: bool = True


class GSTRateCreate(BaseModel):
    rate: float
    description: str | None = None
    is_active: bool = True


class GSTRateUpdate(BaseModel):
    description: str | None = None
    is_active: bool | None = None


class GSTRateResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    rate: float
    description: str | None = None
    is_active: bool


class FinancialYearInfo(BaseModel):
    code: str
    start_date: date
    end_date: date
    status: str
    lock_date: date | None = None
    is_defined: bool


class CompanyGSTInfo(BaseModel):
    gstin: str | None = None
    state_code: str | None = None
    state_name: str | None = None


class AccountsSetupResponse(BaseModel):
    current_financial_year: FinancialYearInfo | None = None
    financial_years: list[FinancialYearInfo] = []
    company_gst: CompanyGSTInfo
    state_codes: dict[str, str]
    schedule_iii_heads: dict[str, str]
    warnings: list[str] = []
