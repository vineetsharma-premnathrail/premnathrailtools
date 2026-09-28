from datetime import datetime
from pydantic import BaseModel


class QualityDocumentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    doc_type: str
    title: str
    version: str | None = None
    linked_standard_id: int | None = None
    file_name: str
    file_path: str
    sharepoint_url: str | None = None
    file_size: int | None = None
    mime_type: str | None = None
    description: str | None = None
    uploaded_by_id: int | None = None
    uploaded_by_name: str | None = None
    created_at: datetime | None = None
