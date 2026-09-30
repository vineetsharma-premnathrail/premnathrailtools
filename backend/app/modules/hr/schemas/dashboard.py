"""HR dashboard response DTOs (Integration agent)."""
import datetime as dt

from pydantic import BaseModel


class HrDashboardCount(BaseModel):
    label: str
    count: int


class HrDashboardHeadcount(BaseModel):
    total: int
    by_status: list[HrDashboardCount]
    by_department: list[HrDashboardCount]
    by_branch: list[HrDashboardCount]


class HrDashboardPerson(BaseModel):
    user_id: int | None = None
    name: str
    date: dt.date | None = None
    department: str | None = None
    designation: str | None = None
    status: str | None = None
    event_id: int | None = None
    pending: bool = False


class HrDashboardOnLeave(BaseModel):
    request_id: int
    user_id: int
    name: str
    leave_type: str
    leave_type_name: str
    from_date: dt.date
    to_date: dt.date
    half_day: bool = False


class HrDashboardAttendance(BaseModel):
    date: dt.date
    headcount: int
    present: int
    absent: int
    on_leave: int
    marked: int
    not_marked: int
    by_status: list[HrDashboardCount]
    holidays_today: list[str]


class HrDashboardPending(BaseModel):
    total: int
    awaiting_hr: int


class HrDashboardApprovals(BaseModel):
    leave: HrDashboardPending
    regularization: HrDashboardPending
    travel: HrDashboardPending
    expense: HrDashboardPending
    claims_to_pay: int
    claims_to_pay_amount: float
    checklist_items_pending: int


class HrDashboardEvent(BaseModel):
    id: int
    event_no: str
    event_type: str
    status: str
    name: str | None = None
    due_date: dt.date | None = None
    items_total: int
    items_done: int


class HrDashboardLifecycle(BaseModel):
    total_open: int
    by_type: list[HrDashboardCount]
    events: list[HrDashboardEvent]


class HrDashboardAssets(BaseModel):
    total: int
    issued: int
    in_stock: int
    under_repair: int
    lost: int
    retired: int
    held_by_inactive: int


class HrDashboardVisitor(BaseModel):
    id: int
    visit_no: str
    visitor_name: str
    visitor_company: str | None = None
    host_name: str
    check_in_at: dt.datetime | None = None
    badge_no: str | None = None
    number_of_persons: int | None = None


class HrDashboardVisitors(BaseModel):
    inside_now: int
    persons_inside: int
    expected_today: int
    inside: list[HrDashboardVisitor]


class HrDashboardDocument(BaseModel):
    document_id: int
    user_id: int
    name: str
    document_type: str
    document_name: str
    expiry_date: dt.date
    days_left: int


class HrDashboardDocuments(BaseModel):
    expiring_count: int
    expired_count: int
    items: list[HrDashboardDocument]


class HrDashboardProbationItem(BaseModel):
    user_id: int
    name: str
    probation_end_date: dt.date
    days_left: int
    employment_status: str


class HrDashboardProbation(BaseModel):
    count: int
    overdue_count: int
    items: list[HrDashboardProbationItem]


class HrDashboardResponse(BaseModel):
    today: dt.date
    month_start: dt.date
    month_end: dt.date
    headcount: HrDashboardHeadcount
    missing_profiles: int
    joiners_this_month: list[HrDashboardPerson]
    joiners_count: int
    exits_this_month: list[HrDashboardPerson]
    exits_count: int
    on_leave_today: list[HrDashboardOnLeave]
    attendance_today: HrDashboardAttendance
    approvals: HrDashboardApprovals
    lifecycle: HrDashboardLifecycle
    assets: HrDashboardAssets
    visitors: HrDashboardVisitors
    documents: HrDashboardDocuments
    probation: HrDashboardProbation
