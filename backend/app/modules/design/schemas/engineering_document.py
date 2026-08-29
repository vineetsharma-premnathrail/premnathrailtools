from datetime import datetime
from pydantic import BaseModel


class EngineeringDocumentResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    project_id: int
    discipline: str
    document_type: str
    title: str
    version: int
    status: str
    superseded_by_id: int | None = None
    filename: str
    content_type: str | None = None
    size: int | None = None
    uploaded_by_id: int | None = None
    created_at: datetime | None = None

    # Denormalized, filled in by the route.
    project_label: str | None = None
    uploaded_by_name: str | None = None


class EngineeringDocumentStatusUpdate(BaseModel):
    status: str
