# Tractive Effort Tool Service Layer
# Orchestrates calculations and prepares formatted reports

from typing import Dict, Any, Tuple, Optional
from .core import perform_tractive_effort_calculation

def perform_te_calculation(inputs: Dict[str, Any], inputs_raw: Optional[Dict[str, Any]] = None) -> Tuple[Dict[str, Any], str]:
    """
    Main orchestration function for tractive effort calculations.
    Returns (results, formatted_report)
    """
    results = perform_tractive_effort_calculation(inputs)
    formatted_report = format_te_report(inputs, results, inputs_raw or {})
    return results, formatted_report

def format_te_report(inputs: Dict[str, Any], results: Dict[str, Any], inputs_raw: Dict[str, Any]) -> str:
    """Format tractive effort calculation report"""
    return (
        f"# Tractive Effort Calculation Report\n\n"
        f"--- 1. Inputs ---\n"
        f"• Shunting Load: {inputs_raw.get('load', inputs.get('load'))} tons\n"
        f"• GBW of Vehicle: {inputs_raw.get('loco_weight', inputs.get('loco_weight'))} tons\n"
        f"• Gradient: {inputs_raw.get('gradient', inputs.get('gradient'))} ({inputs.get('grad_type')})\n"
        f"• Curvature: {inputs_raw.get('curvature', inputs.get('curvature'))} ({inputs.get('curvature_unit')})\n"
        f"• Speed: {inputs_raw.get('speed', inputs.get('speed'))} km/h\n"
        f"• Mode: {inputs.get('mode')}\n\n"

        f"--- 2. Calculation Results ---\n"
        f"Summary of Results:\n"
        f"  • Tractive Effort (TE): {results['te']:.2f} kg  ({results['te']/1000:.3f} tons)\n"
        f"  • Rail Horsepower: {results['power']:.2f} HP\n"
        f"  • OHE Current: {results['ohe_current']:.2f} A\n\n"
        f"Resistance Components:\n"
        f"  • T1 (Wagon Rolling Resistance): {results['T1']:.2f} kg\n"
        f"  • T2 (Loco Rolling Resistance): {results['T2']:.2f} kg\n"
        f"  • T3 (Gradient Resistance): {results['T3']:.2f} kg\n"
        f"  • T4 (Curvature Resistance): {results['T4']:.2f} kg\n"
    )
