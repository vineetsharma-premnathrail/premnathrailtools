from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel


class CrmDocumentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    related_module: str
    related_id: int
    related_sub_module: str | None = None
    related_sub_id: int | None = None
    universal_id: str | None = None
    folder_type: str
    doc_category: str | None = None
    file_name: str
    file_path: str
    sharepoint_path: str | None = None
    sharepoint_url: str | None = None
    file_size: int | None = None
    mime_type: str | None = None
    description: str | None = None
    uploaded_by_name: str | None = None
    org_id: int | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None


class TechnicalOfferRequestBody(BaseModel):
    document_ids: list[int] = []
    # CRM <-> R&D channel: by when R&D must answer, and CRM's note to them.
    # The request goes to the whole R&D team queue (no named engineer).
    response_due_date: date | None = None
    remarks: str | None = None
    # Why the requirement goes to R&D again. Required once an earlier send exists for the record
    # ('other' also needs a note); ignored on the first send. Checked in requirement_movement.check_change_reason.
    change_reason: Literal["customer_changed", "bd_correction", "other"] | None = None
    change_note: str | None = None


class ChangeRequirementBody(BaseModel):
    """Inquiry "Change requirement" (after the requirement went to R&D). `revision` sends the new
    text to R&D as the next revision; `correction` fixes a typo in the SAME revision, only
    while R&D has not accepted it."""
    mode: Literal["revision", "correction"]
    product_spec: str
    # One entry per additional product, in the inquiry's order; None keeps that product's text.
    item_specs: list[str | None] | None = None
    change_reason: Literal["customer_changed", "bd_correction", "other"] | None = None
    change_note: str | None = None
    response_due_date: date | None = None
    remarks: str | None = None
    document_ids: list[int] = []


class CrmDocumentUploadSessionPayload(BaseModel):
    """Opens a direct browser -> SharePoint upload for one large file."""
    related_module: str
    related_id: int
    universal_id: str | None = None
    org_id: int | None = None
    file_name: str
    file_size: int
    content_type: str | None = None


class CrmDocumentUploadSessionResponse(BaseModel):
    upload_url: str
    upload_token: str
    chunk_size: int
    file_name: str
    expires_at: str | None = None


class CrmDocumentCompleteUploadPayload(BaseModel):
    upload_token: str
    drive_item_id: str
    folder_type: str
    doc_category: str | None = None
    related_sub_module: str | None = None
    related_sub_id: int | None = None
    description: str | None = None
