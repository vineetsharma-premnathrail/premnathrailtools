# Qmax Tool Validation

from typing import Dict, Any, Tuple
from .schemas import QmaxInput
from .constants import SIGMA_B_OPTIONS

def validate_qmax_inputs(raw: QmaxInput) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Validate and process qmax inputs"""
    inputs: Dict[str, Any] = {}
    inputs_raw: Dict[str, Any] = raw.model_dump()

    # Validate d (worn rail diameter)
    try:
        inputs['d'] = float(raw.d)
        if inputs['d'] <= 0:
            raise ValueError("Worn rail diameter must be greater than 0")
    except ValueError:
        raise ValueError("Invalid worn rail diameter")

    # Validate sigma_b
    sel = (raw.sigma_b_selection or '').strip()
    is_custom = sel in ('Custom', '') or (sel not in SIGMA_B_OPTIONS and not any(sel in k for k in SIGMA_B_OPTIONS))
    if is_custom and raw.sigma_b_custom:
        try:
            inputs['sigma_b'] = float(raw.sigma_b_custom)
            if inputs['sigma_b'] <= 0:
                raise ValueError("Custom sigma_b must be greater than 0")
        except ValueError:
            raise ValueError("Invalid custom sigma_b value")
    else:
        # Accept both "880" and "880 N/mm²" formats
        matched = SIGMA_B_OPTIONS.get(sel)
        if matched is None:
            for key, val in SIGMA_B_OPTIONS.items():
                if sel in key or key.startswith(sel):
                    matched = val
                    break
        if matched is None:
            try:
                matched = float(sel)
            except (ValueError, TypeError):
                matched = 880
        inputs['sigma_b'] = matched

    # Validate v_head (safety factor)
    try:
        inputs['v_head'] = float(raw.v_head)
        if inputs['v_head'] <= 0:
            raise ValueError("Safety factor must be greater than 0")
    except ValueError:
        raise ValueError("Invalid safety factor")

    return inputs, inputs_raw