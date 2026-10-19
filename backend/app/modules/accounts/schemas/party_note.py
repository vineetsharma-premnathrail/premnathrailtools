from datetime import date, datetime
from pydantic import BaseModel, Field

from app.modules.accounts.schemas.tax_line import TaxLinePayload, TaxLineResponse


class PartyNoteCreate(BaseModel):
    note_type: str  # debit_note | credit_note
    note_date: date
    reason: str = "return"
    vendor_id: int | None = None
    vendor_invoice_id: int | None = None
    ar_transaction_id: int | None = None
    round_off: float = 0
    narration: str | None = None
    lines: list[TaxLinePayload] = Field(default_factory=list)


class PartyNoteCancelPayload(BaseModel):
    reason: str


class PartyNoteResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    note_number: str
    note_type: str
    note_date: date
    reason: str
    vendor_id: int | None = None
    customer_id: int | None = None
    vendor_invoice_id: int | None = None
    ar_transaction_id: int | None = None
    party_gstin: str | None = None
    place_of_supply_state_code: str | None = None
    is_interstate: bool
    taxable_amount: float
    cgst_amount: float
    sgst_amount: float
    igst_amount: float
    gst_amount: float
    round_off: float
    total_amount: float
    unadjusted_amount: float
    narration: str | None = None
    journal_entry_id: int | None = None
    status: str
    created_by_id: int | None = None
    created_at: datetime | None = None
    lines: list[TaxLineResponse] = Field(default_factory=list)

    party_name: str | None = None
    original_invoice_number: str | None = None
    created_by_name: str | None = None
    # Central approval engine: latest request of this record (None = never submitted).
    approval_status: str | None = None
    approval_stage: str | None = None
    approval_request_id: int | None = None
