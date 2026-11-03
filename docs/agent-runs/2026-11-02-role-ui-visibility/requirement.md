# Requirement: role-wise UI visibility (sections, dropdown options, table columns)

Date: 2026-11-02. Size: **L** (permission system, cross-module framework, Role editor UI, backend enforcement, one migration). Core-flow position: cross-cutting (Organization › Role & Permissions), first applied to Store/Purchase (PR form).

## Request (owner, in business words)
Admin should be able to go one level deeper in Role & Permissions than today's Module › Tab › Feature › Action and decide, **per role**, what a user *sees*:

1. **Sections** of a form / record page: show or hide (e.g. hide the "Purchase order" block, hide "Attachments").
2. **Dropdown options**: which values of a coded dropdown this role gets (e.g. PR *Purpose*: Store role sees only "Stock", Project engineer sees "Project" and "Prototype"). Backend accepts only the allowed values for that user.
3. **Table columns**: which columns of a list table this role sees; the rest are hidden.

Pure **show / hide**. This is NOT metadata customisation: no new fields, sections, options or columns can be created by admin; required fields, formulas and workflows do not change. The catalogue of what exists stays in code (like today's `_feature(...)` declarations); admin only ticks / unticks.

Rows (which records a user sees) stay governed by Data access (own / assigned / team / all) and are out of scope.

## Decisions taken at intake (ERP standard, logged for the owner)
- **Default visible, store only overrides.** Unlike action grants (deny by default), a visibility rule that is not customised = everything visible, so no role's form goes blank on day 1. Items declared `sensitive` (prices etc.) keep their existing deny-by-default feature switch.
- **Union across roles**: if any of a user's active roles shows an item, the user sees it (same rule as grants). Admin and Partners see everything.
- **Server-enforced, not UI-only**: hidden sections/columns are blanked/stripped in API responses where feasible; a dropdown value outside the user's allowed set is rejected on create/edit with a real error (which values are allowed, who to ask).
- **Required-ness never changes by role.** If an admin hides a section that contains a required field, the Role editor warns and the backend keeps the field mandatory (the hidden-with-required case is refused when saving the role, or the field is auto-filled by rule, BA to decide).
- **Columns**: role decides the allowed column set. (Per-user column chooser on top is a later, separate item.)
- **Storage**: a JSON map on `roles` keyed by `"<module>:<tab>.<feature>"` (same addressing as `assignee_rules`), e.g. `{"sections": [hidden keys], "options": {"<dropdown key>": [allowed values]}, "columns": [hidden keys]}`. Catalogue declared in code next to features (`app/core/features/<module>.py`), exposed through `/users/permissions/registry`, and the user's effective visibility exposed through the auth/me payload so pages render without extra round-trips.
- **First application**: Procurement › Purchase Requisitions: New PR form (Purpose dropdown, sections), requisition list columns. Framework must be generic so other modules add catalogue entries without new UI.

## Files already modified at launch (protected; see `git status` 2026-11-02 — 57 entries)
Other session's work in progress, notably: `backend/app/core/permission_registry.py`, `backend/app/core/permissions.py`, `backend/app/core/features/projects.py`, `frontend/src/components/organization/PermissionMatrixEditor.tsx`, `frontend/src/hooks/useAuth.ts`, `frontend/src/app/dashboard/p2p/new/page.tsx` (staged + unstaged), `backend/app/modules/p2p/routes/p2p_requests.py`, `backend/app/modules/p2p/schemas/pr_lines.py`, `frontend/src/app/dashboard/p2p/my-lines/page.tsx`, projects/erp/store files. Agents touch these only when assigned, in their own hunk, after reading the diff; registries are Manager-only.

## Open questions for the owner
- None blocking. Confirmed in chat: show/hide only, sections + dropdown options + table columns, rows stay with Data access, catalogue stays in code.

## Note after the review wave (2026-11-02)
Hidden sections and columns are hidden on screen only (ADR 0005, option E); only dropdown values are server-enforced. Owner to confirm in the final report.
