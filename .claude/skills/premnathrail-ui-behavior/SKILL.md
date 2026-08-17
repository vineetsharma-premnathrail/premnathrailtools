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

**When to use which**: plain native `<select>` for short static enumerations (PR category, requirement type, priority — see `frontend/src/app/dashboard/p2p/new/page.tsx`); `SearchableSelect` for longer or dynamically-loaded lookup lists (e.g. picking a Project by label). Don't reach for `SearchableSelect` for a 3-4 option enum, and don't use a plain `<select>` for a list that can grow past what's comfortably scannable.

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

## List-page table

Canonical 5-part shape (byte-identical sticky-header style confirmed in `P2PRequestList.tsx` and `purchase/page.tsx`):
1. Outer glass wrapper: `GLASS.card` + blur + border + `SHADOWS.glass()`, with `overflow: 'auto'` and `maxHeight: 'calc(100vh - 320px)'`.
2. `<table style={{ width: '100%', borderCollapse: 'collapse', minWidth: <N> }}>` — `minWidth` intentionally forces horizontal scroll on narrow viewports rather than wrapping/reflowing columns.
3. `<th>` cells: `position: 'sticky', top: 0, background: '#fdf1e6', zIndex: 1` so the header pins during vertical scroll.
4. Body `<tr onClick={() => router.push(`/dashboard/<module>/${id}`)} style={{ cursor: 'pointer' }}>` — whole row navigates to the detail page.
5. Trailing empty-header (`''`) column with a "View" link: `<td onClick={(e) => e.stopPropagation()}><span onClick={() => router.push(...)}>View</span></td>` — `stopPropagation` avoids double-navigation since the row itself is already clickable; both intentionally do the same navigation.

Loading/empty states are a single full-width `<td colSpan={N}>` row inside `<tbody>`, not a replacement for the whole table.
