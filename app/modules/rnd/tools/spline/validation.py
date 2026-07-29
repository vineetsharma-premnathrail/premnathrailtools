import math
from typing import Dict, Any, List, Tuple, Optional
from .schemas import SplineInput


def validate_spline_inputs(raw: SplineInput) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Validate and convert spline inputs into plain dict for calculation."""
    inputs: Dict[str, Any] = {}
    # dump raw to dict
    inputs_raw = raw.model_dump() if hasattr(raw, 'model_dump') else dict(raw)

    inputs['calc_mode'] = raw.calc_mode

    # geometry inputs
    # geometry inputs
    inputs['number_teeth'] = float(raw.number_teeth)
    inputs['diametral_pitch'] = float(raw.diametral_pitch)
    inputs['pressure_angle_deg'] = float(raw.pressure_angle)
    inputs['outer_diameter'] = float(raw.outer_diameter)
    inputs['inner_diameter'] = float(raw.inner_diameter)
    inputs['length_engagement'] = float(raw.length_engagement)

    # material
    inputs['yield_strength'] = float(raw.yield_strength)
    inputs['material_type'] = raw.material_type

    # operating conditions
    inputs['loco_weight'] = float(raw.loco_weight)
    inputs['number_axles'] = float(raw.number_axles)
    inputs['wheels_per_axle'] = float(raw.wheels_per_axle)
    inputs['speed'] = float(raw.speed)
    inputs['wheel_diameter'] = float(raw.wheel_diameter)
    inputs['friction_coeff'] = float(raw.friction_coeff)

    return inputs, inputs_raw
