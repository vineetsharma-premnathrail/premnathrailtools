# Braking Tool Service Layer
# Orchestrates calculations and prepares context for reports

import math
from typing import Dict, Any, List, Tuple, TypedDict, Optional
class RailCalcDict(TypedDict, total=False):
    scenario: str
    speed_kmh: float
    v_ms: float
    v_ms_squared: float
    gradient_value: float
    angle_deg: float
    mass_kg: float
    weight_n: float
    fmax: float
    f_g: float
    max_braking_force: float
    f_net: float
    a_deceleration: float
    a_deceleration_doubled: float
    reaction_distance: float
    braking_distance: float
    total_stopping_distance: float

class RoadCalcDict(TypedDict, total=False):
    scenario: str
    gradient_value: float
    speed_kmh: float
    v_ms: float
    v_ms_squared: float
    mass_kg: float
    weight_n: float
    friction: float
    angle_deg: float
    fmax: float
    normal_force: float
    fb_friction: float
    f_g: float
    f_net: float
    a_deceleration: float
    a_deceleration_doubled: float
    reaction_distance: float
    braking_distance: float
    total_stopping_distance: float

class ResultsRowDict(TypedDict, total=False):
    mode: str
    scenario: str
    speed: float
    gradient: str
    gradient_value: float
    gravitational_force: float
    applied_force: float
    net_force: float
    decel: float
    dist: float | str
    total: float | str
    status: str

class ContextDict(TypedDict, total=False):
    doc_no: str
    made_by: str
    checked_by: str
    approved_by: str
    mass_kg: float
    weight_n: float
    speed_kmh: float
    v_ms: float
    reaction_time: float
    Reaction_distance: float
    reference_speed_for_force: float
    reference_braking_dist: float
    decel: float
    totl_sto_distan: float
    fb: float
    example_decel: float
    example_fb: float
    gradient_input: float
    gradient_type: str
    road_gradient_input: float
    road_gradient_type: str
    road_angle_deg: float
    number_of_wheels: int
    wheel_dia: float
    wheel_radius: float
    friction_coefficient: float
    max_braking_force: float
    min_braking_force: float
    old_data_for_report: Dict[float, Dict[str, float]]
    rail_detailed_calcs: List[RailCalcDict]
    road_detailed_calcs: List[RoadCalcDict]
    total_stopping_distance_ts_new__Moving_down: float
    fmax: float
    gbr: float
    gbr_value: float
    gbr_percentage: float
    speed_list: List[float]
    standard_speed_inputs: Dict[float, Dict[str, float]]
    calc: RailCalcDict
    show_gbr: bool
    show_straight: bool
    show_moving_up: bool
    show_moving_down: bool
from .core import (
    calculate_max_rail_force, 
    calculate_rail_scenario_forces, 
    calculate_deceleration_and_distances,
    calculate_road_forces,
    calculate_gbr
)
from .constants import G, BRAKING_DATA
from .units import parse_list, calculate_angle, get_compliance, escape_latex

def perform_braking_calculation(inputs: Dict[str, Any]) -> Tuple[List[ResultsRowDict], Dict[str, Any]]:
    """
    Main orchestration function for braking calculations.
    Returns (results_table_rows, context_for_reports)
    """
    results_table_rows: List[ResultsRowDict] = []
    rail_detailed_calcs: List[RailCalcDict] = []
    road_detailed_calcs: List[RoadCalcDict] = []
    
    mass_kg = inputs['mass_kg']
    weight_n = mass_kg * G
    reaction_time = inputs['reaction_time']
    num_wheels = inputs['num_wheels']
    
    # Calculate global max braking force for rail
    max_rail_force = calculate_max_rail_force(mass_kg, reaction_time)
    
    # Prepare old_data_for_report (force capability table)
    old_data_for_report: Dict[float, Dict[str, float]] = {}
    for speed, dist in sorted(BRAKING_DATA.items()):
        v_ms = speed / 3.6
        decel_required = (v_ms**2) / (2 * dist)
        force_required = mass_kg * decel_required
        
        old_data_for_report[speed] = {
            'speed_ms': round(v_ms, 2),
            'braking_distance': dist,
            'deceleration': round(decel_required, 4),
            'reaction_distance': round(v_ms * reaction_time, 2),
            'total_stopping_distance': round((v_ms * reaction_time) + dist, 2),
            'braking_force': round(force_required, 2)
        }
    
    # Rail calculations
    rail_speeds = parse_list(inputs['rail_speed_input'])
    rail_gradients = parse_list(inputs['rail_gradient_input'])
    rail_gradients_with_flat = sorted(list(set([0.0] + rail_gradients)))
    
    for grad_val in rail_gradients_with_flat:
        rail_scenarios: List[str] = ["Straight Track"]
        if grad_val > 0:
            rail_scenarios = ["Moving up", "Moving down"]
        for scenario in rail_scenarios:
            for speed in sorted(rail_speeds):
                v_ms = speed / 3.6
                current_grad = 0 if scenario == "Straight Track" else grad_val
                angle_deg = calculate_angle(current_grad, inputs['rail_gradient_type'])
                
                f_net, eff_grav = calculate_rail_scenario_forces(
                    max_rail_force, weight_n, angle_deg, scenario
                )
                
                decel, braking_dist, reaction_dist, total_dist = calculate_deceleration_and_distances(
                    f_net, mass_kg, v_ms, reaction_time
                )
                
                compliance = get_compliance(speed, total_dist)
                
                # Add to table output
                results_table_rows.append({
                    "mode": "Rail",
                    "scenario": scenario,
                    "speed": speed,
                    "gradient": f"{current_grad} ({inputs['rail_gradient_type']})" if current_grad > 0 else "0",
                    "gradient_value": current_grad,
                    "gravitational_force": round(weight_n * math.sin(math.radians(angle_deg)), 2),
                    "applied_force": round(max_rail_force, 2),
                    "net_force": round(f_net, 2),
                    "decel": round(decel, 2),
                    "dist": round(braking_dist, 2) if braking_dist < 99999 else "Inf",
                    "total": round(total_dist, 2) if braking_dist < 99999 else "Inf",
                    "status": compliance
                })
                
                # Add to PDF context
                rail_detailed_calcs.append({
                    'scenario': scenario,
                    'speed_kmh': speed,
                    'v_ms': round(v_ms, 2),
                    'v_ms_squared': round(v_ms**2, 2),
                    'gradient_value': current_grad,
                    'angle_deg': round(angle_deg, 2),
                    'mass_kg': mass_kg,
                    'weight_n': round(weight_n, 2),
                    'fmax': round(weight_n * math.sin(math.radians(angle_deg)), 2),
                    'f_g': round(eff_grav, 2),
                    'max_braking_force': round(max_rail_force, 2),
                    'f_net': round(f_net, 2),
                    'a_deceleration': round(decel, 2),
                    'a_deceleration_doubled': round(decel*2, 2),
                    'reaction_distance': round(reaction_dist, 2),
                    'braking_distance': round(braking_dist, 2),
                    'total_stopping_distance': round(total_dist, 2)
                })
    
    # Road calculations
    if inputs['calc_mode'] == "Rail+Road":
        road_speeds: List[float] = parse_list(inputs['road_speed_input'])
        road_gradients: List[float] = parse_list(inputs['road_gradient_input'])
        road_gradients = sorted(list(set([0.0] + road_gradients)))
        for grad_val in road_gradients:
            for speed in sorted(road_speeds):
                v_ms = speed / 3.6
                angle_deg = calculate_angle(grad_val, inputs['road_gradient_type'])
                
                normal, grav, friction_f, net = calculate_road_forces(
                    weight_n, angle_deg, inputs['mu'], "Straight Track"
                )
                
                if grad_val == 0:
                    scenarios: List[Dict[str, Any]] = [{"name": "Straight Track", "grav_factor": 0}]
                else:
                    scenarios = [
                        {"name": "Moving up", "grav_factor": 1},
                        {"name": "Moving down", "grav_factor": -1}
                    ]
                for scenario_dict in scenarios:
                    scenario: str = scenario_dict["name"]
                    if scenario == "Moving up":
                        net = friction_f + grav
                    elif scenario == "Moving down":
                        net = friction_f - grav
                    
                    decel, braking_dist, reaction_dist, total_dist = calculate_deceleration_and_distances(
                        net, mass_kg, v_ms, reaction_time
                    )
                    
                    gradient_display = f"{grad_val} ({inputs['road_gradient_type']})" if grad_val > 0 else "0"
                    
                    results_table_rows.append({
                        "mode": "Road",
                        "scenario": scenario,
                        "speed": speed,
                        "gradient": gradient_display,
                        "gradient_value": grad_val,
                        "gravitational_force": round(grav, 2),
                        "applied_force": round(friction_f, 2),
                        "net_force": round(net, 2),
                        "decel": round(decel, 2),
                        "dist": round(braking_dist, 2) if braking_dist < 99999 else "Inf",
                        "total": round(total_dist, 2) if total_dist < 99999 else "Inf",
                        "status": "N/A"
                    })
                    
                    road_detailed_calcs.append({
                        'scenario': scenario,
                        'gradient_value': grad_val, 
                        'speed_kmh': speed,
                        'v_ms': round(v_ms, 2), 
                        'v_ms_squared': round(v_ms**2, 2),
                        'mass_kg': mass_kg, 
                        'weight_n': round(weight_n, 2),
                        'friction': inputs['mu'], 
                        'angle_deg': round(angle_deg, 2),
                        'fmax': round(grav, 2),
                        'normal_force': round(normal, 2), 
                        'fb_friction': round(friction_f, 2),
                        'f_g': round(grav, 2), 
                        'f_net': round(net, 2),
                        'a_deceleration': round(decel, 2), 
                        'a_deceleration_doubled': round(decel*2, 2),
                        'reaction_distance': round(reaction_dist, 2), 
                        'braking_distance': round(braking_dist, 2),
                        'total_stopping_distance': round(total_dist, 2)
                    })
    
    # Build context for reports
    max_input_speed = max(rail_speeds) if rail_speeds else 0
    ref_v = max_input_speed / 3.6
    
    ref_dist = 50
    for s in sorted(BRAKING_DATA.keys(), reverse=True):
        if max_input_speed >= s:
            ref_dist = BRAKING_DATA[s]
            break
            
    ref_decel = (ref_v**2) / (2 * ref_dist)
    ref_force = mass_kg * ref_decel
    gbr = calculate_gbr(max_rail_force, mass_kg)
    
    down_data: Optional[RailCalcDict] = next((x for x in rail_detailed_calcs if x.get("scenario") == "Moving down"), None)
    calc_obj: RailCalcDict = down_data if down_data else {
        'mass_kg': mass_kg,
        'weight_n': round(weight_n, 2),
        'speed_kmh': max_input_speed,
        'v_ms': round(ref_v, 2),
        'max_braking_force': round(max_rail_force, 2),
        'angle_deg': 0,
        'fmax': 0,
        'f_g': 0,
        'f_net': round(max_rail_force, 2),
        'a_deceleration': round(ref_decel, 2),
        'gradient_value': 0
    }
    
    context: ContextDict = {
        'doc_no': escape_latex(inputs.get('doc_no', '')),
        'made_by': escape_latex(inputs.get('made_by', '')),
        'checked_by': escape_latex(inputs.get('checked_by', '')),
        'approved_by': escape_latex(inputs.get('approved_by', '')),
        'mass_kg': mass_kg, 
        'weight_n': round(weight_n, 2),
        'speed_kmh': max_input_speed, 
        'v_ms': round(ref_v, 2),
        'reaction_time': reaction_time, 
        'Reaction_distance': round(ref_v * reaction_time, 2),
        'reference_speed_for_force': max_input_speed, 
        'reference_braking_dist': ref_dist,
        'decel': round(ref_decel, 2), 
        'totl_sto_distan': round((ref_v*reaction_time)+ref_dist, 2),
        'fb': round(ref_force, 2),
        'example_decel': round(ref_decel, 2), 
        'example_fb': round(ref_force, 2),
        'gradient_input': max(rail_gradients) if rail_gradients else 0,
        'gradient_type': escape_latex(inputs.get('rail_gradient_type', '')),
        'road_gradient_input': max(parse_list(inputs.get('road_gradient_input', '0'))) if inputs.get('road_gradient_input') else 0,
        'road_gradient_type': escape_latex(inputs.get('road_gradient_type', '')),
        'road_angle_deg': round(calculate_angle(max(parse_list(inputs.get('road_gradient_input', '0'))) if inputs.get('road_gradient_input') else 0, inputs.get('road_gradient_type', 'Percentage (%)')), 2),
        'number_of_wheels': num_wheels,
        'wheel_dia': inputs.get('wheel_dia', 0),
        'wheel_radius': inputs.get('wheel_dia', 0) / 2 if inputs.get('wheel_dia') else 0,
        'friction_coefficient': inputs.get('mu', 0.7),
        'max_braking_force': round(max_rail_force, 2),
        'min_braking_force': round(max_rail_force/num_wheels, 2) if num_wheels else 0,
        'old_data_for_report': old_data_for_report,
        'rail_detailed_calcs': rail_detailed_calcs,
        'road_detailed_calcs': road_detailed_calcs,
        'total_stopping_distance_ts_new__Moving_down': down_data.get('total_stopping_distance', 0) if down_data else 0,
        'fmax': down_data.get('fmax', 0) if down_data else 0,
        'gbr': gbr,
        'gbr_value': gbr / 100,
        'gbr_percentage': gbr,
        'speed_list': rail_speeds,
        'standard_speed_inputs': old_data_for_report,
        'calc': calc_obj,
        'show_gbr': inputs.get('show_gbr', False),
        'show_straight': inputs.get('show_straight', True),
        'show_moving_up': inputs.get('show_moving_up', True),
        'show_moving_down': inputs.get('show_moving_down', True)
    }
    
    return results_table_rows, context