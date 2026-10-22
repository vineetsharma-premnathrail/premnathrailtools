from datetime import datetime
from pydantic import BaseModel


class FinanceAttachmentResponse(BaseModel):
    id: int
    entity_type: str
    entity_id: int | None = None
    doc_type: str
    filename: str
    content_type: str | None = None
    size: int | None = None
    created_by_id: int | None = None
    created_by_name: str | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}
