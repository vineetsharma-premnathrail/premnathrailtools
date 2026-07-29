# Qmax Tool Constants

from typing import Dict, Optional
SIGMA_B_OPTIONS: Dict[str, Optional[int]] = {
    "880 N/mm²": 880,
    "680 N/mm²": 680,
    "Custom": None
}
CONSTANT_C = 8.257e-7
DEFAULT_V_HEAD = 1.1
KN_TO_TONNES = 1 / 9.80665