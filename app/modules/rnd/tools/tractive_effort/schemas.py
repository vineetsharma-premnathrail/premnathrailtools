# Tractive Effort Tool Schemas

from pydantic import BaseModel, field_validator
from typing import Literal

class TractiveEffortInput(BaseModel):
    load: float
    loco_weight: float
    gradient: float
    curvature: float
    speed: float
    mode: Literal["Start", "Running"]
    grad_type: Literal["Degree", "1 in G"]
    curvature_unit: Literal["Radius(m)", "Degree"]

    @field_validator('load', 'loco_weight', 'gradient', 'curvature', 'speed')
    @classmethod
    def validate_positive(cls, v: float) -> float:
        if v < 0:
            raise ValueError('Value must be non-negative')
        return v
