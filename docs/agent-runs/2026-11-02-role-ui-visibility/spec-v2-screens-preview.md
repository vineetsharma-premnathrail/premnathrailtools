# Spec v2: screen-wise grouping + "Preview & choose" (owner feedback 2026-11-02)

Owner: "one chip mixes form / page / list — you can't tell which is which; a checkbox list is not understandable; the real form should open and I pick what shows. And hiding the items table must never be possible — how would they create a PR?"

## 1. Screens inside one catalogue key
Every section / option / table carries a `screen` (code + label). `register_visibility(..., screens=(("form", "New Requisition form"), ("detail", "Requisition page"), ("list", "Requisitions list")))`; each section tuple gets a 5th element `screen` (default = first screen), each table tuple a 4th element `screen`, each option tuple a 5th `screen`. `catalog()` adds `"screens": {code: label}` and `"screen"` on every item. Storage shape of rules unchanged.

PR catalogue grows to the detail page (`frontend/src/app/dashboard/p2p/[id]/...` requisition page blocks): Purchase order block, Attachments, Audit history, Approval flow card, Lines table columns (make, part code, uom, in stock, ship to, buyer) — all optional; header (number, purpose, status, requester) locked.

## 2. Role editor
Chip text: `Visibility: <n> screens` or the customised summary per screen ("New form: 1 section hidden · List: 2 columns hidden"). Dialog gets one tab per screen; each tab lists that screen's sections / dropdowns / tables (as today) AND a primary button **"Preview & choose"**.

## 3. Preview & choose
Opens the real screen component inside a full-width FormSheet-style overlay (createPortal) in **preview mode**: sample data, every action disabled, nothing saved. Implementation: `VisibilityPreviewProvider` (context: `{ key, screen, rule, onToggle }`); `useVisibility(key)` reads the provider when present (so the rule being edited is applied live). New wrapper components in `lib/visibility.tsx`:
- `<VisSection k="remarks">…</VisSection>` → normal mode: renders children only if shown; preview mode: always renders, with an eye toggle pill top-right ("Shown" / "Hidden", hidden = dimmed + dashed outline); locked sections show a lock pill with the reason "Required — always shown".
- `<VisColumn table="requisitions" k="priority">` for `<th>` (toggle in the header) and `VisCell` / `vis.showColumn` for cells (hidden = dimmed in preview).
- Dropdown values: in preview the Select shows its full list with a tick per value (restrict there too).
Forms keep working in normal mode unchanged. Consumption pattern for all modules: wrappers, not `showSection && …`.
Preview data: the form's own empty/new state (no network writes); lists render 3 sample rows from a `sampleRows` export of the list component or an empty-state note "Columns are shown with sample data".

## 4. Rules (unchanged, now visible in the UI)
Locked = anything needed to create the record (required fields, item lines, qty). Not hideable in the dialog, the preview or the API. Dropdown restriction keeps ≥ 1 value; default value removed → form preselects first allowed. Hidden sections / columns are on-screen only (ADR 0005).

## 5. Order of work
A. Backend: screens in `register_visibility` + catalogue + PR detail page entries (backend-agent).
B. Frontend: wrappers + provider + preview overlay + screen tabs in the dialog + convert PR form / list / detail page (frontend-agent). Manager: chip text in PermissionMatrixEditor, types.
C. Module agents (CRM, Store, Projects/Service, HR/Finance) finish on the current pattern; a conversion pass moves them to the wrappers and adds `screen` tags.
