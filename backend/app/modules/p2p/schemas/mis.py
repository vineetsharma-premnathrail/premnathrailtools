from pydantic import BaseModel


class P2PMisKpis(BaseModel):
    prs_created: int
    prs_approved: int
    prs_rejected: int
    prs_pending_approval: int
    pos_raised: int
    pos_approved: int
    pos_pending_approval: int


class P2PMisTrendPoint(BaseModel):
    date: str
    created: int
    approved: int
    po_raised: int


class P2PMisCategoryBreakdown(BaseModel):
    category_code: str
    label: str
    count: int


class P2PMisApproverPending(BaseModel):
    approver_id: int
    approver_name: str
    role: str
    pending_count: int


class P2PMisSummaryResponse(BaseModel):
    period: str
    date_from: str
    date_to: str
    kpis: P2PMisKpis
    trend: list[P2PMisTrendPoint]
    category_breakdown: list[P2PMisCategoryBreakdown]
    approver_pending: list[P2PMisApproverPending]
