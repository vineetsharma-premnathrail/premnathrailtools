# Load Distribution Tool Core Calculations
# Pure mathematical functions - no I/O, no formatting

from typing import Dict, Any
from .constants import BOGIE_DELTA_Q_LIMIT, TRUCK_DELTA_Q_LIMIT, CONFIG_BOGIE

def calculate_front_rear_loads(total_load: float, front_percent: float) -> tuple[float, float]:
    """Calculate front and rear axle loads"""
    front_load = (front_percent / 100) * total_load
    rear_load = total_load - front_load
    return front_load, rear_load

def calculate_wheel_loads(front_load: float, rear_load: float, q1_percent: float, q3_percent: float) -> Dict[str, float]:
    """Calculate individual wheel loads (Q values)"""
    q1_val = (q1_percent / 100) * front_load
    q2_val = front_load - q1_val
    q3_val = (q3_percent / 100) * rear_load
    q4_val = rear_load - q3_val

    return {
        "Q1": q1_val,
        "Q2": q2_val,
        "Q3": q3_val,
        "Q4": q4_val
    }

def find_min_max_q_values(q_values: Dict[str, float]) -> tuple[str, float, str, float]:
    """Find the lowest and highest Q values"""
    ql_name: str = min(q_values, key=lambda k: q_values[k])
    ql_value: float = q_values[ql_name]
    qh_name: str = max(q_values, key=lambda k: q_values[k])
    qh_value: float = q_values[qh_name]

    return ql_name, ql_value, qh_name, qh_value

def calculate_average_heavy_axle_load(q_values: Dict[str, float], front_load: float, rear_load: float) -> tuple[str, float]:
    """Calculate Q (Average load on heavier axle)"""
    if front_load >= rear_load:
        q_formula_str = "(Q1 + Q2) / 2"
        q_value = (q_values["Q1"] + q_values["Q2"]) / 2
    else:
        q_formula_str = "(Q3 + Q4) / 2"
        q_value = (q_values["Q3"] + q_values["Q4"]) / 2

    return q_formula_str, q_value

def calculate_safety_metrics(q_value: float, ql_value: float, config_type: str) -> Dict[str, Any]:
    """Calculate safety metrics and determine pass/fail status"""
    delta_q = q_value - ql_value
    delta_q_by_q = delta_q / q_value if q_value != 0 else 0
    limit = BOGIE_DELTA_Q_LIMIT if config_type == CONFIG_BOGIE else TRUCK_DELTA_Q_LIMIT

    if delta_q_by_q <= limit:
        status = "success"
        status_msg = f"PASS: ΔQ/Q ({delta_q_by_q:.2%}) is within the {limit:.0%} limit."
    else:
        status = "fail"
        status_msg = f"FAIL: ΔQ/Q ({delta_q_by_q:.2%}) exceeds the {limit:.0%} limit."

    return {
        'delta_q': delta_q,
        'delta_q_by_q': delta_q_by_q,
        'limit': limit,
        'status': status,
        'status_msg': status_msg
    }

def perform_load_distribution_calculation(config_type: str, total_load: float, front_percent: float,
                                        q1_percent: float, q3_percent: float) -> Dict[str, Any]:
    """Main calculation function for load distribution"""
    # Calculate front and rear loads
    front_load, rear_load = calculate_front_rear_loads(total_load, front_percent)

    # Calculate wheel loads
    q_values = calculate_wheel_loads(front_load, rear_load, q1_percent, q3_percent)

    # Find min/max Q values
    ql_name, ql_value, qh_name, qh_value = find_min_max_q_values(q_values)

    # Calculate average on heavier axle
    q_formula_str, q_value = calculate_average_heavy_axle_load(q_values, front_load, rear_load)

    # Calculate safety metrics
    safety_metrics = calculate_safety_metrics(q_value, ql_value, config_type)

    # Combine all results
    results: Dict[str, Any] = {
        'q_values': q_values,
        'front_load': front_load,
        'rear_load': rear_load,
        'ql_name': ql_name,
        'ql_value': ql_value,
        'qh_name': qh_name,
        'qh_value': qh_value,
        'q_formula_str': q_formula_str,
        'q_value': q_value,
        **safety_metrics
    }

    return results