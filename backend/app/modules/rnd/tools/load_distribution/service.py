# Load Distribution Tool Service Layer
# Orchestrates calculations and prepares formatted reports

from typing import Dict, Any
from .core import perform_load_distribution_calculation

def perform_load_distro_calculation(config_type: str, total_load: float, front_percent: float,
                                  q1_percent: float, q3_percent: float) -> Dict[str, Any]:
    """Legacy function for backward compatibility - calls the new core function"""
    return perform_load_distribution_calculation(config_type, total_load, front_percent, q1_percent, q3_percent)

def perform_load_distro_calc(config_type: str, total_load: float, front_percent: float,
                           q1_percent: float, q3_percent: float) -> Dict[str, Any]:
    """Main orchestration function for load distribution calculations"""
    return perform_load_distribution_calculation(config_type, total_load, front_percent, q1_percent, q3_percent)

def format_load_distro_steps(inputs: Dict[str, Any], results: Dict[str, Any]) -> str:
    """Format load distribution calculation steps"""
    return (
        f"1. Calculate Front and Rear Loads:\n"
        f"   Front = Total Load × (Front % / 100)\n"
        f"   Front = {inputs['total_load']:.2f} × ({inputs['front_percent']:.2f} / 100) = {results['front_load']:.2f} Ton\n\n"
        f"   Rear = Total Load - Front Load\n"
        f"   Rear = {inputs['total_load']:.2f} - {results['front_load']:.2f} = {results['rear_load']:.2f} Ton\n\n"

        f"2. Calculate Individual Wheel Loads (Q Values):\n"
        f"   Q1 = Front Load × (Q1 % / 100)\n"
        f"   Q1 = {results['front_load']:.2f} × ({inputs['q1_percent']:.2f} / 100) = {results['q_values']['Q1']:.2f} Ton\n\n"
        f"   Q2 = Front Load - Q1\n"
        f"   Q2 = {results['front_load']:.2f} - {results['q_values']['Q1']:.2f} = {results['q_values']['Q2']:.2f} Ton\n\n"
        f"   Q3 = Rear Load × (Q3 % / 100)\n"
        f"   Q3 = {results['rear_load']:.2f} × ({inputs['q3_percent']:.2f} / 100) = {results['q_values']['Q3']:.2f} Ton\n\n"
        f"   Q4 = Rear Load - Q3\n"
        f"   Q4 = {results['rear_load']:.2f} - {results['q_values']['Q3']:.2f} = {results['q_values']['Q4']:.2f} Ton\n\n"

        f"3. Calculate Q, ΔQ, and ΔQ/Q:\n"
        f"   Q (Average on heavier axle) = {results['q_value']:.2f} Ton\n"
        f"   QL (Lowest wheel load) = {results['ql_value']:.2f} Ton ({results['ql_name']})\n"
        f"   ΔQ = Q - QL = {results['q_value']:.2f} - {results['ql_value']:.2f} = {results['delta_q']:.2f} Ton\n\n"
        f"   ΔQ/Q = ΔQ / Q = {results['delta_q']:.2f} / {results['q_value']:.2f} = {results['delta_q_by_q']:.4f}\n\n"

        f"4. Final Check:\n"
        f"   Is {results['delta_q_by_q']:.2%} ≤ {results['limit']:.0%}? {'Yes' if results['status']=='success' else 'No'}.\n"
        f"   Result: {results['status'].upper()}"
    )