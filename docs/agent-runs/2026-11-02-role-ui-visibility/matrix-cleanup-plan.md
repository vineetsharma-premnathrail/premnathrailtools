# Matrix cleanup (owner 2026-11-03: "matrix me aise tabs/sub-tabs hain jo app me nahi, aur kuch missing")

Source: three read-only audits of the Role & Permissions matrix against the real navigation, pages, record tabs and backend checks (all 15 modules). Registry dump: `matrix-registry-dump.md`.

## Rules for every change (nobody may lose access they have today)
1. **Remove a tab / action / feature** only when no live screen uses it and no backend route checks it. Old ids already stored on roles must not break saving: add them to `RETIRED_GRANTS` (Manager adds to `permission_registry.py`) — `validate_grants` drops them silently, `expand_grants` ignores them, `legacy_grant_aliases` maps them when they still carry access somewhere else.
2. **Missing screen** (a nav tab / page / record tab with no row): add it as a **feature of kind `subtab`** under the tab that gates it today, with `inherit={"view": "view", …}` — existing roles keep exactly what they had; admins can now untick it. Nav item / page then checks `canFeature(...)` and the backend route `can_feature(...)`.
3. **Label** = what the user sees on screen (nav / tab label). Module labels match the Sidebar.
4. **Kind** = what it is on screen: a tab inside a record page = `subtab`; a block = `section`; a button = `action`.
5. **Assign-to-only features** (owner / lead / approver / inspector pickers whose only use is the "Assign to" rule): new kind `picker` ("Assign-to rule") — Role editor shows them with their chip, no other meaning. Keep their `view` action (the assign-to rule reads `:view` to decide which roles count).
6. **Orphan screens** (live page + live API, no nav entry): add the nav entry when the module is live (R&D Experiments, Prototypes, Documents; Service settings gear). Pages that are only redirects are deleted together with their rows.
7. Ticked-but-unchecked **actions** that a screen *should* honour (ungated Export / Print buttons): wire the check instead of removing the action. Actions with no button and no endpoint: remove.

## Decisions taken (ERP standard; owner can override)
- "Ongoing Projects" rows (`project_work` in rnd, electrical, hydraulic, maintenance, production, store, quality; `ongoing_projects` in design): **removed**. Today they silently open the Project Management task APIs. Their stored grants alias to `projects:my_tasks:<same action>` so nobody loses task access; `_DEPT_WORK_TABS` emptied. Redirect stub pages deleted.
- Design `project_work` (= the Requests screen) keeps its key but label "Requests"; documented.
- Maintenance "Assets / AMC & Warranty": feature `assets.contracts` (subtab, inherits) for the AMC & Warranty tab.
- Store Batches / Serial Nos. / Reorder → features under `stock`; Before PO → feature under `grn`. Store matrix groups Inventory / Inward / Outward / Settings like the nav.
- Quality `masters.calibration` → label "Gauges tab", kind subtab. Finance `currencies` into its own group; Controlling split into "Controlling" and "Costing & Profitability" like the nav.
- P2P `my_lines` / `vendors.info_records` stay features, labels "My Lines tab" / "Item Rates tab"; PR segment features relabelled to the real segment names.
- Removed features: `p2p:rfq.evaluation`, `rnd:requirements.projects`, `accounts:payments.payment_block` (no UI) — retired ids.
- Store `entry_types`, `issue_rules` tabs removed (screens retired 2026-10-12).
- PM: `milestones` "WBS" — keep only if a live screen's API still checks it, relabelled to what it gates; `department_board` page added to PM nav only if the page is live, else row + page removed; `department_work` relabelled "Department work (milestone heads)". My Tasks nav item gets `subtabKey: 'my_tasks'`.
- R&D: settings gear gets feature `requirements.settings` (subtab-like, inherits view) instead of riding silently on Requirements.
- Backend gaps that make a tick meaningless (Quality views checked only at app level, Service dashboard, Maintenance requests): add `require_tab_access` / `require_tab_action` on those routes.
