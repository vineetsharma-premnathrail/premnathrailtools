from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

HolidayType = Literal["national", "festival", "restricted", "optional"]


class HrHolidayCreate(BaseModel):
    holiday_date: date
    name: str = Field(..., min_length=1, max_length=150)
    holiday_type: HolidayType = "national"
    branch_id: int | None = None
    description: str | None = Field(None, max_length=2000)
    is_active: bool = True


class HrHolidayUpdate(BaseModel):
    holiday_date: date | None = None
    name: str | None = Field(None, min_length=1, max_length=150)
    holiday_type: HolidayType | None = None
    branch_id: int | None = None
    description: str | None = Field(None, max_length=2000)
    is_active: bool | None = None


class HrHolidayBulkPayload(BaseModel):
    rows: list[HrHolidayCreate] = Field(..., min_length=1, max_length=200)


class HrHolidayCopyPayload(BaseModel):
    from_year: int = Field(..., ge=2000, le=2100)
    to_year: int = Field(..., ge=2000, le=2100)
    branch_id: int | None = None  # copy only this plant's (plus all-plant) holidays; None = everything
    include_types: list[HolidayType] | None = None


class HrHolidayResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    holiday_date: date
    name: str
    holiday_type: str
    branch_id: int | None = None
    year: int
    description: str | None = None
    is_active: bool
    created_at: datetime | None = None
    updated_at: datetime | None = None
    branch_name: str | None = None
    weekday: str | None = None
