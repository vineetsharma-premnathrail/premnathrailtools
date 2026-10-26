# Row click opens the record: no View / Edit buttons, no Actions column

Owner request (2026-10-26): "not need view button or edit button, or actions column in every table. User can open by clicking on the row and view."
Size: L (about 78 files, many modules). Frontend only, no backend, no migration.

## Rule
1. A list table opens its record when the user clicks the row. The row has `cursor: pointer` and an `onClick` that navigates to the same target the "View" link used (keep `recordPath(...)` / signed refs, never raw ids).
2. Remove the `View` and `Edit` link/button from list tables, and remove the whole `Actions` column (header, cells, `colSpan`s) when nothing else is left in it.
3. Edit is reached from the record's own page (it already has Edit there). Before removing a table's `Edit`, check that the detail page offers Edit. If it does not, KEEP the Edit and report it.
4. Keep every other real action (Delete, Approve, Reject, Cancel, Download, Receive, Convert, Assign ...). If a column holds such an action next to View/Edit, remove only View/Edit and keep the column and the other actions, with `onClick={(e) => e.stopPropagation()}` so they do not trigger the row click.
5. Interactive things inside a row (links, buttons, checkboxes, selects) must call `e.stopPropagation()` so they do not trigger the row click.
6. Make the row keyboard reachable only if the page already has an established pattern for it; otherwise match the existing row-click pattern in the same file (many tables, e.g. `frontend/src/app/dashboard/erp/projects/page.tsx`, already use `onClick` + `cursor: 'pointer'` rows).
7. Not a list table = out of scope: do not touch View/Edit buttons that open a dialog on a record page, file/attachment "View" links, document previews, settings/master-data rows where "Edit" opens an inline editor or popup and the row itself has no detail page (masters such as HR masters, store settings, finance masters, CRM masters): in those, keep Edit unless the row click can open the same editor; if you change one, say so in the report.
8. A table that has no detail page (nothing for the row to open): leave its buttons and report it.
9. Update any guided-tour config of the page that mentions the View/Edit/Actions buttons or targets them (`data-tour` ids of removed buttons or `Actions` columns) so the tour never points at something that no longer exists. Tour configs live in `frontend/src/lib/tour/configs/`. Write plain text that says "click a row to open it".
10. Remove imports, variables and permission checks that become unused (for example `canEdit` only used by the removed Edit link). Do not leave unused code.
11. Do not change anything else: no restyling, no new features, no text changes other than the tour text above.

## Untouchable
R&D calculator pages and tools: `frontend/src/app/dashboard/rnd/{braking,qmax,tractive-effort,load-distribution,spline,vehicle-performance,hydraulic,history}` and `components/rnd/ToolCalculatorPage.tsx`, `toolStyles.ts`. Do not edit them even for this.
Already done this session, do not touch: `frontend/src/app/dashboard/erp/projects/page.tsx`, `frontend/src/app/dashboard/erp/service-requests/page.tsx`.
Shared registries (Manager only): `frontend/src/lib/api.ts`, `types/index.ts`, `hooks/useAuth.ts`, Sidebar, `dashboard/page.tsx`.

## Acceptance
- In every touched list table: clicking the row opens the record (same URL as the removed View link); no View/Edit buttons; no empty Actions column; no empty header cell.
- Other actions still work and do not trigger the row click.
- `npx tsc --noEmit` has no new errors (ignore anything under `.next/`); `npm run test:ui` stays at 0 errors.
- Tours do not mention or target removed buttons.

## Report format
Per file: table name, what was removed, how the row opens the record, anything kept and why. List separately every table where View/Edit was KEPT (with the reason) and any table where the row had no way to open a record.
