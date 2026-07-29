from pydantic import BaseModel
from app.modules.crm.schemas.organization import OrganizationResponse
from app.modules.crm.schemas.inquiry import InquiryResponse
from app.modules.crm.schemas.tender import TenderResponse
from app.modules.crm.schemas.activity import ActivityResponse
from app.modules.crm.schemas.note import NoteResponse


class CrmDashboardResponse(BaseModel):
    total_organizations: int
    total_inquiries: int
    total_tenders: int
    open_followups: int
    overdue_followups: int
    today_activities: int
    pending_tenders: int
    recent_notes_count: int
    recent_organizations: list[OrganizationResponse]
    recent_inquiries: list[InquiryResponse]
    recent_tenders: list[TenderResponse]
    recent_activities: list[ActivityResponse]
    recent_notes: list[NoteResponse]
