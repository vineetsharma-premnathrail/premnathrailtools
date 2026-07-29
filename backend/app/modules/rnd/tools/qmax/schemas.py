# Qmax Tool Schemas

from pydantic import BaseModel

class QmaxInput(BaseModel):
    d: str  # Worn rail diameter
    sigma_b_selection: str  # Material strength selection
    sigma_b_custom: str  # Custom sigma_b value
    v_head: str  # Safety factor