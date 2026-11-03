# How a module joins role-wise visibility (pattern for module agents)

Read `spec.md` §2 first. The framework exists; a module only declares its catalogue and consumes the rules.

## 1. Backend catalogue — `backend/app/core/features/<module>.py` (append at the bottom)
```python
from app.core.visibility import register_visibility
register_visibility(
    "<module>", "<tab>",                      # key "<module>:<tab>", or add feature_key="<feature>" for "<module>:<tab>.<feature>"
    label="<Screen name> — form & list",
    sections=(("key", "Label as the screen shows it", "one-line hint", locked: bool), ...),   # locked=True when the section holds a REQUIRED field
    options=(("dropdown_key", "Label", {value: label, ...}, "hint"), ...),                     # CODED dropdowns only (import the constant, never retype); not DB-fed pickers
    section_defaults=(("section_key", "dropdown_key", "default_value"),),                       # only when hiding a section makes the form send a dropdown default
    tables=(("table_key", "Table label", {"col_key": "Column label", ...}), ...),              # never list the code/number column, the status column or money columns (money stays behind the `prices` sensitive feature)
)
```
Rules: one entry per screen (tab); section keys/labels must match the real form sections (read the form component); hideable sections only hold optional fields; required-holding sections are `locked=True`. Keep the key on the TAB unless the form really belongs to a feature.

## 2. Backend enforcement (only for `options`)
In the create route: `visibility.ensure_option_allowed(user, KEY, "dropdown", payload.field)` and, when the field is mandatory for a submitted record, `visibility.ensure_option_given(user, KEY, "dropdown", payload.field)`. In update routes: only when the value changes. In the endpoint that serves the dropdown list (meta/options), return every value with `"allowed": bool` (`allowed_values(user, KEY, "dropdown")`; None = all allowed) — do NOT filter the list, the form filters and keeps an old record's value. Any importer that creates the record without that field: refuse for a restricted user with a real 422 (see `p2p/routes/pr_transfer.py`).

Touch only your own hunks in route files; run `git diff <file>` first and never revert another session's edits.

## 3. Frontend consumption
```ts
import { useVisibility } from '@/lib/visibility'
const vis = useVisibility('<module>:<tab>')
{vis.showSection('remarks') && <SheetSection …/>}                       // drop the section AND its wrapper; keep grids tidy when a column empties
const choices = vis.options('priority', PRIORITY_OPTIONS, (o) => o.value) // coded lists; keep the current value only when editing a saved record that holds it; on a new form preselect the first allowed value when the default is not allowed
columns.filter((c) => vis.showColumn('<table_key>', c.key))              // header AND cells from the same check; colSpan from the filtered length
```
For server-fed dropdowns with `allowed`: `rows.filter((r) => r.allowed !== false || (editing && r.code === editing.field))`.

## 4. Tests
`backend/app/tests/test_visibility_<module>.py`: catalogue keys resolve (reuse the assertions in `test_visibility_rules.py`), create refused 422 for a disallowed value with the real message, allowed value passes, meta/options carry `allowed`.

## 5. Checks before reporting
`cd backend && ruff check --select F821 --target-version py312 app alembic && python -m pytest app/tests/test_visibility_<module>.py app/tests/test_visibility_rules.py -q -p no:warnings`; `cd frontend && npx tsc --noEmit && npm run test:ui`. Report what you did NOT see live.

## 6. v2 (2026-11-03): screens + preview wrappers — REQUIRED for every module
Read `spec-v2-screens-preview.md`. Reference implementation: Procurement (`backend/app/core/features/p2p.py` bottom; `frontend/src/app/dashboard/p2p/new/page.tsx`, `frontend/src/app/dashboard/p2p/[id]/page.tsx`, `frontend/src/components/p2p/P2PRequestList.tsx`, `frontend/src/lib/visibilityPreviews/p2p.tsx`).

Backend: every `register_visibility` call declares `screens=(("form", "<X> form"), ("detail", "<X> page"), ("list", "<X> list"))` (use only the screens that exist; one screen is fine) and tags each section (5th tuple element), option (5th) and table (4th) with its screen code. Item keys stay unique across the whole entry (prefix detail-page keys with `detail_`). Hints say what the screen is.

Frontend consumption (replace the `vis.showSection(...) && …` pattern):
```tsx
import { VisSection, VisTh, VisTd, VisOptionValues } from '@/lib/visibilityComponents'
<VisSection vis={vis} k="remarks" frame={…optional box style…}>…</VisSection>   // locked sections too (they show a lock pill in preview)
<VisTh vis={vis} table="list" k="priority" style={th}>Priority</VisTh> … <VisTd vis={vis} table="list" k="priority">…</VisTd>
<VisOptionValues vis={vis} dropdown="priority" />   // under a coded-dropdown Select
```
Column counts (`colSpan`) come from the visible-column list. Each previewable screen must work with `vis.preview === true`: no network writes, no route id resolution (use a sample record exported from a `…PreviewSamples.ts` file), module nav / Back dropped, Save/Submit disabled, `useFormDraft` off. Lists render 3 sample rows in preview.

Preview registry: add `frontend/src/lib/visibilityPreviews/<module>.tsx` exporting `<module>Previews: PreviewScreens` (catalogue key -> screen code -> component, loaded with `next/dynamic`, like `p2p.tsx`). Do NOT edit `visibilityPreviews/index.ts` — return the one import + spread line for the Manager.
