# Hydraulic Tool Service Layer
# Orchestrates calculations and prepares formatted reports

from typing import Dict, Any, Tuple, Optional
from .core import (
    calculate_displacement_mode,
    calculate_speed_mode,
    calculate_motor_pressure_mode,
    calculate_gear_ratio_mode,
)

def perform_hydraulic_calculation(inputs: Dict[str, Any], inputs_raw: Optional[Dict[str, Any]] = None) -> Tuple[Dict[str, Any], str]:
    """
    Main orchestration function for hydraulic calculations.
    Returns (results, formatted_report)
    """
    raw: Dict[str, Any] = inputs_raw if inputs_raw is not None else {}
    results: Dict[str, Any] = {}
    report: str = ""

    mode = inputs.get('calc_mode')

    if mode == "calc_cc":
        results = calculate_displacement_mode(inputs)
        report = format_displacement_report(inputs, results, raw)
    elif mode == "calc_speed":
        results = calculate_speed_mode(inputs)
        report = format_speed_report(inputs, results, raw)
    elif mode == 'calc_motor_pressure':
        results = calculate_motor_pressure_mode(inputs)
        report = format_motor_pressure_report(inputs, results, raw)
    elif mode == 'calc_gear':
        results = calculate_gear_ratio_mode(inputs)
        report = format_gear_report(inputs, results, raw)
    else:
        # fallback to speed mode
        results = calculate_speed_mode(inputs)
        report = format_speed_report(inputs, results, raw)

    return results, report


def format_gear_report(inputs: Dict[str, Any], results: Dict[str, Any], inputs_raw: Dict[str, Any]) -> str:
    """Simple report for Gear Ratio mode"""
    raw = inputs_raw
    out: list[str] = []
    out.append("# GEAR RATIO MODE REPORT")
    out.append("")
    out.append("--- INPUTS ---")
    out.append(f"Target Speed: {raw.get('speed')} km/h")
    out.append(f"Wheel Diameter: {raw.get('wheel_diameter')} mm")
    out.append(f"Max Motor RPM: {raw.get('max_motor_rpm')} RPM")
    out.append("")
    out.append("--- RESULTS ---")
    out.append(f"Wheel Circumference (m) = {results.get('wheel_circumference'):.3f}")
    out.append(f"Wheel RPM = {results.get('wheel_rpm'):.2f} RPM")
    out.append(f"Required Gear Ratio (motor_rpm / wheel_rpm) = {results.get('required_gear_ratio'):.3f}")
    if results.get('warnings'):
        out.append("")
        out.append("--- WARNINGS ---")
        for w in results['warnings']:
            out.append(f"- {w}")
    return '\n'.join(out)


def format_motor_pressure_report(inputs: Dict[str, Any], results: Dict[str, Any], inputs_raw: Dict[str, Any]) -> str:
    """Report for Motor Pressure mode — shows required pressure + traction outputs."""
    raw = inputs_raw
    out: list[str] = []
    out.append("# MOTOR PRESSURE MODE REPORT")
    out.append("")
    out.append("--- INPUTS ---")
    out.append(f"Vehicle Weight: {raw.get('weight')} t")
    out.append(f"Drive Axles: {raw.get('drive_axles', raw.get('axles'))}")
    out.append(f"Target Speed: {raw.get('speed')} km/h")
    out.append(f"Wheel Dia: {raw.get('wheel_diameter')} mm")
    out.append(f"Motor Displacement (cc): {raw.get('motor_disp_in')} cc")
    out.append(f"Motor Mechanical Efficiency: {raw.get('mech_eff_motor')} %")
    out.append("")
    out.append("--- RESULTS ---")
    out.append(f"Wheel RPM = {results.get('wheel_rpm'):.2f} RPM")
    out.append(f"Required Total Resistance (kN) = {results.get('total_resistance'):.2f} kN")

    out.append("\nStep 3: Torque Requirements")
    out.append(f"  Wheel Radius (m) = {results.get('wheel_radius'):.3f} m")
    out.append(f"  Required Total Torque (Nm) = {results.get('required_total_torque'):.2f} Nm")
    out.append(f"  Required Torque per Wheel (Nm) = {results.get('per_wheel_torque'):.2f} Nm/wheel")
    out.append(f"  Required Torque per Axle (Nm) = {results.get('per_axle_torque'):.2f} Nm/axle")
    # clarified labels for Motor Pressure mode
    out.append(f"  Torque required at axle / after gearbox (per motor) = {results.get('per_motor_torque'):.2f} Nm")
    out.append(f"  Torque at motor shaft (gearbox input) = {results.get('per_gearbox_input_torque'):.2f} Nm")

    out.append(f"Required Pressure = {results.get('required_pressure_bar'):.2f} bar")
    if results.get('warnings'):
        out.append("")
        out.append("--- WARNINGS ---")
        for w in results['warnings']:
            out.append(f"- {w}")
    return '\n'.join(out)

def format_displacement_report(inputs: Dict[str, Any], results: Dict[str, Any], inputs_raw: Dict[str, Any]) -> str:
    """Format displacement calculation report"""
    raw = inputs_raw
    output_lines: list[str] = []
    # use a more formal heading for reports
    output_lines.append("# Pump & Motor (cc) Calculation Report")
    output_lines.append("\n--- VEHICLE INPUTS ---")
    output_lines.append(f"Vehicle Weight: {raw.get('weight')} t")
    output_lines.append(f"Number of axles: {raw.get('axles')}")
    output_lines.append(f"Drive Axles: {raw.get('drive_axles', raw.get('axles'))}")
    output_lines.append(f"Target Speed: {raw.get('speed')} km/h")
    output_lines.append(f"Wheel Dia: {raw.get('wheel_diameter')} mm")
    # Show converted slope (in %) and the original selected unit
    output_lines.append(f"Slope: {raw.get('slope_percent')} % (input unit: {raw.get('slope_unit', '%')})")
    # Show converted curve in degrees
    output_lines.append(f"Curve: {inputs.get('curve_degree', 0.0):.4f} deg")
    output_lines.append(f"Axle Gear box Ratio: {raw.get('axle_gear_box_ratio')}")
    output_lines.append(f"max Vehicle RPM : {raw.get('max_vehicle_rpm')}")
    output_lines.append(f"PTO Gear Box Ratio: {raw.get('pto_gear_ratio')}")
    output_lines.append(f"Engine Gear Box Ratios: {raw.get('engine_gear_ratio')}")
    output_lines.append("\n--- HYDRAULIC MOTOR & PUMP INPUTS ---")
    output_lines.append(f"Total Hydraulic Motor: {raw.get('num_motors')}")
    output_lines.append(f"Hydraulic Motor / axle: {raw.get('per_axle_motor')}")
    # Show original input unit plus converted value (inputs contains validated values)
    input_pressure_raw = raw.get('pressure')
    input_pressure_unit = raw.get('pressure_unit', 'bar')
    used_pressure_bar = inputs.get('pressure') if inputs.get('pressure') is not None else raw.get('pressure')
    output_lines.append(f"Pressure: {input_pressure_raw} {input_pressure_unit} (used: {used_pressure_bar:.3f} bar)")
    output_lines.append(f"Motor Mechanical Efficiency: {raw.get('mech_eff_motor')} %")
    output_lines.append(f"Motor Volumetric Efficiency: {raw.get('vol_eff_motor')} %")
    output_lines.append(f"Pump Volumetric Efficiency: {raw.get('vol_eff_pump')} %")
    output_lines.append(f"Total Pumps: {raw.get('num_pumps', 1)}")
    output_lines.append("\n--- RESULTS: STEP-BY-STEP CALCULATION (COMMON) ---")
    output_lines.append("\nStep 1: Vehicle Speed & Wheel RPM")
    output_lines.append(f"  Speed (m/s) = {results.get('speed_mps'):.2f} m/s")
    output_lines.append(f"  Wheel Circumference (m) = {results.get('wheel_circumference'):.3f} m")
    output_lines.append(f"  Wheel RPM = {results.get('wheel_rpm'):.2f} RPM")
    output_lines.append("\nStep 2: Resistance Forces (kN)")
    output_lines.append(f"  Rolling Resistance (kN) = {results.get('rolling_resistance'):.2f} kN")
    output_lines.append(f"  Gradient Resistance (kN) = {results.get('gradient_resistance'):.2f} kN")
    output_lines.append(f"  Curvature Resistance (kN) = {results.get('curvature_resistance'):.2f} kN")
    output_lines.append(f"  Starting Resistance (kN) = {results.get('starting_resistance'):.2f} kN")
    output_lines.append("  ---")
    output_lines.append(f"  Total Resistance (kN): {results.get('total_resistance'):.2f} kN")
    output_lines.append("  ---")
    output_lines.append("\nStep 3: Torque Requirements")
    output_lines.append(f"  Wheel Radius (m) = {results.get('wheel_radius'):.3f} m")
    output_lines.append(f"  Required Total Torque (Nm) = {results.get('required_total_torque'):.2f} Nm")
    output_lines.append(f"  Required Torque per Wheel (Nm) = {results.get('per_wheel_torque'):.2f} Nm/wheel")
    output_lines.append(f"  Required Torque per Axle (Nm) = {results.get('per_axle_torque'):.2f} Nm/axle")
    # Show only motor-shaft torque (gearbox input) as the required motor torque
    output_lines.append(f"  Required Motor Torque (gearbox input) = {results.get('per_gearbox_input_torque'):.2f} Nm")

    output_lines.append("\nStep 5: Motor Displacement (New Formula)")
    output_lines.append(f"  Motor Torque (kg-cm) = {results.get('per_gearbox_input_torque_kg_cm'):.2f} kg-cm")
    output_lines.append(f"  Pressure (kg/cm2) = {results.get('pressure_kg_cm2'):.2f} kg/cm2")
    output_lines.append(f"  Motor Displacement (cc/rev) = {results.get('motor_displacement_cc'):.2f} cc/rev")
    output_lines.append("\nStep 6: Motor Flow Rate (New Formula)")
    output_lines.append(f"  Per Motor Flow Rate (LPM) = {results.get('per_motor_flow_rate_lpm'):.2f} LPM")
    output_lines.append(f"  Total Motor Flow Rate (LPM) = {results.get('total_motor_flow_lpm', 0):.2f} LPM")
    output_lines.append(f"  Per Motor Power = {results.get('per_motor_power_kw', 0):.2f} kW")
    output_lines.append(f"  Total Motor Power = {results.get('per_motor_power_kw', 0) * results.get('num_motors', 1):.2f} kW")
    # Per-motor summary
    output_lines.append(f"  Number of Motors: {results.get('num_motors')}")
    output_lines.append(f"  Motors per Axle: {results.get('motors_per_axle')}")
    output_lines.append(f"  Required Motor Torque (gearbox input) = {results.get('per_gearbox_input_torque'):.2f} Nm")
    output_lines.append(f"  Motor Displacement (per motor) = {results.get('motor_displacement_cc'):.2f} cc/rev")
    # Suggested standard motor size (next higher)
    if results.get('suggested_motor_cc'):
        output_lines.append(f"  Suggested standard motor displacement (next higher): {results.get('suggested_motor_cc'):.0f} cc")

    output_lines.append("\n--- RESULTS: STEP-BY-STEP CALCULATION (PER GEAR) ---")
    output_lines.append("\nStep 7: Required Pump Displacement")
    pump_results_list = results.get('pump_results', [])
    if not pump_results_list:
        output_lines.append("    (No pump results were calculated)")
    for res in pump_results_list:
        max_vehicle_rpm_input = res.get('max_vehicle_rpm_input', 0)
        actual_prop_rpm = res.get('actual_prop_rpm', 0)
        calc_pump_rpm = res.get('pump_rpm', 0)
        final_disp_cc = res.get('pump_disp_cc', 0)
        final_disp_per_pump_cc = res.get('pump_disp_per_pump_cc', None)
        num_pumps = res.get('num_pumps', 1)
        engine_gear = res.get('engine_gear_ratio', 1.0)
        output_lines.append(f"\n  --- For Engine Gear {engine_gear:.2f} @ {max_vehicle_rpm_input:.0f} RPM ---")
        output_lines.append(f"    Actual Prop RPM = {actual_prop_rpm:.2f} RPM")
        output_lines.append(f"    Calculate Pump RPM = {calc_pump_rpm:.2f} RPM")
        output_lines.append(f"    Required Pump Displacement (cc/rev) = {final_disp_cc:.2f} cc/rev")
        if final_disp_per_pump_cc is not None:
            output_lines.append(f"    Pumps: {num_pumps} x {final_disp_per_pump_cc:.2f} cc/rev per pump")
        if res.get('pump_flow_per_pump_lpm') is not None:
            output_lines.append(f"    Pump Flow (total) = {res.get('pump_flow_lpm',0):.2f} LPM")
            output_lines.append(f"    Per Pump Flow = {res.get('pump_flow_per_pump_lpm'):.2f} LPM/pump (x{res.get('num_pumps',1)})")
        # Support both new and legacy key names for pump power
        per_pump_power = res.get('pump_power_per_pump_kw') if res.get('pump_power_per_pump_kw') is not None else res.get('per_pump_power_kw')
        if per_pump_power is not None:
            total_pump_power = res.get('pump_total_power_kw') if res.get('pump_total_power_kw') is not None else (per_pump_power * res.get('num_pumps', 1))
            output_lines.append(f"    Pump Power (per pump) = {per_pump_power:.2f} kW")
            output_lines.append(f"    Pump Power (total) = {total_pump_power:.2f} kW")
        # Suggested pump standard size (per pump)
        if res.get('suggested_pump_disp_per_pump_cc'):
            output_lines.append(f"    Suggested standard pump displacement per pump (next higher): {res.get('suggested_pump_disp_per_pump_cc'):.0f} cc")
    # add a concise summary table at the end to give clean final results
    output_lines.append("\n--- FINAL SUMMARY ---")
    output_lines.append("Parameter                           Value")
    output_lines.append("-------------------------------------------")
    output_lines.append(f"Motor displacement (cc/rev)        {results.get('motor_displacement_cc'):.2f}")
    if results.get('suggested_motor_cc'):
        output_lines.append(f"Suggested motor size (cc/rev)      {results.get('suggested_motor_cc'):.0f}")
    if pump_results_list:
        first = pump_results_list[0]
        output_lines.append(f"Pump displacement per pump (cc/rev) {first.get('pump_disp_per_pump_cc'):.2f}")
        if first.get('suggested_pump_disp_per_pump_cc'):
            output_lines.append(f"Suggested pump size per pump (cc/rev) {first.get('suggested_pump_disp_per_pump_cc'):.0f}")
        total_pump_power = first.get('pump_total_power_kw') or 0
        output_lines.append(f"Pump power (total) (kW)            {total_pump_power:.2f}")
    return '\n'.join(output_lines)

def format_speed_report(inputs: Dict[str, Any], results: Dict[str, Any], inputs_raw: Dict[str, Any]) -> str:
    """Format speed calculation report"""
    raw = inputs_raw
    output_lines: list[str] = []
    output_lines.append("# MODE 2 REPORT: SPEED CALCULATION")
    output_lines.append("\n--- VEHICLE INPUTS ---")
    output_lines.append(f"Wheel Dia: {raw.get('wheel_diameter')} mm")
    output_lines.append(f"Drive Axles: {raw.get('drive_axles', raw.get('axles'))}")
    output_lines.append(f"Slope: {raw.get('slope_percent')} % (input unit: {raw.get('slope_unit', '%')})")
    output_lines.append(f"Curve: {inputs.get('curve_degree', 0.0):.4f} deg")
    output_lines.append(f"Axle Gear box Ratio: {raw.get('axle_gear_box_ratio')}")
    output_lines.append(f"max Vehicle RPM: {raw.get('max_vehicle_rpm')}")
    output_lines.append(f"PTO Gear Box Ratio: {raw.get('pto_gear_ratio')}")
    output_lines.append(f"Engine Gear Box Ratios: {raw.get('engine_gear_ratio')}")
    output_lines.append("\n--- HYDRAULIC MOTOR & PUMP INPUTS ---")
    output_lines.append(f"Total Hydraulic Motor: {raw.get('num_motors')}")
    output_lines.append(f"Hydraulic Motor / axle: {raw.get('per_axle_motor')}")
    output_lines.append(f"Pressure: {raw.get('pressure')} {raw.get('pressure_unit', 'bar')}")
    output_lines.append(f"Motor Mechanical Efficiency: {raw.get('mech_eff_motor')} %")
    output_lines.append(f"Motor Displacement: {raw.get('motor_disp_in')} cc")
    # Show per-motor power if provided by core
    if results.get('per_motor_power_kw') is not None:
        output_lines.append(f"Per Motor Power: {results.get('per_motor_power_kw'):.2f} kW")
        output_lines.append(f"Total Motor Power: {(results.get('per_motor_power_kw') * results.get('num_motors',1)):.2f} kW")
    else:
        output_lines.append(f"Per Motor Power: -")
    output_lines.append(f"Pump Volumetric Efficiency: {raw.get('vol_eff_pump')} %")
    output_lines.append(f"Total Pumps: {raw.get('num_pumps', 1)}")
    output_lines.append(f"Pump Displacement: {raw.get('pump_disp_in')} cc")
    output_lines.append("\n--- CALCULATION RESULTS (PER ENGINE GEAR) ---")
    speed_results_list = results.get('speed_results_list', [])
    if not speed_results_list:
        output_lines.append("    (No speed results were calculated)")
    for res in speed_results_list:
        max_vehicle_rpm_input = res.get('max_vehicle_rpm_input', 0)
        actual_prop_rpm = res.get('actual_prop_rpm', 0)
        pump_rpm = res.get('pump_rpm', 0)
        pump_flow_lpm = res.get('pump_flow_lpm', 0)
        motor_speed_rpm = res.get('motor_speed_rpm', 0)
        axle_shaft_rpm = res.get('axle_shaft_rpm', 0)
        achievable_speed_kph = res.get('achievable_speed_kph', 0)
        engine_gear = res.get('engine_gear_ratio', 1.0)
        output_lines.append(f"\n  --- For Engine Gear {engine_gear:.2f} @ {max_vehicle_rpm_input:.0f} RPM ---")
        output_lines.append(f"  Actual Prop RPM = {actual_prop_rpm:.2f} RPM")
        output_lines.append(f"  Calculate Pump RPM = {pump_rpm:.2f} RPM")
        output_lines.append(f"  Calculate Pump Flow (LPM) = {pump_flow_lpm:.2f} LPM")
        if 'pump_flow_per_pump_lpm' in res:
            output_lines.append(f"    → Per Pump: {res.get('pump_flow_per_pump_lpm'):.2f} LPM/pump (x{res.get('num_pumps',1)})")
        if 'motor_flow_per_motor_lpm' in res:
            output_lines.append(f"    → Per Motor Flow: {res.get('motor_flow_per_motor_lpm'):.2f} LPM/motor (x{res.get('num_motors',1)})")
        output_lines.append(f"  Calculate Motor Speed (RPM) = {motor_speed_rpm:.2f} RPM")
        output_lines.append(f"  Calculate Axle/Wheel Speed (RPM) = {axle_shaft_rpm:.2f} RPM")
        output_lines.append(f"  ** Achievable Speed: {achievable_speed_kph:.2f} km/h **")
    if results.get('warnings'):
        output_lines.append("\n--- ⚠️ WARNINGS ---")
        for warning in results['warnings']:
            output_lines.append(f"- {warning}")
    return '\n'.join(output_lines)