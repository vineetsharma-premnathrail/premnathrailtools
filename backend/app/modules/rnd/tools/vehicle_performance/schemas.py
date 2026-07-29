# Vehicle Performance Tool Schemas

from pydantic import BaseModel
from typing import List, Dict, Optional

class VehiclePerformanceInput(BaseModel):
    max_curve: float
    max_slope: float
    loco_gvw: float
    max_speed: float
    num_axles: int
    rear_axle_ratio: float
    gear_ratios: List[float]
    shunting_load: float
    peak_power: float
    friction_mu: float
    wheel_dia: float
    min_rpm: int
    max_rpm: int = 2500
    torque_curve: Optional[Dict[int, float]] = None
    curve_unit: str = "degree"
    slope_unit: str = "%"
    # Document metadata (used in report only)
    doc_no: Optional[str] = None
    doc_date: Optional[str] = None
    made_by: Optional[str] = None
    checked_by: Optional[str] = None
    approved_by: Optional[str] = None
