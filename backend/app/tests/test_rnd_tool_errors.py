"""R&D calculators: a wrong input is the user's fault (HTTP 400 with a
readable reason), not a server crash (500), and an unexpected failure must
not leak internal exception text to the user.

The endpoint functions are called directly — they are plain async functions
with no auth/DB dependencies, so no app client is needed.
"""
import asyncio

import pytest
from fastapi import HTTPException

from app.modules.rnd.tools.braking import api as braking_api
from app.modules.rnd.tools.braking.schemas import BrakingInput
from app.modules.rnd.tools.qmax import api as qmax_api
from app.modules.rnd.tools.qmax.schemas import QmaxInput


def _run(coro):
    return asyncio.run(coro)


def test_qmax_bad_diameter_returns_400_with_reason():
    raw = QmaxInput(d="-5", sigma_b_selection="880", sigma_b_custom="", v_head="1.5")
    with pytest.raises(HTTPException) as exc:
        _run(qmax_api.calculate(raw))
    assert exc.value.status_code == 400
    assert "diameter" in exc.value.detail.lower()
    assert "correct the highlighted input" in exc.value.detail


def test_qmax_non_numeric_input_returns_400():
    raw = QmaxInput(d="abc", sigma_b_selection="880", sigma_b_custom="", v_head="1.5")
    with pytest.raises(HTTPException) as exc:
        _run(qmax_api.download_report(raw))
    assert exc.value.status_code == 400


def test_braking_zero_mass_returns_400_with_reason():
    raw = BrakingInput(
        mass_kg=0, reaction_time=1, num_wheels=4, calc_mode="Rail",
        rail_speed_input="10", rail_gradient_input="0", rail_gradient_type="1 in G",
    )
    with pytest.raises(HTTPException) as exc:
        _run(braking_api.calculate_braking(raw))
    assert exc.value.status_code == 400
    assert "mass" in exc.value.detail.lower()


def test_unexpected_failure_returns_500_without_leaking(monkeypatch):
    def boom(*_a, **_k):
        raise RuntimeError("secret internal path /app/.env")

    monkeypatch.setattr(qmax_api, "perform_qmax_calculation", boom)
    raw = QmaxInput(d="900", sigma_b_selection="880", sigma_b_custom="", v_head="1.5")
    with pytest.raises(HTTPException) as exc:
        _run(qmax_api.calculate(raw))
    assert exc.value.status_code == 500
    assert "secret" not in exc.value.detail
    assert "R&D tool owner" in exc.value.detail
