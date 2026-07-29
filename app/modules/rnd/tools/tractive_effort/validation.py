# Tractive Effort Tool Validation

from typing import Dict, Any, Tuple
from .schemas import TractiveEffortInput

def validate_tractive_effort_inputs(raw: TractiveEffortInput) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Validate and process tractive effort inputs"""
    inputs: Dict[str, Any] = {}
    inputs_raw: Dict[str, Any] = raw.model_dump()

    # All inputs are already validated by Pydantic schema
    inputs.update(inputs_raw)

    return inputs, inputs_raw