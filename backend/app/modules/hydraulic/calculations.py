"""Fluid-power engineering calculations for the Hydraulic & Pneumatic
module. Pure functions — no DB, no I/O — so the calculator endpoint, the
save endpoint and the tests share one definition of every formula.

Each calculation declares its inputs (with units and defaults) so the
frontend renders its form from GET /hydraulic/calculations/types instead
of duplicating the formulas or field lists. Pressures are gauge bar unless
a formula says otherwise; P_ATM converts to absolute where the gas laws
need it.

Separate from app/modules/rnd/tools/hydraulic, which is the R&D
locomotive hydrostatic-drive sizing tool."""
import math
from typing import Any, Callable

P_ATM = 1.01325  # bar, standard atmosphere
G = 9.80665

# Next-size-up recommendations.
IEC_MOTOR_KW = (0.37, 0.55, 0.75, 1.1, 1.5, 2.2, 3, 4, 5.5, 7.5, 11, 15, 18.5, 22, 30, 37, 45, 55, 75, 90, 110, 132, 160, 200, 250, 315)
ACCUMULATOR_SIZES_L = (0.16, 0.32, 0.5, 0.75, 1, 1.4, 2.5, 4, 5, 6, 10, 13, 20, 24, 32, 50)
AIR_RECEIVER_SIZES_L = (50, 100, 150, 200, 270, 500, 750, 1000, 1500, 2000, 3000, 5000)

# Recommended oil velocity bands (m/s) by line — common design practice.
LINE_VELOCITY = {
    "suction": (0.6, 1.2, 1.0),
    "return": (2.0, 4.0, 3.0),
    "pressure": (3.0, 6.0, 5.0),
}


class CalculationError(ValueError):
    """Raised for inputs that make a calculation meaningless — the message
    is shown to the user as-is, so it says what to change."""


def _num(label: str, key: str, unit: str | None, default: float | None = None, *, min_value: float | None = None,
         optional: bool = False, help_text: str | None = None) -> dict:
    return {"key": key, "label": label, "unit": unit, "kind": "number", "default": default,
            "min": min_value, "optional": optional, "help": help_text}


def _select(label: str, key: str, options: list[tuple[str, str]], default: str) -> dict:
    return {"key": key, "label": label, "unit": None, "kind": "select", "default": default,
            "options": [{"value": v, "label": lbl} for v, lbl in options], "optional": False}


def _res(key: str, label: str, value: float | str | None, unit: str | None = None, places: int = 2, primary: bool = False) -> dict:
    if isinstance(value, float):
        value = round(value, places)
    return {"key": key, "label": label, "value": value, "unit": unit, "primary": primary}


def _next_size(value: float, sizes: tuple) -> float | None:
    return next((s for s in sizes if s >= value - 1e-9), None)


def _area_mm2(d_mm: float) -> float:
    return math.pi * d_mm ** 2 / 4


def _require_positive(inputs: dict, *keys: str) -> None:
    for k in keys:
        if inputs.get(k) is None or inputs[k] <= 0:
            raise CalculationError(f"{_LABELS.get(k, k)} must be greater than zero.")


def _pct(inputs: dict, key: str) -> float:
    val = inputs.get(key)
    if val is None or val <= 0 or val > 100:
        raise CalculationError(f"{_LABELS.get(key, key)} must be between 1 and 100 %.")
    return val / 100


def _rod_check(bore: float, rod: float) -> None:
    if rod < 0:
        raise CalculationError("Rod diameter can't be negative.")
    if rod >= bore:
        raise CalculationError(f"Rod diameter ({rod:g} mm) must be smaller than the bore ({bore:g} mm).")


# ---------------------------------------------------------------------------
# Hydraulic
# ---------------------------------------------------------------------------

def cylinder_force(i: dict) -> dict:
    _require_positive(i, "bore_mm", "pressure_bar")
    bore, rod, p = i["bore_mm"], i.get("rod_mm") or 0.0, i["pressure_bar"]
    _rod_check(bore, rod)
    eff = _pct(i, "efficiency_pct")
    a_bore = _area_mm2(bore)
    a_ann = a_bore - _area_mm2(rod)
    # 1 bar = 0.1 N/mm²
    f_ext = 0.1 * p * a_bore * eff
    f_ret = 0.1 * p * a_ann * eff
    return {
        "results": [
            _res("extend_force_kn", "Extend (push) force", f_ext / 1000, "kN", primary=True),
            _res("retract_force_kn", "Retract (pull) force", f_ret / 1000, "kN", primary=True),
            _res("extend_force_t", "Extend force", f_ext / 1000 / G, "tonne-f"),
            _res("retract_force_t", "Retract force", f_ret / 1000 / G, "tonne-f"),
            _res("bore_area_cm2", "Piston area", a_bore / 100, "cm²"),
            _res("annulus_area_cm2", "Annulus area", a_ann / 100, "cm²"),
            _res("area_ratio", "Area ratio (φ)", a_bore / a_ann if a_ann else None, None, 3),
        ],
        "warnings": [],
    }


def cylinder_speed(i: dict) -> dict:
    _require_positive(i, "bore_mm", "flow_lpm")
    bore, rod, q = i["bore_mm"], i.get("rod_mm") or 0.0, i["flow_lpm"]
    _rod_check(bore, rod)
    stroke = i.get("stroke_mm") or 0.0
    a_bore = _area_mm2(bore)
    a_ann = a_bore - _area_mm2(rod)
    q_mm3_s = q * 1e6 / 60
    v_ext = q_mm3_s / a_bore
    v_ret = q_mm3_s / a_ann
    results = [
        _res("extend_speed_mm_s", "Extend speed", v_ext, "mm/s", primary=True),
        _res("retract_speed_mm_s", "Retract speed", v_ret, "mm/s", primary=True),
        _res("extend_speed_m_min", "Extend speed", v_ext * 60 / 1000, "m/min"),
        _res("retract_speed_m_min", "Retract speed", v_ret * 60 / 1000, "m/min"),
        # Rod-side oil pushed out while extending — what the return line sees.
        _res("return_flow_extend_lpm", "Return flow while extending", q * a_ann / a_bore, "L/min"),
        _res("return_flow_retract_lpm", "Return flow while retracting", q * a_bore / a_ann, "L/min"),
    ]
    warnings = []
    if stroke > 0:
        results.insert(2, _res("extend_time_s", "Extend time (full stroke)", stroke / v_ext, "s", primary=True))
        results.insert(3, _res("retract_time_s", "Retract time (full stroke)", stroke / v_ret, "s", primary=True))
        results.append(_res("swept_volume_l", "Swept volume (piston side)", a_bore * stroke / 1e6, "L", 3))
    if v_ext * 60 / 1000 > 18:
        warnings.append("Extend speed is above ~0.3 m/s — standard cylinder seals and cushioning may not be rated for it; check with the manufacturer.")
    return {"results": results, "warnings": warnings}


def pump_flow(i: dict) -> dict:
    _require_positive(i, "displacement_cc", "speed_rpm")
    eff_v = _pct(i, "vol_efficiency_pct")
    q_theo = i["displacement_cc"] * i["speed_rpm"] / 1000
    q_act = q_theo * eff_v
    return {
        "results": [
            _res("actual_flow_lpm", "Actual delivered flow", q_act, "L/min", primary=True),
            _res("theoretical_flow_lpm", "Theoretical flow", q_theo, "L/min"),
            _res("leakage_lpm", "Internal leakage", q_theo - q_act, "L/min"),
        ],
        "warnings": [],
    }


def pump_power(i: dict) -> dict:
    _require_positive(i, "flow_lpm", "pressure_bar")
    eff_t = _pct(i, "overall_efficiency_pct")
    p_hyd = i["pressure_bar"] * i["flow_lpm"] / 600
    p_in = p_hyd / eff_t
    motor = _next_size(p_in, IEC_MOTOR_KW)
    warnings = [] if motor else ["Input power is above the largest standard IEC motor size listed (315 kW) — size the drive separately."]
    return {
        "results": [
            _res("input_power_kw", "Required input (shaft) power", p_in, "kW", primary=True),
            _res("recommended_motor_kw", "Next standard motor size", motor, "kW", primary=True),
            _res("hydraulic_power_kw", "Hydraulic (output) power", p_hyd, "kW"),
            _res("heat_loss_kw", "Power lost as heat", p_in - p_hyd, "kW"),
            _res("input_power_hp", "Required input power", p_in * 1.341, "hp"),
        ],
        "warnings": warnings,
    }


def motor_output(i: dict) -> dict:
    _require_positive(i, "displacement_cc", "pressure_bar", "flow_lpm")
    eff_v = _pct(i, "vol_efficiency_pct")
    eff_m = _pct(i, "mech_efficiency_pct")
    vg, dp, q = i["displacement_cc"], i["pressure_bar"], i["flow_lpm"]
    torque = vg * dp * eff_m / (20 * math.pi)
    speed = q * 1000 * eff_v / vg
    power = torque * speed / 9549
    return {
        "results": [
            _res("torque_nm", "Output torque", torque, "Nm", primary=True),
            _res("speed_rpm", "Output speed", speed, "rpm", 0, primary=True),
            _res("output_power_kw", "Output power", power, "kW"),
            _res("input_power_kw", "Hydraulic input power", dp * q / 600, "kW"),
            _res("theoretical_torque_nm", "Theoretical torque", vg * dp / (20 * math.pi), "Nm"),
        ],
        "warnings": [],
    }


def pipe_sizing(i: dict) -> dict:
    _require_positive(i, "flow_lpm")
    line = i.get("line_type") or "pressure"
    if line not in LINE_VELOCITY:
        raise CalculationError(f"Unknown line type '{line}'. Use suction, return or pressure.")
    v_min, v_max, v_design = LINE_VELOCITY[line]
    q_m3_s = i["flow_lpm"] / 60000
    d_min_mm = math.sqrt(4 * q_m3_s / (math.pi * v_max)) * 1000
    d_design_mm = math.sqrt(4 * q_m3_s / (math.pi * v_design)) * 1000
    results = [
        _res("recommended_id_mm", f"Recommended bore at {v_design:g} m/s", d_design_mm, "mm", 1, primary=True),
        _res("minimum_id_mm", f"Smallest bore (at {v_max:g} m/s limit)", d_min_mm, "mm", 1),
        _res("velocity_band", "Recommended velocity band", f"{v_min:g} – {v_max:g}", "m/s"),
    ]
    warnings = []
    actual = i.get("actual_id_mm")
    if actual:
        v_actual = q_m3_s / (math.pi * (actual / 1000) ** 2 / 4)
        results.insert(1, _res("actual_velocity_m_s", f"Velocity in {actual:g} mm bore", v_actual, "m/s", primary=True))
        if v_actual > v_max:
            warnings.append(f"{v_actual:.2f} m/s is above the {v_max:g} m/s limit for a {line} line — go up to at least {d_min_mm:.1f} mm bore to avoid heat, noise and pressure loss"
                            + (" (and pump cavitation)." if line == "suction" else "."))
        elif v_actual < v_min:
            warnings.append(f"{v_actual:.2f} m/s is below the usual {v_min:g} m/s minimum for a {line} line — the line is oversized (more cost, oil volume and weight than needed).")
    return {"results": results, "warnings": warnings}


def pressure_drop(i: dict) -> dict:
    _require_positive(i, "flow_lpm", "pipe_id_mm", "length_m", "viscosity_cst", "density_kg_m3")
    d = i["pipe_id_mm"] / 1000
    q = i["flow_lpm"] / 60000
    area = math.pi * d ** 2 / 4
    v = q / area
    nu = i["viscosity_cst"] * 1e-6
    re = v * d / nu
    warnings = []
    if re < 2300:
        f = 64 / re
        regime = "Laminar"
    else:
        # Blasius, smooth pipe — valid to Re ≈ 1e5.
        f = 0.316 / re ** 0.25
        regime = "Turbulent" if re > 4000 else "Transitional"
        if re < 4000:
            warnings.append("Flow is in the laminar→turbulent transition band (Re 2300–4000); the pressure drop estimate is uncertain here.")
        if re > 1e5:
            warnings.append("Reynolds number is above 1×10⁵, beyond the Blasius formula's range — treat the result as approximate.")
    dp_pa = f * (i["length_m"] / d) * i["density_kg_m3"] * v ** 2 / 2
    return {
        "results": [
            _res("pressure_drop_bar", "Pressure drop", dp_pa / 1e5, "bar", 3, primary=True),
            _res("velocity_m_s", "Flow velocity", v, "m/s", primary=True),
            _res("reynolds", "Reynolds number", re, None, 0),
            _res("regime", "Flow regime", regime),
            _res("friction_factor", "Darcy friction factor", f, None, 4),
            _res("power_loss_kw", "Power lost in the line", dp_pa * q / 1000, "kW", 3),
        ],
        "warnings": warnings,
    }


def accumulator_sizing(i: dict) -> dict:
    _require_positive(i, "delta_v_l", "p1_bar", "p2_bar")
    p1, p2 = i["p1_bar"], i["p2_bar"]
    if p2 <= p1:
        raise CalculationError("Maximum working pressure (p2) must be higher than minimum working pressure (p1).")
    p0 = i.get("p0_bar") or 0.9 * p1
    if p0 >= p1:
        raise CalculationError(f"Pre-charge pressure ({p0:g} bar) must be below the minimum working pressure p1 ({p1:g} bar) — typically about 90 % of p1.")
    process = i.get("process") or "adiabatic"
    n = 1.4 if process == "adiabatic" else 1.0
    a0, a1, a2 = p0 + P_ATM, p1 + P_ATM, p2 + P_ATM
    denom = (a0 / a1) ** (1 / n) - (a0 / a2) ** (1 / n)
    v0 = i["delta_v_l"] / denom
    size = _next_size(v0, ACCUMULATOR_SIZES_L)
    warnings = []
    if p2 / p0 > 4:
        warnings.append(f"Pressure ratio p2/p0 is {p2 / p0:.1f} — bladder accumulators are normally limited to about 4:1; use a larger unit or a higher pre-charge.")
    if not size:
        warnings.append("Required volume is above 50 L — use several accumulators in parallel or a piston accumulator with gas bottles.")
    return {
        "results": [
            _res("required_volume_l", "Required gas volume (V0)", v0, "L", 2, primary=True),
            _res("recommended_size_l", "Next standard accumulator size", size, "L", primary=True),
            _res("precharge_bar", "Pre-charge pressure (p0)", p0, "bar"),
            _res("polytropic_n", "Polytropic exponent (n)", n, None, 1),
            _res("usable_fraction_pct", "Usable volume / accumulator size", i["delta_v_l"] / v0 * 100, "%", 1),
        ],
        "warnings": warnings,
    }


def reservoir_sizing(i: dict) -> dict:
    _require_positive(i, "pump_flow_lpm", "factor")
    fluid = i["pump_flow_lpm"] * i["factor"]
    gross = fluid * 1.1
    warnings = []
    if i["factor"] < 2:
        warnings.append("A reservoir holding under 2 minutes of pump flow gives little time for air release and heat dissipation — only acceptable with a cooler on mobile equipment.")
    return {
        "results": [
            _res("fluid_volume_l", "Fluid volume", fluid, "L", 0, primary=True),
            _res("tank_volume_l", "Tank gross volume (+10 % air space)", gross, "L", 0, primary=True),
            _res("dwell_time_min", "Fluid dwell time", i["factor"], "min", 1),
        ],
        "warnings": warnings,
    }


def heat_load(i: dict) -> dict:
    _require_positive(i, "input_power_kw")
    eff = _pct(i, "overall_efficiency_pct")
    heat = i["input_power_kw"] * (1 - eff)
    area = i.get("tank_surface_m2") or 0.0
    dt = i.get("allowed_temp_rise_c") or 0.0
    # Natural convection from a steel tank in still air ≈ 15 W/m²·K.
    dissipated = 0.015 * area * dt
    cooler = max(heat - dissipated, 0.0)
    return {
        "results": [
            _res("heat_generated_kw", "Heat generated", heat, "kW", primary=True),
            _res("cooler_required_kw", "Cooler capacity required", cooler, "kW", primary=True),
            _res("tank_dissipation_kw", "Dissipated by the tank", dissipated, "kW"),
        ],
        "warnings": ["No tank surface area / temperature rise given — the whole heat load is assigned to the cooler."] if not (area and dt) else [],
    }


# ---------------------------------------------------------------------------
# Pneumatic
# ---------------------------------------------------------------------------

def pneumatic_cylinder_force(i: dict) -> dict:
    _require_positive(i, "bore_mm", "pressure_bar")
    bore, rod, p = i["bore_mm"], i.get("rod_mm") or 0.0, i["pressure_bar"]
    _rod_check(bore, rod)
    eff = _pct(i, "efficiency_pct")
    a_bore = _area_mm2(bore)
    a_ann = a_bore - _area_mm2(rod)
    f_ext = 0.1 * p * a_bore * eff
    f_ret = 0.1 * p * a_ann * eff
    results = [
        _res("extend_force_n", "Extend (push) force", f_ext, "N", 0, primary=True),
        _res("retract_force_n", "Retract (pull) force", f_ret, "N", 0, primary=True),
        _res("extend_force_kgf", "Extend force", f_ext / G, "kgf", 1),
        _res("retract_force_kgf", "Retract force", f_ret / G, "kgf", 1),
    ]
    warnings = []
    load = i.get("load_kg")
    if load:
        ratio = load * G / f_ext * 100
        results.append(_res("load_ratio_pct", "Load ratio (extend)", ratio, "%", 1, primary=True))
        if ratio > 100:
            warnings.append(f"The load needs {load * G:.0f} N but the cylinder only gives {f_ext:.0f} N — it won't move it. Increase the bore or the supply pressure.")
        elif ratio > 70:
            warnings.append("Load ratio is above 70 % — motion will be slow and erratic. Pneumatic cylinders are normally sized for 50–70 % (under 50 % for fast motion).")
    return {"results": results, "warnings": warnings}


def air_consumption(i: dict) -> dict:
    _require_positive(i, "bore_mm", "stroke_mm", "cycles_per_min", "pressure_bar")
    bore, rod, stroke = i["bore_mm"], i.get("rod_mm") or 0.0, i["stroke_mm"]
    _rod_check(bore, rod)
    acting = i.get("acting") or "double"
    a_bore = _area_mm2(bore)
    a_ann = a_bore - _area_mm2(rod)
    swept_l = (a_bore * stroke + (a_ann * stroke if acting == "double" else 0)) / 1e6
    compression = (i["pressure_bar"] + P_ATM) / P_ATM
    free_air_per_cycle = swept_l * compression
    per_min = free_air_per_cycle * i["cycles_per_min"]
    return {
        "results": [
            _res("consumption_nl_min", "Free-air consumption", per_min, "Nl/min", 1, primary=True),
            _res("consumption_m3_h", "Free-air consumption", per_min * 60 / 1000, "Nm³/h", 2, primary=True),
            _res("per_cycle_nl", "Free air per cycle", free_air_per_cycle, "Nl", 3),
            _res("compression_ratio", "Compression ratio", compression, None, 2),
            # Tubing dead volume and leakage typically add 10–25 %.
            _res("with_allowance_nl_min", "With 20 % allowance (tubing, leakage)", per_min * 1.2, "Nl/min", 1),
        ],
        "warnings": [],
    }


def air_receiver_sizing(i: dict) -> dict:
    _require_positive(i, "demand_nl_min", "p_max_bar", "time_min")
    p1, p2 = i["p_max_bar"], i.get("p_min_bar") or 0.0
    if p1 <= p2:
        raise CalculationError("Cut-out (maximum) pressure must be higher than the minimum pressure the system can tolerate.")
    v = i["time_min"] * i["demand_nl_min"] * P_ATM / (p1 - p2)
    size = _next_size(v, AIR_RECEIVER_SIZES_L)
    return {
        "results": [
            _res("receiver_volume_l", "Required receiver volume", v, "L", 0, primary=True),
            _res("recommended_size_l", "Next standard receiver size", size, "L", primary=True),
            _res("stored_free_air_nl", "Usable stored free air", v * (p1 - p2) / P_ATM, "Nl", 0),
        ],
        "warnings": [] if size else ["Above 5000 L — use several receivers or reconsider the compressor capacity."],
    }


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

_EFF_HELP = "Allows for seal friction and losses."

CALC_TYPES: dict[str, dict[str, Any]] = {
    "cylinder_force": {
        "label": "Hydraulic Cylinder Force", "system_type": "hydraulic", "fn": cylinder_force,
        "description": "Push and pull force of a double-acting cylinder at a given pressure.",
        "inputs": [
            _num("Bore diameter", "bore_mm", "mm", 63, min_value=0),
            _num("Rod diameter", "rod_mm", "mm", 36, min_value=0),
            _num("Working pressure", "pressure_bar", "bar", 160, min_value=0),
            _num("Mechanical efficiency", "efficiency_pct", "%", 95, help_text=_EFF_HELP),
        ],
    },
    "cylinder_speed": {
        "label": "Hydraulic Cylinder Speed & Cycle Time", "system_type": "hydraulic", "fn": cylinder_speed,
        "description": "Extend / retract speed and stroke time from the supply flow, plus the return-line flow.",
        "inputs": [
            _num("Bore diameter", "bore_mm", "mm", 63),
            _num("Rod diameter", "rod_mm", "mm", 36),
            _num("Stroke", "stroke_mm", "mm", 500, optional=True),
            _num("Supply flow", "flow_lpm", "L/min", 20),
        ],
    },
    "pump_flow": {
        "label": "Pump Delivery (Flow)", "system_type": "hydraulic", "fn": pump_flow,
        "description": "Pump output flow from displacement and drive speed.",
        "inputs": [
            _num("Displacement", "displacement_cc", "cc/rev", 28),
            _num("Drive speed", "speed_rpm", "rpm", 1450),
            _num("Volumetric efficiency", "vol_efficiency_pct", "%", 95),
        ],
    },
    "pump_power": {
        "label": "Pump Drive Power", "system_type": "hydraulic", "fn": pump_power,
        "description": "Shaft power needed to drive a pump, and the next standard motor size.",
        "inputs": [
            _num("Flow", "flow_lpm", "L/min", 40),
            _num("Pressure", "pressure_bar", "bar", 180),
            _num("Overall pump efficiency", "overall_efficiency_pct", "%", 85),
        ],
    },
    "motor_output": {
        "label": "Hydraulic Motor Torque & Speed", "system_type": "hydraulic", "fn": motor_output,
        "description": "Output torque, speed and power of a hydraulic motor.",
        "inputs": [
            _num("Displacement", "displacement_cc", "cc/rev", 100),
            _num("Pressure differential (Δp)", "pressure_bar", "bar", 200),
            _num("Supply flow", "flow_lpm", "L/min", 60),
            _num("Volumetric efficiency", "vol_efficiency_pct", "%", 95),
            _num("Mechanical efficiency", "mech_efficiency_pct", "%", 90),
        ],
    },
    "pipe_sizing": {
        "label": "Pipe / Hose Sizing", "system_type": "hydraulic", "fn": pipe_sizing,
        "description": "Bore needed to keep oil velocity inside the recommended band for the line.",
        "inputs": [
            _num("Flow", "flow_lpm", "L/min", 40),
            _select("Line", "line_type", [("pressure", "Pressure line (3–6 m/s)"), ("return", "Return line (2–4 m/s)"), ("suction", "Suction line (0.6–1.2 m/s)")], "pressure"),
            _num("Actual bore (to check)", "actual_id_mm", "mm", None, optional=True),
        ],
    },
    "pressure_drop": {
        "label": "Line Pressure Drop", "system_type": "hydraulic", "fn": pressure_drop,
        "description": "Darcy–Weisbach pressure loss along a straight pipe or hose.",
        "inputs": [
            _num("Flow", "flow_lpm", "L/min", 40),
            _num("Bore", "pipe_id_mm", "mm", 16),
            _num("Length", "length_m", "m", 5),
            _num("Kinematic viscosity", "viscosity_cst", "cSt", 46, help_text="ISO VG 46 is 46 cSt at 40 °C."),
            _num("Fluid density", "density_kg_m3", "kg/m³", 870),
        ],
    },
    "accumulator_sizing": {
        "label": "Accumulator Sizing", "system_type": "hydraulic", "fn": accumulator_sizing,
        "description": "Gas-charged accumulator size for a volume of oil delivered between two pressures (Boyle / polytropic).",
        "inputs": [
            _num("Oil volume to deliver (ΔV)", "delta_v_l", "L", 1.5),
            _num("Minimum working pressure (p1)", "p1_bar", "bar", 120),
            _num("Maximum working pressure (p2)", "p2_bar", "bar", 200),
            _num("Pre-charge pressure (p0)", "p0_bar", "bar", None, optional=True, help_text="Leave blank to use 90 % of p1."),
            _select("Process", "process", [("adiabatic", "Fast (adiabatic, n = 1.4)"), ("isothermal", "Slow (isothermal, n = 1.0)")], "adiabatic"),
        ],
    },
    "reservoir_sizing": {
        "label": "Reservoir Sizing", "system_type": "hydraulic", "fn": reservoir_sizing,
        "description": "Oil tank volume from pump flow — rule of thumb 3–5 × pump flow per minute for industrial power packs.",
        "inputs": [
            _num("Pump flow", "pump_flow_lpm", "L/min", 40),
            _num("Dwell time factor", "factor", "× flow", 3),
        ],
    },
    "heat_load": {
        "label": "Heat Load & Cooler Sizing", "system_type": "hydraulic", "fn": heat_load,
        "description": "Heat the system generates and the cooler capacity needed beyond what the tank sheds.",
        "inputs": [
            _num("Input power", "input_power_kw", "kW", 15),
            _num("Overall system efficiency", "overall_efficiency_pct", "%", 75),
            _num("Tank surface area", "tank_surface_m2", "m²", None, optional=True),
            _num("Allowed oil temperature rise over ambient", "allowed_temp_rise_c", "°C", None, optional=True),
        ],
    },
    "pneumatic_cylinder_force": {
        "label": "Pneumatic Cylinder Force", "system_type": "pneumatic", "fn": pneumatic_cylinder_force,
        "description": "Push / pull force at supply pressure, and load ratio for a given load.",
        "inputs": [
            _num("Bore diameter", "bore_mm", "mm", 50),
            _num("Rod diameter", "rod_mm", "mm", 20),
            _num("Supply pressure", "pressure_bar", "bar", 6),
            _num("Efficiency", "efficiency_pct", "%", 85, help_text=_EFF_HELP),
            _num("Load to move", "load_kg", "kg", None, optional=True),
        ],
    },
    "air_consumption": {
        "label": "Air Consumption", "system_type": "pneumatic", "fn": air_consumption,
        "description": "Free-air consumption of a cylinder for compressor and FRL sizing.",
        "inputs": [
            _num("Bore diameter", "bore_mm", "mm", 50),
            _num("Rod diameter", "rod_mm", "mm", 20),
            _num("Stroke", "stroke_mm", "mm", 200),
            _num("Cycles per minute", "cycles_per_min", "cycles/min", 10, help_text="One cycle = extend + retract."),
            _num("Supply pressure", "pressure_bar", "bar", 6),
            _select("Cylinder", "acting", [("double", "Double acting"), ("single", "Single acting (spring return)")], "double"),
        ],
    },
    "air_receiver_sizing": {
        "label": "Air Receiver Sizing", "system_type": "pneumatic", "fn": air_receiver_sizing,
        "description": "Receiver volume to supply a demand for a set time with the compressor off.",
        "inputs": [
            _num("Air demand", "demand_nl_min", "Nl/min", 1000),
            _num("Compressor cut-out pressure", "p_max_bar", "bar", 8),
            _num("Minimum acceptable pressure", "p_min_bar", "bar", 6),
            _num("Time to supply from the receiver", "time_min", "min", 1),
        ],
    },
}

_LABELS: dict[str, str] = {inp["key"]: inp["label"] for spec in CALC_TYPES.values() for inp in spec["inputs"]}


def calc_type_catalog() -> list[dict]:
    return [
        {"key": k, "label": v["label"], "system_type": v["system_type"], "description": v["description"], "inputs": v["inputs"]}
        for k, v in CALC_TYPES.items()
    ]


def run_calculation(calc_type: str, raw_inputs: dict) -> tuple[dict, dict]:
    """Validates and coerces `raw_inputs` against the calculation's declared
    inputs, runs it, and returns (clean_inputs, results). Raises
    CalculationError with a user-facing message on bad input."""
    spec = CALC_TYPES.get(calc_type)
    if not spec:
        raise CalculationError(f"Unknown calculation type '{calc_type}'. Valid types: {', '.join(CALC_TYPES)}.")
    clean: dict[str, Any] = {}
    for inp in spec["inputs"]:
        key, val = inp["key"], raw_inputs.get(inp["key"])
        if inp["kind"] == "select":
            val = val or inp["default"]
            valid = {o["value"] for o in inp["options"]}
            if val not in valid:
                raise CalculationError(f"{inp['label']}: '{val}' isn't one of {', '.join(sorted(valid))}.")
            clean[key] = val
            continue
        if val in (None, ""):
            if inp.get("optional"):
                clean[key] = None
                continue
            if inp.get("default") is None:
                raise CalculationError(f"{inp['label']} is required.")
            # Efficiencies etc. fall back to their typical value.
            val = inp["default"]
        try:
            num = float(val)
        except (TypeError, ValueError):
            raise CalculationError(f"{inp['label']} must be a number (got '{val}').")
        if not math.isfinite(num):
            raise CalculationError(f"{inp['label']} must be a finite number.")
        if num < 0:
            raise CalculationError(f"{inp['label']} can't be negative.")
        clean[key] = num
    fn: Callable[[dict], dict] = spec["fn"]
    try:
        out = fn(clean)
    except ZeroDivisionError:
        raise CalculationError("These inputs divide by zero — check that no diameter, area or pressure difference is zero.")
    return clean, out
