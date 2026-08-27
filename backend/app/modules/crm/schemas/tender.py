from datetime import date, datetime
from pydantic import BaseModel


class TenderCreate(BaseModel):
    org_id: int
    org_contact_id: int | None = None
    tender_number: str | None = None
    tender_name: str | None = None
    tender_authority: str | None = None
    tender_portal: str | None = None
    tender_type: str | None = None
    tender_category: str | None = None
    tender_value: float | None = None
    currency: str = "INR"
    status: str = "Active"
    current_stage: str = "Tender Published"
    railway_zone: str | None = None
    division: str | None = None
    workshop: str | None = None
    publish_date: date | None = None
    doc_download_date: date | None = None
    pre_bid_meeting_date: date | None = None
    query_submission_date: date | None = None
    submission_date: date | None = None
    opening_date: date | None = None
    financial_opening_date: date | None = None
    expected_award_date: date | None = None
    participate: bool | None = None
    decision_by: str | None = None
    decision_date: date | None = None
    reason_no_participate: str | None = None
    awarded_to: str | None = None
    loi_number: str | None = None
    contract_value: float | None = None
    loss_reason: str | None = None


class TenderUpdate(BaseModel):
    org_id: int | None = None
    org_contact_id: int | None = None
    tender_number: str | None = None
    tender_name: str | None = None
    tender_authority: str | None = None
    tender_portal: str | None = None
    tender_type: str | None = None
    tender_category: str | None = None
    tender_value: float | None = None
    currency: str | None = None
    status: str | None = None
    current_stage: str | None = None
    railway_zone: str | None = None
    division: str | None = None
    workshop: str | None = None
    publish_date: date | None = None
    doc_download_date: date | None = None
    pre_bid_meeting_date: date | None = None
    query_submission_date: date | None = None
    submission_date: date | None = None
    opening_date: date | None = None
    financial_opening_date: date | None = None
    expected_award_date: date | None = None
    participate: bool | None = None
    decision_by: str | None = None
    decision_date: date | None = None
    reason_no_participate: str | None = None
    awarded_to: str | None = None
    loi_number: str | None = None
    contract_value: float | None = None
    loss_reason: str | None = None


class TenderResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    universal_id: str
    org_id: int
    org_contact_id: int | None = None
    tender_number: str | None = None
    tender_name: str | None = None
    tender_authority: str | None = None
    tender_portal: str | None = None
    tender_type: str | None = None
    tender_category: str | None = None
    tender_value: float | None = None
    currency: str
    status: str
    current_stage: str
    railway_zone: str | None = None
    division: str | None = None
    workshop: str | None = None
    publish_date: date | None = None
    doc_download_date: date | None = None
    pre_bid_meeting_date: date | None = None
    query_submission_date: date | None = None
    submission_date: date | None = None
    opening_date: date | None = None
    financial_opening_date: date | None = None
    expected_award_date: date | None = None
    participate: bool | None = None
    decision_by: str | None = None
    decision_date: date | None = None
    reason_no_participate: str | None = None
    awarded_to: str | None = None
    loi_number: str | None = None
    contract_value: float | None = None
    loss_reason: str | None = None
    technical_offer_number: str | None = None
    technical_offer_sent_at: datetime | None = None
    created_by_id: int | None = None
    created_by_name: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    is_deleted: bool = False
