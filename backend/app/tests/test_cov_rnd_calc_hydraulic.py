"""R&D calculator verification pack: Hydraulic drive (tools/hydraulic).

Reference: docs/02-modules/rnd/overview.md §8.2 and §14 rows 5-6.
Golden values are hand-computed from the documented resistance model and
torque chain; discrepancies are written as the correct engineering behaviour
and pinned with xfail(strict=True, raises=AssertionError). No maths changed.
"""
import io

import pytest

from app.modules.rnd.tools.hydraulic.core import (
    calculate_displacement_mode,
    calculate_gear_ratio_mode,
    calculate_motor_pressure_mode,
    calculate_speed_mode,
)

# Reference vehicle used throughout (units as the core expects):
#   W = 20 t, 2 axles (both driven), wheel Ø600 mm, 1 motor per axle (2 motors),
#   p = 200 bar, motor η_mech 90 %, η_vol 95 %, axle gearbox 5:1,
#   engine 2000 rpm, engine gear 1, PTO 1, pump η_vol 95 %, η_mech 90 %, 1 pump.
BASE = dict(
    calc_mode="calc_cc", weight=20.0, axles=2, drive_axles=2, wheel_diameter=600.0,
    speed=10.0, slope_percent=0.0, curve_degree=0.0, per_axle_motor=1, num_motors=2,
    pressure=200.0, mech_eff_motor=90.0, vol_eff_motor=95.0, axle_gear_box_ratio=5.0,
    engine_gear_ratio_list=[1.0], max_vehicle_rpm=2000.0, pto_gear_ratio=1.0,
    vol_eff_pump=95.0, mech_eff_pump=90.0, num_pumps=1,
)


def _case(**over):
    d = dict(BASE)
    d.update(over)
    return d


# ---------------------------------------------------------------------------
# (a) Golden values
# ---------------------------------------------------------------------------

def test_cc_mode_flat_10kmh_hand_calc():
    # Resistance (kN):
    #   A = 0.647 + 13.17/(20/2) = 1.964 ; B·v = 0.00933·10 = 0.0933 ; C·v² = (0.057/20)·100 = 0.285
    #   R_r = (1.964 + 0.0933 + 0.285)·20·9.81/1000 = 2.3423·0.1962 = 0.45956 kN
    #   R_s = 6·20·9.81/1000 = 1.1772 kN ; R = 1.63676 kN
    # Torque chain:
    #   T_total = 1636.76 N · 0.3 m = 491.03 N·m ; per axle = 245.51 ; per motor = 245.51
    #   at motor shaft = 245.51/5 = 49.103 N·m = 49.103·10.1972 = 500.71 kg·cm
    # Displacement:
    #   p = 200·1.01972 = 203.944 kg/cm² ; V_m = 500.71·2π/(203.944·0.90) = 3146.07/183.55 = 17.140 cc
    #   → next standard size strictly above = 23 cc
    # Flow:
    #   circ = π·0.6 = 1.88496 m ; v = 2.7778 m/s ; n_wheel = 2.7778/1.88496·60 = 88.42 rpm
    #   n_m = 88.42·5 = 442.10 rpm ; Q_m = 17.140·442.10/0.95/1000 = 7.976 L/min ; total = 15.953 L/min
    #   P_motor = 7.976·200/600·0.90·0.95 = 2.273 kW
    # Pump (gear 1, PTO 1): n_p = 2000 rpm ; V_p = 15.953/(2000·0.95)·1000 = 8.396 cc → suggest 10 cc
    #   P_pump = 200·15.953/(600·0.90) = 5.908 kW
    r = calculate_displacement_mode(_case())
    assert r["A"] == pytest.approx(1.964)
    assert r["rolling_resistance"] == pytest.approx(0.45956, abs=1e-5)
    assert r["starting_resistance"] == pytest.approx(1.1772, abs=1e-6)
    assert r["total_resistance"] == pytest.approx(1.63676, abs=1e-5)
    assert r["required_total_torque"] == pytest.approx(491.03, abs=0.01)
    assert r["per_gearbox_input_torque"] == pytest.approx(49.103, abs=0.001)
    assert r["per_gearbox_input_torque_kg_cm"] == pytest.approx(500.71, abs=0.01)
    assert r["motor_displacement_cc"] == pytest.approx(17.140, abs=0.001)
    assert r["suggested_motor_cc"] == 23.0
    assert r["gearbox_input_rpm"] == pytest.approx(442.10, abs=0.01)
    assert r["per_motor_flow_rate_lpm"] == pytest.approx(7.976, abs=0.001)
    assert r["total_motor_flow_lpm"] == pytest.approx(15.953, abs=0.001)
    assert r["per_motor_power_kw"] == pytest.approx(2.273, abs=0.001)
    pr = r["pump_results"][0]
    assert pr["pump_rpm"] == pytest.approx(2000.0)
    assert pr["pump_disp_cc"] == pytest.approx(8.396, abs=0.001)
    assert pr["suggested_pump_disp_per_pump_cc"] == 10.0
    assert pr["pump_power_per_pump_kw"] == pytest.approx(5.908, abs=0.001)


def test_cc_mode_slope_and_curve_20kmh_hand_calc():
    # v = 20 km/h, s = 2 %, D = 3°:
    #   R_r = (1.964 + 0.1866 + 0.00285·400)·0.1962 = 3.2906·0.1962 = 0.64562 kN
    #   R_g = 20·9.81·2/100            = 3.924 kN
    #   R_c = 0.4·20·3·9.81/1000       = 0.23544 kN
    #   R_s = 1.1772 kN ; R = 5.98226 kN
    #   V_m scales with R: 17.140 · 5.98226/1.63676 = 62.646 cc → suggest 63 cc
    r = calculate_displacement_mode(_case(speed=20.0, slope_percent=2.0, curve_degree=3.0))
    assert r["rolling_resistance"] == pytest.approx(0.64562, abs=1e-5)
    assert r["gradient_resistance"] == pytest.approx(3.924, abs=1e-6)
    assert r["curvature_resistance"] == pytest.approx(0.23544, abs=1e-6)
    assert r["total_resistance"] == pytest.approx(5.98226, abs=1e-5)
    assert r["motor_displacement_cc"] == pytest.approx(62.646, abs=0.001)
    assert r["suggested_motor_cc"] == 63.0


def test_gear_ratio_mode_hand_calc():
    # v = 20 km/h = 5.5556 m/s, Ø600 mm → circ 1.88496 m → n_wheel = 176.84 rpm
    # ratio = 3000 / 176.84 = 16.965
    r = calculate_gear_ratio_mode({"speed": 20, "wheel_diameter": 600, "max_motor_rpm": 3000})
    assert r["wheel_rpm"] == pytest.approx(176.84, abs=0.01)
    assert r["required_gear_ratio"] == pytest.approx(16.965, abs=0.001)


def test_motor_pressure_mode_hand_calc():
    # Same torque chain as the cc case (500.71 kg·cm at the motor shaft), V_m = 28 cc:
    #   p = 500.71·2π/(28·0.90) = 3146.07/25.2 = 124.84 kg/cm² → /1.01972 = 122.43 bar
    r = calculate_motor_pressure_mode(_case(calc_mode="calc_motor_pressure", motor_disp_in=28.0))
    assert r["required_pressure_bar"] == pytest.approx(122.43, abs=0.01)
    assert r["pump_results"] == []


def test_speed_mode_torque_match_hand_calc():
    # T_avail = η·p·V·0.015915 = 0.90·200·28·0.015915 = 80.21 N·m
    # Required per motor = R(v)·1000·0.3 / 2 axles / 1 motor / 5 = 30·R(v) N·m (R in kN)
    #   → need R(v) ≤ 2.6737 kN, i.e. (1.964 + 0.00933v + 0.00285v²)·0.1962 ≤ 1.4965
    #   → 0.00285v² + 0.00933v − 5.6636 ≤ 0 → v ≤ 42.97 km/h → highest whole km/h = 42
    #   at 42: R = (1.964 + 0.3919 + 5.0274)·0.1962 + 1.1772 = 2.6258 kN → 78.77 N·m
    r = calculate_speed_mode(_case(calc_mode="calc_speed", pump_disp_in=45.0, motor_disp_in=28.0))
    assert r["available_torque"] == pytest.approx(80.21, abs=0.01)
    assert r["matched_speed_kph"] == 42
    assert r["per_motor_torque"] == pytest.approx(78.77, abs=0.01)


# ---------------------------------------------------------------------------
# (b) Discrepancies
# ---------------------------------------------------------------------------

@pytest.mark.xfail(
    reason="DISCREPANCY: speed mode ignores flow-limited speed (pump flow → motor rpm → wheel), needs "
           "engineering confirmation — backend/app/modules/rnd/tools/hydraulic/core.py:546",
    strict=True, raises=AssertionError,
)
def test_speed_mode_result_cannot_exceed_flow_limited_speed():
    # Tiny pump, big motors: pump 10 cc @2000 rpm, η_v 0.95 → 19 L/min ; 2 motors → 9.5 L/min each
    #   motor 100 cc: n_m = 9.5/0.1·0.95 = 90.25 rpm → axle 18.05 rpm → v = 18.05·1.885/60·3.6 = 2.04 km/h
    # Torque is plentiful (286 N·m available), so the torque-only scan reports 117 km/h.
    r = calculate_speed_mode(_case(calc_mode="calc_speed", pump_disp_in=10.0, motor_disp_in=100.0))
    flow_limited = r["gear_results"][0]["hydraulic_speed_kph"]
    assert flow_limited == pytest.approx(2.04, abs=0.01)
    assert r["matched_speed_kph"] <= flow_limited + 1


@pytest.mark.xfail(
    reason="DISCREPANCY: speed mode always reports the last gear in the list (T_avail is gear-independent), "
           "needs engineering confirmation — backend/app/modules/rnd/tools/hydraulic/core.py:549",
    strict=True, raises=AssertionError,
)
def test_speed_mode_reports_the_gear_that_actually_gives_the_speed():
    # Gears "1, 3": gear 1 gives the pump 2000 rpm, gear 3 only 667 rpm → gear 1 can
    # feed three times the flow, so it is the gear that achieves the top speed.
    r = calculate_speed_mode(_case(calc_mode="calc_speed", pump_disp_in=45.0, motor_disp_in=28.0,
                                   engine_gear_ratio_list=[1.0, 3.0]))
    assert r["matched_gear_ratio"] == 1.0


@pytest.mark.xfail(
    reason="DISCREPANCY: speed mode divides pump shaft speed by the number of pumps, needs engineering "
           "confirmation — backend/app/modules/rnd/tools/hydraulic/core.py:505",
    strict=True, raises=AssertionError,
)
def test_speed_mode_each_pump_runs_at_full_shaft_speed():
    # 2 pumps of 45 cc on the PTO at 2000 rpm: each delivers 45·2000·0.95/1000 = 85.5 L/min.
    r = calculate_speed_mode(_case(calc_mode="calc_speed", pump_disp_in=45.0, motor_disp_in=28.0, num_pumps=2))
    g = r["gear_results"][0]
    assert g["pump_speed"] == pytest.approx(2000.0)
    assert g["per_pump_flow"] == pytest.approx(85.5, abs=0.01)


@pytest.mark.xfail(
    reason="DISCREPANCY: pump input power divides by mechanical efficiency only, not η_vol·η_mech, needs "
           "engineering confirmation — backend/app/modules/rnd/tools/hydraulic/core.py:190",
    strict=True, raises=AssertionError,
)
def test_pump_input_power_uses_total_efficiency():
    # P_in = p·Q/(600·η_vol·η_mech) = 200·15.953/(600·0.95·0.90) = 6.219 kW (code: 5.908 kW)
    pr = calculate_displacement_mode(_case())["pump_results"][0]
    assert pr["pump_power_per_pump_kw"] == pytest.approx(6.219, abs=0.001)


@pytest.mark.xfail(
    reason="DISCREPANCY: report motor-size list lacks 28/32 cc and uses >= while core uses > , needs "
           "engineering confirmation — backend/app/modules/rnd/tools/hydraulic/reports/pdf_builder.py:589 (also :730, :741)",
    strict=True, raises=AssertionError,
)
def test_report_motor_size_suggestion_matches_core_rule():
    import docx

    from app.modules.rnd.tools.hydraulic.reports.pdf_builder import create_hydraulic_docx_report

    inputs = _case(calc_mode="calc_motor_pressure", motor_disp_in=28.0)
    results = calculate_motor_pressure_mode(inputs)
    stream = create_hydraulic_docx_report(inputs, results, {k: str(v) for k, v in inputs.items()})
    text = "\n".join(p.text for p in docx.Document(io.BytesIO(stream.getvalue())).paragraphs)
    # Core list {16, 23, 28, 32, 45, ...}, first size strictly above 28 → 32. Report says 45.
    assert "Suggested standard motor (next higher): 32 cc/rev" in text


@pytest.mark.xfail(
    reason="DISCREPANCY: mech_eff_motor defaults to \"0\" so an omitted field fails with 'cannot be 0', "
           "needs engineering confirmation — backend/app/modules/rnd/tools/hydraulic/schemas.py:25",
    strict=True, raises=AssertionError,
)
def test_mech_eff_motor_default_is_not_zero():
    from app.modules.rnd.tools.hydraulic.schemas import HydraulicInput

    f = HydraulicInput.model_fields["mech_eff_motor"]
    assert f.is_required() or float(f.default) > 0
