from datetime import datetime
from pydantic import BaseModel, Field


class ElectricalPanelCreate(BaseModel):
    panel_tag: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=150)
    panel_type: str = "control"
    location_on_vehicle: str | None = Field(None, max_length=150)
    enclosure_material: str | None = Field(None, max_length=100)
    ip_rating: str | None = Field(None, max_length=20)
    dimensions: str | None = Field(None, max_length=100)
    status: str = "designed"
    remarks: str | None = None


class ElectricalPanelUpdate(BaseModel):
    panel_tag: str | None = Field(None, min_length=1, max_length=50)
    name: str | None = Field(None, min_length=1, max_length=150)
    panel_type: str | None = None
    location_on_vehicle: str | None = Field(None, max_length=150)
    enclosure_material: str | None = Field(None, max_length=100)
    ip_rating: str | None = Field(None, max_length=20)
    dimensions: str | None = Field(None, max_length=100)
    status: str | None = None
    remarks: str | None = None


class ElectricalPanelResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    job_id: int
    panel_tag: str
    name: str
    panel_type: str
    location_on_vehicle: str | None = None
    enclosure_material: str | None = None
    ip_rating: str | None = None
    dimensions: str | None = None
    status: str
    assembled_by_id: int | None = None
    assembled_at: datetime | None = None
    remarks: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    # Denormalized display fields, filled in by the route.
    assembled_by_name: str | None = None
    component_count: int = 0
