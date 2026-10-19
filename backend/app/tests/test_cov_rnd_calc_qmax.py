"""R&D calculator verification pack: Qmax (tools/qmax).

Reference: docs/02-modules/rnd/overview.md §8.3 and §14 row 7.
Golden values hand-computed from Qmax = C·(d/2)·(σB/v)², C = 8.257e-7.
Discrepancies pinned with xfail(strict=True, raises=AssertionError).
Routes are exercised on a minimal FastAPI app holding only the qmax router
(no auth/DB), which is how the router behaves once mounted.
"""
import math

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.rnd.tools.qmax.api import router as qmax_router
from app.modules.rnd.tools.qmax.core import calculate_qmax
from app.modules.rnd.tools.qmax.schemas import QmaxInput
from app.modules.rnd.tools.qmax.validation import validate_qmax_inputs


@pytest.fixture()
def qclient():
    app = FastAPI()
    app.include_router(qmax_router, prefix="/qmax")
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# (a) Golden values
# ---------------------------------------------------------------------------

def test_qmax_880_grade_hand_calc():
    # d = 1000 mm, σB = 880 N/mm², v = 1.1
    #   (σB/v)² = 800² = 640 000 ; d/2 = 500 mm
    #   Qmax = 8.257e-7 · 500 · 640 000 = 264.224 kN ; /9.80665 = 26.943 t
    r = calculate_qmax(1000, 880, 1.1)
    assert r["qmax_kn"] == pytest.approx(264.224, abs=1e-3)
    assert r["qmax_tonnes"] == pytest.approx(26.943, abs=1e-3)


def test_qmax_680_grade_hand_calc():
    # d = 920 mm, σB = 680 N/mm², v = 1.0
    #   680² = 462 400 ; d/2 = 460 ; Qmax = 8.257e-7 · 460 · 462 400 = 175.630 kN = 17.909 t
    r = calculate_qmax(920, 680, 1.0)
    assert r["qmax_kn"] == pytest.approx(175.630, abs=1e-3)
    assert r["qmax_tonnes"] == pytest.approx(17.909, abs=1e-3)


def test_qmax_route_custom_sigma(qclient):
    # Custom σB = 1000, v = 1.25, d = 800 → (800)² = 640 000 ; 8.257e-7·400·640 000 = 211.379 kN
    res = qclient.post("/qmax/calculate", json={"d": "800", "sigma_b_selection": "Custom",
                                                  "sigma_b_custom": "1000", "v_head": "1.25"})
    assert res.status_code == 200
    assert res.json()["results"]["qmax_kn"] == pytest.approx(211.379, abs=1e-3)


def test_qmax_grade_label_variants_parse_to_same_value():
    a, _ = validate_qmax_inputs(QmaxInput(d="1000", sigma_b_selection="880", sigma_b_custom="", v_head="1.1"))
    b, _ = validate_qmax_inputs(QmaxInput(d="1000", sigma_b_selection="880 N/mm²", sigma_b_custom="", v_head="1.1"))
    assert a["sigma_b"] == b["sigma_b"] == 880


# ---------------------------------------------------------------------------
# (b) Discrepancies
# ---------------------------------------------------------------------------

@pytest.mark.xfail(
    reason="DISCREPANCY: e_param (d_eff = √(d·e)) is browser-only, so server/DOCX Qmax differs from the "
           "screen, needs engineering confirmation — backend/app/modules/rnd/tools/qmax/schemas.py:5 vs "
           "frontend/src/app/dashboard/rnd/qmax/page.tsx:110",
    strict=True, raises=AssertionError,
)
def test_server_applies_e_param_like_the_screen(qclient):
    # Screen: d = 1000, e = 800 → d_eff = √800 000 = 894.43 mm
    #   Qmax = 8.257e-7 · 447.21 · 640 000 = 236.33 kN   (server today: 264.22 kN)
    res = qclient.post("/qmax/calculate", json={"d": "1000", "sigma_b_selection": "880",
                                                  "sigma_b_custom": "", "v_head": "1.1", "e_param": "800"})
    assert res.status_code == 200
    assert res.json()["results"]["qmax_kn"] == pytest.approx(264.224 * math.sqrt(0.8), abs=0.01)


@pytest.mark.xfail(
    reason="DISCREPANCY: Q_applied compliance and margin are browser-only (not in server result or DOCX), "
           "needs engineering confirmation — backend/app/modules/rnd/tools/qmax/schemas.py:5 vs "
           "frontend/src/app/dashboard/rnd/qmax/page.tsx:170",
    strict=True, raises=AssertionError,
)
def test_server_returns_compliance_for_applied_load(qclient):
    res = qclient.post("/qmax/calculate", json={"d": "1000", "sigma_b_selection": "880",
                                                  "sigma_b_custom": "", "v_head": "1.1", "q_applied": "300"})
    results = res.json()["results"]
    # 300 kN > 264.22 kN → should be reported as not compliant
    assert any(k in results for k in ("compliant", "compliance", "margin_percent"))


@pytest.mark.xfail(
    reason="DISCREPANCY (new): sigma_b_selection='Custom' with a blank custom value silently uses 880 N/mm², "
           "needs engineering confirmation — backend/app/modules/rnd/tools/qmax/validation.py:22,42",
    strict=True, raises=AssertionError,
)
def test_custom_grade_without_value_is_rejected():
    raised = False
    try:
        inputs, _ = validate_qmax_inputs(QmaxInput(d="1000", sigma_b_selection="Custom",
                                                   sigma_b_custom="", v_head="1.1"))
    except ValueError:
        raised = True
    assert raised, f"blank custom σB silently became {inputs['sigma_b']} N/mm²"
