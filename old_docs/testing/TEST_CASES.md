# Test Cases — Premnathrail Portal

> Standalone catalog of individual test scenarios, distinct from [TESTING.md](TESTING.md) (strategy) and [TEST_REPORT_2026-08-27.md](TEST_REPORT_2026-08-27.md) (results). This catalog is generated from the actual test files in `backend/app/tests/` — it lists what's covered, not a hand-written spec written ahead of implementation.

## Coverage by Module (from `backend/app/tests/` file names)

| Test File | Module Covered | Scenario Count (approx, from last run) |
|---|---|---|
| `test_auth.py` | Auth (SSO/JWT) | — |
| `test_microsoft_oauth.py` | Microsoft OAuth flow | — |
| `test_users.py` | User/role/permission management | — (1 currently failing) |
| `test_crm.py` | CRM core | — (1 currently failing) |
| `test_crm_activities.py` | CRM Activities | — |
| `test_crm_activity_attachments.py` | CRM Activity attachments | — |
| `test_crm_documents.py` | CRM Documents | — |
| `test_erp_projects.py` | ERP Projects | — |
| `test_erp_service_requests.py` | ERP Service Requests | — |
| `test_purchase_requisitions.py` | Purchase (SR-linked) | — |
| `test_p2p_requests.py` | Purchase Requisition (standalone) | 43 scenarios — **currently 43/43 failing**, see Test Report |
| `test_rnd.py` | R&D calculators | — |
| `test_rnd_latex_escaping.py` | R&D report generation (LaTeX escaping) | — |
| `test_rnd_tool_snapshots.py` | R&D calculator snapshot tests | — |
| `test_audit_logs.py` | Audit trail | — (1 currently failing) |
| `test_notifications.py` | Notifications | — |
| `test_feedback.py` | Feedback inbox | — |
| `test_followup_reminders.py` | Follow-up reminders | — |
| `test_presence.py` | Presence indicator | — |
| `test_security_middleware.py` | OWASP middleware (all 10 categories) | — |

*(Exact per-file scenario counts weren't captured in the summary run — re-run `pytest app/tests -v` and paste counts here if a precise breakdown is needed.)*

## Representative Test Case: P2P Request Creation

Since this is the module with active failures, one example in full detail:

| Field | Value |
|---|---|
| **ID** | TC-P2P-001 |
| **Name** | `test_create_success_auto_fills_and_generates_p2p_number` |
| **Module** | P2P (standalone Purchase Requisition) |
| **Preconditions** | Authenticated user with `p2p` app access |
| **Steps** | `POST /api/v1/p2p/requests` with category + line items |
| **Expected** | 201, response includes generated `p2p_number` starting with category prefix (e.g. `P2P-HYD-`) |
| **Actual (2026-08-27)** | **400** — request rejected before a `p2p_number` is ever generated |
| **Status** | ❌ **FAILING** — see [Test Report](TEST_REPORT_2026-08-27.md) root cause |

## Gaps in Coverage (Not Found in `backend/app/tests/`)

- No frontend/E2E test files found in this pass — confirm whether frontend tests exist elsewhere (`frontend/` was not searched for a test runner config)
- No dedicated load/performance test file
- No test file for `design`, `electrical`, `store`, `vendor`, `service`, `hr` modules (these exist on disk per [LLD.md](../architecture/LLD.md) §2 but have no corresponding `test_*.py`)

---
*Last updated: 2026-08-27. Regenerate this table whenever test files are added/removed — treat file names as the source of truth for "what's covered."*
