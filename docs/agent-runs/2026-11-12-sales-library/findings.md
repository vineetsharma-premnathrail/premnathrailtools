# Sales Library — findings (review wave 1) and outcome

| # | Sev | Source | Finding | Outcome |
|---|---|---|---|---|
| S-H1 | High | security | Client-supplied MIME stored and served inline → stored XSS via blob/iframe | Fixed: server MIME from extension, risky types refused, inline only pdf/raster/video, nosniff; preview re-types blob, PDF via `<object>` |
| R-H1 | High | reviewer | New version of expired/undated pricing doc impossible from UI | Fixed: expiry field in version mode, pre-check before bytes upload, backend test |
| S-M1 | Medium | security | 403 messages named confidential docs/folders | Fixed: neutral 404 for hidden and missing alike |
| S-M2/R-M3 | Medium | both | Pickers returned every org/project/product | Fixed: search + limit, org data scope applied (note: Organization is registered shared, so scope is a no-op today — same as CRM itself) |
| R-M1 | Medium | reviewer | Pricing via ancestor folder not recognised in UI | Fixed: ancestor walk helpers |
| R-M2 | Medium | reviewer | `?product=` lost when a document is opened | Fixed |
| R-M4 | Medium | reviewer | main.py / permission_registry.py carry other sessions' hunks | Release: stage our hunks only |
| S-L1..L6, R-L1..L7 | Low | both | share info leak, hidden-name 409, un-confidential not audited, upload name binding, preview memory, stale list, IntegrityError race, Hindi tags, seeded folders deletable, confidential switch shown to all | Fixed (audit via register_audited for folders/files; seeded folders admin-only). Not fixed: S-L5 raw Graph text in shared `utils/sharepoint.py` (other session's file) |

Out of scope, flagged for owner: `crm/routes/documents.py` has the same stored-MIME/inline pattern as S-H1 (existing CRM inquiry/tender documents).
Global `/api/` CSP middleware overrides the route's `sandbox` CSP with `default-src 'none'` (still blocks scripts).

Checks after fix round: pytest 86 passed (library + CRM docs/upload + permission/notification/audit suites); ruff F821 py312 clean; alembic single head c9e4a7d1f3b8; tsc clean; test:ui 0 errors.
Live browser check: NOT RUN yet (servers down, owner login needed).
