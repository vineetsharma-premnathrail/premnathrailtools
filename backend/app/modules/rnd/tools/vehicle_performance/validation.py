# Vehicle Performance Tool Validation

from typing import Dict, Any, Tuple
from .schemas import VehiclePerformanceInput

def validate_vehicle_performance_inputs(raw: VehiclePerformanceInput) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Validate and process vehicle performance inputs"""
    inputs: Dict[str, Any] = {}
    inputs_raw = raw.model_dump()

    # Map HTML field names to internal field names
    field_mapping = {
        'loco_gvw': 'loco_gvw_kg',
        'max_speed': 'max_speed_kmh',
        'shunting_load': 'shunting_load_t',
        'peak_power': 'peak_power_kw',
        'wheel_dia': 'wheel_dia_m'
    }

    # Apply mapping, ensure all mapped fields are present
    for html_field, internal_field in field_mapping.items():
        value = inputs_raw.get(html_field, None)
        inputs[internal_field] = value

    # Handle gear_ratios - convert string to list if needed
    if 'gear_ratios' in inputs_raw:
        gear_value = inputs_raw['gear_ratios']
        if isinstance(gear_value, str):
            try:
                inputs['gear_ratios'] = [float(x.strip()) for x in gear_value.split(',') if x.strip()]
            except ValueError:
                inputs['gear_ratios'] = []
        else:
            inputs['gear_ratios'] = gear_value
    else:
        inputs['gear_ratios'] = []

    # Set defaults for missing fields
    if ('max_rpm' not in inputs_raw or inputs_raw['max_rpm'] is None) and 'max_rpm' not in inputs:
        inputs['max_rpm'] = 2500
    else:
        inputs['max_rpm'] = inputs_raw.get('max_rpm', 2500)
    if ('min_rpm' not in inputs_raw or inputs_raw['min_rpm'] is None) and 'min_rpm' not in inputs:
        inputs['min_rpm'] = 100
    else:
        inputs['min_rpm'] = inputs_raw.get('min_rpm', 100)

    # Copy remaining fields including units, but don't overwrite mapped fields
    for key, value in inputs_raw.items():
        if key not in field_mapping and key != 'gear_ratios' and key not in ['max_rpm', 'min_rpm']:
            inputs[key] = value

    # Return processed inputs and original raw inputs (or adjust as needed)
    return inputs, inputs_raw
