# Load Distribution Tool Schemas

from pydantic import BaseModel, field_validator
from typing import Literal


class LoadDistributionInput(BaseModel):
    config_type: Literal["Bogie", "Truck", "Axle"]
    total_load: float
    front_percent: float
    q1_percent: float
    q3_percent: float

    @field_validator('total_load', 'front_percent', 'q1_percent', 'q3_percent')
    @classmethod
    def validate_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError('Value must be positive')
        return v

    @field_validator('front_percent')
    @classmethod
    def validate_percentage(cls, v: float) -> float:
        if not 0 <= v <= 100:
            raise ValueError('Percentage must be between 0 and 100')
        return v

    @field_validator('q1_percent', 'q3_percent')
    @classmethod
    def validate_q_percentage(cls, v: float) -> float:
        if not 0 <= v <= 100:
            raise ValueError('Q percentage must be between 0 and 100')
        return v