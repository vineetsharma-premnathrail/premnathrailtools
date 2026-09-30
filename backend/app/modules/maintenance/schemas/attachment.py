from datetime import datetime
from pydantic import BaseModel


class MaintenanceAttachmentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    entity_type: str
    entity_id: int
    doc_type: str
    filename: str
    content_type: str | None = None
    size: int | None = None
    sharepoint_url: str | None = None
    created_by_id: int | None = None
    created_by_name: str | None = None
    created_at: datetime | None = None
