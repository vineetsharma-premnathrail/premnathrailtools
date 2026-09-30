from datetime import datetime
from pydantic import BaseModel


class RndDocumentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_id: int
    experiment_id: int | None = None
    prototype_id: int | None = None
    doc_type: str
    title: str
    version: str | None = None
    description: str | None = None
    file_name: str
    sharepoint_url: str | None = None
    file_size: int | None = None
    mime_type: str | None = None
    uploaded_by_id: int | None = None
    uploaded_by_name: str | None = None
    created_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    project_number: str | None = None
    experiment_number: str | None = None
    prototype_number: str | None = None
