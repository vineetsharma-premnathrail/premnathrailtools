"""Receivables management — credit releases, collection notes, dunning
letters and disputes (see models/collections.py)."""
from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field


# ── Credit ───────────────────────────────────────────────────────────────

class AccountsCreditReleaseCreate(BaseModel):
    customer_id: int
    checkpoint: str = Field(..., description="so_confirmation | dispatch")
    sales_order_id: int | None = None
    reason: str


class AccountsCreditReleaseWithdrawPayload(BaseModel):
    reason: str | None = None


class AccountsCreditReleaseResponse(BaseModel):
    id: int
    release_number: str
    customer_id: int
    sales_order_id: int | None = None
    checkpoint: str
    status: str
    credit_limit: float | None = None
    exposure: float
    overdue_amount: float
    max_days_overdue: int
    block_reasons: str
    request_reason: str
    requested_by_id: int | None = None
    decided_by_id: int | None = None
    decided_at: datetime | None = None
    decision_comment: str | None = None
    valid_until: date | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}

    customer_name: str | None = None
    so_number: str | None = None
    requested_by_name: str | None = None
    decided_by_name: str | None = None
    approval_status: str | None = None
    approval_stage: str | None = None
    approval_request_id: int | None = None


# ── Collections ──────────────────────────────────────────────────────────

class AccountsCollectionNoteCreate(BaseModel):
    customer_id: int
    note_type: str
    remarks: str
    note_date: date | None = None
    ar_transaction_id: int | None = None
    contact_person: str | None = None
    promised_date: date | None = None
    promised_amount: float | None = None
    follow_up_date: date | None = None


class AccountsCollectionNoteResponse(BaseModel):
    id: int
    customer_id: int
    ar_transaction_id: int | None = None
    note_type: str
    note_date: date
    contact_person: str | None = None
    remarks: str
    promised_date: date | None = None
    promised_amount: float | None = None
    promise_status: str | None = None
    promise_received: float | None = None
    follow_up_date: date | None = None
    dunning_letter_id: int | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}

    invoice_number: str | None = None
    created_by_name: str | None = None


class AccountsDunningRunPayload(BaseModel):
    as_of: date | None = None
    customer_ids: list[int] | None = None


class AccountsDunningLetterCancelPayload(BaseModel):
    reason: str


class AccountsDunningLetterResponse(BaseModel):
    id: int
    letter_number: str
    customer_id: int
    letter_date: date
    as_of: date
    dunning_level: int
    total_overdue: float
    items: list[dict]
    status: str
    cancelled_reason: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}

    customer_name: str | None = None
    created_by_name: str | None = None


# ── Disputes ─────────────────────────────────────────────────────────────

class AccountsDisputeCreate(BaseModel):
    ar_transaction_id: int
    disputed_amount: float
    reason: str
    description: str
    owner_user_id: int | None = None
    raised_on: date | None = None
    customer_complaint_id: int | None = None


class AccountsDisputeUpdate(BaseModel):
    disputed_amount: float | None = None
    reason: str | None = None
    description: str | None = None
    owner_user_id: int | None = None
    status: str | None = None


class AccountsDisputeResolvePayload(BaseModel):
    resolution: str = Field(..., description="credit_note | write_off | paid")
    note: str
    party_note_id: int | None = None
    write_off_reason: str | None = None
    resolved_on: date | None = None


class AccountsDisputeResponse(BaseModel):
    id: int
    dispute_number: str
    customer_id: int
    ar_transaction_id: int
    disputed_amount: float
    reason: str
    description: str
    status: str
    raised_on: date
    owner_user_id: int | None = None
    customer_complaint_id: int | None = None
    resolved_on: date | None = None
    resolved_by_id: int | None = None
    resolution_note: str | None = None
    party_note_id: int | None = None
    settlement_adjustment_id: int | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}

    customer_name: str | None = None
    invoice_number: str | None = None
    invoice_due: float | None = None
    owner_name: str | None = None
    resolved_by_name: str | None = None
    credit_note_number: str | None = None
