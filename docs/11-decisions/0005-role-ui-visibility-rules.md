# ADR 0005: Role-wise UI visibility rules (sections, dropdown values, table columns)

**Status:** Accepted
**Date:** 2026-11-02
**Author:** Documentation agent, for the project owner
**Audience:** developers and the admins who own Role & Permissions
**Last verified:** 2026-11-02 against `docs/agent-runs/2026-11-02-role-ui-visibility/spec.md`, and against the built code (`backend/app/core/visibility.py`) after the review wave of the same day

## Context

Role & Permissions today decides Module > Tab > Feature > Action (for example `p2p:purchase_requisitions:create`). It cannot say what a person *sees inside* a screen. The owner asked (2026-11-02) for one more level, set per role:

1. Show or hide **sections** of a form or record page (for example hide "Remarks" or "Attachments").
2. Choose which **values of a coded dropdown** a role gets (for example PR Purpose: a Store role gets only "Store stock refill"; a project engineer gets "Project" and "New development").
3. Choose which **columns of a list table** a role sees.

Constraints that shaped the decision:

- The owner decided on 2026-10-08 that modules, tables and views are **coded, not admin-configurable** (memory: *No metadata customization*). So this is show/hide only. Admin cannot create a field, section, option or column, and cannot change a required field, a formula or a workflow.
- Rows (which records a user sees) are already governed by Data access (own / assigned / department / plant / organization). Out of scope here.
- The system must fit the central authorization design (memory: *RBAC + central authorization*): deny-by-default for actions, roles plus extras, Admin and Partners at the top. Visibility must not break that model and must not blank a role's screens on the day it ships.
- Core flow position: cross-cutting (Organization > Role & Permissions). First applied to Store/Purchase, the Purchase Requisition (PR) form and requisitions list.

## Decision

We will add a **visibility layer** to roles with these rules:

1. **Catalogue lives in code.** `register_visibility(...)` in `backend/app/core/visibility.py` declares, per tab or feature key, the sections, the coded dropdowns (with their values) and the tables (with their hideable columns). Registration sits next to the feature declarations (first entry: `p2p:purchase_requisitions` at the bottom of `backend/app/core/features/p2p.py`). Registration asserts the tab or feature exists in the permission registry. Dropdown values are imported from the existing code constants (`P2P_PURPOSES`, `P2P_REQUEST_PRIORITIES`), never retyped.
2. **A role stores overrides only.** New JSON column `roles.visibility_rules`, default `{}`. A role that has no rule shows everything. Anything not customised is visible, unlike action grants which are deny-by-default. Items that are already behind a sensitive switch (prices) keep that switch.
3. **Union across roles.** Only the user's active roles that actually open the screen (they hold its `view` grant) are counted. A section is hidden only if every such role hides it. A dropdown is restricted only if every such role restricts it, and the allowed values are the union. Columns work the same way. No relevant role means no restriction. Admin and Partners (`is_partner`) see everything.
4. **Dropdown values are enforced by the server.** A value outside the user's allowed set is refused on create and edit with a real message that names the allowed values and where to widen them. On edit the check runs only when the value changes, so an old record that already holds a now-disallowed value stays editable. The `/meta` list the form reads marks every purpose with `allowed`, so the form can hide the others and still keep an old record's own value. A restricted role must also give a purpose (leaving it empty, or importing a file without a Purpose column, is refused). A non-admin cannot change the visibility of a role they hold themselves or of a role that applies to everyone.
5. **Sections and columns are hidden on screen only.** The server does not strip them from API responses. Every hideable section holds optional data, and the list data is shared with other features. The Role editor says so in plain words ("hides it on screen"). Money columns stay protected by the existing prices switch, not by this layer.
6. **Locked sections.** A section that holds a required field is declared `locked`. The Role editor shows it ticked and disabled, and the server refuses to save a rule that hides it. Required-ness never changes by role.
7. **Delivery to the screen.** The effective restrictions of the signed-in user are returned in the `/auth/me` payload as `visibility`, so pages need no extra request. The catalogue is returned in `/roles/catalog`. The Role editor edits rules through a "Visibility" chip on the Permission Matrix row of that tab or feature. Changing rules needs the same Role & Permissions "Edit" permission as the matrix; no new permission is added.

## Rationale

### Options considered

- **A. Full metadata customisation** (admin adds or renames fields, sections, options, columns, makes fields required per role). Rejected. It contradicts the owner decision of 2026-10-08 ("coded, not admin-configurable"). It would let screens, validations and reports drift per customer and per role, make every test and every document template unpredictable, and turn Role & Permissions into a form designer.
- **B. Per-user layouts** (each user hides what they like, or an admin sets it user by user). Rejected for this phase. Access is managed by role, so per-user rules cannot be audited or reviewed with the role list. A per-user column chooser may come later on top of the role-allowed set (separate item).
- **C. Hard-code the differences in each page** (`if role is store`). Rejected. Role names are admin data, so code cannot know them, and every change would need a release.
- **D. Deny-by-default visibility** (admin must tick every section, value and column for every role). Rejected. On day one every existing role's forms would go blank, and a forgotten tick would silently remove a required field from a form.
- **E. Server-strip hidden sections and columns from API responses.** Not chosen for now. It would need per-endpoint response shaping in every module and would break features that share the same list data. Dropdown values are the only part where hiding changes what may be saved, so only that part is enforced on the server.
- **F. Visibility as part of the permission grant ids** (extra grant strings per section). Rejected. It would multiply grant ids, flood the matrix, and mix "may do" with "may see".
- **G. Chosen:** catalogue in code, overrides in a role JSON, union across roles, server enforcement for dropdown values, screen-only hiding for sections and columns.

### Business rules behind the choices

- Union follows the same rule as grants: a person with two jobs gets the wider view, never a surprise loss.
- Default visible plus locked sections means an admin can only remove optional things. The worst mistake is a screen that looks shorter, not a form that cannot be saved.

## Consequences

### Positive

- Admin can tailor a role's screens without a release and without a developer.
- No role is affected until someone customises it (migration adds the column empty).
- A new module adopts it by registering a catalogue entry. No new Role editor UI is needed.
- Dropdown restriction cannot be bypassed by calling the API directly.

### Negative and trade-offs

- Hidden sections and columns are cosmetic: a technically skilled user can still read that data from the API response. Do not use this layer to protect confidential data. Use grants, data access or the sensitive switches for that.
- A rule is stored by catalogue key, section key and value key. If a developer renames or removes a catalogue entry, saved rules that point to it become stale. A stale screen key is dropped silently on the next save (logged), so an unrelated role edit still saves; a stale section / dropdown / value / column name is refused ("isn't in the current catalogue, reload the page"). At runtime `effective()` ignores a stale screen key; a dropdown whose stored values all disappeared counts as "nothing allowed" (fails closed) until an admin re-saves the role.
- Roles with no `view` grant on the screen are ignored for that screen, so a rule on such a role does nothing until that role opens the screen.
- More states to test: every catalogue entry needs a union case in tests.

### Migration

One Alembic migration adds `roles.visibility_rules` (JSON, NOT NULL, server default `{}`), revision `a4e7c1b9d306`, chained after `b8d2f6a1c3e5`.

## Alternatives considered

See "Options considered" above (A to F).

## Business-flow check

Cross-cutting. It does not change any step of Customer > BD > R&D > Design/EHP > BOM > Store/Purchase > Production > QC > Dispatch > Commissioning > Machine > Service > Finance. It only changes what a role sees on a screen. First application is Store/Purchase (PR form and requisitions list). Approvals still go through the central approval engine, and Partners stay the top approval.

## Related decisions

- [ADR 0001: Modular monolith](0001-modular-monolith.md): the catalogue sits in core, each module registers its own entries.
- Memory *No metadata customization* (2026-10-08): the reason for show/hide only.
- Memory *RBAC + central authorization*: roles plus extras, deny-by-default for grants, union across roles, Data access for rows.
- Memory *Feature-level permissions* (2026-10-16): same Module > Tab > Feature addressing is reused.
- `docs/02-modules/platform/authorization-architecture.md`: developer guide, section 5 describes how to register visibility.

## When to revisit

- If sections or columns must protect data for real (then add server-side stripping per endpoint, option E).
- If dropdown values start to come from Settings or the database instead of code constants (phase 2: dynamic sources).
- If admins ask for a per-user column chooser or per-user hiding.
- If more than a few modules register entries and the Role editor chip becomes crowded.

## References

- Run folder: `docs/agent-runs/2026-11-02-role-ui-visibility/` (`requirement.md`, `spec.md`, `plan.md`).
- Code: `backend/app/core/visibility.py`, `backend/app/core/features/p2p.py`, `backend/app/modules/main/routes/roles.py`, `backend/app/modules/main/routes/auth.py`, `backend/app/modules/p2p/routes/p2p_requests.py`, `frontend/src/lib/visibility.ts`, `frontend/src/components/organization/VisibilityRuleDialog.tsx`, `backend/app/tests/test_visibility_rules.py`.
