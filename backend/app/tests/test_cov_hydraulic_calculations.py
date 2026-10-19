"""Coverage tests for the Hydraulic & Pneumatic calculation engine
(app/modules/hydraulic/calculations.py). Every expected number below is
worked out by hand from the formula in calculations.py and written out in
the comments — the assertions don't call back into the module's own
helpers, so a wrong formula can't "agree with itself".

test_hydraulic.py already covers cylinder_force, pump_power, pipe_sizing,
accumulator_sizing and air_consumption; these tests pick the other
calculation types: cylinder_speed, motor_output, pressure_drop, heat_load,
air_receiver_sizing (plus pump_flow, reservoir_sizing and
pneumatic_cylinder_force), and the input coercion in run_calculation."""
import math

import pytest

from app.auth.jwt_handler import create_access_token
from app.modules.hydraulic.calculations import CalculationError, calc_type_catalog, run_calculation
from app.modules.main.models.user import User

API = "/api/v1/hydraulic"


def res(out: dict, key: str):
    return next(r["value"] for r in out["results"] if r["key"] == key)


# ---------------------------------------------------------------------------
# 1. Cylinder speed — v = Q / A
# ---------------------------------------------------------------------------

def test_cylinder_speed_hand_calc():
    # Ø63 bore / Ø36 rod, 20 L/min, 500 mm stroke.
    #   A_bore    = π·63²/4            = 3117.25 mm²
    #   A_rod     = π·36²/4            = 1017.88 mm²
    #   A_annulus = 3117.25 − 1017.88  = 2099.37 mm²
    #   Q         = 20 L/min = 20·10⁶ mm³ / 60 s = 333 333 mm³/s
    #   v_ext = 333 333 / 3117.25 = 106.93 mm/s   → 500 / 106.93 = 4.68 s
    #   v_ret = 333 333 / 2099.37 = 158.78 mm/s   → 500 / 158.78 = 3.15 s
    #   v_ext in m/min = 106.93 · 60 / 1000 = 6.42 m/min
    #   Return flow while extending = 20 · 2099.37 / 3117.25 = 13.47 L/min
    #   Return flow while retracting = 20 · 3117.25 / 2099.37 = 29.70 L/min
    #   Swept volume = 3117.25 mm² · 500 mm = 1 558 623 mm³ = 1.559 L
    _, out = run_calculation("cylinder_speed", {"bore_mm": 63, "rod_mm": 36, "stroke_mm": 500, "flow_lpm": 20})
    assert res(out, "extend_speed_mm_s") == pytest.approx(106.93, abs=0.01)
    assert res(out, "retract_speed_mm_s") == pytest.approx(158.78, abs=0.01)
    assert res(out, "extend_time_s") == pytest.approx(4.68, abs=0.01)
    assert res(out, "retract_time_s") == pytest.approx(3.15, abs=0.01)
    assert res(out, "extend_speed_m_min") == pytest.approx(6.42, abs=0.01)
    assert res(out, "return_flow_extend_lpm") == pytest.approx(13.47, abs=0.01)
    assert res(out, "return_flow_retract_lpm") == pytest.approx(29.70, abs=0.01)
    assert res(out, "swept_volume_l") == pytest.approx(1.559, abs=0.001)
    assert out["warnings"] == []


def test_cylinder_speed_without_stroke_and_overspeed_warning():
    # No stroke → no stroke-time rows. Ø20 bore at 20 L/min:
    #   A = π·20²/4 = 314.16 mm², v = 333 333 / 314.16 = 1061.0 mm/s = 63.7 m/min
    #   > 18 m/min (0.3 m/s) → seal-speed warning.
    _, out = run_calculation("cylinder_speed", {"bore_mm": 20, "rod_mm": 10, "flow_lpm": 20})
    keys = {r["key"] for r in out["results"]}
    assert "extend_time_s" not in keys and "swept_volume_l" not in keys
    assert res(out, "extend_speed_mm_s") == pytest.approx(1061.03, abs=0.01)
    assert out["warnings"] and "0.3 m/s" in out["warnings"][0]


# ---------------------------------------------------------------------------
# 2. Hydraulic motor — T = Vg·Δp·ηm / 20π,  n = Q·1000·ηv / Vg,  P = T·n / 9549
# ---------------------------------------------------------------------------

def test_motor_output_hand_calc():
    # Vg = 100 cc/rev, Δp = 200 bar, Q = 60 L/min, ηv = 95 %, ηm = 90 %.
    #   Theoretical torque = 100 · 200 / (20π) = 20 000 / 62.832 = 318.31 Nm
    #   Output torque      = 318.31 · 0.90                        = 286.48 Nm
    #   Speed              = 60 · 1000 · 0.95 / 100                = 570 rpm
    #   Output power       = 286.48 · 570 / 9549                   = 17.10 kW
    #   Hydraulic input    = Δp · Q / 600 = 200 · 60 / 600         = 20.00 kW
    _, out = run_calculation("motor_output", {
        "displacement_cc": 100, "pressure_bar": 200, "flow_lpm": 60, "vol_efficiency_pct": 95, "mech_efficiency_pct": 90,
    })
    assert res(out, "theoretical_torque_nm") == pytest.approx(318.31, abs=0.01)
    assert res(out, "torque_nm") == pytest.approx(286.48, abs=0.01)
    assert res(out, "speed_rpm") == 570  # rounded to 0 places
    assert res(out, "output_power_kw") == pytest.approx(17.10, abs=0.01)
    assert res(out, "input_power_kw") == pytest.approx(20.0)
    # Overall efficiency sanity: 17.10 / 20 = 85.5 % = ηv · ηm = 0.95 · 0.90.
    assert res(out, "output_power_kw") / res(out, "input_power_kw") == pytest.approx(0.95 * 0.90, abs=0.001)


# ---------------------------------------------------------------------------
# 3. Line pressure drop — Darcy–Weisbach, laminar f = 64/Re
# ---------------------------------------------------------------------------

def test_pressure_drop_laminar_matches_hagen_poiseuille():
    # 40 L/min of ISO VG 46 (ν = 46 cSt, ρ = 870 kg/m³) through 5 m of Ø16 mm bore.
    #   Q  = 40 / 60 000            = 6.667·10⁻⁴ m³/s
    #   A  = π·0.016²/4             = 2.0106·10⁻⁴ m²
    #   v  = Q / A                  = 3.316 m/s
    #   Re = v·d/ν = 3.316 · 0.016 / 46·10⁻⁶ = 1153  (< 2300 → laminar)
    #   f  = 64 / 1153              = 0.0555
    # Laminar Darcy–Weisbach is exactly Hagen–Poiseuille, Δp = 32·μ·L·v / d²
    # with μ = ν·ρ = 46·10⁻⁶ · 870 = 0.04002 Pa·s:
    #   Δp = 32 · 0.04002 · 5 · 3.316 / 0.016² = 82 935 Pa = 0.829 bar
    #   Power lost = Δp · Q = 82 935 · 6.667·10⁻⁴ = 55.3 W = 0.055 kW
    _, out = run_calculation("pressure_drop", {
        "flow_lpm": 40, "pipe_id_mm": 16, "length_m": 5, "viscosity_cst": 46, "density_kg_m3": 870,
    })
    mu = 46e-6 * 870
    v = (40 / 60000) / (math.pi * 0.016 ** 2 / 4)
    hagen_poiseuille_bar = 32 * mu * 5 * v / 0.016 ** 2 / 1e5
    assert res(out, "regime") == "Laminar"
    assert res(out, "velocity_m_s") == pytest.approx(3.32, abs=0.01)
    assert res(out, "reynolds") == pytest.approx(1153, abs=1)
    assert res(out, "friction_factor") == pytest.approx(0.0555, abs=0.0001)
    assert res(out, "pressure_drop_bar") == pytest.approx(0.829, abs=0.001)
    assert res(out, "pressure_drop_bar") == pytest.approx(hagen_poiseuille_bar, abs=0.001)
    assert res(out, "power_loss_kw") == pytest.approx(0.055, abs=0.001)
    assert out["warnings"] == []


def test_pressure_drop_turbulent_uses_blasius():
    # Thin oil (ν = 10 cSt) at 100 L/min in Ø16 mm → turbulent.
    #   v  = (100/60 000) / 2.0106·10⁻⁴ = 8.289 m/s
    #   Re = 8.289 · 0.016 / 10·10⁻⁶     = 13 263  (> 4000)
    #   f  = 0.316 / Re^0.25 = 0.316 / 10.732 = 0.02945
    #   Δp = f · (L/d) · ρv²/2 = 0.02945 · (2/0.016) · 870 · 8.289² / 2 = 109 990 Pa = 1.100 bar
    _, out = run_calculation("pressure_drop", {
        "flow_lpm": 100, "pipe_id_mm": 16, "length_m": 2, "viscosity_cst": 10, "density_kg_m3": 870,
    })
    assert res(out, "regime") == "Turbulent"
    assert res(out, "reynolds") == pytest.approx(13263, abs=2)
    assert res(out, "friction_factor") == pytest.approx(0.0294, abs=0.0001)
    assert res(out, "pressure_drop_bar") == pytest.approx(1.100, abs=0.002)
    assert out["warnings"] == []


# ---------------------------------------------------------------------------
# 4. Heat load — heat = P_in·(1 − η), tank sheds 15 W/m²K · A · ΔT
# ---------------------------------------------------------------------------

def test_heat_load_with_tank_dissipation():
    # 15 kW input at 75 % overall efficiency:
    #   heat generated = 15 · (1 − 0.75) = 3.75 kW
    # Tank 2 m² allowed to run 30 °C over ambient:
    #   dissipated = 0.015 kW/m²K · 2 · 30 = 0.90 kW
    #   cooler     = 3.75 − 0.90         = 2.85 kW
    _, out = run_calculation("heat_load", {
        "input_power_kw": 15, "overall_efficiency_pct": 75, "tank_surface_m2": 2, "allowed_temp_rise_c": 30,
    })
    assert res(out, "heat_generated_kw") == pytest.approx(3.75)
    assert res(out, "tank_dissipation_kw") == pytest.approx(0.90)
    assert res(out, "cooler_required_kw") == pytest.approx(2.85)
    assert out["warnings"] == []


def test_heat_load_tank_bigger_than_load_and_no_tank():
    # 4 kW at 90 % → 0.4 kW of heat; a 3 m² tank at 20 °C sheds 0.015·3·20 = 0.9 kW,
    # so no cooler is needed (clamped at 0, never negative).
    _, out = run_calculation("heat_load", {"input_power_kw": 4, "overall_efficiency_pct": 90, "tank_surface_m2": 3, "allowed_temp_rise_c": 20})
    assert res(out, "heat_generated_kw") == pytest.approx(0.4)
    assert res(out, "cooler_required_kw") == 0.0
    # No tank data → the whole 3.75 kW goes to the cooler, with a warning.
    _, out = run_calculation("heat_load", {"input_power_kw": 15, "overall_efficiency_pct": 75})
    assert res(out, "cooler_required_kw") == pytest.approx(3.75)
    assert "whole heat load is assigned to the cooler" in out["warnings"][0]


# ---------------------------------------------------------------------------
# 5. Air receiver — V = t · demand · p_atm / (p_max − p_min)
# ---------------------------------------------------------------------------

def test_air_receiver_sizing_hand_calc():
    # 1000 Nl/min for 1 min between 8 and 6 bar(g):
    #   V = 1 · 1000 · 1.01325 / (8 − 6) = 506.6 L → next standard size 750 L
    #   usable stored free air = 506.6 · 2 / 1.01325 = 1000 Nl (= the demand, by construction)
    _, out = run_calculation("air_receiver_sizing", {"demand_nl_min": 1000, "p_max_bar": 8, "p_min_bar": 6, "time_min": 1})
    assert res(out, "receiver_volume_l") == pytest.approx(507, abs=0.5)  # rounded to 0 places
    assert res(out, "recommended_size_l") == 750
    assert res(out, "stored_free_air_nl") == pytest.approx(1000, abs=0.5)
    assert out["warnings"] == []


def test_air_receiver_too_large_and_bad_pressures():
    # 20 000 Nl/min for 2 min over a 1 bar band: 2 · 20 000 · 1.01325 / 1 = 40 530 L > 5000 L.
    _, out = run_calculation("air_receiver_sizing", {"demand_nl_min": 20000, "p_max_bar": 7, "p_min_bar": 6, "time_min": 2})
    assert res(out, "receiver_volume_l") == pytest.approx(40530, abs=0.5)
    assert res(out, "recommended_size_l") is None and "5000 L" in out["warnings"][0]
    with pytest.raises(CalculationError, match="Cut-out"):
        run_calculation("air_receiver_sizing", {"demand_nl_min": 100, "p_max_bar": 6, "p_min_bar": 6, "time_min": 1})


# ---------------------------------------------------------------------------
# Extra types
# ---------------------------------------------------------------------------

def test_pump_flow_hand_calc():
    # 28 cc/rev at 1450 rpm: 28 · 1450 / 1000 = 40.6 L/min theoretical;
    # at 95 % volumetric → 38.57 L/min delivered, 2.03 L/min internal leakage.
    _, out = run_calculation("pump_flow", {"displacement_cc": 28, "speed_rpm": 1450, "vol_efficiency_pct": 95})
    assert res(out, "theoretical_flow_lpm") == pytest.approx(40.6)
    assert res(out, "actual_flow_lpm") == pytest.approx(38.57, abs=0.01)
    assert res(out, "leakage_lpm") == pytest.approx(2.03, abs=0.01)


def test_reservoir_sizing_hand_calc():
    # 40 L/min × 3 min dwell = 120 L of oil; +10 % air space = 132 L gross.
    _, out = run_calculation("reservoir_sizing", {"pump_flow_lpm": 40, "factor": 3})
    assert res(out, "fluid_volume_l") == 120 and res(out, "tank_volume_l") == 132
    assert out["warnings"] == []
    _, out = run_calculation("reservoir_sizing", {"pump_flow_lpm": 40, "factor": 1.5})
    assert "under 2 minutes" in out["warnings"][0]


def test_pneumatic_cylinder_force_load_ratio():
    # Ø50 bore, 6 bar, 85 % efficiency:
    #   A = π·50²/4 = 1963.50 mm² → F = 0.1 · 6 · 1963.50 · 0.85 = 1001.4 N → 1001 N
    #   A_ann = 1963.50 − π·20²/4 (314.16) = 1649.34 mm² → F_ret = 0.1 · 6 · 1649.34 · 0.85 = 841.2 N
    #   80 kg load = 80 · 9.80665 = 784.5 N → load ratio = 784.5 / 1001.4 = 78.3 % (> 70 % → warning)
    _, out = run_calculation("pneumatic_cylinder_force", {"bore_mm": 50, "rod_mm": 20, "pressure_bar": 6, "efficiency_pct": 85, "load_kg": 80})
    assert res(out, "extend_force_n") == 1001
    assert res(out, "retract_force_n") == 841
    assert res(out, "extend_force_kgf") == pytest.approx(102.1, abs=0.05)
    assert res(out, "load_ratio_pct") == pytest.approx(78.3, abs=0.05)
    assert "above 70 %" in out["warnings"][0]
    # 120 kg = 1176.8 N > 1001.4 N → it can't move the load at all.
    _, out = run_calculation("pneumatic_cylinder_force", {"bore_mm": 50, "rod_mm": 20, "pressure_bar": 6, "efficiency_pct": 85, "load_kg": 120})
    assert "won't move it" in out["warnings"][0]


# ---------------------------------------------------------------------------
# Input coercion
# ---------------------------------------------------------------------------

def test_inputs_coerced_defaults_and_rejected():
    # Strings are coerced; a blank efficiency falls back to the declared default (95 %).
    clean, _ = run_calculation("pump_flow", {"displacement_cc": "28", "speed_rpm": "1450", "vol_efficiency_pct": ""})
    assert clean == {"displacement_cc": 28.0, "speed_rpm": 1450.0, "vol_efficiency_pct": 95.0}
    # Optional fields stay None rather than taking a default.
    clean, _ = run_calculation("pipe_sizing", {"flow_lpm": 40})
    assert clean["actual_id_mm"] is None and clean["line_type"] == "pressure"

    with pytest.raises(CalculationError, match="must be a number"):
        run_calculation("pump_flow", {"displacement_cc": "abc", "speed_rpm": 1450})
    with pytest.raises(CalculationError, match="can't be negative"):
        run_calculation("pump_flow", {"displacement_cc": -5, "speed_rpm": 1450})
    with pytest.raises(CalculationError, match="finite"):
        run_calculation("pump_flow", {"displacement_cc": float("inf"), "speed_rpm": 1450})
    with pytest.raises(CalculationError, match="isn't one of"):
        run_calculation("pipe_sizing", {"flow_lpm": 40, "line_type": "drain"})
    with pytest.raises(CalculationError, match="between 1 and 100"):
        run_calculation("motor_output", {"displacement_cc": 100, "pressure_bar": 200, "flow_lpm": 60, "vol_efficiency_pct": 120})
    with pytest.raises(CalculationError, match="greater than zero"):
        run_calculation("pump_flow", {"displacement_cc": 0, "speed_rpm": 1450})


def test_catalog_lists_every_type_with_inputs():
    cat = {c["key"]: c for c in calc_type_catalog()}
    assert len(cat) == 13
    assert cat["air_receiver_sizing"]["system_type"] == "pneumatic"
    assert cat["motor_output"]["system_type"] == "hydraulic"
    assert [i["key"] for i in cat["heat_load"]["inputs"]] == ["input_power_kw", "overall_efficiency_pct", "tank_surface_m2", "allowed_temp_rise_c"]


def test_compute_endpoint_returns_clean_inputs(client, db):
    user = User(email="cov.calc@premnathrail.com", name="calc", role="user", is_active=True, assigned_apps=["hydraulic"])
    db.add(user)
    db.commit()
    h = {"Authorization": f"Bearer {create_access_token({'sub': str(user.id), 'email': user.email, 'role': user.role})}"}
    r = client.post(f"{API}/calculations/compute", json={"calc_type": "heat_load", "inputs": {"input_power_kw": "15"}}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    # Efficiency defaults to 75 % → 15 · 0.25 = 3.75 kW.
    assert body["inputs"]["overall_efficiency_pct"] == 75
    assert res(body, "heat_generated_kw") == pytest.approx(3.75)
    bad = client.post(f"{API}/calculations/compute", json={"calc_type": "warp_drive", "inputs": {}}, headers=h)
    assert bad.status_code == 400 and "Unknown calculation type" in bad.json()["detail"]
