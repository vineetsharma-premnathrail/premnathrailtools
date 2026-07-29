# Braking Tool Validation

from typing import Dict, Any, Tuple
from .schemas import BrakingInput

def validate_braking_inputs(raw: BrakingInput) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Validate and process braking inputs"""
    inputs: Dict[str, Any] = {}
    inputs_raw = raw.model_dump()
    
    inputs['mass_kg'] = raw.mass_kg
    inputs['reaction_time'] = raw.reaction_time
    inputs['num_wheels'] = raw.num_wheels
    inputs['calc_mode'] = raw.calc_mode
    inputs['rail_speed_input'] = raw.rail_speed_input
    inputs['rail_gradient_input'] = raw.rail_gradient_input
    inputs['rail_gradient_type'] = raw.rail_gradient_type
    inputs['road_speed_input'] = raw.road_speed_input or ""
    inputs['road_gradient_input'] = raw.road_gradient_input or ""
    inputs['road_gradient_type'] = raw.road_gradient_type or "Percentage (%)"
    inputs['mu'] = raw.mu or 0.7
    inputs['doc_no'] = raw.doc_no or ""
    inputs['made_by'] = raw.made_by or ""
    inputs['checked_by'] = raw.checked_by or ""
    inputs['approved_by'] = raw.approved_by or ""
    inputs['wheel_dia'] = raw.wheel_dia or 0
    
    # Basic validation
    if inputs['mass_kg'] <= 0:
        raise ValueError("Mass must be greater than 0")
    if inputs['num_wheels'] <= 0:
        raise ValueError("Number of wheels must be greater than 0")
    if inputs['mu'] <= 0:
        raise ValueError("Friction coefficient must be greater than 0")
    
    return inputs, inputs_raw