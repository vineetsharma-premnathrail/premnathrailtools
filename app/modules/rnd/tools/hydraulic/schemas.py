# Hydraulic Tool Schemas

from pydantic import BaseModel

class HydraulicInput(BaseModel):
    calc_mode: str  # "calc_cc", "calc_speed", "calc_motor_pressure", or "calc_gear"
    weight: str
    axles: str
    speed: str = "0"
    max_vehicle_rpm: str
    pto_gear_ratio: str = "1"
    engine_gear_ratio: str
    axle_gear_box_ratio: str
    # Slope and curve accept numeric or string inputs (frontend may send numbers or text)
    slope_percent: float | int | str = 0
    curve_degree: float | int | str = 0
    # Units submitted from UI (optional) - provide defaults to avoid validation errors
    slope_unit: str = "percent"
    curve_unit: str = "degree"
    wheel_diameter: str
    num_motors: str = "1"
    per_axle_motor: str = "1"
    pressure: str = "0"
    pressure_unit: str = "bar"
    mech_eff_motor: str = "0"
    vol_eff_motor: str = "100"
    motor_disp_in: str = "0"
    max_motor_rpm: str = "0"
    vol_eff_pump: str = "100"
    mech_eff_pump: str = "95"
    pump_disp_in: str = "0"
    max_pump_rpm: str = "0"
    num_pumps: str = "1"
    # Optional: number of driven axles (subset of total axles). Defaults to all axles if not provided
    drive_axles: int | str | None = None

    # Optional report metadata fields (UI-provided; used only for report generation)
    doc_no: str | None = None
    made_by: str | None = None
    checked_by: str | None = None
    approved_by: str | None = None
    doc_date: str | None = None