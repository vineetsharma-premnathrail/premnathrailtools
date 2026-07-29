# Tractive Effort Tool Core Calculations
# Pure mathematical functions - no I/O, no formatting

import math
from typing import Dict, Any
from .constants import (
    WAGON_ROLLING_RESISTANCE_START, LOCO_ROLLING_RESISTANCE_START,
    WAGON_ROLLING_RESISTANCE_RUNNING, LOCO_ROLLING_RESISTANCE_RUNNING,
    POWER_CONSTANT, OHE_VOLTAGE, OHE_EFFICIENCY, POWER_FACTOR, CURRENT_CONSTANT,
    GRADIENT_CONSTANT, CURVATURE_CONSTANT
)

def calculate_gradient_resistance(gradient: float, grad_type: str) -> float:
    """Calculate gradient resistance per ton"""
    if grad_type == "Degree":
        return math.tan(math.radians(gradient)) * GRADIENT_CONSTANT if gradient != 0 else 0
    else:  # "1 in G"
        return GRADIENT_CONSTANT / gradient if gradient != 0 else 0

def calculate_curvature_resistance(curvature: float, curvature_unit: str) -> float:
    """Calculate curvature resistance per ton"""
    if curvature_unit == "Radius(m)":
        return CURVATURE_CONSTANT / curvature if curvature != 0 else 0
    else:  # "Degree"
        return curvature

def get_rolling_resistances(mode: str) -> tuple[float, float, float]:
    """Get rolling resistance coefficients and speed for power calculation"""
    if mode == "Start":
        return WAGON_ROLLING_RESISTANCE_START, LOCO_ROLLING_RESISTANCE_START, 1.0
    else:  # "Running"
        # Use 0.0 as a sentinel value for speed to be set later
        return WAGON_ROLLING_RESISTANCE_RUNNING, LOCO_ROLLING_RESISTANCE_RUNNING, 0.0

def calculate_resistance_components(inputs: Dict[str, Any]) -> Dict[str, float]:
    """Calculate all resistance components"""
    load = inputs['load']
    loco_weight = inputs['loco_weight']
    total_weight = load + loco_weight

    # Calculate gradient and curvature resistances
    gradient_resistance_per_ton = calculate_gradient_resistance(inputs['gradient'], inputs['grad_type'])
    curvature_resistance_per_ton = calculate_curvature_resistance(inputs['curvature'], inputs['curvature_unit'])

    # Get rolling resistances
    wagon_rr, loco_rr, speed_for_power = get_rolling_resistances(inputs['mode'])
    if speed_for_power == 0.0:  # Running mode, set actual speed
        speed_for_power = inputs['speed']

    # Calculate individual components
    T1 = load * wagon_rr  # Wagon rolling resistance
    T2 = loco_weight * loco_rr  # Loco rolling resistance
    T3 = total_weight * gradient_resistance_per_ton  # Gradient resistance
    T4 = total_weight * curvature_resistance_per_ton  # Curvature resistance

    return {
        'T1': T1,
        'T2': T2,
        'T3': T3,
        'T4': T4,
        'speed_for_power': speed_for_power
    }

def calculate_tractive_effort(components: Dict[str, float]) -> Dict[str, float]:
    """Calculate final tractive effort, power, and current"""
    te = components['T1'] + components['T2'] + components['T3'] + components['T4']
    power = (te * components['speed_for_power']) / POWER_CONSTANT
    ohe_current = (power * CURRENT_CONSTANT) / (OHE_VOLTAGE * OHE_EFFICIENCY * POWER_FACTOR)

    return {
        'te': te,
        'power': power,
        'ohe_current': ohe_current
    }

def perform_tractive_effort_calculation(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Main calculation function for tractive effort"""
    components = calculate_resistance_components(inputs)
    results = calculate_tractive_effort(components)

    # Combine all results
    final_results = {**components, **results}
    return final_results
