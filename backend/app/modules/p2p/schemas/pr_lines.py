"""Requisition line actions, the requester tracker and the buyers' My Lines worklist
(routes/pr_lines.py, routes/my_lines.py). Nothing here carries a price or a PO value:
the tracker is shown to the requester, who is not allowed to see vendor commercials."""
from datetime import date, datetime

from pydantic import BaseModel, Field


class ReassignBuyerPayload(BaseModel):
    # buyer_id / reason are optional here only so the route can answer with a message that
    # says what to do, instead of a bare pydantic 422.
    buyer_id: int | None = None
    reason: str | None = None


class ShortClosePayload(BaseModel):
    # None = everything that is not yet on a PO.
    quantity: float | None = None
    reason: str | None = None


# ── Tracker ──────────────────────────────────────────────────────────────

class TrackerApprovalStep(BaseModel):
    sequence: int
    stage_name: str
    approver_name: str | None = None
    status: str
    decided_by_name: str | None = None
    decided_at: datetime | None = None
    comment: str | None = None
    via: str | None = None


class TrackerApproval(BaseModel):
    status: str
    submitted_at: datetime | None = None
    completed_at: datetime | None = None
    steps: list[TrackerApprovalStep] = Field(default_factory=list)


class TrackerGrn(BaseModel):
    grn_id: int
    grn_number: str
    received_date: date | None = None
    status: str
    received_qty: float = 0
    accepted_qty: float = 0
    rejected_qty: float = 0


class TrackerPo(BaseModel):
    po_id: int
    po_number: str
    # Only for people who may see PO commercials; None for the requester.
    vendor_name: str | None = None
    quantity: float
    stage: str
    stage_label: str
    expected_delivery: date | None = None
    approval: TrackerApproval | None = None
    grns: list[TrackerGrn] = Field(default_factory=list)


class TrackerRfq(BaseModel):
    rfq_id: int
    rfq_number: str
    status: str
    buyer_name: str | None = None
    quote_count: int = 0


class TrackerLine(BaseModel):
    pr_item_id: int
    item_code: str | None = None
    item_name: str
    unit: str | None = None
    quantity: float
    issued_qty: float = 0
    short_closed_qty: float = 0
    short_closed_reason: str | None = None
    buyer_id: int | None = None
    buyer_name: str | None = None
    fulfillment_status: str
    ordered_qty: float = 0
    accepted_qty: float = 0
    rejected_qty: float = 0
    pending_qty: float = 0
    state: str
    state_label: str
    over_ordered: bool = False
    po_rejected: bool = False
    rfqs: list[TrackerRfq] = Field(default_factory=list)
    pos: list[TrackerPo] = Field(default_factory=list)


class TrackerProgress(BaseModel):
    lines: int
    lines_done: int
    ordered_pct: float
    received_pct: float


class PrTrackerResponse(BaseModel):
    p2p_request_id: int
    p2p_number: str
    status: str
    status_label: str
    progress: TrackerProgress
    pr_approval: TrackerApproval | None = None
    lines: list[TrackerLine] = Field(default_factory=list)


# ── My Lines ─────────────────────────────────────────────────────────────

class MyLineRfq(BaseModel):
    id: int
    rfq_number: str
    status: str


class MyLinePo(BaseModel):
    id: int
    po_number: str
    stage: str
    stage_label: str


class MyLineRow(BaseModel):
    pr_item_id: int
    p2p_request_id: int
    p2p_number: str
    pr_status: str
    priority: str | None = None
    required_date: date | None = None
    requester_name: str | None = None
    purpose_label: str | None = None
    charged_to: str | None = None
    item_code: str | None = None
    item_name: str
    unit: str | None = None
    buy_qty: float
    short_closed_qty: float
    ordered_qty: float
    released_qty: float
    accepted_qty: float
    open_to_order: float
    pending_receipt: float
    state: str
    state_label: str
    buyer_id: int | None = None
    buyer_name: str | None = None
    po_rejected: bool = False
    rfqs: list[MyLineRfq] = Field(default_factory=list)
    pos: list[MyLinePo] = Field(default_factory=list)
    last_activity: datetime | None = None


class MyLinesResponse(BaseModel):
    rows: list[MyLineRow]
    total: int
    skip: int
    limit: int
    counts: dict[str, int]
