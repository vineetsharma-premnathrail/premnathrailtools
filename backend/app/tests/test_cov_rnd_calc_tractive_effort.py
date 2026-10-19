"""R&D calculator verification pack: Tractive effort (tools/tractive_effort).

Reference: docs/02-modules/rnd/overview.md §8.5 and §14 row 8.
Golden values hand-computed (results in kgf, "kg"). Discrepancies pinned with
xfail(strict=True, raises=AssertionError).
"""
import io
import math

import pytest

from app.modules.rnd.tools.tractive_effort import constants as te_constants
from app.modules.rnd.tools.tractive_effort.core import perform_tractive_effort_calculation
from app.modules.rnd.tools.tractive_effort.service import perform_te_calculation


def _inp(**over):
    d = dict(load=1000.0, loco_weight=100.0, gradient=100.0, grad_type="1 in G",
             curvature=350.0, curvature_unit="Radius(m)", speed=20.0, mode="Start")
    d.update(over)
    return d


# ---------------------------------------------------------------------------
# (a) Golden values
# ---------------------------------------------------------------------------

def test_start_mode_hand_calc():
    # 1000 t trailing + 100 t loco ; 1 in 100 ; R = 350 m ; Start
    #   gradient = 1000/100 = 10 kg/t ; curve = 700/350 = 2 kg/t
    #   T1 = 1000·4.0 = 4000 ; T2 = 100·6.0 = 600 ; T3 = 1100·10 = 11 000 ; T4 = 1100·2 = 2200
    #   TE = 17 800 kg
    #   HP = 17 800·1/270 = 65.926 HP (V = 1 km/h in Start mode)
    #   I  = 65.926·735.5/(22 500·0.84·0.8) = 48 488.7/15 120 = 3.2069 A
    r = perform_tractive_effort_calculation(_inp())
    assert (r["T1"], r["T2"], r["T3"], r["T4"]) == pytest.approx((4000, 600, 11000, 2200))
    assert r["te"] == pytest.approx(17800)
    assert r["power"] == pytest.approx(65.926, abs=1e-3)
    assert r["ohe_current"] == pytest.approx(3.2069, abs=1e-4)


def test_running_mode_hand_calc():
    # Running, V = 50 km/h: T1 = 1000·1.3505 = 1350.5 ; T2 = 100·2.913 = 291.3
    #   TE = 1350.5 + 291.3 + 11 000 + 2200 = 14 841.8 kg
    #   HP = 14 841.8·50/270 = 2748.48 HP ; I = 2748.48·735.5/15 120 = 133.70 A
    r = perform_tractive_effort_calculation(_inp(mode="Running", speed=50.0))
    assert r["te"] == pytest.approx(14841.8, abs=0.01)
    assert r["power"] == pytest.approx(2748.48, abs=0.01)
    assert r["ohe_current"] == pytest.approx(133.70, abs=0.01)
    assert r["speed_for_power"] == 50.0


def test_degree_gradient_hand_calc():
    # 1° → tan(1°)·1000 = 17.4551 kg/t ; T3 = 1100·17.4551 = 19 200.6 kg
    r = perform_tractive_effort_calculation(_inp(gradient=1.0, grad_type="Degree", curvature=0.0))
    assert r["T3"] == pytest.approx(1100 * math.tan(math.radians(1)) * 1000, abs=1e-6)
    assert r["T3"] == pytest.approx(19200.6, abs=0.1)
    assert r["T4"] == 0


# ---------------------------------------------------------------------------
# (b) Discrepancies
# ---------------------------------------------------------------------------

def _docx_text(inputs):
    import docx

    from app.modules.rnd.tools.tractive_effort.reports.pdf_builder import create_te_docx_report

    results, _ = perform_te_calculation(inputs, inputs)
    stream = create_te_docx_report(inputs, results, inputs)
    return "\n".join(p.text for p in docx.Document(io.BytesIO(stream.getvalue())).paragraphs)


@pytest.mark.xfail(
    reason="DISCREPANCY: DOCX reads grad_rr_per_ton/curve_rr_per_ton that the core never returns, so "
           "its working prints 0.0000 kg/t, needs engineering confirmation — "
           "backend/app/modules/rnd/tools/tractive_effort/reports/pdf_builder.py:64,80",
    strict=True, raises=AssertionError,
)
def test_docx_working_shows_real_per_tonne_resistances():
    # Expected working: R_grad = 1000 / 100 = 10.0000 kg/t ; R_curve = 700 / 350 = 2.0000 kg/t
    text = _docx_text(_inp())
    assert "0.0000 kg/t" not in text.replace("10.0000 kg/t", "").replace("2.0000 kg/t", "")
    assert "10.0000 kg/t" in text
    assert "2.0000 kg/t" in text


@pytest.mark.xfail(
    reason="DISCREPANCY: curve resistance per degree is 1.0 kg/t/° (degree input) vs 0.4 kg/t/° "
           "(700/R with R = 1750/D, and other tools), needs engineering confirmation — "
           "backend/app/modules/rnd/tools/tractive_effort/core.py:25",
    strict=True, raises=AssertionError,
)
def test_curve_resistance_same_for_degree_and_equivalent_radius():
    # 2° curve ≡ R = 1750/2 = 875 m → 700/875 = 0.8 kg/t → T4 = 1100·0.8 = 880 kg
    by_radius = perform_tractive_effort_calculation(_inp(curvature=875.0, curvature_unit="Radius(m)"))
    by_degree = perform_tractive_effort_calculation(_inp(curvature=2.0, curvature_unit="Degree"))
    assert by_radius["T4"] == pytest.approx(880.0)
    assert by_degree["T4"] == pytest.approx(880.0)  # today 2200 kg (1.0 kg/t/°)


@pytest.mark.xfail(
    reason="DISCREPANCY: page labels current 'OHE Current (25kV)' but formula uses 22 500 V, needs "
           "engineering confirmation — backend/app/modules/rnd/tools/tractive_effort/constants.py:12 vs "
           "frontend/src/app/dashboard/rnd/tractive-effort/page.tsx:236",
    strict=True, raises=AssertionError,
)
def test_ohe_current_matches_the_25kv_label():
    # At 25 kV: I = 65.926·735.5/(25 000·0.84·0.8) = 48 488.7/16 800 = 2.8862 A (code: 3.2069 A @22.5 kV)
    assert te_constants.OHE_VOLTAGE == 25000
    r = perform_tractive_effort_calculation(_inp())
    assert r["ohe_current"] == pytest.approx(2.8862, abs=1e-4)


@pytest.mark.xfail(
    reason="DISCREPANCY: page says Running uses speed-dependent (Davis) resistance but coefficients are "
           "constants, needs engineering confirmation — backend/app/modules/rnd/tools/tractive_effort/core.py:33 "
           "vs frontend/src/app/dashboard/rnd/tractive-effort/page.tsx:177",
    strict=True, raises=AssertionError,
)
def test_running_resistance_depends_on_speed():
    slow = perform_tractive_effort_calculation(_inp(mode="Running", speed=20.0, gradient=0.0, curvature=0.0))
    fast = perform_tractive_effort_calculation(_inp(mode="Running", speed=80.0, gradient=0.0, curvature=0.0))
    assert fast["te"] > slow["te"]
