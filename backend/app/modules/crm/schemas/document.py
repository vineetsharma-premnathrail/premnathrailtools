from datetime import datetime
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
