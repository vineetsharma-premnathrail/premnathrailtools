# Braking Tool Helper Functions

import math
from typing import List

from ..latex_utils import escape_latex  # re-exported: `from .units import escape_latex` still works

def parse_list(input_str: str) -> List[float]:
    """Parse comma-separated string into list of floats"""
    if not input_str:
        return []
    try:
        # Handle "10, 20" or just "10"
        return [float(x.strip()) for x in str(input_str).split(',') if x.strip()]
    except:
        return []

def calculate_angle(gradient_val: float, gradient_type: str) -> float:
    """Convert gradient to angle in degrees"""
    if gradient_val == 0:
        return 0.0
    gt = (gradient_type or '').lower().strip()
    if 'degree' in gt or '°' in gt:
        return float(gradient_val)
    elif '1 in' in gt:
        return math.degrees(math.atan(1 / gradient_val)) if gradient_val != 0 else 0
    else:  # Percentage (default)
        return math.degrees(math.atan(gradient_val / 100))

def get_compliance(speed: float, total_dist: float) -> str:
    """Check if stopping distance complies with EN standard"""
    from .constants import MAX_STOPPING_DISTANCES
    
    # Find the appropriate limit for the current speed
    allowed_distance = None
    for limit_speed in sorted(MAX_STOPPING_DISTANCES.keys(), reverse=True):
        if speed >= limit_speed:
            allowed_distance = MAX_STOPPING_DISTANCES[limit_speed]
            break
            
    if allowed_distance is None:
        return "Standard Not Found"
    
    if total_dist <= allowed_distance:
        return "✓ Standard Followed"
    else:
        return "✗ Standard Exceeded"