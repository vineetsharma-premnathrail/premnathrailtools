# Braking Tool Schemas

from pydantic import BaseModel
from typing import Optional

class BrakingInput(BaseModel):
    mass_kg: float
    reaction_time: float
    num_wheels: int  # HTML sends 'num_wheels'
    calc_mode: str  # "Rail" or "Rail+Road"
    
    rail_speed_input: str  # Comma-separated speeds
    rail_gradient_input: str  # Comma-separated gradients
    rail_gradient_type: str  # "Degree (°)", "1 in G", or "Percentage (%)"
    
    road_speed_input: Optional[str] = ""
    road_gradient_input: Optional[str] = ""
    road_gradient_type: Optional[str] = "Percentage (%)"
    mu: Optional[float] = 0.7
    
    doc_no: Optional[str] = ""
    made_by: Optional[str] = ""
    checked_by: Optional[str] = ""
    approved_by: Optional[str] = ""
    wheel_dia: Optional[float] = 0