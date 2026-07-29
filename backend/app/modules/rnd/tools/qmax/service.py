# Qmax Tool Service Layer
# Orchestrates calculations and prepares formatted reports

from typing import Dict, Any, Optional
from .core import calculate_qmax
from .constants import CONSTANT_C

from typing import Tuple

def perform_qmax_calculation(inputs: Dict[str, Any], inputs_raw: Optional[Dict[str, Any]] = None) -> Tuple[Dict[str, float], str]:
    """
    Main orchestration function for qmax calculations.
    Returns (results, formatted_report)
    """
    # Perform the calculation
    results = calculate_qmax(inputs['d'], inputs['sigma_b'], inputs['v_head'])

    # Format the detailed steps
    formatted_report = format_qmax_detailed_steps(results, inputs_raw or {})

    return results, formatted_report

def format_qmax_detailed_steps(results: Dict[str, Any], inputs_raw: Dict[str, Any]) -> str:
    """Formats the step-by-step calculation into a readable string."""
    sigma_v_head_squared = (results['sigma_b'] / results['v_head']) ** 2
    d_half = results['d'] / 2

    report_lines = [
        "# Qmax Calculation Report",
        "\n--- INPUT PARAMETERS ---",
        f"Worn rail diameter limit (d): {inputs_raw.get('d', 'N/A')} mm",
        f"Material Strength (σB): {inputs_raw.get('sigma_b_selection', 'N/A')}",
        f"  (Value Used: {results['sigma_b']} N/mm²)",
        f"Safety Factor (v_head): {inputs_raw.get('v_head', 'N/A')}",

        "\n--- STEP-BY-STEP CALCULATION ---",
        "1. Formula:",
        "   Qmax = C × (d / 2) × (σB / v_head)²",
        f"   Where C = {CONSTANT_C}",

        "\n2. Substitute Values:",
        f"   d = {results['d']} mm",
        f"   σB = {results['sigma_b']} N/mm²",
        f"   v_head = {results['v_head']}",

        "\n3. Step-by-Step Calculation:",
        f"   a) (σB / v_head)² = ({results['sigma_b']} / {results['v_head']})² = {sigma_v_head_squared:.3f}",
        f"   b) Qmax = {CONSTANT_C} × ({results['d']} / 2) × {sigma_v_head_squared:.3f}",
        f"   c) Qmax = {CONSTANT_C} × {d_half:.1f} × {sigma_v_head_squared:.3f}",

        "\n--- FINAL RESULT ---",
        f"Qmax = {results['qmax_kn']:.4f} kN",
        f"Qmax = {results['qmax_tonnes']:.4f} tonnes"
    ]

    return "\n".join(report_lines)