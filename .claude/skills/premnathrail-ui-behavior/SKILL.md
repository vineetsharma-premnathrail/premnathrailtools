---
name: premnathrail-ui-behavior
description: UI behavior conventions for the Premnathrail Portal frontend — how forms, date inputs, dropdowns/searchable-selects, multi-select chips, file uploads, permission-gated pages, error banners, and status badges are built. Load before adding or editing any form field, dropdown, date picker, file upload, or permission check on a dashboard page, so it matches the existing component behavior instead of a new one-off implementation.
---

# Premnathrail Portal — UI Behavior Patterns

Companion to [[premnathrail-app-design]] (structure). This one covers how interactive components actually behave.

## Date input — `frontend/src/components/erp/DateField.tsx`

Not a native `type="date"` input. A text `<input>` + calendar icon, with a portaled (`createPortal(..., document.body)`) calendar popup positioned via `getBoundingClientRect()`, re-measured on scroll/resize. The portal-to-`body` + fixed-position tracking exists because these forms live inside glass cards with `backdrop-filter`/`overflow` ancestors that would otherwise clip or defeat a normally-stacked popup.

- **Value contract**: `value`/`onChange` are ISO `yyyy-mm-dd` (matches backend Pydantic `date` fields). Displayed text and the calendar itself use `DD-MM-YYYY` (legacy-app convention).
- Internal `draft` state holds in-progress typed text so a partial date isn't clobbered by the value-derived re-render on every keystroke. Digits auto-format with dashes as typed; `commitIfValid` rejects invalid real dates (e.g. `31-02-2026`) and only calls `onChange` on a valid full date or a calendar-day click. Blur with an invalid draft snaps back to the last committed value.
- No extra props beyond `value`, `onChange`, `style` — don't add a mask/format prop, just use it as-is for any date field.

## Single-value dropdown — `frontend/src/components/erp/SearchableSelect.tsx`

Props: `{ value, onChange, options: {value,label}[], placeholder? }`. Fake "select" trigger div that toggles a portaled (same body-portal + fixed-position pattern as DateField) dropdown with an `autoFocus` search input and a filtered option list. Single-value only, no native multi-select.

Also takes `searchable` (default: search box only when > 8 options), `style` (outer box), `triggerStyle`, `autoFocus`, `id`/`name`/`title`/`ariaLabel`/`required`, and options may carry `disabled` / `group`. The list flips upward near the bottom of the screen, is clamped inside the viewport, supports ↑/↓/Enter/Esc, and the trigger (`role="combobox"`, class `ui-select-trigger`) keeps its value in `data-value` and fires a DOM `change` on pick — the guided tour relies on that.

**When to use which (rule, 2026-10-23; app-wide since 2026-10-24)**: no native `<select>` anywhere — `npm run test:ui` fails on one. Use:
- `Select` from `components/shared/Select.tsx` — drop-in for a native select: same `<option>`/`<optgroup>` children, `value`, `onChange={(e) => e.target.value}`, `disabled`, `style`, `data-*`. Without a width it is as wide as its longest option (like a native select); `style={inputStyle}` makes it fill its cell. Not supported: `ref`, `onBlur/onFocus`, `size`, `e.target.selectedOptions/options`.
- `SearchableSelect` directly when you already have `{value,label}[]` or need server search / add / edit rows.
- A segmented toggle (two or three pill buttons) instead of a dropdown when there are only 2–3 fixed choices that the user flips often in a line row (e.g. Project / Inhouse).

## Global UI consistency layer (2026-10-24)

One scale, enforced by tests. Use these instead of local copies:
- **Sizes** — `CONTROL` in `lib/theme.ts`: every input, dropdown trigger, date field and button is **38px** (small = **30px**), radius 10, font 13, from padding + 16px line-height + 1px border. Module style files (crm/ui, finance/financeUi, hr/hcmUi, sales/SalesUi, projects/work/pmUi, electrical/shared, rnd/toolStyles, FormSheet `sheetBtn`/`sheetInput`) all spread the shared ones — override colours, never the height.
- **Buttons** — `components/shared/ui.tsx`: `primaryBtnStyle` / `secondaryBtnStyle` / `dangerBtnStyle` (page + form actions), `smallPrimaryBtnStyle` / `smallSecondaryBtnStyle` / `smallDangerBtnStyle` (table row actions, chips, toolbars), `iconBtnStyle` (38×38 icon next to a field), `btnBase` to build a new colour variant. No inline `padding` on a button.
- **Tables** — `<TableScroll maxHeight? minWidth?>` (or `tableWrapStyle`) around every `<table>`; `thStyle`/`tdStyle`/`numThStyle`/`numTdStyle` (sticky nowrap header, right-aligned numbers). The page itself never scrolls sideways.
- **Popovers** — `components/shared/AnchoredPopover.tsx` for every hand-rolled suggestion list / picker / menu (anchor by `anchorRef`, or the parent / previous element; `align="right"` for menus). Never an `absolute` list inside a card, sheet or scroll box. Layers come from `Z` in theme.ts (sheet 150 < tour 2000 < popover 3000).
- **Layout** — `<Toolbar>` for filter/action rows (wraps; stacks on phones); `className="ui-cols"` on any inline grid of side-by-side panes (stacks < 1024px); field grids use `repeat(auto-fit, minmax(Npx, 1fr))`; flex/grid children holding inputs or tables get `minWidth: 0`; no `overflow: 'scroll'`. Never put `transform` on a card hover (it breaks every fixed popup inside it).
- **Tests** — `npm run test:ui` (static audit, `scripts/ui-audit.mjs`: native-select, browser-dialog, overlay-portal, table-scroll fail; `--warn` adds adhoc-button, fixed-grid). `npm run test:ui:login` once, then `npm run test:ui:layout` (Playwright, Edge, every static dashboard page at 1366px and 390px: overflow, native select, row heights, clipped buttons, dropdown on screen). A deliberate exception gets `// ui-audit-ignore-next-line <rule>` with the reason.

## Input / dropdown / section design rules (no repeat mistakes)

Check every form, line-item grid and section against this list before you call it done:
1. **Same height, one style.** Every input, dropdown, date field and toggle in a row uses the shared `inputStyle` (`components/shared/ui.tsx`, or the module's own `inputStyle`) and so has the same height, radius, border, padding and font size. Never mix a tall `SearchableSelect` with a short native control.
2. **Nothing clipped.** No field cut off at the card edge (e.g. a "Ship To" input half-hidden) and no label wrapping to 2 lines. If a line grid has more columns than fit, drop or move the low-value columns (show them in the row's detail popup) before you accept a horizontal scrollbar. Required columns (item, qty, project) must always be visible without scrolling.
3. **Read-only cells line up.** Values shown as text in a grid (Make, UOM, Category) are vertically centred with the inputs beside them. Use the same font size as the inputs and `—` for empty, never a blank cell.
4. **Labels.** Every field has a label; a required field shows `*`. Placeholder text is a hint ("Pick vehicle / lot…"), never a substitute for the label. Column header case and style match the rest of the module.
5. **Dependent fields.** A field that only matters for one choice (e.g. Order Project vehicle/lot only when the line is "Project") is hidden or disabled with a reason until that choice is made. Never leave it open and empty, looking required.
6. **Dropdown lists.** Options are sorted (code/id ascending, see "Default row order"), have readable labels (`CODE — Name`) and an empty state that says what to do. Every popup is portaled to `body` (see DateField).
7. **Sections.** Each section has one header row (icon + title on the left, its action button such as "+ Add Item" on the right) and the same padding and gap as its sibling sections. No stray empty boxes or dashed placeholders left on the page. Help text sits directly under the thing it explains.
8. **Look before done.** Open the form at a normal laptop width (~1366px) and at the user's wide screen. Check rules 1–7 visually, not just in code.

## Multi-select with chips (approver-style picker)

Currently **hand-rolled inline, not a shared component** — see `frontend/src/app/dashboard/p2p/new/page.tsx` (Approver field). State shape: `selectedIds: number[]` + `search: string`. Selected items render as removable chips above the input (`<span>` pill + `×` glyph that filters the id out of the array). The search input's filtered dropdown only renders when `search.trim()` is non-empty, listing not-yet-selected matches (name/email), capped (`.slice(0, 8)`), clicking one appends to `selectedIds` and clears the search text.

This exact block is duplicated wherever a multi-select-by-search is needed — there is no `MultiSelectChips`/`TypeaheadMultiSelect` component yet. If you need this pattern in a third place, that's a good moment to extract a shared component; until then, copy the existing block rather than inventing a different multi-select UX.

## File uploads

Files are staged client-side as `File[]` in local state (e.g. `supportingFiles`, `specFiles`) via a plain `<input type="file" multiple onChange={(e) => setX(Array.from(e.target.files || []))} style={inputStyle} />`. `accept` restrictions are inconsistent across the app — some upload inputs restrict to `"image/*,.pdf,.doc,.docx,.xls,.xlsx"`, others (e.g. the P2P supporting-documents input) have no `accept` at all. Don't assume a universal `accept` value; check the sibling upload input in the same module before picking one.

Files are uploaded **after** the parent record is created, in a follow-up call keyed by doc type, and upload failures are deliberately swallowed so they never block the record from being created:
```ts
const pr = await p2pApi.create({...})
for (const doc of ['supporting', 'specification'] as const) {
  const files = allFiles.filter((x) => x.doc === doc).map((x) => x.f)
  if (files.length) {
    try { await p2pApi.uploadAttachments(pr.id, files, doc) } catch { /* upload failure shouldn't block record creation */ }
  }
}
```
Keep this resilience behavior when adding new upload flows — a failed attachment upload is not a reason to fail the whole submission.

## Permission-gated pages

Frontend idiom, identical across every dashboard page (confirmed on p2p, purchase, erp, crm list/new/detail/edit pages):
```tsx
const { isAuthorized, isLoading, user } = useRequireApp('p2p')
// ...any authorized-only data loading goes in a useEffect gated on isAuthorized...
if (isLoading || !isAuthorized) return null
```
Always place that guard immediately before the JSX `return`, and always return `null` (not a spinner) while loading/unauthorized — `useRequireApp` itself redirects to `/dashboard` when access is missing, so the page doesn't need its own redirect logic.

Backend — `Depends(require_app_access("<app>"))` on the route function. Naming convention: parameter is `user` when the value is used in the function body, `_user` (underscore-prefixed) when it's present only to enforce the dependency. Keep this naming split — it signals at a glance whether the handler actually reads `user`.

## Error banner

Copy this exact block for form/list-page error display (used verbatim in `p2p/new/page.tsx` and `P2PRequestList.tsx`):
```tsx
<div style={{ padding: '10px 14px', marginBottom: 16, borderRadius: 10, background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.2)', color: '#b91c1c', fontSize: 13 }}>
  {error}
</div>
```
Note this duplicates raw literals rather than referencing `theme.ts`'s `DANGER.*` tokens — that's the existing (if imperfect) convention; match it rather than "fixing" it into token references as an incidental change.

## Status/priority badges

Each page defines its own local `STATUS_LABELS: Record<string,string>` and `STATUS_HEX: Record<string,string>` maps keyed by backend status strings (no shared/imported version, even across pages showing the same entity), then renders a pill:
```tsx
<span style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 9999, background: `${STATUS_HEX[status]}1a`, color: STATUS_HEX[status], whiteSpace: 'nowrap' }}>
  {STATUS_LABELS[status] || status}
</span>
```
Background = the same hex with a literal `1a` alpha suffix appended (~10% opacity); text color = the raw hex; `borderRadius: 9999` for the pill shape. When adding a new status page, add its own local maps rather than importing another page's — this is intentional per-page duplication, not a missed shared-constant opportunity.

## Form field width/layout sizing

Don't blindly reuse a generic `repeat(auto-fit, minmax(220px, 1fr))` grid for every field row — it stretches short fields (Quantity, Unit, PIN, Priority) to fill leftover space and makes them look oversized. Instead:

- **Size each field to its label + typical content**, not a shared default. A 4-6 char value (Unit, PIN, Priority) needs ~80-100px; a short enum/date needs ~130-170px; free text (Address, Remarks, Delivery Location) should get `flex: 1` so it absorbs the extra space instead of a short field next to it.
- Prefer `display:'flex', flexWrap:'wrap', gap:12` with each field wrapped in its own `<div style={{ flex: '0 1 <Npx>', minWidth: <Npx> }}>` (short/fixed fields) or `flex:'1 1 <Npx>'` (fields that should grow) over a uniform CSS grid — this lets fields size independently instead of all sharing one `1fr` track.
- Check the label text width too: an UPPERCASE, letter-spaced label (e.g. "REQUIRED DELIVERY DATE") needs enough `minWidth` on its field to not wrap to 2 lines — don't just size for the input value.
- **Two side-by-side sections/columns must not become CSS Grid siblings in the same implicit row** — default `align-items: stretch` height-links unrelated columns (e.g. adding a contact in one column visibly grows an unrelated section in the other column). Use two independent `display:'flex', flexDirection:'column'` wrapper divs instead of relying on a 2-column CSS grid's automatic row-pairing, when the columns' contents are unrelated in length.
- Don't force a `flex:1`/`minHeight:0` growth + fixed `maxHeight` on a list section (e.g. "Contact Persons") just to enable scrolling for a hypothetical large list — that stretches empty space and pushes an "+ Add" button far below when there are only 1-2 items. Instead cap only the *scrollable inner list* with `maxHeight` + `overflowY:'auto'` (so it scrolls only once genuinely full) and let the section itself size to its natural content height.
- Read-only data that's already captured elsewhere (e.g. an org's own address/GST mirrored onto an Inquiry) doesn't need an `<input disabled>` box — a plain label+value display (see `InfoRow` in `ui.tsx`) is closer to what's actually needed, and often the field shouldn't be duplicated on the page at all if the linked record already shows it.
- **`flex: '1 1 Npx'` alone is not enough — always pair it with a `maxWidth`.** A grower with no ceiling will happily stretch to consume all of a wide card's leftover space (e.g. an Email field spanning almost the full card) just because the container is wide, not because the data needs it. Give every growing field a `maxWidth` (roughly 1.5-2x its comfortable content width — ~280-320px for email/URL, ~300-340px for a name) so its width still reflects what it holds.
- **The real bug this session's fixes were chasing was proportion/hierarchy, not color or spacing tokens.** When a form "looks stretched," check in this order: (1) is a short field getting a wide flex/grid track, (2) is a grower missing a `maxWidth` cap, (3) is a section's height being forced by an unrelated sibling (grid row-stretch) rather than its own content, (4) is a repeating row's internal padding/gap using the outer Section's generous spacing (18px/12px) instead of a tighter scale (10-12px/10px) appropriate for dense repeating rows like a contact-list card. Two visually uneven columns (one card shorter than its neighbor) is **correct**, not a bug, once heights are decoupled — don't re-introduce row-stretching to force them equal.

## List-page table

Canonical 5-part shape (byte-identical sticky-header style confirmed in `P2PRequestList.tsx` and `purchase/page.tsx`):
1. Outer glass wrapper: `GLASS.card` + blur + border + `SHADOWS.glass()`, with `overflow: 'auto'` and `maxHeight: 'calc(100vh - 320px)'`.
2. `<table style={{ width: '100%', borderCollapse: 'collapse', minWidth: <N> }}>` — `minWidth` intentionally forces horizontal scroll on narrow viewports rather than wrapping/reflowing columns.
3. `<th>` cells: `position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1` so the header pins during vertical scroll.
4. Body `<tr onClick={() => router.push(`/dashboard/<module>/${id}`)} style={{ cursor: 'pointer' }}>` — whole row navigates to the detail page.
5. Trailing empty-header (`''`) column with a "View" link: `<td onClick={(e) => e.stopPropagation()}><span onClick={() => router.push(...)}>View</span></td>` — `stopPropagation` avoids double-navigation since the row itself is already clickable; both intentionally do the same navigation.

Loading/empty states are a single full-width `<td colSpan={N}>` row inside `<tbody>`, not a replacement for the whole table.

## Default row order — code / id ascending

Every table or list (list pages, line-item grids, master tables, dropdown option lists, exports) that shows a **code or id** (item code, document number, employee code, serial, `id`) is sorted **ascending by that code/id by default**: text codes A → Z, numbers 0 → max. Apply it in both places:
- Backend list endpoint: `order_by(Model.code.asc())` (or `Model.id.asc()` when there's no code), so paging stays in the same order.
- Frontend: if the page sorts client-side, the initial sort is the same column ascending. Sort codes naturally (`localeCompare(b, undefined, { numeric: true })`) so `ITEM-2` comes before `ITEM-10`.
A user-clicked column sort can override it, but the default on load is always code/id ascending.
