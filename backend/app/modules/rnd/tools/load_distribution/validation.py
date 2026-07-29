# Load Distribution Tool Validation

from typing import Dict, Any, Tuple
from .schemas import LoadDistributionInput

def validate_load_distribution_inputs(raw: LoadDistributionInput) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Validate and process load distribution inputs"""
    inputs: Dict[str, Any] = {}
    inputs_raw: Dict[str, Any] = raw.model_dump()

    # All inputs are already validated by Pydantic schema
    inputs.update(inputs_raw)

    return inputs, inputs_raw