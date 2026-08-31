# Test Report — 2026-08-27

> Records testing results and discovered issues. This is a **live, generated report** from an actual `pytest` run against the current working tree — not aspirational. Re-run and file a new dated report whenever you want a fresh snapshot; don't edit this one after the fact.

## Run Details

- **Command**: `pytest app/tests -q` (from `backend/`)
- **Suite**: `backend/app/tests/` (19 test files)
- **Result**: **213 passed, 46 failed**, 2164 warnings, 34.67s

## Failure Summary

| Test File | Failures | Notes |
|---|---|---|
| `test_p2p_requests.py` | 43 | Almost the entire file — see root cause below |
| `test_users.py` | 1 | `test_admin_gets_all_apps_regardless_of_assignment` |
| `test_crm.py` | 1 | 1 failure (name not captured in summary grep) |
| `test_audit_logs.py` | 1 | 1 failure (name not captured in summary grep) |

## Root Cause — `test_p2p_requests.py` (43 failures)

Representative failure (`test_create_success_auto_fills_and_generates_p2p_number`):

```
assert pr["p2p_number"].startswith("P2P-HYD-")
KeyError: 'p2p_number'
```

The `POST /api/v1/p2p/requests` call itself is returning **HTTP 400** (visible in the captured log: `[A09] 400 | ... path=/api/v1/p2p/requests`), so the response body never contains a `p2p_number` key at all — the test's assertion is just the visible symptom, not the actual defect. Every other P2P test in the file fails the same way (`KeyError: 'id'` on a PR that was never successfully created in `setup`/fixtures), confirming this is **one systemic issue**, not 43 independent bugs.

This is either:
1. A real regression in `p2p/routes/p2p_requests.py` or its schema validation (something now rejects a request the tests construct), or
2. A test fixture/schema drift — the test payload no longer matches what the endpoint expects.

**Not yet root-caused past this point** — needs a developer to run the single failing test with full request/response logging and inspect the 400 body's actual validation error.

## Other Failures (Not Yet Investigated)

- `test_users.py::test_admin_gets_all_apps_regardless_of_assignment`
- One failure each in `test_crm.py` and `test_audit_logs.py`

These were not deep-dived in this pass — flagged for follow-up.

## Action Items

| Priority | Item | Owner |
|---|---|---|
| P0 | Root-cause the P2P `POST /requests` 400 — blocks 43/213 tests and likely indicates a real functional break in the standalone Purchase Requisition module | ⚠️ unassigned |
| P1 | Investigate `test_users.py` failure | ⚠️ unassigned |
| P1 | Investigate `test_crm.py` and `test_audit_logs.py` failures | ⚠️ unassigned |
| P2 | Suite has 2164 warnings, mostly `datetime.utcnow()` deprecation and FastAPI `on_event` deprecation — not failing tests today but will break on a future FastAPI/Python upgrade | ⚠️ unassigned |

## Relation to Other Docs

- Log this as a Bug/Issue in [BUG_TRACKING.md](BUG_TRACKING.md) once triaged
- If confirmed a real regression, it may warrant a [Risk Register](../product/RISK_REGISTER.md) entry given the P2P module's central role (R-02 already flags P2P/Purchase convergence risk)
- No frontend test run was performed in this pass — this report covers backend only

---
*This is a point-in-time snapshot (2026-08-27). Do not update this file — generate a new dated report for the next run so history is preserved (see [TESTING.md](TESTING.md) for the overall test strategy this report measures against).*
