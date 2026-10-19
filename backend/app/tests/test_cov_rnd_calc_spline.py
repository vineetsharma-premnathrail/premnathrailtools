"""R&D calculator verification pack: Spline (tools/spline).

Reference: docs/02-modules/rnd/overview.md §8.7 and §14 row 10.
Code path: api.py → core.calculate_spline_mode. Golden values hand-computed;
discrepancies pinned with xfail(strict=True, raises=AssertionError).
"""
import math

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.rnd.tools.spline.api import router as spline_router
from app.modules.rnd.tools.spline.core import calculate_spline_mode

BASE = dict(
    calc_mode="calc_spline", number_teeth="8", diametral_pitch="0.19", pressure_angle="0",
    outer_diameter="44.8", inner_diameter="39", length_engagement="40", yield_strength="500",
    material_type="EN24", loco_weight="20", number_axles="2", wheels_per_axle="2",
    speed="20", wheel_diameter="0.8", friction_coeff="0.3",
)


def _d(**over):
    d = dict(BASE)
    d.update(over)
    return d


@pytest.fixture()
def sclient():
    app = FastAPI()
    app.include_router(spline_router, prefix="/spline")
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# (a) Golden values
# ---------------------------------------------------------------------------

def test_spline_unsafe_case_hand_calc():
    # Geometry: D = Z/P = 8/0.19 = 42.105 mm ; module = 1/0.19 = 5.263 ; h = (44.8−39)/2 = 2.9 mm
    #   r_m = (44.8 + 39)/4 = 20.95 mm ; A = Z·L·h = 8·40·2.9 = 928 mm²
    # Torque: W = 20 t → 196 200 N ; per wheel (4) = 49 050 N ; F_t = 0.3·49 050 = 14 715 N
    #   T = 14 715 · 0.4 m = 5 886 N·m
    # Stress: τ = 5 886 000 N·mm / (928 · 20.95) = 5 886 000 / 19 441.6 = 302.75 MPa
    #   allowable = 500/√3 = 288.675 MPa ; FOS = 0.9535 < 1.5 → UNSAFE
    #   capacity = 288.675·928·20.95/1000 = 5 612.3 N·m
    r = calculate_spline_mode(_d())
    assert r["pitch_diameter"] == pytest.approx(42.105, abs=1e-3)
    assert r["module"] == pytest.approx(5.263, abs=1e-3)
    assert r["tooth_height"] == pytest.approx(2.9)
    assert r["shear_area"] == pytest.approx(928.0)
    assert r["tangential_force_n"] == pytest.approx(14715.0)
    assert r["torque_required_nm"] == pytest.approx(5886.0)
    assert r["shear_stress"] == pytest.approx(302.75, abs=0.01)
    assert r["allowable_shear"] == pytest.approx(288.675, abs=1e-3)
    assert r["safety_factor"] == pytest.approx(0.9535, abs=1e-4)
    assert r["torque_capacity"] == pytest.approx(5612.3, abs=0.1)
    assert r["verdict"] == "UNSAFE"


def test_spline_safe_case_hand_calc():
    # W = 5 t: F_t = 5·9810/4·0.3 = 3 678.75 N ; T = 1 471.5 N·m
    #   τ = 1 471 500 / 19 441.6 = 75.69 MPa ; FOS = 288.675/75.69 = 3.814 ≥ 1.5 → SAFE
    r = calculate_spline_mode(_d(loco_weight="5"))
    assert r["torque_required_nm"] == pytest.approx(1471.5)
    assert r["shear_stress"] == pytest.approx(75.69, abs=0.01)
    assert r["safety_factor"] == pytest.approx(3.814, abs=1e-3)
    assert r["verdict"] == "SAFE"


def test_spline_informational_resistance_hand_calc():
    # IR resistance, 20 t, 2 axles, 20 km/h: (1.964 + 0.1866 + 1.14)·20·9.81 = 645.62 N
    #   starting = 6·20·9.81 = 1 177.2 N ; total = 1 822.82 N
    #   working torque per wheel = 1 822.82·0.4/4 = 182.28 N·m
    r = calculate_spline_mode(_d())
    assert r["rolling_resistance_n"] == pytest.approx(645.62, abs=0.01)
    assert r["starting_resistance_n"] == pytest.approx(1177.2)
    assert r["working_torque_wheel"] == pytest.approx(182.28, abs=0.01)


def test_spline_route_returns_json(sclient):
    res = sclient.post("/spline/calculate", json=_d())
    assert res.status_code == 200
    assert res.json()["verdict"] == "UNSAFE"


# ---------------------------------------------------------------------------
# (b) Discrepancies
# ---------------------------------------------------------------------------

@pytest.mark.xfail(
    reason="DISCREPANCY: /spline/calculate has no error wrapper, a non-numeric field is a bare 500, needs "
           "engineering confirmation — backend/app/modules/rnd/tools/spline/api.py:43",
    strict=True, raises=AssertionError,
)
def test_bad_numeric_input_is_a_400_with_reason(sclient):
    res = sclient.post("/spline/calculate", json=_d(number_teeth="abc"))
    assert res.status_code == 400
    assert "number_teeth" in res.json().get("detail", "") or "teeth" in res.json().get("detail", "").lower()


@pytest.mark.xfail(
    reason="DISCREPANCY: zero shear stress gives FOS = inf, which cannot be JSON-encoded (500), needs "
           "engineering confirmation — backend/app/modules/rnd/tools/spline/core.py:74",
    strict=True, raises=AssertionError,
)
def test_zero_stress_does_not_crash_the_response(sclient):
    # μ = 0 → F_t = 0 → τ = 0 → FOS = allowable/0. Expected: a valid JSON answer
    # (e.g. FOS reported as not applicable) or a 400 with a reason — never a 500.
    res = sclient.post("/spline/calculate", json=_d(friction_coeff="0"))
    assert res.status_code in (200, 400), res.status_code


def test_zero_stress_core_returns_inf_today():
    # Documents the root cause of the xfail above.
    assert math.isinf(calculate_spline_mode(_d(friction_coeff="0"))["safety_factor"])


@pytest.mark.xfail(
    reason="DISCREPANCY: 'diametral pitch' is really teeth per mm (1/module); a real ANSI DP gives a pitch "
           "diameter in inches beside mm, needs engineering confirmation — "
           "backend/app/modules/rnd/tools/spline/core.py:44",
    strict=True, raises=AssertionError,
)
def test_diametral_pitch_in_teeth_per_inch_gives_mm_pitch_diameter():
    # ANSI B92.1 16/32 DP, Z = 20: D = 20/16 = 1.25 in = 31.75 mm (code: 1.25 "mm")
    r = calculate_spline_mode(_d(number_teeth="20", diametral_pitch="16", outer_diameter="33.3",
                                 inner_diameter="29.5"))
    assert r["pitch_diameter"] == pytest.approx(31.75, abs=0.01)


@pytest.mark.xfail(
    reason="DISCREPANCY (new): shear_stress_wheel omits the N·m→N·mm ×1000 that numerator_shear includes, "
           "so it is 1000× too small, needs engineering confirmation — "
           "backend/app/modules/rnd/tools/spline/core.py:126",
    strict=True, raises=AssertionError,
)
def test_shear_stress_wheel_units_match_its_reported_working():
    # τ_wheel = 2·T_work·1000 / (D·L·Z·h) = 2·182.28·1000 / (42.105·40·8·2.9)
    #         = 364 560 / 39 073.7 = 9.33 MPa   (code: 0.00933)
    r = calculate_spline_mode(_d())
    assert r["shear_stress_wheel"] == pytest.approx(r["numerator_shear"] / r["denominator_shear"])
    assert r["shear_stress_wheel"] == pytest.approx(9.33, abs=0.01)
