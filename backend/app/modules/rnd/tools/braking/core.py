# Braking Tool Core Calculations
# Pure mathematical functions - no I/O, no formatting

import math
from typing import Tuple
from .constants import G, BRAKING_DATA


def calculate_max_rail_force(mass_kg: float, reaction_time: float) -> float:
    """Calculate the maximum braking force required for rail mode"""
    max_force = 0.0
    for speed, dist in sorted(BRAKING_DATA.items()):
        v_ms = speed / 3.6
        decel_required = (v_ms**2) / (2 * dist)
        force_required = mass_kg * decel_required
        if force_required > max_force:
            max_force = force_required
    return max_force

def calculate_rail_scenario_forces(
    max_braking_force: float, 
    weight_n: float, 
    angle_deg: float, 
    scenario: str
) -> Tuple[float, float]:
    """Calculate net force and effective gravity for a rail scenario"""
    grav_force_slope = weight_n * math.sin(math.radians(angle_deg))
    
    if scenario == "Straight Track":
        f_net = max_braking_force
        eff_grav = 0.0
    elif scenario == "Moving up":
        f_net = max_braking_force + grav_force_slope
        eff_grav = grav_force_slope
    elif scenario == "Moving down":
        f_net = max_braking_force - grav_force_slope
        eff_grav = grav_force_slope
    else:
        f_net = max_braking_force
        eff_grav = 0.0
    return f_net, eff_grav

def calculate_deceleration_and_distances(
    f_net: float, 
    mass_kg: float, 
    v_ms: float, 
    reaction_time: float
) -> Tuple[float, float, float, float]:
    """Calculate deceleration, braking distance, reaction distance, total distance"""
    decel = abs(f_net / mass_kg) if mass_kg > 0 else 0.0
    
    if decel > 0 and v_ms > 0:
        braking_dist = abs((0 - v_ms**2) / (2 * decel))
    else:
        braking_dist = 0.0
    
    reaction_dist = v_ms * reaction_time
    total_dist = reaction_dist + braking_dist
    
    return decel, braking_dist, reaction_dist, total_dist

def calculate_road_forces(
    weight_n: float, 
    angle_deg: float, 
    mu: float, 
    scenario: str
) -> Tuple[float, float, float, float]:
    """Calculate forces for road mode"""
    normal = weight_n * math.cos(math.radians(angle_deg))
    grav = weight_n * math.sin(math.radians(angle_deg))
    friction_f = mu * normal
    
    if scenario == "Straight Track":
        net = friction_f
    elif scenario == "Moving up":
        net = friction_f + grav
    elif scenario == "Moving down":
        net = friction_f - grav
    else:
        net = friction_f
    return normal, grav, friction_f, net

def calculate_gbr(max_braking_force: float, mass_kg: float) -> float:
    """Calculate Gross Braking Ratio"""
    return round((max_braking_force / (mass_kg * G)) * 100, 2) if mass_kg > 0 else 0