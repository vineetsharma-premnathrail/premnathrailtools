from datetime import datetime
from pydantic import BaseModel, Field


class DesignTeamMemberPayload(BaseModel):
    user_id: int
    role: str  # designer | reviewer | head


class DesignTeamMemberResponse(BaseModel):
    user_id: int
    role: str
    name: str | None = None
    email: str | None = None
    has_design_app: bool = True


class DesignSettingsUpdate(BaseModel):
    customer_response_days: int | None = Field(None, ge=1, le=365)
    review_overdue_days: int | None = Field(None, ge=1, le=90)
    default_approver_id: int | None = None
    change_board_member_ids: list[int] | None = None
    # {"production": [ids], "purchase": [...], "store": [...], "quality": [...]}
    ecn_acknowledger_ids: dict[str, list[int]] | None = None
    team: list[DesignTeamMemberPayload] | None = None


class DesignSettingsResponse(BaseModel):
    customer_response_days: int
    review_overdue_days: int
    default_approver_id: int | None = None
    default_approver_name: str | None = None
    change_board_member_ids: list[int] = []
    change_board: list[dict] = []
    ecn_acknowledger_ids: dict[str, list[int]] = {}
    ecn_acknowledgers: dict[str, list[dict]] = {}
    team: list[DesignTeamMemberResponse] = []
    team_configured: bool = False
    updated_at: datetime | None = None
    updated_by_name: str | None = None
    # Caller's own role in Design: admin | head | reviewer | designer | viewer.
    my_role: str = "designer"
    can_edit: bool = False
