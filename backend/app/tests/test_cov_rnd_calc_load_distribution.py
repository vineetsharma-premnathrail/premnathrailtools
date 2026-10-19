"""R&D calculator verification pack: Load distribution (tools/load_distribution).

Reference: docs/02-modules/rnd/overview.md §8.4 and §14 row 1.
Golden values hand-computed from F = W·f, Q1 = F·q1, …, ΔQ/Q against the
backend limit. The 25 % (screen) vs 60/50 % (backend) conflict and the Axle →
Truck fall-through are pinned with xfail(strict=True, raises=AssertionError).
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.rnd.tools.load_distribution.api import router as ld_router
from app.modules.rnd.tools.load_distribution.constants import BOGIE_DELTA_Q_LIMIT, TRUCK_DELTA_Q_LIMIT
from app.modules.rnd.tools.load_distribution.core import perform_load_distribution_calculation

SCREEN_LIMIT = 0.25  # frontend/src/app/dashboard/rnd/load-distribution/page.tsx:31-32,284,290


@pytest.fixture()
def ldclient():
    app = FastAPI()
    app.include_router(ld_router, prefix="/ld")
    return TestClient(app, raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# (a) Golden values
# ---------------------------------------------------------------------------

def test_symmetric_bogie_hand_calc():
    # 40 t, 50 % front, 50/50 left-right → every wheel 10 t, ΔQ = 0 → PASS
    r = perform_load_distribution_calculation("Bogie", 40, 50, 50, 50)
    assert r["q_values"] == {"Q1": 10, "Q2": 10, "Q3": 10, "Q4": 10}
    assert r["delta_q_by_q"] == 0
    assert r["status"] == "success"


def test_asymmetric_bogie_hand_calc():
    # 40 t, front 60 %, q1 40 %, q3 50 %
    #   F = 24 t, R = 16 t
    #   Q1 = 24·0.40 = 9.6 ; Q2 = 14.4 ; Q3 = 16·0.50 = 8.0 ; Q4 = 8.0
    #   QL = 8.0 (Q3, first minimum) ; F ≥ R → Q = (9.6 + 14.4)/2 = 12.0
    #   ΔQ = 4.0 t ; ΔQ/Q = 0.3333 ≤ 0.60 (Bogie) → PASS
    r = perform_load_distribution_calculation("Bogie", 40, 60, 40, 50)
    assert r["front_load"] == pytest.approx(24.0)
    assert r["rear_load"] == pytest.approx(16.0)
    assert r["q_values"]["Q1"] == pytest.approx(9.6)
    assert r["q_values"]["Q2"] == pytest.approx(14.4)
    assert r["ql_name"] == "Q3" and r["ql_value"] == pytest.approx(8.0)
    assert r["q_value"] == pytest.approx(12.0)
    assert r["delta_q"] == pytest.approx(4.0)
    assert r["delta_q_by_q"] == pytest.approx(1 / 3)
    assert r["limit"] == BOGIE_DELTA_Q_LIMIT == 0.6
    assert r["status"] == "success"


def test_axle_ratio_060_documented_backend_verdicts():
    # 20 t, front 50 %, q1 20 %, q3 50 %
    #   F = R = 10 t ; Q1 = 2, Q2 = 8, Q3 = 5, Q4 = 5 ; Q = (2 + 8)/2 = 5 ; QL = 2
    #   ΔQ = 3 ; ΔQ/Q = 0.60
    #   Bogie (≤ 0.60) → PASS ; Axle (falls through to 0.50) → FAIL — documented current behaviour
    bogie = perform_load_distribution_calculation("Bogie", 20, 50, 20, 50)
    axle = perform_load_distribution_calculation("Axle", 20, 50, 20, 50)
    assert bogie["delta_q_by_q"] == pytest.approx(0.6)
    assert bogie["status"] == "success"
    assert axle["limit"] == TRUCK_DELTA_Q_LIMIT == 0.5
    assert axle["status"] == "fail"


def test_rear_heavier_uses_rear_axle_average():
    # 30 t, front 40 % → F 12, R 18 ; q1 50 → Q1 = Q2 = 6 ; q3 30 → Q3 = 5.4, Q4 = 12.6
    #   R > F → Q = (5.4 + 12.6)/2 = 9.0 ; QL = 5.4 ; ΔQ/Q = 3.6/9 = 0.40
    r = perform_load_distribution_calculation("Bogie", 30, 40, 50, 30)
    assert r["q_formula_str"] == "(Q3 + Q4) / 2"
    assert r["q_value"] == pytest.approx(9.0)
    assert r["delta_q_by_q"] == pytest.approx(0.40)


# ---------------------------------------------------------------------------
# (b) Discrepancies
# ---------------------------------------------------------------------------

@pytest.mark.xfail(
    reason="DISCREPANCY: screen states ΔQ/Q limit 25 % but backend passes up to 60 % (Bogie), needs "
           "engineering confirmation — backend/app/modules/rnd/tools/load_distribution/constants.py:5 vs "
           "frontend/src/app/dashboard/rnd/load-distribution/page.tsx:31",
    strict=True, raises=AssertionError,
)
def test_bogie_33pct_unloading_fails_the_stated_25pct_limit(ldclient):
    # ΔQ/Q = 33.3 % (asymmetric case above) — the page tells the user the limit is 25 %.
    res = ldclient.post("/ld/calculate", json={"config_type": "Bogie", "total_load": 40,
                                               "front_percent": 60, "q1_percent": 40, "q3_percent": 50})
    body = res.json()["results"]
    assert body["limit"] == pytest.approx(SCREEN_LIMIT)
    assert body["status"] == "fail"


@pytest.mark.xfail(
    reason="DISCREPANCY: Axle has no limit of its own and falls through to the Truck limit (50 %), needs "
           "engineering confirmation — backend/app/modules/rnd/tools/load_distribution/core.py:51",
    strict=True, raises=AssertionError,
)
def test_axle_uses_its_own_stated_limit_not_the_truck_limit():
    # The page says Axle: ΔQ/Q ≤ 25 %. Today Axle silently gets TRUCK_DELTA_Q_LIMIT (0.50).
    from app.modules.rnd.tools.load_distribution import constants

    axle = perform_load_distribution_calculation("Axle", 20, 50, 40, 50)  # ΔQ/Q = 0.20
    assert hasattr(constants, "AXLE_DELTA_Q_LIMIT"), "Axle has no limit constant of its own"
    assert axle["limit"] == pytest.approx(SCREEN_LIMIT)
