# Findings — GRN quality-check flag (2026-11-03)

| # | Sev | Raised by | Finding | Status |
|---|---|---|---|---|
| 1 | High | reviewer | 29 GRN tests on the old flow failed | Fixed — qa-agent updated 13 test files + new test_grn_quality_check_flag.py (8 tests); 191 passed |
| 2 | Medium | security | Quality-check flag editable by any Items › Edit holder with no audit → QC bypass possible | Partly fixed: every flip now writes AuditLog `quality_flag_changed` (who / old / new). Server-side gating of the flag to a Quality role is NOT built — owner decision pending |
| 3 | Low | security | Auto-completed GRN showed "Inspected by <receiver>" though nobody inspected | Fixed — inspected_by stays empty; screen says "Completed on receipt — no quality check needed" |
| 4 | Low | security | Audit log did not say the GRN completed without a check | Fixed — `grn_completed_on_receipt` audit row |
| 5 | Medium | reviewer | Stale wording (storeGrnForm tour, GRN list subtitle, storeGrnDetail tour) | Fixed |
| 6 | Low | reviewer | Leftover "Inspection" wording (service_entries error, stock page hint, storeStock tour, event label, 2 fallback errors) | Fixed |
| 7 | Low | reviewer | Serial history shows "in Quality stock until inspected" then immediate in_stock on unflagged lines | Open — cosmetic |
| — | — | reviewer | Live screens NOT seen (no Playwright in this session) | Open — owner to check |
