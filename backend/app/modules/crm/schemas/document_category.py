from datetime import datetime
from pydantic import BaseModel


class CrmDocumentCategoryCreate(BaseModel):
    label: str


class CrmDocumentCategoryUpdate(BaseModel):
    label: str | None = None


class CrmDocumentCategoryResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    label: str
    created_by_id: int | None = None
    created_at: datetime | None = None
    # Number of inquiry/tender documents currently filed under this label.
    document_count: int = 0
