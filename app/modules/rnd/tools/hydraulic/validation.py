# Hydraulic Tool Validation

import math
from typing import Dict, Any, Tuple, Optional, List, cast, Mapping as _TypingMapping
from .schemas import HydraulicInput

def validate_hydraulic_inputs(raw: HydraulicInput) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Validate and process hydraulic inputs"""
    inputs: Dict[str, Any] = {}
    # Extract a plain dict from the Pydantic model in a way that works for v1 and v2
    inputs_raw: Dict[str, Any] = {}
    # Prefer Pydantic v2's model_dump; otherwise accept mapping-like inputs
    dump = getattr(raw, "model_dump", None)
    if callable(dump):
        try:
            data = dump()
            # Ensure we only pass a mapping/dict to dict() and normalize keys to str
            from collections.abc import Mapping as _Mapping
            if isinstance(data, _Mapping):
                inputs_raw = {}
                items = cast(_TypingMapping[str, Any], data).items()
                for k, v in items:
                    inputs_raw[str(k)] = v
            else:
                inputs_raw = {}
        except Exception:
            inputs_raw = {}
    else:
        try:
            from collections.abc import Mapping as _Mapping
            if isinstance(raw, _Mapping):
                inputs_raw = dict(raw)
        except Exception:
            inputs_raw = {}

    mode = raw.calc_mode
    inputs['calc_mode'] = mode

    # Common validations
    inputs['weight'] = float(raw.weight)
    inputs['axles'] = int(raw.axles)
    # drive_axles is optional; default to total axles if not provided
    # drive_axles may be optional; default to total axles if not provided
    drive_axles_raw = getattr(raw, 'drive_axles', None)
    if drive_axles_raw in (None, ''):
        inputs['drive_axles'] = int(raw.axles)
    else:
        # safe cast to int for inputs like '2' or 2
        inputs['drive_axles'] = int(drive_axles_raw)

    # Validate logical relationship: drive_axles must not exceed total axles
    try:
        total_axles_val = int(raw.axles)
    except Exception:
        total_axles_val = int(inputs.get('axles', 0))
    if inputs['drive_axles'] > total_axles_val:
        raise ValueError("Drive axles cannot exceed total number of axles.")

    # Always parse these commonly-used vehicle inputs (was previously nested incorrectly)
    inputs['wheel_diameter'] = float(raw.wheel_diameter)
    inputs['axle_gear_box_ratio'] = float(raw.axle_gear_box_ratio)
    inputs['max_vehicle_rpm'] = float(raw.max_vehicle_rpm)
    inputs['pto_gear_ratio'] = float(raw.pto_gear_ratio)

    # Parse engine gear ratios
    engine_gear_raw: str = str(raw.engine_gear_ratio).strip()
    parts: List[str] = [p.strip() for p in engine_gear_raw.split(',') if p.strip()]
    engine_gear_list: List[float] = [float(p) for p in parts]
    inputs['engine_gear_ratio_list'] = engine_gear_list
    inputs['engine_gear_ratio'] = engine_gear_list[0] if engine_gear_list else 1.0

    inputs['num_motors'] = int(raw.num_motors)
    inputs['per_axle_motor'] = int(raw.per_axle_motor)
    inputs['vol_eff_motor'] = float(raw.vol_eff_motor)
    inputs['vol_eff_pump'] = float(raw.vol_eff_pump)

    # Helper to safely parse percent-like inputs coming as strings/numbers
    def _parse_percent(val: Any, default: float = 95.0, minimum: float = 0.0, maximum: float = 100.0) -> float:
        try:
            n = float(val) if val is not None and str(val) != '' else float(default)
        except Exception:
            n = float(default)
        if n <= minimum or n > maximum:
            raise ValueError(f"Percentage must be > {minimum} and <= {maximum}; got {n}")
        return n

    # Pump mechanical efficiency (percentage, validated)
    inputs['mech_eff_pump'] = _parse_percent(getattr(raw, 'mech_eff_pump', 95.0), default=95.0)
    # we no longer show these fields in the UI but keep parsing for backwards compatibility
    inputs['max_motor_rpm'] = float(getattr(raw, 'max_motor_rpm', 0) or 0.0)
    inputs['max_pump_rpm'] = float(getattr(raw, 'max_pump_rpm', 0) or 0.0)

    # Mode-specific validations
    inputs['speed'] = float(raw.speed) if mode in ('calc_cc', 'calc_motor_pressure', 'calc_gear') else 0.0

    # Pressure: accept value + unit from frontend, convert to BAR for internal calculations
    def _pressure_to_bar(val: Any, unit: Optional[str]) -> float:
        try:
            v = float(val) if val is not None and str(val) != '' else 0.0
        except Exception:
            v = 0.0
        u = (unit or 'bar').strip().lower()
        if u in ('bar', 'bars'):
            return v
        if u in ('pa', 'pascal', 'pascals'):
            return v / 1e5
        if u in ('kpa', 'kilopascal', 'kilopascals'):
            return v / 100.0
        if u in ('mpa', 'megapascal', 'megapascals'):
            return v * 10.0
        if u in ('kg/cm2', 'kg/cm²', 'kgcm2', 'kgf/cm2', 'kgf/cm²'):
            # 1 kgf/cm^2 ≈ 0.980665 bar
            return v * 0.980665
        # default assume bar
        return v

    # store the raw unit (if present) and convert to bar
    pressure_unit_raw = getattr(raw, 'pressure_unit', None)
    inputs['pressure_unit'] = pressure_unit_raw or 'bar'
    inputs['pressure'] = _pressure_to_bar(getattr(raw, 'pressure', 0), pressure_unit_raw) if mode in ('calc_cc','calc_speed') else 0.0

    inputs['mech_eff_motor'] = float(raw.mech_eff_motor) if mode in ('calc_cc', 'calc_motor_pressure', 'calc_speed') else 0.0
    inputs['motor_disp_in'] = float(raw.motor_disp_in)
    inputs['pump_disp_in'] = float(raw.pump_disp_in)
    inputs['num_pumps'] = int(raw.num_pumps) if getattr(raw, 'num_pumps', None) is not None else 1

    # Unit conversion helpers (ensure calculations use percentage for slope and degrees for curve)
    def _slope_to_percent(val: Any, unit: Optional[str]) -> float:
        """Convert various slope unit inputs to percent (safely).

        Supported units:
        - percent / % : value interpreted directly
        - ratio : 1:G -> percent = 100 / G
        - degree / deg / ° : degrees -> percent = tan(deg) * 100
        """
        try:
            v: float = float(val) if val is not None and str(val) != '' else 0.0
        except Exception:
            v = 0.0
        unit_norm: str = str(unit or '').lower()
        if unit_norm in ('percent', '%'):
            return v
        if unit_norm == 'ratio':
            return 0.0 if v == 0 else 100.0 / v
        if unit_norm in ('degree', 'deg', '°'):
            return math.tan(math.radians(v)) * 100.0
        # default - treat as percent
        return v

    def _curve_to_degrees(val: Any, unit: Optional[str]) -> float:
        """Convert various curve unit inputs to degrees.

        Supported units:
        - degree / deg / ° : value interpreted directly
        - percent : percent -> degrees = atan(percent/100)
        - ratio : 1:G -> percent = 100 / G -> degrees
        """
        try:
            v: float = float(val) if val is not None and str(val) != '' else 0.0
        except Exception:
            v = 0.0
        unit_norm: str = str(unit or '').lower()
        if unit_norm in ('degree', 'deg', '°'):
            return v
        if unit_norm == 'percent':
            return math.degrees(math.atan(v / 100.0))
        if unit_norm == 'ratio':
            percent = 0.0 if v == 0 else 100.0 / v
            return math.degrees(math.atan(percent / 100.0))
        if unit_norm in ('m', 'meter', 'meters', 'radius'):
            # Curve radius (m) → degree of curve: D = 1750 / R
            return 1750.0 / v if v > 0 else 0.0
        # default - treat as degrees
        return v

    # Optional parameters and converted units
    slope_raw: Any = getattr(raw, 'slope_percent', None)
    slope_unit: Optional[str] = getattr(raw, 'slope_unit', None)
    inputs['slope_percent'] = _slope_to_percent(slope_raw, slope_unit)
    inputs['slope_unit'] = slope_unit or 'percent'

    curve_raw: Any = getattr(raw, 'curve_degree', None)
    curve_unit: Optional[str] = getattr(raw, 'curve_unit', None)
    inputs['curve_degree'] = _curve_to_degrees(curve_raw, curve_unit)
    inputs['curve_unit'] = curve_unit or 'degree'

    return inputs, inputs_raw