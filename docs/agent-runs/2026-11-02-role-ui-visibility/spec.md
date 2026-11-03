# Spec: role-wise UI visibility (sections, dropdown options, table columns)

Written by the Manager inline (ba-agent and architecture-agent stalled). Decisions in `requirement.md` are fixed.

## 1. Scope
- Per role, admin decides what a user **sees** in a screen: which **sections** show, which **dropdown values** are offered, which **table columns** show.
- Show/hide only. The catalogue of sections / dropdowns / columns is declared in code next to the permission features. Admin never creates fields, options or columns.
- Generic framework (any module registers a catalogue entry) + first application: Procurement › Purchase Requisitions (New/Edit PR form and the requisitions list).

Out of scope: which rows a user sees (Data access), making a field required/optional per role, per-user column chooser, dropdowns whose values come from Settings/DB (phase 2: dynamic sources), other modules' catalogues (follow-ups, no new UI needed).

## 2. Concept (ERP: "field-level visibility" as a value restriction on a role)
- A **visibility key** is a tab (`p2p:purchase_requisitions`) or a feature (`crm:inquiries_tenders.quotations`) — same addressing as grants and assign-to rules.
- One catalogue entry per key holds: `sections` (each may be `locked` = contains a required field, always shown), `options` (dropdowns with coded values), `tables` (each with hideable columns).
- A role stores **only overrides** (what it hides / which values it allows). No rule = everything visible.
- **Union across roles**: of the user's active roles that *open* the key (hold its `view` grant), a section is hidden only if every such role hides it; a dropdown is restricted only if every such role restricts it (allowed = union); a column likewise. No relevant role → no restriction. Admin and Partners (`is_partner`) → no restriction.
- Dropdown restriction is **server-enforced** (422 on create/edit with a real message). Sections and columns are **UI-only**: every hideable section is optional data and the list endpoints already carry the columns' data for other features; money columns stay behind the existing `prices` sensitive switch. This is stated in the Role editor hint ("hides it on screen").

## 3. Catalogue (code) — `backend/app/core/visibility.py`
```python
register_visibility(module_key, tab_key, feature_key=None, *, label,
    sections=((key, label, hint, locked: bool), ...),
    options=((dropdown_key, label, {value: label}, hint), ...),
    tables=((table_key, label, {column_key: label}), ...))
```
Asserts the tab/feature exists in `permission_registry.MODULES`. `catalog()` returns the JSON below; `/roles/catalog` adds it as `"visibility"`.

```json
"p2p:purchase_requisitions": {
  "label": "Purchase Requisitions — form & list",
  "sections": {
    "purpose_charging": {"label": "Purpose & Charging", "hint": "Purpose and the project / R&D project it is charged to.", "locked": true},
    "request_details":  {"label": "Request Details", "hint": "Required date and priority.", "locked": false},
    "item_details":     {"label": "Item Details", "hint": "The item lines.", "locked": true},
    "remarks":          {"label": "Remarks", "hint": "Free-text remarks on the requisition.", "locked": false},
    "attachments":      {"label": "Attachments", "hint": "Specification / reference files on the form.", "locked": false}
  },
  "options": {
    "purpose":  {"label": "Purpose", "hint": "What the purchase is for. A value not allowed here is also refused by the server.", "values": {"customer_order": "Project", "machine_project": "Service", "development": "New development", "department": "Department running cost", "capital": "Asset / capital purchase", "stock": "Store stock refill"}},
    "priority": {"label": "Priority", "hint": "Standard / Urgent.", "values": {"standard": "Standard", "urgent": "Urgent"}}
  },
  "tables": {
    "requisitions": {"label": "Requisitions list", "columns": {"category": "Category", "project": "Project", "required_by": "Required By", "priority": "Priority"}},
    "form_items":   {"label": "Item lines on the form", "columns": {"make": "Make", "part_code": "Part Code", "uom": "UOM", "in_stock": "In Stock", "ship_to": "Ship To"}}
  }
}
```
Purpose values come from `P2P_PURPOSES`, priority from `P2P_REQUEST_PRIORITIES` (import, do not retype). Registration lives at the bottom of `app/core/features/p2p.py` (auto-imported with the features).

## 4. Storage — `roles.visibility_rules` (JSON, NOT NULL, server_default `{}`)
```json
{"p2p:purchase_requisitions": {"hidden_sections": ["remarks"], "options": {"purpose": ["stock"]}, "hidden_columns": {"requisitions": ["priority"], "form_items": ["ship_to"]}}}
```
`clean_rules(value)` (ValueError → 422 in the route): unknown key / section / dropdown / value / table / column → "… isn't in the current catalogue — reload the page"; hiding a `locked` section → "'Purpose & Charging' holds a required field, so it can't be hidden. Leave it visible."; an options list that is empty → "Pick at least one Purpose value, or reset it to all values."; empty rule objects dropped. One migration: add column, `down_revision` = head at launch `b8d2f6a1c3e5`.

Role routes: `RolePayload.visibility_rules: dict | None` (None = unchanged), `_role_out` returns it, `create_role`/`update_role`/`copy_role` persist it, `old/new` audit + `access_changed` include it (label "visibility rules"). Changing it needs the same Edit the matrix needs (no new feature).

## 5. Resolution — `effective(user) -> dict`
Relevant roles for a key = user's active roles + active default roles whose `expand_grants(permissions)` contains `<key>:view` (for `mod:tab` → `mod:tab:view`; for `mod:tab.feature` → `mod:tab.feature:view`). Admin (`is_admin_user`) or `is_partner` → `{}`. Cached on `user.__dict__` like `effective_permissions`. Output = only keys with at least one restriction:
```json
{"p2p:purchase_requisitions": {"hidden_sections": ["remarks"], "options": {"purpose": ["stock"]}, "hidden_columns": {"requisitions": ["priority"]}}}
```
Exposed in `/auth/me` as `visibility` (`CurrentUserResponse.visibility: dict = {}`); frontend `User.visibility?`.

Helpers: `allowed_values(user, key, dropdown) -> set | None`; `ensure_option_allowed(user, key, dropdown, value)` → 422 `"Purpose 'Project' isn't available to your role — you can pick: Store stock refill. Ask an admin to widen it in Organization › Role & Permissions › Procurement › Purchase Requisitions › Visibility."`; `filter_options(user, key, dropdown, rows, value_of=lambda r: r["code"])`; `section_hidden(user, key, section) -> bool`.

Enforcement in `p2p_requests.py`: `/meta` filters `purposes` with `filter_options`; `create` calls `ensure_option_allowed` for `purpose` and `priority`; `update` calls it only when the value changes (an old PR with a now-disallowed purpose stays editable).

## 6. Role editor UX
- On the Permission Matrix, a tab (or feature) row that has a catalogue entry shows a **"Visibility: shows everything ▾"** chip (same look as the "Assign to" chip). Text becomes e.g. "Visibility: 1 section hidden, Purpose: 1 of 6 values" when customised.
- Chip opens `VisibilityRuleDialog` (createPortal, FormSheet style) with three groups:
  - **Sections** — checkbox per section, "shown" by default; locked sections rendered checked + disabled with "Always shown (has a required field)".
  - **Dropdowns** — per dropdown an "All values" switch; off → checkbox per value; at least one must stay ticked (inline error).
  - **Tables** — per table a checkbox per column ("Hidden" when unticked); columns not in the catalogue are always shown.
  - Footer: "Reset to show everything", Cancel, Apply. Hint line: "Hides these on screen for members of this role. Dropdown values are also refused by the server; sections and columns are hidden on screen only."
- Read-only when the role is a system role or the matrix is read-only.

## 7. Frontend consumption — `frontend/src/lib/visibility.ts`
```ts
useVisibility(key) -> { showSection(k), showColumn(table, col), options<T>(dropdown, all: T[], valueOf: (t)=>string): T[], restricted: boolean }
```
Reads `user.visibility` from the auth store; admin / no entry → everything shown. PR form: wrap sections 2 and 4-5 with `showSection`, filter `purposes` and `PRIORITY_OPTIONS` with `options`, filter the item-table headers/cells with `showColumn('form_items', …)`. Requisition list: filter `columns` with `showColumn('requisitions', …)`; PR No., Status, PO Value (own switch) are never hidden.

## 8. Acceptance criteria
1. Given a role with no visibility rule, when a member opens the New PR form and the list, then every section, purpose value and column shows as today.
2. Given role "Store Keeper" with Purpose = Stock only, when a member opens the form, then Purpose offers only "Store stock refill"; `/p2p/requests/meta` returns only that purpose; POST with `purpose=customer_order` → 422 naming the allowed values and where to widen it.
3. Given the same member also holds a role that opens Purchase Requisitions with no Purpose restriction, then all six values show (union).
4. Given a role hides "Remarks" and column "Priority", then the member's form has no Remarks section and the list has no Priority column; an admin sees both.
5. Given an admin tries to hide "Purpose & Charging" or saves Purpose with zero values, then the role is not saved and the message names the section / asks for at least one value.
6. `/roles/catalog` carries `visibility` for `p2p:purchase_requisitions`; `/auth/me` carries `visibility` with only the effective restrictions.
7. `test_visibility_rules.py`: every catalogue key resolves to an existing tab/feature; clean_rules cases (unknown key, locked section, empty options, pass-through); effective() union cases incl. admin/partner bypass and "no relevant role → no restriction"; PR create 422.
8. `alembic heads` = one; `npx tsc --noEmit`, `npm run test:ui`, ruff F821 py312 clean.
