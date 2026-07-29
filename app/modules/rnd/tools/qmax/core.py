# Qmax Tool Core Calculations
# Pure mathematical functions - no I/O, no formatting

from .constants import CONSTANT_C, KN_TO_TONNES

from typing import Dict

def calculate_qmax(d: float, sigma_b: float, v_head: float) -> Dict[str, float]:
    """
    Calculate Qmax values using the formula:
    Qmax = C × (d / 2) × (σB / v_head)²
    """
    qmax_kn = CONSTANT_C * (d / 2) * (sigma_b / v_head) ** 2
    qmax_tonnes = qmax_kn * KN_TO_TONNES

    return {
        "d": d,
        "sigma_b": sigma_b,
        "v_head": v_head,
        "qmax_kn": qmax_kn,
        "qmax_tonnes": qmax_tonnes
    }