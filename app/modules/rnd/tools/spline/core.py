from typing import Any, Dict
import math
from ..hydraulic.constants import GRAVITY

# mode-specific calculation

def calculate_spline_mode(data: Dict[str, Any]) -> Dict[str, Any]:
    """Perform spline design calculations.

    The routine will:
    1. Extract and cast numeric inputs
    2. Compute geometry and forces per user formulas
    3. Return a dictionary suitable for JSON response and report
    """

    # helper to convert value to float safely
    def as_float(val: Any, name: str = "") -> float:
        try:
            return float(val)
        except Exception:
            raise ValueError(f"Invalid numeric value for {name}: {val}")

    # convert inputs directly
    Z = as_float(data.get("number_teeth"), "number_teeth")
    P = as_float(data.get("diametral_pitch"), "diametral_pitch")
    # front-end and schema use "pressure_angle"; support either field for backwards compatibility
    phi_raw = data.get("pressure_angle") if data.get("pressure_angle") is not None else data.get("pressure_angle_deg")
    phi_deg = as_float(phi_raw, "pressure_angle")
    OD = as_float(data.get("outer_diameter"), "outer_diameter")
    ID = as_float(data.get("inner_diameter"), "inner_diameter")
    L = as_float(data.get("length_engagement"), "length_engagement")
    Syt = as_float(data.get("yield_strength"), "yield_strength")
    loco_weight = as_float(data.get("loco_weight"), "loco_weight")
    axles = as_float(data.get("number_axles"), "number_axles")
    wheels_per_axle = as_float(data.get("wheels_per_axle"), "wheels_per_axle")
    speed = as_float(data.get("speed"), "speed")
    wheel_dia = as_float(data.get("wheel_diameter"), "wheel_diameter")
    mu = as_float(data.get("friction_coeff"), "friction_coeff")

    # start calculations

    # geometry
    module = 1.0 / P if P != 0 else 0.0
    pitch_dia = Z / P if P != 0 else 0.0  # inches if P is inches-based
    phi_rad = math.radians(phi_deg)
    base_dia = pitch_dia * math.cos(phi_rad)
    tooth_thickness = (math.pi * pitch_dia / (2 * Z)) if Z != 0 else 0.0
    tooth_height = (OD - ID) / 2.0   # actual radial height (mm)
    H = tooth_height
    P_input = P

    # wheel dynamics
    # assume speed input in km/h and diameter in metres
    wheel_circ_m = math.pi * wheel_dia
    speed_mps = (speed * 1000.0) / 3600.0
    wheel_rpm = (speed_mps / wheel_circ_m * 60.0) if wheel_circ_m > 0 else 0.0

    # force and torque
    # convert loco_weight from tonnes to kg (assuming input in t)
    weight_n = loco_weight * 1000.0 * GRAVITY
    wheels_total = axles * wheels_per_axle if axles * wheels_per_axle > 0 else 1
    tangential_force = (weight_n / wheels_total) * mu
    wheel_radius = wheel_dia / 2.0
    torque_required = tangential_force * wheel_radius

    # spline strength checks — same formula as frontend JS
    tooth_height_mm = (OD - ID) / 2.0          # radial tooth height (mm)
    avg_dia = (OD + ID) / 2.0
    mean_radius = avg_dia / 2.0                 # mm
    shear_area = Z * L * tooth_height_mm        # N × L × h (mm²)
    torque_required_nmm = torque_required * 1000.0  # N·m → N·mm
    shear_stress = torque_required_nmm / (shear_area * mean_radius) if (shear_area * mean_radius) != 0 else 0.0  # MPa
    allowable_shear = Syt / math.sqrt(3) if Syt != 0 else 0.0
    safety_factor = allowable_shear / shear_stress if shear_stress != 0 else float('inf')

    # rolling and starting resistance (per example requirements)
    A = 0.647 + (13.17 / (loco_weight / axles)) if axles > 0 else 0.0
    B = 0.00933
    C = 0.057 / loco_weight if loco_weight != 0 else 0.0
    # compute forces (in newtons) and convert to kN as needed
    rolling_resistance_n = (A + B * speed + C * speed * speed) * loco_weight * GRAVITY
    starting_resistance_n = 6 * loco_weight * GRAVITY
    total_resistance_n = rolling_resistance_n + starting_resistance_n  # gradient/curvature assumed zero
    # working torque per wheel
    total_wheels = axles * wheels_per_axle if axles * wheels_per_axle > 0 else 1
    working_torque_wheel = (total_resistance_n * wheel_radius) / total_wheels

    # capacity/working — N·mm then convert to N·m
    torque_capacity = (allowable_shear * shear_area * mean_radius) / 1000.0 if mean_radius != 0 else 0.0
    working_torque = torque_required

    # verdict
    required_fos = 1.5
    verdict = "SAFE" if safety_factor >= required_fos else "UNSAFE"
    reason = f"FOS {'>=' if safety_factor >= required_fos else '<'} {required_fos}"

    return {
        "Z": Z,
        "P": P_input,
        "D": pitch_dia,
        "H": H,
        "module": module,
        "pitch_diameter": pitch_dia,
        "base_diameter": base_dia,
        "tooth_thickness": tooth_thickness,
        "tooth_height": tooth_height,
        "pressure_angle_rad": phi_rad,
        "wheel_circumference": wheel_circ_m,
        "speed_mps": speed_mps,
        "wheel_rpm": wheel_rpm,
        "tangential_force_n": tangential_force,
        "torque_required_nm": torque_required,
        "torque_capacity": torque_capacity,
        "working_torque": working_torque,
        "working_torque_wheel": working_torque_wheel,
        "rolling_resistance_n": rolling_resistance_n,
        "starting_resistance_n": starting_resistance_n,
        "total_resistance_n": total_resistance_n,
        "A": A,
        "B": B,
        "C": C,
        "wheel_radius": wheel_radius,
        "wheels_total": total_wheels,
        "shear_area": shear_area,
        "shear_stress": shear_stress,
        "shear_stress_wheel": (2 * working_torque_wheel) / (pitch_dia * L * Z * H) if (pitch_dia * L * Z * H) != 0 else 0.0,
        "allowable_shear": allowable_shear,
        "safety_factor": safety_factor,
        "verdict": verdict,
        "reason": reason,
        "yield_strength": Syt,
        "phi_deg": phi_deg,
        "length_engagement": L,
        "numerator_shear": 2 * working_torque_wheel * 1000,
        "denominator_shear": pitch_dia * L * Z * H,
        "status": "ok"
    }
