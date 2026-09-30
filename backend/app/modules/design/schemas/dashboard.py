from datetime import datetime
from pydantic import BaseModel


class DesignLookupOption(BaseModel):
    id: int
    label: str
    code: str | None = None
    extra: str | None = None


class DesignTaskItem(BaseModel):
    """One row of "waiting on me" — a revision (kind review/approve/returned/
    draft) or an ECN (kind ecn_approve/ecn_implement)."""
    kind: str
    document_id: int | None = None
    doc_number: str | None = None
    title: str
    revision_id: int | None = None
    revision_label: str | None = None
    status: str
    ecn_id: int | None = None
    ecn_number: str | None = None
    author_name: str | None = None
    comment: str | None = None
    since: datetime | None = None
    days_waiting: int = 0


class DesignMyTasks(BaseModel):
    to_review: list[DesignTaskItem] = []
    to_approve: list[DesignTaskItem] = []
    returned_to_me: list[DesignTaskItem] = []
    my_drafts: list[DesignTaskItem] = []
    ecns_to_approve: list[DesignTaskItem] = []
    ecns_to_implement: list[DesignTaskItem] = []


class DesignRecentRelease(BaseModel):
    document_id: int
    doc_number: str
    title: str
    revision_id: int
    revision_label: str
    released_at: datetime | None = None
    approved_by_name: str | None = None


class DesignDashboard(BaseModel):
    active_documents: int = 0
    released_documents: int = 0
    drafts: int = 0
    in_review: int = 0
    in_approval: int = 0
    obsolete_documents: int = 0
    released_this_month: int = 0
    open_ecns: int = 0
    waiting_on_me: int = 0
    overdue_in_workflow: int = 0
    overdue_days: int = 7
    my_tasks: list[DesignTaskItem] = []
    overdue: list[DesignTaskItem] = []
    recent_releases: list[DesignRecentRelease] = []


class DesignCountRow(BaseModel):
    key: str
    count: int


class DesignMonthRow(BaseModel):
    month: str
    released: int


class DesignReportSummary(BaseModel):
    by_type: list[DesignCountRow] = []
    by_discipline: list[DesignCountRow] = []
    by_status: list[DesignCountRow] = []
    releases_by_month: list[DesignMonthRow] = []
    avg_cycle_days: float | None = None
    avg_returns_per_release: float | None = None
    total_revisions_released: int = 0
