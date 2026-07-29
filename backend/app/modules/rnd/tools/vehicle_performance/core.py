# Vehicle Performance Tool Core Calculations
# Pure mathematical functions - no I/O, no formatting

import math
from typing import Dict, Any, List
from .constants import GRAVITY, AIR_DENSITY, ROLLING_RESISTANCE_COEFFICIENT, MPS_TO_KMH

def calculate_resistive_forces(mass_kg: float, speed_kmh: float, slope_percent: float,
                              curve_radius_m: float, friction_mu: float) -> Dict[str, float]:
    """Calculate all resistive forces acting on the vehicle"""
    speed_mps = speed_kmh / MPS_TO_KMH

    # Rolling resistance (simplified)
    rolling_resistance = mass_kg * GRAVITY * ROLLING_RESISTANCE_COEFFICIENT

    # Gradient resistance
    gradient_resistance = mass_kg * GRAVITY * (slope_percent / 100)

    # Curve resistance (simplified)
    curve_resistance = 0.0
    if curve_radius_m > 0:
        curve_resistance = (mass_kg * GRAVITY * math.pow(speed_mps, 2)) / (curve_radius_m * GRAVITY)

    # Air resistance (simplified)
    air_resistance = 0.5 * AIR_DENSITY * math.pow(speed_mps, 2) * 1.0  # Assuming Cd*A = 1.0

    # Total resistance
    total_resistance = rolling_resistance + gradient_resistance + curve_resistance + air_resistance

    return {
        'rolling_resistance': rolling_resistance,
        'gradient_resistance': gradient_resistance,
        'curve_resistance': curve_resistance,
        'air_resistance': air_resistance,
        'total_resistance': total_resistance
    }

def calculate_torque_from_power(power_kw: float, rpm: float) -> float:
    """Calculate torque from power and RPM"""
    if rpm == 0:
        return 0.0
    # Power (W) = Torque (Nm) * RPM * 2π / 60
    return (power_kw * 1000 * 60) / (rpm * 2 * math.pi)

def calculate_wheel_force(torque_nm: float, wheel_radius_m: float, gear_ratio: float,
                         mechanical_efficiency: float = 0.95) -> float:
    """Calculate tractive force at wheels"""
    return (torque_nm * gear_ratio * mechanical_efficiency) / wheel_radius_m

def calculate_max_speed_for_conditions(mass_kg: float, available_power_kw: float,
                                     slope_percent: float, curve_radius_m: float,
                                     gear_ratio: float, wheel_radius_m: float,
                                     friction_mu: float) -> float:
    """Calculate maximum achievable speed for given conditions"""
    # Simplified calculation - find speed where tractive force equals resistance
    max_speed_kmh = 0.0

    # Try different speeds to find equilibrium
    for speed_kmh in range(0, 200, 5):  # 0 to 200 km/h in 5 km/h steps
        resistances = calculate_resistive_forces(mass_kg, speed_kmh, slope_percent,
                                                curve_radius_m, friction_mu)
        total_resistance = resistances['total_resistance']

        # Calculate available tractive force at this speed
        # Assume constant power, so torque decreases with speed
        rpm = (speed_kmh / MPS_TO_KMH) * gear_ratio * 60 / (2 * math.pi * wheel_radius_m)
        if rpm > 0:
            torque = calculate_torque_from_power(available_power_kw, rpm)
            tractive_force = calculate_wheel_force(torque, wheel_radius_m, 1.0)  # gear_ratio already included in RPM calc

            if tractive_force >= total_resistance:
                max_speed_kmh = speed_kmh
            else:
                break

    return max_speed_kmh

def calculate_traction_snapshot(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate traction performance snapshot for given inputs"""
    mass_kg = inputs['loco_gvw_kg']
    power_kw = inputs['peak_power_kw']
    wheel_radius_m = inputs['wheel_dia_m'] / 2
    gear_ratios = inputs.get('gear_ratios', [1.0])
    friction_mu = inputs.get('friction_mu', 0.3)

    results: Dict[str, Any] = {}

    # Calculate for each gear
    for gear_ratio in gear_ratios:
        gear_key = f"gear_{gear_ratio}"

        # Calculate max speed on level ground
        max_speed_level = calculate_max_speed_for_conditions(
            mass_kg, power_kw, 0, float('inf'), gear_ratio, wheel_radius_m, friction_mu
        )

        # Calculate max speed on given slope
        max_slope = inputs.get('max_slope', 0)
        max_speed_slope = calculate_max_speed_for_conditions(
            mass_kg, power_kw, max_slope, float('inf'), gear_ratio, wheel_radius_m, friction_mu
        )

        # Calculate max speed on given curve
        max_curve = inputs.get('max_curve', float('inf'))
        max_speed_curve = calculate_max_speed_for_conditions(
            mass_kg, power_kw, 0, max_curve, gear_ratio, wheel_radius_m, friction_mu
        )

        results[gear_key] = {
            'max_speed_level_kmh': max_speed_level,
            'max_speed_slope_kmh': max_speed_slope,
            'max_speed_curve_kmh': max_speed_curve,
            'gear_ratio': gear_ratio
        }

    return results

def calculate_speed_vs_slope_table(inputs: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Calculate speed vs slope performance table"""
    mass_kg = inputs['loco_gvw_kg']
    power_kw = inputs['peak_power_kw']
    wheel_radius_m = inputs['wheel_dia_m'] / 2
    gear_ratios = inputs.get('gear_ratios', [1.0])
    friction_mu = inputs.get('friction_mu', 0.3)
    max_slope = inputs.get('max_slope', 10)

    table_data: List[Dict[str, Any]] = []

    # Calculate for different slopes
    slopes = [i * max_slope / 10 for i in range(11)]  # 0% to max_slope%

    for slope in slopes:
        row = {'slope_percent': slope}

        for gear_ratio in gear_ratios:
            max_speed = calculate_max_speed_for_conditions(
                mass_kg, power_kw, slope, float('inf'), gear_ratio, wheel_radius_m, friction_mu
            )
            row[f'gear_{gear_ratio}_speed_kmh'] = max_speed

        table_data.append(row)

    return table_data

def calculate_max_traction_without_slipping(mass_kg: float, friction_mu: float, num_axles: int) -> float:
    """Calculate maximum tractive force without slipping"""
    # Simplified: assume all axles are driving axles
    return mass_kg * GRAVITY * friction_mu

def calculate_max_traction_force(inputs: Dict[str, Any]) -> float:
    """Calculate maximum tractive force the locomotive can generate"""
    torque_curve = inputs.get('torque_curve', {})
    gear_ratios = inputs.get('gear_ratios', [1.0])
    wheel_radius_m = inputs['wheel_dia_m'] / 2
    
    if not torque_curve:
        # If no torque curve, use peak power at some RPM
        power_kw = inputs['peak_power_kw']
        rpm = inputs.get('max_rpm', 2500)
        max_torque = calculate_torque_from_power(power_kw, rpm)
    else:
        # Find maximum torque from curve
        max_torque = max(torque_curve.values()) if torque_curve else 0
    
    # Use the highest gear ratio for maximum force (lowest speed)
    max_gear_ratio = max(gear_ratios)
    
    # Calculate force
    return calculate_wheel_force(max_torque, wheel_radius_m, max_gear_ratio)