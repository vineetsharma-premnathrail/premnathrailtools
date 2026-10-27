# Final report - CRM Reports

**Status:** built and tested locally; not committed, not pushed; not seen live in the browser.

## Files
- New: backend/app/modules/crm/reporting.py, backend/app/tests/test_crm_reports.py, frontend/src/app/dashboard/crm/reports/page.tsx, frontend/src/lib/tour/configs/crmReports.ts
- Changed: backend/app/core/reporting/providers.py, backend/app/core/features/crm.py, backend/app/core/permission_registry.py (one line in the crm block only; the rest of that file's diff is another session's), frontend/src/components/crm/CrmNav.tsx, frontend/src/lib/tour/modules/crm.ts, frontend/src/lib/tour/configs/crmDashboard.ts

## Checks
- pytest: test_crm_reports (3), crm_quotations, reporting framework/dashboards, erp service reports, roles_permissions: all passed.
- ruff F821 py312 clean; tsc: no errors in src (only stale .next dev types); test:ui: 4 errors, none in this change's files.

## Review (reviewer-agent) and outcome
- Medium: a role with only CRM › Reports sees the lead list without Inquiries & Tenders view (scope still applies). Kept on purpose: same as Service › Reports; Reports is a management right.
- Low, fixed: lead pages and filter lookups no longer read every quotation (one count query).
- Low, fixed: won/lost leads with no close time use their last change date (definition added).
- Low, kept: owner column in the record list has no people flag (framework columns have none); scope still applies and the Inquiries list shows owners anyway.
