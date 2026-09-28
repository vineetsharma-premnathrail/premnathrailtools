from datetime import date, datetime
from pydantic import BaseModel


class AuditLogResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    entity_type: str
    entity_id: int | None
    action: str
    field_name: str | None
    old_value: str | None
    new_value: str | None
    summary: str | None
    performed_by_id: int | None
    performed_by_name: str | None = None
    performed_at: datetime
    module_key: str | None
    subtab_key: str | None
    branch_id: int | None
    branch_name: str | None = None
    department: str | None
    status: str | None
    result: str | None
    reason: str | None
    attachment_url: str | None
    retention_date: date | None
    ip_address: str | None
    user_agent: str | None
    session_id: int | None
    api_source: str | None


class AuditDashboardResponse(BaseModel):
    total_logs: int
    logs_today: int
    logs_last_7_days: int
    by_action: dict[str, int]
    by_module: dict[str, int]
    top_users: list[dict]
