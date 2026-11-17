# Remove R&D Experiments & Tests and Prototypes - requirement

**Date:** 2026-11-17. **Size:** L (tables dropped, permissions rewritten, several screens).
**Core flow:** Customer, BD, **R&D**, Design/EHP, BOM, ... R&D stays after BD (requirements, Prototype / Research projects, engineering tools). The part removed is the R&D-side "build a prototype BOM and release it to Production" path; BOMs are made in Design / Production.

## Business ask (owner, in chat)
"no need experiments & tests, also remove prototypes, completely remove both"

## Decisions
1. **Tables are dropped** (owner chose full removal, not hiding). Migration `b7e2d4f6a8c1_drop_rnd_experiments_prototypes.py` (revises `d3f8b2e6a9c1`):
   - drops `rnd_experiments`, `rnd_prototype_bom_items`, `rnd_prototypes`;
   - drops `rnd_documents.experiment_id` and `prototype_id` (files stay on their project);
   - rewrites role and user grants: `rnd:experiments*` and `rnd:prototypes*` removed;
   - removes the "Assign experiment to" rule and the "Prototype released" notification from roles.
   - Data is not recoverable except from a backup; the downgrade only recreates empty tables and columns.
2. **What stays:** "Prototype / Research" projects (and their tasks, feasibility, handover, attachments), the R&D task type "prototype", Requirements, R&D Documents (now project-only), the seven engineering calculators and Calculation History. Production BOMs that were earlier released from a prototype stay in Production.
3. **BOM-costs switch moved.** The old "R&D > Prototypes > BOM costs" switch (`rnd:prototypes.costs:view`) is now "R&D > Prototype / Research > Budget & costs" (`rnd:projects.costs:view`). It hides or shows the project budget card; people with Edit on Prototype / Research always see it. The migration carries an existing view grant over; other prototype-cost actions are not carried over.
4. **Project delete** is blocked only while the project has attachments or documents (error names the count and says to delete them in the Attachments section). Experiments and prototypes no longer count.
5. **R&D documents attach to a project only.**
6. The R&D dashboard API now returns only `requirements`, `projects` and `recent_projects`. The R&D lookup of Item Master parts was removed with the prototype BOM.

## Docs touched
- `docs/02-modules/rnd/overview.md`, `docs/module-guides/md/04-rnd.md`, `docs/02-modules/platform/access-and-permissions.md` (the experiments / prototypes lines only).
- What's New entry dated 2026-11-17 in `frontend/src/lib/changelog.ts`.

## Evidence in code
- Migration above; test `backend/app/tests/test_rnd_experiments_prototypes_removed.py` (routes gone, registry without the two tabs, `hide_costs` follows the Budget & costs switch, grant rewrite is idempotent).
- Registry: `backend/app/core/permission_registry.py` (R&D module), feature switch in `backend/app/core/features/rnd.py`.
- Delete guard: `backend/app/modules/rnd/routes/projects.py` (`delete_project`).

## Open points
- Rollback = restore from backup; there is no data-preserving downgrade.
- R&D guided tours (`frontend/src/lib/tour/configs/rnd*.ts`, `modules/rnd.ts`) were searched for experiments / prototypes / release / BOM-cost wording: no step mentions the removed features (matches are only the "Prototype / Research" tab name).
