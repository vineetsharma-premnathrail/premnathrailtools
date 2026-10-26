# Procurement tabs: same list layout as the Service Request Registry

Owner request (2026-10-26): "do the same in Purchase Requisition, and every tab in Procurement" (same as the Service Request Registry screen).
Size: L. Frontend only, no backend, no migration.

## The reference screens (read them first, copy their structure and styles)
- `frontend/src/app/dashboard/erp/service-requests/page.tsx` (the model).
- `frontend/src/app/dashboard/erp/projects/page.tsx` (same pattern, more columns).
- Shared pieces: `StatChip`, `RowCount`, `secondaryBtnStyle`, `inputStyle` in `frontend/src/components/shared/ui.tsx`; `FormSheet`, `SheetIcon`, `SHEET`, `sheetBtn`, `sheetInput`, `sheetLabel` in `frontend/src/components/shared/FormSheet.tsx`; `Funnel` from `@phosphor-icons/react`; TableFit (`frontend/src/components/shared/TableFit.tsx`, read its header comment).

## The layout (every Procurement list tab)
1. Title row: page title only (no subtitle line), left.
2. Under the title: a row of small `StatChip` counters with real numbers for that tab (for example total, and the main statuses; max 4; colours like the reference). Counters follow the active filters. Keep a `data-tour` id on the chip row.
3. One toolbar row below: the primary create button on the LEFT (same orange as the Service button: `background: '#ea580c', border: '1px solid #c2410c', color: '#fff', fontSize: 13.5, fontWeight: 600, padding: '10px 14px', borderRadius: 10`), and on the RIGHT (`marginLeft: 'auto'` group): the search box (width 280), a **Filters** icon button (funnel icon, count badge of active filters, accent `#ea580c` when active), a **Clear** button only while filters are active, then Export and Import where the tab has them today (keep their permission checks and dialogs unchanged). A tab that has no create button keeps the left side empty.
4. Filters: every dropdown / checkbox filter of the tab moves into a **Filters popup** (`FormSheet`, `width={560}`, `busy={false}`, icon `search`, title "Filters", footer "Clear Filters" (`sheetBtn('secondary', SHEET.INK)`) and "Apply Filters" (`sheetBtn('primary', SHEET.BLUE)` with a check `SheetIcon`)). The popup edits a draft; Apply copies the draft into the live filters and closes; opening the popup starts from the live filters. Search stays outside the popup and applies as you type. Selects in the popup use the shared `Select` with `style={sheetInput}`, labels `sheetLabel`. Keep existing `data-tour` ids on the moved controls and add `data-tour="<tab>-filter-btn"` on the Filters button.
5. Tables (TableFit rules, same as the reference):
   - No View / Edit buttons, no Actions column (the row click opens the record). Keep real actions (Approve, Reject, Receive, Start RFQ ...) exactly as they are, with `stopPropagation`.
   - Header cells: one line (`whiteSpace: 'nowrap'`), `padding: '10px 8px'`, add `data-fit-min={60}` on every header; free-text columns (client/vendor names, project, descriptions, remarks, addresses) also get `data-fit-cut=""`. Only those free-text columns may use two rows (cell `data-fit-clamp` with a `<div title={full text}>` inside) and be cut with "..."; everything else stays on one row at its full width.
   - Cell `padding: '10px 8px'` (no wide gaps), remove any `minWidth` on the `<table>`.
   - Text cut rule: one-row text longer than 25 characters is cut with "…" and the full text goes in `title`; two-row columns cut at 50. Use small `clip(v, max = 25)` / `clip2` helpers like `frontend/src/app/dashboard/erp/projects/page.tsx`. Do not clip document numbers (PR/PO/RFQ/GRN numbers), dates, amounts or statuses (statuses may be clipped at 25 only when text).
   - Keep `<RowCount count={...} />` inside the first header cell (the UI audit requires it; it is invisible on screen).
6. Counters, filters and the tab's data loading must keep working exactly as before (same API calls, same filtering rules). Do not change business logic.
7. Update the tab's guided-tour config in `frontend/src/lib/tour/configs/` (files `p2p*`, `procurement*`, `rfq*`, `po*`, `purchase*`) so steps match the new layout: counters step, one "Filters" step instead of one step per moved dropdown (list the options in it), search, create button, table. Never leave a step pointing at a control that is no longer on the page.

## Untouchable / shared
R&D calculators; `frontend/src/lib/api.ts`, `types/index.ts`, `hooks/useAuth.ts`, Sidebar, `dashboard/page.tsx`; `frontend/src/components/shared/ui.tsx`, `FormSheet.tsx`, `TableFit.tsx`, `globals.css` (Manager only: ask in your report if you need a change there); git; dev servers; backend.
`frontend/src/app/dashboard/p2p/page.tsx` already has the three role-controlled tabs (My / All / Approvals) built from `canFeature(...)`: keep that logic and the tab bar exactly as they are, only restyle title/toolbar/filters around it.

## Acceptance
- Each tab looks like the Service Request Registry: counters under the title, create button left, search + Filters + Export + Import right, filters in a popup with Apply, no sideways scroll, one-line headers, only free-text columns cut or on two rows.
- Same data and same filter results as before; Export/Import still work; Approve/Reject/Receive etc. unchanged.
- `npx tsc --noEmit` (ignore `.next/`) clean, `npm run test:ui` 0 errors, tours updated.

## Report format
Per tab: files changed, counters chosen, which filters moved into the popup, which columns are free-text (cut / two rows), what was kept as it was and why, anything you could not do. Say plainly that nothing was seen live.
