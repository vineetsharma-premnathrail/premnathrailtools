# Admin — Extension Plan

## Current state

Already built: users, `assigned_apps` permissions, audit log, notifications, API keys (`backend/app/modules/main/`). This is a mature module — the extension below is driven by the structural warning raised repeatedly across the other department plans: at 17 departments, `AVAILABLE_APPS` as a hardcoded set is no longer the right shape.

## Phase 1 — DB-Backed Module Registry

- New `modules` table: `key` (the string currently hardcoded in `AVAILABLE_APPS`), `label`, `icon`, `is_active`. Seed it with the current 6 (`erp`, `rnd`, `crm`, `purchase`, `p2p`, `store`).
- `User.get_apps()` and `require_app_access()` read against this table instead of the hardcoded Python set — adding a new department becomes a data change (insert a row, assign it to users) rather than editing `AVAILABLE_APPS`, the frontend `AppModule` type, `useAuth.ts`, and the admin UI's `APPS` array in four separate files every time.
- Frontend: `AppModule` becomes a plain `string` instead of a union type once the registry is DB-backed (a real trade-off — loses compile-time typo-catching on app keys; worth deciding if that's acceptable before doing this migration, or keep the union type as a synced-but-manually-maintained convenience list).

## Phase 2 — Org-Wide Settings

- Holiday calendar, financial year configuration — already implicitly assumed by Purchase/P2P's FY-based PR numbering (`PR-{CODE}-{YEAR}-{NUM}`) but not actually configurable anywhere; a settings screen makes the assumption explicit and editable.

## Phase 3 — HR Profile Ownership

- If [[hr]]'s profile fields (`reporting_manager_id`, `date_of_joining`) land, Admin becomes the natural place to manage them as part of user administration, rather than a separate HR-only edit screen.

## Interconnections

| With | Relationship |
|---|---|
| Every department | The module registry (Phase 1) is the literal gate every other department's `require_app_access()` call depends on — do this before building more than 2-3 of the remaining 14 departments, not after |
| [[hr]] | Shares user-profile field ownership once HR's fields exist |

## Cross-cutting

- Phase 1 is the highest-leverage item in this entire multi-department roadmap — it turns "add a department" from a 4-file code change into a data change, for every department plan in this set.
