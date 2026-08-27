from datetime import datetime
from pydantic import BaseModel


class PaymentTermCreate(BaseModel):
    label: str
    description: str | None = None


class PaymentTermUpdate(BaseModel):
    label: str | None = None
    description: str | None = None


class PaymentTermResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    label: str
    description: str | None = None
    created_by_id: int | None = None
    created_at: datetime | None = None
