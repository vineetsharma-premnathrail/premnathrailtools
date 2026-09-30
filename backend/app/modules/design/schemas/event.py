from datetime import datetime
from pydantic import BaseModel, Field


class DesignCommentPayload(BaseModel):
    comment: str = Field(min_length=1, max_length=4000)
    revision_id: int | None = None


class DesignEventResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    document_id: int | None = None
    revision_id: int | None = None
    ecn_id: int | None = None
    action: str
    comment: str | None = None
    actor_id: int | None = None
    created_at: datetime | None = None

    actor_name: str | None = None
    revision_label: str | None = None
    doc_number: str | None = None
