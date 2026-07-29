# Hydraulic Tool Core Calculations
# Pure mathematical functions - no I/O, no formatting

import math
from typing import Dict, Any, Optional
from .constants import GRAVITY

def calculate_displacement_mode(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Calculate hydraulic motor displacement and pump requirements (displacement / cc mode).

    NOTE: Motor-Pressure-specific logic was moved to a dedicated function
    `calculate_motor_pressure_mode` to avoid mixing calculation modes.
    """
    results: Dict[str, Any] = {}
    pump_results: list[Dict[str, Any]] = []
    warnings: list[str] = []

    speed = inputs['speed']
    locomotive_weight = inputs['weight']
    number_of_axles = inputs['axles']
    wheel_diameter = inputs['wheel_diameter']
    slope_percent = inputs['slope_percent']
    curve_degree = inputs['curve_degree']
    pressure_bar = inputs.get('pressure', 0.0)
    mech_eff_motor_frac = inputs['mech_eff_motor'] / 100.0
    gear_ratio = inputs.get('axle_gear_box_ratio', 1.0)
    engine_gear_list = inputs.get('engine_gear_ratio_list', [1.0])
    pto_gear_ratio = inputs['pto_gear_ratio']

    wheel_circumference = (wheel_diameter * math.pi) / 1000
    if wheel_circumference == 0:
        raise ValueError("Wheel Diameter cannot be 0.")
    speed_mps = (speed * 1000) / 3600
    wheel_rpm = (speed_mps / wheel_circumference) * 60
    gearbox_input_rpm = wheel_rpm * gear_ratio

    # General validation used for displacement mode
    if number_of_axles <= 0:
        raise ValueError("Number of axles must be greater than 0.")
    drive_axles = int(inputs.get('drive_axles', number_of_axles) or number_of_axles)
    if drive_axles <= 0:
        raise ValueError("Drive axles must be greater than 0.")
    if drive_axles > number_of_axles:
        raise ValueError("Drive axles cannot exceed total number of axles.")
    if locomotive_weight <= 0:
        raise ValueError("Weight must be greater than 0.")
    if gear_ratio == 0:
        raise ValueError("Axle Gearbox Ratio cannot be 0.")

    A = 0.647 + (13.17 / (locomotive_weight / number_of_axles))
    B = 0.00933
    C = 0.057 / locomotive_weight
    rolling_resistance = (A + B * speed + C * speed**2) * locomotive_weight * GRAVITY / 1000
    gradient_resistance = locomotive_weight * 1000 * GRAVITY * slope_percent / 100000
    curvature_resistance = 0.4 * locomotive_weight * curve_degree * GRAVITY / 1000
    starting_resistance = 6 * locomotive_weight * GRAVITY / 1000
    total_resistance = rolling_resistance + gradient_resistance + curvature_resistance + starting_resistance

    wheel_radius = wheel_diameter / 2000
    required_total_torque = total_resistance * 1000 * wheel_radius
    # Distribute traction torque only across drive axles/wheels
    number_of_wheels = drive_axles * 2
    per_wheel_torque = required_total_torque / number_of_wheels if number_of_wheels > 0 else 0.0
    per_axle_torque = required_total_torque / drive_axles if drive_axles > 0 else 0.0

    # Motors: use provided total number or derive from motors per axle
    motors_per_axle = int(inputs.get('per_axle_motor', 1) or 1)
    num_motors = int(inputs.get('num_motors', motors_per_axle * drive_axles) or (motors_per_axle * drive_axles))

    # Torque per motor (distribute axle torque across motors on that axle)
    if motors_per_axle <= 0:
        raise ValueError("Motors per axle must be greater than 0.")
    per_motor_torque = per_axle_torque / motors_per_axle

    
    # Gearbox input torque is torque seen at gearbox input per motor
    per_gearbox_input_torque = per_motor_torque / gear_ratio
    per_gearbox_input_torque_kg_cm = per_gearbox_input_torque * 10.1972

    # Displacement-mode: compute motor displacement from supplied pressure
    pressure_kg_cm2 = pressure_bar * 1.01972
    if pressure_kg_cm2 == 0 or mech_eff_motor_frac == 0:
        raise ValueError("Pressure or Mechanical Efficiency cannot be 0.")
    motor_displacement = (per_gearbox_input_torque_kg_cm * 2 * math.pi) / (pressure_kg_cm2 * mech_eff_motor_frac)

    vol_eff_motor_frac = (inputs['vol_eff_motor'] / 100.0)
    if vol_eff_motor_frac == 0:
        raise ValueError("Motor Volumetric Efficiency cannot be 0.")

    # hydraulic_motor_flow is flow per motor (LPM)
    hydraulic_motor_flow = ((motor_displacement * gearbox_input_rpm) / vol_eff_motor_frac ) / 1000
    total_motor_flow_lpm = hydraulic_motor_flow * num_motors



    results['speed_mps'] = speed_mps
    results['wheel_circumference'] = wheel_circumference
    results['wheel_rpm'] = wheel_rpm
    results['gearbox_input_rpm'] = gearbox_input_rpm
    results['A'] = A
    results['B'] = B
    results['C'] = C
    results['rolling_resistance'] = rolling_resistance
    results['gradient_resistance'] = gradient_resistance
    results['curvature_resistance'] = curvature_resistance
    results['starting_resistance'] = starting_resistance
    results['total_resistance'] = total_resistance
    results['wheel_radius'] = wheel_radius
    results['required_total_torque'] = required_total_torque
    results['per_wheel_torque'] = per_wheel_torque
    results['per_axle_torque'] = per_axle_torque
    results['drive_axles'] = drive_axles
    results['motors_per_axle'] = motors_per_axle
    results['num_motors'] = num_motors
    results['per_motor_torque'] = per_motor_torque
    results['per_gearbox_input_torque'] = per_gearbox_input_torque
    results['per_gearbox_input_torque_kg_cm'] = per_gearbox_input_torque_kg_cm
    results['pressure_kg_cm2'] = pressure_kg_cm2
    results['motor_displacement_cc'] = motor_displacement
    results['per_motor_flow_rate_lpm'] = hydraulic_motor_flow
    results['total_motor_flow_lpm'] = total_motor_flow_lpm

    hydraulic_motor_flow = ((motor_displacement * gearbox_input_rpm) / vol_eff_motor_frac ) / 1000
    vol_eff_motor_frac = (inputs['vol_eff_motor'] / 100.0)
    per_motor_power_kw = ((hydraulic_motor_flow * pressure_bar) / 600 ) *  mech_eff_motor_frac * vol_eff_motor_frac 
    results['per_motor_power_kw'] = per_motor_power_kw
       # --- Suggested standard motor displacement (pick next-higher from standard sizes)
    motor_standard_sizes = [16, 23, 28, 32, 45, 56, 63, 80, 90, 107, 125]
    try:
        # choose the first standard size STRICTLY greater than the calculated value
        suggested_motor = next((s for s in motor_standard_sizes if s > motor_displacement), None)
        if suggested_motor is None:
            # no higher size available — fallback to the largest available
            suggested_motor = motor_standard_sizes[-1]
    except Exception:
        suggested_motor = motor_standard_sizes[-1]
    results['suggested_motor_cc'] = float(suggested_motor)



    prop_rpm_list = [inputs.get('max_vehicle_rpm', 0.0)]
    vol_eff_pump_frac = inputs['vol_eff_pump'] / 100.0
    if vol_eff_pump_frac == 0:
        raise ValueError("Pump Volumetric Efficiency cannot be 0.")

    # Determine effective number of pumps. legacy per-axle-pump input has been removed;
    # use explicit `num_pumps` value or default to one pump.
    provided_num_pumps = int(inputs.get('num_pumps', 0) or 0)
    num_pumps = provided_num_pumps if provided_num_pumps > 0 else 1

    # Safe pump mechanical-efficiency fraction (validated in validation.py)
    pump_mech_eff_frac = float(inputs.get('mech_eff_pump', 95.0)) / 100.0
    if pump_mech_eff_frac <= 0.0:
        raise ValueError("Pump mechanical efficiency must be greater than 0%.")
    for engine_gear in engine_gear_list:
        for max_vehicle_rpm_input in prop_rpm_list:
            if engine_gear == 0 or gear_ratio == 0:
                raise ValueError("Engine or Axle Gear Ratio cannot be 0.")
            actual_prop_rpm = max_vehicle_rpm_input / engine_gear
            pump_rpm_from_prop = pto_gear_ratio * actual_prop_rpm
            if pump_rpm_from_prop <= 0:
                raise ValueError(f"Calculated pump RPM ({pump_rpm_from_prop:.2f}) is 0 or negative.")
            pump_denom = (pump_rpm_from_prop * vol_eff_pump_frac)
            if pump_denom == 0:
                raise ValueError("Calculated Pump RPM or Volumetric Efficiency is 0.")
            # Use total motor flow (LPM) when computing required pump displacement per revolution
            disp_L_rev = total_motor_flow_lpm / pump_denom
            pump_disp = disp_L_rev * 1000.0
            pump_disp_per_pump = pump_disp / num_pumps if num_pumps > 0 else pump_disp
            # Suggest a standard pump size (per-pump) — pick the next higher available standard size
            pump_standard_sizes = [10, 12, 16, 23, 28, 32, 45, 56, 63, 80, 90, 107, 125, 160, 180]
            try:
                # prefer per-pump comparison (more practical when multiple pumps are used)
                target_per_pump = pump_disp_per_pump
                suggested_per_pump = next((s for s in pump_standard_sizes if s > target_per_pump), None)
                if suggested_per_pump is None:
                    suggested_per_pump = pump_standard_sizes[-1]
            except Exception:
                suggested_per_pump = pump_standard_sizes[-1]
            # also compute overall suggested pump displacement (total)
            try:
                suggested_total_pump = next((s for s in pump_standard_sizes if s > pump_disp), pump_standard_sizes[-1])
            except Exception:
                suggested_total_pump = pump_standard_sizes[-1]

            # compute pump flows and power using actual per-pump displacement (not only suggested)
            pump_flow_lpm = (pump_disp * pump_rpm_from_prop * vol_eff_pump_frac) / 1000.0
            pump_flow_per_pump_lpm = (pump_disp_per_pump * pump_rpm_from_prop * vol_eff_pump_frac) / 1000.0
            # hydraulic power (kW) = (pressure_bar * Q_LPM) / (600 * mech_eff)
            pump_power_per_pump_kw = (pressure_bar * pump_flow_per_pump_lpm) / (600.0 * pump_mech_eff_frac) if pump_mech_eff_frac > 0 else 0.0
            pump_total_power_kw = pump_power_per_pump_kw * num_pumps

            # suggested-per-pump power (for comparison with suggested_per_pump size)
            suggested_per_pump_power_kw = (pressure_bar * ((suggested_per_pump * pump_rpm_from_prop * vol_eff_pump_frac) / 1000.0)) / (600.0 * pump_mech_eff_frac) if pump_mech_eff_frac > 0 else 0.0

            pump_results.append({
                'engine_gear_ratio': engine_gear,
                'max_vehicle_rpm_input': max_vehicle_rpm_input,
                'pump_rpm': pump_rpm_from_prop,
                'pump_disp_cc': pump_disp,
                'pump_disp_per_pump_cc': pump_disp_per_pump,
                'num_pumps': num_pumps,
                'actual_prop_rpm': actual_prop_rpm,
                'suggested_pump_disp_cc': float(suggested_total_pump),
                'suggested_pump_disp_per_pump_cc': float(suggested_per_pump),
                'pump_flow_lpm': pump_flow_lpm,
                'pump_flow_per_pump_lpm': pump_flow_per_pump_lpm,
                'pump_power_per_pump_kw': pump_power_per_pump_kw,
                'pump_total_power_kw': pump_total_power_kw,
                'suggested_per_pump_power_kw': suggested_per_pump_power_kw
            })


    # expose the effective pump counts used by the core
    results['num_pumps'] = int(num_pumps)
    results['pump_results'] = pump_results

    # Expose convenient top-level pump metrics for templates that reference them directly
    # (some templates use `pump_rpm` / `pump_total_disp_cc` directly instead of drilling into `pump_results`).
    if pump_results:
        first = pump_results[0]
        results['pump_rpm'] = float(first.get('pump_rpm', 0.0))
        results['pump_total_disp_cc'] = float(first.get('pump_disp_cc', 0.0))
        results['pump_disp_per_pump_cc'] = float(first.get('pump_disp_per_pump_cc', 0.0))
        results['pump_flow_per_pump_lpm'] = float(first.get('pump_flow_per_pump_lpm', 0.0))
        results['pump_power_per_pump_kw'] = float(first.get('pump_power_per_pump_kw', 0.0))
        results['pump_total_power_kw'] = float(first.get('pump_total_power_kw', 0.0))

    # --- Sensitivity analysis (simple ±10% cases for key inputs) ---
    sensitivity: Dict[str, Dict[str, Optional[Dict[str, float]]]] = {}
    try:
        if pump_results:
            pr0: Dict[str, Any] = pump_results[0]
            pump_rpm_ref: float = float(pr0.get('pump_rpm', 0.0))

            # helper to compute resulting values for a modified set of input multipliers
            def _compute_sensitivity(mod_pressure_bar: float, mod_vol_eff_motor_frac: float, mod_vol_eff_pump_frac: float) -> Optional[Dict[str, float]]:
                # motor displacement (depends inversely on pressure)
                pressure_kg_cm2_mod = mod_pressure_bar * 1.01972
                if pressure_kg_cm2_mod <= 0 or mech_eff_motor_frac == 0:
                    return None
                motor_disp_mod = (per_gearbox_input_torque_kg_cm * 2 * math.pi) / (pressure_kg_cm2_mod * mech_eff_motor_frac)
                # motor flow (LPM)
                if mod_vol_eff_motor_frac == 0:
                    return None
                motor_flow_mod = ((motor_disp_mod * gearbox_input_rpm) / mod_vol_eff_motor_frac) / 1000.0
                total_motor_flow_mod = motor_flow_mod * num_motors
                # pump displacement required (total and per pump)
                pump_denom_mod = pump_rpm_ref * mod_vol_eff_pump_frac
                if pump_denom_mod == 0:
                    return None
                pump_disp_mod = (total_motor_flow_mod / pump_denom_mod) * 1000.0
                pump_disp_per_pump_mod = pump_disp_mod / (num_pumps if num_pumps>0 else 1)
                # pump flow per pump
                pump_flow_per_pump_lpm_mod = (pump_disp_per_pump_mod * pump_rpm_ref * mod_vol_eff_pump_frac) / 1000.0
                # pump power (kW)
                pump_power_per_pump_kw_mod = (mod_pressure_bar * pump_flow_per_pump_lpm_mod) / (600.0 * pump_mech_eff_frac) if pump_mech_eff_frac>0 else 0.0
                pump_total_power_kw_mod = pump_power_per_pump_kw_mod * (num_pumps if num_pumps>0 else 1)
                return {
                    'motor_displacement_cc': motor_disp_mod,
                    'per_motor_flow_rate_lpm': motor_flow_mod,
                    'total_motor_flow_lpm': total_motor_flow_mod,
                    'pump_disp_cc': pump_disp_mod,
                    'pump_disp_per_pump_cc': pump_disp_per_pump_mod,
                    'pump_flow_per_pump_lpm': pump_flow_per_pump_lpm_mod,
                    'pump_power_per_pump_kw': pump_power_per_pump_kw_mod,
                    'pump_total_power_kw': pump_total_power_kw_mod
                }

            base_pressure: float = float(pressure_bar)
            base_vol_eff_motor: float = float(inputs['vol_eff_motor'])/100.0
            base_vol_eff_pump: float = float(inputs['vol_eff_pump'])/100.0

            for param, _ in (('pressure', base_pressure), ('vol_eff_motor', base_vol_eff_motor), ('vol_eff_pump', base_vol_eff_pump)):
                sensitivity[param] = {}
                for label, factor in (('minus', 0.9), ('plus', 1.1)):
                    if param == 'pressure':
                        mod_p = base_pressure * factor
                        mod_vm = base_vol_eff_motor
                        mod_vp = base_vol_eff_pump
                    elif param == 'vol_eff_motor':
                        mod_p = base_pressure
                        mod_vm = max(1e-6, base_vol_eff_motor * factor)
                        mod_vp = base_vol_eff_pump
                    else:  # vol_eff_pump
                        mod_p = base_pressure
                        mod_vm = base_vol_eff_motor
                        mod_vp = max(1e-6, base_vol_eff_pump * factor)
                    out: Optional[Dict[str, float]] = _compute_sensitivity(mod_p, mod_vm, mod_vp)
                    sensitivity[param][label] = out
            results['sensitivity'] = sensitivity
    except Exception:
        # non-fatal — sensitivity is a best-effort enhancement
        results['sensitivity'] = {}

    results['warnings'] = warnings
    return results




def calculate_gear_ratio_mode(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Dedicated Gear Ratio mode — compute required gear ratio from motor speed.

    Formula:
      wheel_circumference (m) = wheel_diameter (mm) * pi / 1000
      speed_mps = speed_kph * 1000 / 3600
      wheel_rpm = (speed_mps / wheel_circumference) * 60
      required_gear_ratio = max_motor_rpm / wheel_rpm

    Returns keys: wheel_circumference, speed_mps, wheel_rpm, required_gear_ratio
    """
    results: Dict[str, Any] = {}
    warnings: list[str] = []

    # required inputs
    speed = float(inputs.get('speed', 0.0))
    wheel_diameter = float(inputs.get('wheel_diameter', 0.0))
    max_motor_rpm = float(inputs.get('max_motor_rpm', 0.0))

    if wheel_diameter <= 0:
        raise ValueError("Wheel Diameter must be greater than 0 for gear ratio calculation.")
    if speed <= 0:
        raise ValueError("Vehicle speed must be greater than 0 for gear ratio calculation.")
    if max_motor_rpm <= 0:
        raise ValueError("Max motor RPM must be greater than 0 for gear ratio calculation.")

    wheel_circumference = (wheel_diameter * math.pi) / 1000.0  # meters
    speed_mps = (speed * 1000.0) / 3600.0
    wheel_rpm = (speed_mps / wheel_circumference) * 60.0

    if wheel_rpm == 0:
        raise ValueError("Calculated wheel RPM is 0 — check speed and wheel diameter inputs.")

    required_gear_ratio = max_motor_rpm / wheel_rpm

    results['speed_mps'] = speed_mps
    results['wheel_circumference'] = wheel_circumference
    results['wheel_rpm'] = wheel_rpm
    results['required_gear_ratio'] = required_gear_ratio
    results['warnings'] = warnings
    return results


def calculate_motor_pressure_mode(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Dedicated Motor Pressure mode — compute required pressure from motor displacement.

    This function performs the traction/resistance and pump-result calculations like
    displacement mode, but computes `required_pressure_bar` from the supplied
    `motor_disp_in` and the torque requirements instead of deriving displacement.
    """
    # Reuse many of the same local variable names so the output keys match
    results: Dict[str, Any] = {}
    warnings: list[str] = []

    # copy inputs used for traction calculations
    speed = inputs['speed']
    locomotive_weight = inputs['weight']
    number_of_axles = inputs['axles']
    wheel_diameter = inputs['wheel_diameter']
    slope_percent = inputs['slope_percent']
    curve_degree = inputs['curve_degree']
    mech_eff_motor_frac = inputs['mech_eff_motor'] / 100.0
    # Motor-Pressure: use axle gearbox ratio as the gearbox-input torque basis (Option B)
    # Engine gear ratios do not affect the pressure calculation here.
    gear_ratio = inputs.get('axle_gear_box_ratio', 1.0)
    if gear_ratio == 0:
        raise ValueError("Axle Gearbox Ratio cannot be 0 for Motor Pressure mode.")

    wheel_circumference = (wheel_diameter * math.pi) / 1000
    if wheel_circumference == 0:
        raise ValueError("Wheel Diameter cannot be 0.")
    speed_mps = (speed * 1000) / 3600
    wheel_rpm = (speed_mps / wheel_circumference) * 60

    # Validation specific to Motor Pressure mode
    if number_of_axles <= 0:
        raise ValueError("Number of axles must be greater than 0.")
    drive_axles = int(inputs.get('drive_axles', number_of_axles) or number_of_axles)
    if drive_axles <= 0 or drive_axles > number_of_axles:
        raise ValueError("Drive axles must be > 0 and cannot exceed total axles.")
    if locomotive_weight <= 0:
        raise ValueError("Weight must be greater than 0.")
    motors_per_axle = int(inputs.get('per_axle_motor', 1) or 1)
    if motors_per_axle <= 0:
        raise ValueError("Motors per axle must be greater than 0.")

    A = 0.647 + (13.17 / (locomotive_weight / number_of_axles))
    B = 0.00933
    C = 0.057 / locomotive_weight
    rolling_resistance = (A + B * speed + C * speed**2) * locomotive_weight * GRAVITY / 1000
    gradient_resistance = locomotive_weight * 1000 * GRAVITY * slope_percent / 100000
    curvature_resistance = 0.4 * locomotive_weight * curve_degree * GRAVITY / 1000
    starting_resistance = 6 * locomotive_weight * GRAVITY / 1000
    total_resistance = rolling_resistance + gradient_resistance + curvature_resistance + starting_resistance

    wheel_radius = wheel_diameter / 2000
    required_total_torque = total_resistance * 1000 * wheel_radius
    number_of_wheels = drive_axles * 2
    per_axle_torque = required_total_torque / drive_axles if drive_axles > 0 else 0.0
    per_wheel_torque = required_total_torque / number_of_wheels if number_of_wheels > 0 else 0.0
  
    num_motors = int(inputs.get('num_motors', motors_per_axle * drive_axles) or (motors_per_axle * drive_axles))
    per_motor_torque = per_axle_torque / motors_per_axle

    
    per_gearbox_input_torque = per_motor_torque / gear_ratio
    per_gearbox_input_torque_kg_cm = per_gearbox_input_torque * 10.1972

    # Motor displacement must be provided in this mode
    motor_displacement_input = float(inputs.get('motor_disp_in', 0.0))
    if motor_displacement_input <= 0:
        raise ValueError("Motor displacement must be provided and greater than 0 for Motor Pressure mode.")
    if mech_eff_motor_frac == 0:
        raise ValueError("Mechanical efficiency cannot be 0.")

    # torque_kgcm × 2π / (displacement_cc × efficiency) = pressure (kg/cm2)
    required_pressure_kg_cm2 = (per_gearbox_input_torque_kg_cm * 2 * math.pi) / (motor_displacement_input * mech_eff_motor_frac)
    required_pressure_bar = required_pressure_kg_cm2 / 1.01972

    # Use required pressure to populate comparable result keys. We do NOT compute
    # pump/pto/axle-gear flows or pump_results in Motor Pressure-only mode.
    pressure_kg_cm2 = required_pressure_kg_cm2
    motor_displacement = motor_displacement_input

    

    results['speed_mps'] = speed_mps
    results['wheel_circumference'] = wheel_circumference
    results['wheel_rpm'] = wheel_rpm
    # gearbox_input_rpm intentionally omitted for Motor Pressure-only mode
    results['A'] = A
    results['B'] = B
    results['C'] = C
    results['rolling_resistance'] = rolling_resistance
    results['gradient_resistance'] = gradient_resistance
    results['curvature_resistance'] = curvature_resistance
    results['starting_resistance'] = starting_resistance
    results['total_resistance'] = total_resistance
    results['wheel_radius'] = wheel_radius
    results['required_total_torque'] = required_total_torque
    results['per_wheel_torque'] = per_wheel_torque
    results['per_axle_torque'] = per_axle_torque
    results['drive_axles'] = drive_axles
    results['motors_per_axle'] = motors_per_axle
    results['num_motors'] = num_motors
    results['per_motor_torque'] = per_motor_torque
    results['per_gearbox_input_torque'] = per_gearbox_input_torque
    results['per_gearbox_input_torque_kg_cm'] = per_gearbox_input_torque_kg_cm
    results['pressure_kg_cm2'] = pressure_kg_cm2
    results['motor_displacement_cc'] = motor_displacement
   

    # Motor Pressure specific output
    results['required_pressure_bar'] = required_pressure_bar

    # Motor-pressure-only mode: user requested NO pump / PTO / axle-gear computations.
    # Provide empty pump_results and return the core motor/torque/pressure outputs only.
    results['pump_results'] = []
    results['warnings'] = warnings
    return results

def calculate_speed_mode(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """Torque-match speed mode – scans 1–120 km/h and finds the
    highest speed/gear where the available motor torque meets or exceeds
    the required torque.  Returns the matched case and a step-by-step
    calculation suitable for professional reports.

    Only the matched speed/gear is reported; intermediate speeds are
    discarded as per final master prompt.
    """
    # shorthand names for input values
    W = float(inputs.get('weight', 0.0))              # tons
    axles = float(inputs.get('axles', 0.0))
    drive_axles = float(inputs.get('drive_axles', axles))
    wheel_dia = float(inputs.get('wheel_diameter', 0.0))  # mm
    slope = float(inputs.get('slope_percent', 0.0))
    curve = float(inputs.get('curve_degree', 0.0))
    gear_list = inputs.get('engine_gear_ratio_list', [1.0])
    max_rpm = float(inputs.get('max_vehicle_rpm', 0.0))
    pto = float(inputs.get('pto_gear_ratio', 1.0))
    pumps = float(inputs.get('num_pumps', 1.0))
    pump_cc = float(inputs.get('pump_disp_in', 0.0))
    motor_cc = float(inputs.get('motor_disp_in', 0.0))
    pressure = float(inputs.get('pressure', 0.0))
    vol_eff = float(inputs.get('vol_eff_pump', 0.0)) / 100.0
    mech_eff = float(inputs.get('mech_eff_motor', 0.0)) / 100.0
    motors_per_axle = float(inputs.get('per_axle_motor', 1.0))
    gear_ratio = float(inputs.get('axle_gear_box_ratio', 1.0))
    # constant
    g = GRAVITY

    matched: Optional[Dict[str, Any]] = None
    step_lines: list[str] = []
    _wheel_circ = (wheel_dia * 3.14159265) / 1000.0

    # resistance coefficients (speed-independent)
    A = 0.647 + (13.17 / (W / axles)) if axles > 0 else 0.647
    B = 0.00933
    C = 0.057 / W if W > 0 else 0.0

    # pre-compute per-gear hydraulic values (speed-independent)
    gear_results: list[Dict[str, Any]] = []
    for _g in gear_list:
        _gs   = ((max_rpm / _g) * pto) / pumps
        _ppf  = (pump_cc * _gs * vol_eff) / 1000.0
        _pmf  = _ppf / (drive_axles * motors_per_axle) if drive_axles > 0 else 0.0
        _at   = ((mech_eff) * pressure * motor_cc) * 0.015915 if mech_eff > 0 else 0.0
        _mrpm = (_pmf / (motor_cc / 1000.0)) * vol_eff if motor_cc > 0 else 0.0
        _arpm = _mrpm / gear_ratio if gear_ratio else 0.0
        _spd  = (_arpm * _wheel_circ / 60.0) * 3.6
        gear_results.append({
            'gear_ratio':          _g,
            'pump_speed':          _gs,
            'per_pump_flow':       _ppf,
            'per_motor_flow':      _pmf,
            'avail_torque':        _at,
            'motor_speed_rpm':     _mrpm,
            'axle_shaft_rpm':      _arpm,
            'hydraulic_speed_kph': _spd,
        })

    # iterate speeds 1..120
    for speed in range(1, 121):
        rolling   = (A + B * speed + C * speed**2) * W * g / 1000
        gradient  = W * 1000 * g * slope / 100000
        curvature = 0.4 * W * curve * g / 1000
        starting  = 6 * W * g / 1000
        total_res = rolling + gradient + curvature + starting

        # torque required
        wheel_radius    = wheel_dia / 2000.0
        req_total_torque = total_res * 1000.0 * wheel_radius
        per_axle_t      = req_total_torque / drive_axles if drive_axles > 0 else 0.0
        per_motor_req   = (per_axle_t / motors_per_axle) / gear_ratio if motors_per_axle > 0 else 0.0

        # loop gears
        for gear in gear_list:
            pump_speed     = ((max_rpm / gear) * pto) / pumps
            per_pump_flow  = (pump_cc * pump_speed * vol_eff) / 1000.0
            per_motor_flow = per_pump_flow / (drive_axles * motors_per_axle) if drive_axles > 0 else 0.0
            avail_torque   = ((mech_eff) * pressure * motor_cc) * 0.015915 if mech_eff > 0 else 0.0
            motor_speed_rpm = (per_motor_flow / (motor_cc / 1000.0)) * vol_eff if motor_cc > 0 else 0.0
            axle_shaft_rpm  = motor_speed_rpm / gear_ratio if gear_ratio else 0.0

            if avail_torque >= per_motor_req:
                matched = {
                    'speed_kph':          speed,
                    'gear_ratio':         gear,
                    'required_torque':    per_motor_req,
                    'available_torque':   avail_torque,
                    'rolling_resistance': rolling,
                    'gradient_resistance': gradient,
                    'curvature_resistance': curvature,
                    'starting_resistance': starting,
                    'total_resistance':   total_res,
                    'wheel_radius':       wheel_radius,
                    'pump_speed':         pump_speed,
                    'per_pump_flow':      per_pump_flow,
                    'per_motor_flow':     per_motor_flow,
                    'motor_speed_rpm':    motor_speed_rpm,
                    'axle_shaft_rpm':     axle_shaft_rpm,
                }
            else:
                # avail_torque is constant; per_motor_req only grows with speed
                # once condition fails, no higher speed will ever pass → exit both loops
                break
        else:
            # all gears passed at this speed → continue to next speed
            continue
        # inner loop broke → condition failed → stop outer loop too
        break
    # build step-by-step for matched case
    if matched:
        step_lines.append("--- MATCHED SPEED / GEAR CASE ---")
        step_lines.append(f"Speed: {matched['speed_kph']} km/h")
        step_lines.append(f"Gear Ratio: {matched['gear_ratio']}")
        step_lines.append("")
        step_lines.append("STEP 1: RESISTANCE FORCES")
        step_lines.append(f"  Rolling = {matched['rolling_resistance']:.2f} kN")
        step_lines.append(f"  Gradient = {matched['gradient_resistance']:.2f} kN")
        step_lines.append(f"  Curvature = {matched['curvature_resistance']:.2f} kN")
        step_lines.append(f"  Starting = {matched['starting_resistance']:.2f} kN")
        step_lines.append(f"  Total = {matched['total_resistance']:.2f} kN")
        step_lines.append("")
        step_lines.append("STEP 2: TORQUE REQUIREMENTS")
        step_lines.append(f"  Wheel Radius = {matched['wheel_radius']:.3f} m")
        step_lines.append(f"  Req per Motor = {matched['required_torque']:.2f} Nm")
        step_lines.append("")
        step_lines.append("STEP 3: HYDRAULIC SYSTEM")
        step_lines.append(f"  Pump Speed = {matched['pump_speed']:.2f} RPM")
        step_lines.append(f"  Per Pump Flow = {matched['per_pump_flow']:.2f} LPM")
        step_lines.append(f"  Per Motor Flow = {matched['per_motor_flow']:.2f} LPM")
        step_lines.append(f"  Available Torque = {matched['available_torque']:.2f} Nm")
    else:
        step_lines.append("No matching speed/gear found within range.")

    # include matched case in a list for reporting convenience
    results: Dict[str, Any] = {
        'matched_case': matched,
        'step_by_step': '\n'.join(step_lines),
        'gear_results': gear_results,
    }
    if matched is not None:
        _speed_mps = matched['speed_kph'] / 3.6
        _req_total = matched['total_resistance'] * 1000.0 * matched['wheel_radius']
        _per_axle  = _req_total / drive_axles if drive_axles > 0 else 0.0
        results['coeff_A']                  = A
        results['coeff_B']                  = B
        results['coeff_C']                  = C
        results['matched_speed_kph']        = matched['speed_kph']
        results['matched_gear_ratio']       = matched['gear_ratio']
        results['total_resistance']         = matched['total_resistance']
        results['rolling_resistance']       = matched['rolling_resistance']
        results['gradient_resistance']      = matched['gradient_resistance']
        results['curvature_resistance']     = matched['curvature_resistance']
        results['starting_resistance']      = matched['starting_resistance']
        results['wheel_radius']             = matched['wheel_radius']
        results['required_total_torque']    = _req_total
        results['per_axle_torque']          = _per_axle
        results['per_wheel_torque']         = _per_axle / 2.0
        results['per_motor_torque']         = matched.get('required_torque', 0.0)
        results['per_gearbox_input_torque'] = matched.get('required_torque', 0.0)
        results['available_torque']         = matched.get('available_torque', 0.0)
        results['speed_mps']                = _speed_mps
        results['wheel_circumference']      = _wheel_circ
        results['wheel_rpm']                = (_speed_mps / _wheel_circ) * 60.0 if _wheel_circ > 0 else 0.0
        results['speed_results_list'] = [
            {
                'engine_gear_ratio':        matched['gear_ratio'],
                'max_vehicle_rpm_input':    inputs.get('max_vehicle_rpm', 0.0),
                'actual_prop_rpm':          matched.get('pump_speed', 0.0),
                'pump_rpm':                 matched.get('pump_speed', 0.0),
                'pump_flow_lpm':            matched.get('per_pump_flow', 0.0),
                'motor_speed_rpm':          matched.get('motor_speed_rpm', 0.0),
                'axle_shaft_rpm':           matched.get('axle_shaft_rpm', 0.0),
                'achievable_speed_kph':     matched['speed_kph'],
                'num_pumps':                inputs.get('num_pumps', 1),
                'num_motors':               inputs.get('num_motors', 1),
                'pump_flow_per_pump_lpm':   matched.get('per_pump_flow', 0.0),
                'motor_flow_per_motor_lpm': matched.get('per_motor_flow', 0.0),
                'wheel_circumference':      _wheel_circ,
                'motor_disp_lpm':           motor_cc / 1000.0,
                'required_torque':          matched.get('required_torque', 0.0),
                'available_torque':         matched.get('available_torque', 0.0),
            }
        ]
        results['achievable_speed_kph'] = matched['speed_kph']
    else:
        # no match found — compute values for PDF explanation
        _at       = gear_results[0]['avail_torque'] if gear_results else 0.0
        _wrad     = wheel_dia / 2000.0
        _roll1    = (A + B * 1 + C * 1) * W * g / 1000
        _grad1    = W * 1000 * g * slope / 100000
        _curv1    = 0.4 * W * curve * g / 1000
        _start1   = 6 * W * g / 1000
        _total1   = _roll1 + _grad1 + _curv1 + _start1
        _reqt1    = _total1 * 1000.0 * _wrad
        _peraxle1 = _reqt1 / drive_axles if drive_axles > 0 else 0.0
        _permotor1 = (_peraxle1 / motors_per_axle) / gear_ratio if motors_per_axle > 0 else 0.0
        results['available_torque']     = _at
        results['min_required_torque']  = _permotor1
        results['coeff_A']              = A
        results['coeff_B']              = B
        results['coeff_C']              = C
        results['speed_results_list']   = []
        results['achievable_speed_kph'] = None
    return results
