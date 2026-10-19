# Electrical Module — Re-scope Implementation Plan

**Module:** Electrical (`electrical`) — becomes the **RRV Electrical Package**
**Spec:** `docs/MODULE_DETAILED_PLAN.md` §10 (Electrical), §17 (RRV Build stages 5–8), §25 (clean-up list + migration rule), §35 (settings), rules R2–R6, decisions D1–D8
**Aligned with:** `docs/02-modules/engineering/plan.md` (discipline BOMs move to the shared `design_bom*` engine — §2.2, §12.1, §13), `docs/02-modules/production/rrv-build.md`
**Companion plan:** `docs/02-modules/hydraulic/rescope-plan.md` (Hydraulic + Pneumatic, and the RRV Build stage split)
**Prepared for:** Vineet Sharma
**Date:** 07 October 2026
**Status:** Plan only — no code written. Open decisions are in §13. Each one has a recommended default, so phase EL-0 can start without waiting for answers. **Decided 2026-10-07:** decision #2 (who releases electrical drawings) — see §7.3 and §13.

---

## 1. Summary

Today the Electrical module runs a **20-stage "electrical job" lifecycle** for each vehicle. That lifecycle covers system design, panel design and assembly, troubleshooting, on-site commissioning and handover. It also keeps its **own drawing register** and its **own BOM lines**, where the item can be free text. Under rules R2–R5, Electrical is a **design discipline**. Its output is drawings plus an Electrical BOM. Every electrical item is bought out, and the only physical electrical work is the wiring and harness installation done **on the RRV, inside Production's RRV Build**.

The re-scope:

1. **Stages go from 20 to 8.** The current data is mapped to the new stages in an Alembic data step, and the old rows are kept in a snapshot table (§4.1, §8.3).
2. **Drawings move to the Design register** (`design_documents`, `discipline = electrical`). Electrical shows them through a filter and a link table (§8.4).
3. **BOM lines move to the shared BOM engine** (`design_bom*`, `discipline = electrical`, `bom_kind = system`). This uses the Engineering plan's migration (§12.1 there), so **`electrical_bom_items` is migrated once, not twice** (§5).
4. **Troubleshooting is retired.** Open issues become RRV Build rework orders. Commissioning and handover fields, commissioning-phase tests and the panel build lifecycle are hidden, kept read-only, exported, and then dropped (§8).
5. **Production's RRV Build** reads the package's stages 1–5 plus an installation checklist for its *Electrical Installation* stage. Final Assembly waits for the package's *Testing & QC* stage (§6). This removes today's gate, which waits for the electrical job to be *handed over* and so effectively blocks on commissioning.

Every retirement follows the §25 migration rule: **hide in the UI (one release) → keep the tables read-only → export → drop in a later Alembic migration with a backup.**

> **ERP standard / why — a discipline module is a *view* over the shared registers, not a parallel system.** In SAP, Teamcenter or Odoo PLM, the electrical engineer works in the same document register (DIR / item revisions) and the same BOM tables as the mechanical designer, filtered to the electrical discipline. A separate drawing table and BOM table per department gives you three revision rules, three ECN paths and no cross-discipline where-used. That is what rule R6 forbids. The Electrical module keeps what only Electrical owns: the per-vehicle **package** (which released drawings and BOM apply, purchase readiness, test results, as-built), the cable schedule and the electrical test records.

---

## 2. Current state (read from code, 07-Oct-2026)

| Area | Where | What it does today |
|---|---|---|
| Job + 20 stages | `models/job.py` (`ELECTRICAL_STAGES`, 5 phases: design / procurement / build / test_qc / handover), `service.py` (`stage_gate_problems`, `MANDATORY_STAGES = requirement, electrical_bom, electrical_testing, handover`) | One job per vehicle (`ELJ-YYYY-NNNN`), optional `erp_project_id`, free-text `rrv_model`. Status `draft → in_progress → handed_over → closed` (+ `on_hold`, `cancelled`). Commissioning and handover columns on the job. |
| BOM | `models/bom.py` → `electrical_bom_items` | Flat lines per job. `store_item_id` is **nullable**, with free-text description/make/part no. `selection_status` (proposed/selected/approved) and `procurement_status` (required/in_stock/pr_raised/ordered/received/issued) are on the same row, plus `p2p_request_id` and `panel_id`. |
| Drawings | `models/drawing.py` → `electrical_drawings`, `electrical_drawing_revisions` | Own register per job: R0, R1…, `draft → submitted → approved/rejected → superseded`, `is_as_built`, one SharePoint file per revision (`Electrical-media/<job>/<drawing>/`). The model docstring already says "fold into `design_documents` later". |
| Cables | `models/cable.py` | Cable schedule. Status `designed → cut → harnessed → installed → terminated → tested`. |
| Panels | `models/panel.py` | Panel lifecycle `designed → in_assembly → assembled → tested → installed` (R3 conflict: no electrical manufacturing). |
| Tests | `models/test_record.py` | `phase = factory | commissioning`, pass/fail, retest chain. |
| Issues | `models/issue.py` → `electrical_issues` | Troubleshooting log, `ISS-NNN` per job. |
| Documents | `models/document.py` | Attachments by category (includes `commissioning_report`, `handover_certificate`, `manual`). |
| Routes | `routes/*.py` (all `require_app_access("electrical")`; most writes use `require_tab_action("electrical", "jobs", "edit")`) | Endpoints are listed in §4.5. |
| Production link | `production/service.py` `rrv_stage_gate_problems` → `electrical_integration` | Requires every Electrical job of the build's machine (`erp_project_id`) to be `handed_over` / `closed`. `production/routes/rrv_builds.py` `_integration()` lists those jobs. |
| Frontend | `dashboard/electrical/{page, jobs, jobs/[id], jobs/new, drawings, purchase, testing, troubleshooting, project-work}`; `components/electrical/*` (job detail tabs: stages, details, bom, panels, cables, drawings, tests, issues, handover, documents) | Nav: Dashboard · Project Work · RRV Jobs · Drawings · Purchase Req. · Testing · Troubleshooting |
| Permissions | `core/permission_registry.py` `MODULES["electrical"]` | Subtabs `dashboard, project_work, jobs, drawings, purchase, testing, troubleshooting` |
| Audit | `core/audit_registry.py` lines ~346–381 | All 9 models registered |
| Tests | `backend/app/tests/test_electrical.py` | Assumes 20 stages |

**Note on §25 "Projects tab":** the current code has **no** Electrical "Projects" tab. The `Project Work` tab is the app-wide PM work inbox (`components/projects/work/DepartmentWork`, `MyTasks`), and every department module has one. It is PM's own view, not a duplicate of PM, so it **stays**.

---

## 3. Target scope

**In scope:** electrical requirement per vehicle → schematic and wiring drawings (Design register) → Electrical system BOM (shared engine, Item Master items only, all *Buy*) → EBOM release (four-eyes) → purchase readiness → installation on the RRV (a Production stage, mirrored here) → factory electrical tests + QC sign-off → as-built drawing revision.

**Out of scope (removed or hidden):** electrical component manufacturing and the panel build lifecycle (R3), monitoring of any kind (R5), the separate commissioning lifecycle (commissioning belongs to RRV handover / Service), maintenance of electrical systems, the troubleshooting log (now RRV Build rework), and the own drawing register (R6).

---

## 4. Current → target mapping

### 4.1 Stages (20 → 8)

| # | New key | New stage | Gate (what must be true to complete it) | N/A allowed | Old stages folded in |
|---|---|---|---|---|---|
| 1 | `requirement` | Electrical Requirement | `system_voltage` set **and** customer spec / tender clause attached (`customer_spec_ref` or a `requirement_spec` document) | No | `requirement` |
| 2 | `schematic_wiring` | Schematic & Wiring Drawing | ≥1 linked Design document of type `schematic` / `wiring_diagram` with a **released** revision. No linked document has an open revision. | No | `schematics`, `drawing_revision` (`system_design` is dropped) |
| 3 | `electrical_bom` | Electrical BOM | The package's system BOM (`design_bom_id`) has a revision with ≥1 line. Every line is an Item Master item with make + part no. + qty, and no line is *Make* (R3). The cable schedule is required only when the §35 setting is on. | No | `electrical_bom`, `component_selection`, `component_specification`, `cable_design` |
| 4 | `ebom_release` | EBOM Release | The system BOM has a **released** revision (checker ≠ maker, approver = Electrical head). Pushed to Engineering through the master BOM's section line (Engineering §5.3). | No | — (new) |
| 5 | `purchase_requirement` | Purchase Requirement | No line in *To Buy*: each line is in stock, reserved, or on a PR (§5.3) | No | `purchase_requirement` |
| 6 | `installation` | Installation on RRV (wiring/harness) | The linked RRV Build's stage `electrical_integration` is **completed** (Production owns it) | No | `wiring_installation`, `electrical_assembly` |
| 7 | `testing_qc` | Electrical Testing & QC | Every required factory test type (§35 test master: IR, continuity, polarity, earth, lighting, horn, indicators, battery charging, functional) has a latest result of *pass*, there are no open failures, and the Quality inspection is passed or conditionally passed (existing `quality_inspection_id` flow) | No | `electrical_testing`, `inspection_qc` |
| 8 | `as_built` | As-built record | Every linked drawing flagged as-built has a revision released after stage 6 was completed, **or** N/A with the reason "built as drawn" | **Yes** (§35 default) | `as_built_records`, `final_documentation` |

**Retired stages (no successor):** `system_design` (2), `panel_design` (7), `panel_assembly` (13), `troubleshooting` (16), `commissioning` (17), `handover` (19). This matches the §25 list (2, 7, 8, 11, 13, 16, 17), with `component_specification` (8) and `electrical_assembly` (11) folded into stages 3 and 6 rather than dropped, because their evidence still matters.

**Phases** (the `PHASES` constant in `jobs/[id]/page.tsx` and `ELECTRICAL_PHASES`): `design` (1–4) · `procurement` (5) · `build` (6) · `test_qc` (7) · `records` (8). The old `handover` phase is removed.

**Mandatory (no N/A):** stages 1–7. `MANDATORY_STAGES` becomes `requirement, schematic_wiring, electrical_bom, ebom_release, purchase_requirement, installation, testing_qc`.

> **ERP standard / why — evidence gates, not checkboxes.** Each of the 8 stages completes only when another record proves it: a released document, a released BOM revision, a shortage run with no unraised lines, a completed Production stage, passing tests. That is why stages like "Component Selection" vanish. Picking a make and part number is a *field on the BOM line*, not a stage. A stage that only records "the engineer says so" adds clicks without adding control.

### 4.2 Package status

| Current | Target | Rule |
|---|---|---|
| `draft`, `in_progress`, `on_hold`, `cancelled` | unchanged | — |
| `handed_over` | **`completed`** | The package becomes `completed` when all 8 stages are done or N/A. There is no "handover" on an electrical package any more. The vehicle is handed over by Production (RRV Build stage 13). |
| `closed` | unchanged | Closing requires `completed` |

`ELECTRICAL_WORKING_STATUSES` becomes `draft, in_progress, completed` (as-built can still be recorded after completion).

### 4.3 Tables

| Table | Target | Phase | Notes |
|---|---|---|---|
| `electrical_jobs` | **Keep**, UI name "RRV Electrical Package" | EL-1 | Add `rrv_build_id` (FK `production_rrv_builds`, nullable, indexed). **One of `rrv_build_id` / `erp_project_id` is mandatory on create.** `design_bom_id` is added by **Engineering E-1** (Engineering §4.3). Do not add it twice; use a defensive `inspect` check. Commissioning/handover columns (`commissioning_location`, `commissioned_on`, `handover_to_name`, `handover_to_organization`, `handover_date`, `handover_remarks`, `handed_over_at`) are hidden in EL-0, read-only, and dropped in EL-4. `battery_spec` / `alternator_spec` stay as requirement fields. |
| `electrical_job_stages` | **Reseed** with the 8 stages, mapped from the old rows | EL-1 | Old rows go to the snapshot `electrical_job_stages_legacy_20` (dropped in EL-4). |
| `electrical_bom_items` | **Migrate** to `design_bom*` (Engineering §12.1), then read-only, then drop | EL-2 → EL-4 | The master plan's "add mandatory `store_item_id`" is **superseded** by Engineering §13. Do not extend this table. |
| `electrical_cables` | **Keep** as an optional cable schedule | EL-1 | Status `tested` is removed (testing is stage 7). Existing `tested` → `terminated`. |
| `electrical_panels` | **Keep** as an enclosure list only (tag, name, type, location, IP rating) | EL-1 | The lifecycle (`status`, `assembled_by_id`, `assembled_at`) is hidden in EL-0 and dropped in EL-4. BOM lines carry the panel tag in the line's location column (§5.2). |
| `electrical_drawings`, `electrical_drawing_revisions` | **Migrate** to `design_documents` / `design_document_revisions` / `design_revision_files`, then read-only, then drop | EL-2 → EL-4 | §8.4 |
| `electrical_tests` | **Keep**, factory only | EL-1 | `phase = commissioning` rows stay read-only history. New tests are forced to `factory`. `phase` is dropped in EL-4 after export. |
| `electrical_issues` | **Retire**. Open issues → `production_rework_orders` | EL-0 (hide/RO) → EL-1 (move) → EL-4 (drop) | §8.5 |
| `electrical_documents` | **Keep** | EL-0 | Categories `commissioning_report`, `handover_certificate` and `manual` are hidden for new uploads (old files stay). |
| **new** `electrical_job_documents` | Link package ↔ Design documents | EL-2 | `id, job_id FK, document_id FK design_documents, role (schematic / wiring / harness / panel_layout / cable_schedule / other), is_as_built bool, created_by_id, timestamps`, unique (`job_id`, `document_id`). Drawings are per model/project. The link says which ones this vehicle is built to. |
| **new** `legacy_migration_map` (shared with Hydraulic and Engineering) | Crosswalk old id → new id | EL-2 | `source_table, source_id, target_table, target_id, run_id, migrated_at, migrated_by_id`, unique (`source_table`, `source_id`, `target_table`). It makes the migration idempotent and proves "nothing left behind" before the drop. |

### 4.4 Screens and tabs

**Module nav** (`ElectricalNav.tsx`):

| Current tab | Target | Phase |
|---|---|---|
| Dashboard | Dashboard (KPIs reworked: packages by stage, EBOMs awaiting release, packages blocked on purchase, failed tests, as-built pending) | EL-1 |
| Project Work | **Keep** (app-wide PM inbox) | — |
| RRV Jobs | **Packages** (same route `/dashboard/electrical/jobs`, label change) | EL-0 label, EL-1 content |
| Drawings | **Drawings (Design register, discipline = electrical)**: read view plus "Open in Design" and "Link to package" | EL-2 |
| — | **BOM** (new): electrical system BOMs on the shared `BomLinesEditor` (Engineering §8) | EL-2 |
| Purchase Req. | **Purchase Requirement**: legacy lines until EL-3, then Engineering shortage runs filtered to electrical | EL-3 |
| Testing | Testing (factory only) | EL-0 |
| Troubleshooting | **Hidden** in EL-0. Read-only list under Reports → Retired data until EL-4. | EL-0 |
| — | **Reports** (new): EBOM per RRV, items to buy, long-lead electrical items, test results per RRV, Retired data exports | EL-1 / EL-3 |
| — | **Settings** (new, last tab, §35) | EL-3 |

**Package detail tabs** (`jobs/[id]/page.tsx`, `TAB_KEYS`):

| Current | Target |
|---|---|
| stages | Stages (8, new phases) |
| details | Details: requirement fields + **RRV Build** picker. The commissioning block is removed. |
| bom | BOM: EL-1 legacy (read-only once migrated). EL-2: the shared editor on `design_bom_id`, `discipline = electrical`. |
| panels | Panels: enclosure list only, no status column |
| cables | Cables: no "Tested" status |
| drawings | Drawings: linked Design documents (role, current released rev, as-built flag) |
| tests | Tests: no "phase" picker (factory) |
| issues | **Removed**. A banner links to the RRV Build's Rework tab. |
| handover | **Replaced by "QC"**: request the Quality inspection and show its status. The handover fields are removed. |
| documents | Documents (reduced categories) |

### 4.5 Endpoints

| Current endpoint | Target | Phase |
|---|---|---|
| `GET/POST /electrical/jobs`, `GET/PATCH/DELETE /electrical/jobs/{id}`, `hold`, `resume`, `cancel`, `close` | Keep. Payload gains `rrv_build_id`. Commissioning/handover fields are **rejected** with 422: "Commissioning and handover are no longer recorded on the electrical package — the RRV is handed over in Production → RRV Build → Handover." `close` requires `completed`. | EL-0 (reject fields), EL-1 |
| `POST /electrical/jobs/{id}/request-inspection` | Keep (stage 7) | — |
| `PATCH/POST /electrical/jobs/{id}/stages/{key}[/start|/complete|/not-applicable|/reopen]` | Keep paths. The key set changes. Old keys → 404: "Stage 'panel_design' was retired on <date> (rule R3)…" | EL-1 |
| `GET/POST/PATCH/DELETE /electrical/jobs/{id}/bom[/{item}]`, `link-pr`, `unlink-pr` | GET kept for history. Writes return **410** once that job's BOM has been migrated: "This BOM moved to the shared BOM engine as BOM-2026-0050 R0 — edit it on the BOM tab." | EL-2 |
| `GET /electrical/purchase-requirements` | Re-implemented over Engineering shortage runs (`/engineering/shortage-runs?discipline=electrical`) | EL-3 |
| `/electrical/jobs/{id}/cables*`, `bulk-status` | Keep. `tested` is rejected. | EL-1 |
| `/electrical/jobs/{id}/panels*` | Keep. `status` is ignored and hidden. | EL-0 |
| `GET /electrical/drawings`, `GET/POST /electrical/jobs/{id}/drawings`, `/drawings/{id}`, `/drawings/{id}/revisions`, `/revisions/{id}/file|submit|approve|reject|content` | EL-0: unchanged. EL-2: writes → 410 ("Drawings now live in Design → Drawings; this one is ELE-2026-0007 / legacy E-SCH-01"). GET and `content` stay until EL-4. | EL-2 |
| — | **New** `GET /electrical/jobs/{id}/documents-links`, `POST` (link a design doc with a role / as-built flag), `DELETE /…/{link_id}` | EL-2 |
| `/electrical/tests`, `/electrical/jobs/{id}/tests`, `/tests/{id}` | Keep. `phase` is forced to `factory`. | EL-0 |
| `/electrical/issues*`, `/electrical/jobs/{id}/issues*` | EL-0: GET only, writes → 410 ("Troubleshooting moved to Production → RRV Build → Rework"). EL-4: removed. | EL-0 |
| `/electrical/jobs/{id}/documents`, `/documents/{id}[/content]` | Keep | — |
| `GET /electrical/dashboard` | Reworked KPIs | EL-1 |
| `/electrical/lookups/*` | Keep. Add `GET /electrical/lookups/rrv-builds` (open builds with build number, model, serial). | EL-1 |
| — | **New** `GET /electrical/reports/{ebom-per-rrv|items-to-buy|long-lead|test-results}` (Excel) and `GET /electrical/reports/retired/{issues|drawings|bom|commissioning}.xlsx` | EL-0 (retired), EL-3 |

Every 409/410 message names the record, its state and the next step (real-error-messages rule).

---

## 5. Alignment with the Engineering BOM plan (no double migration)

### 5.1 What the Engineering plan already owns

- **The BOM engine and its migration.** `electrical_bom_items` → `design_bom*` with `discipline = electrical` and `bom_kind = system`, run by `engineering/migration.py` (`POST /engineering/admin/migrate/electrical?dry_run=true`). The rules (item mapping, new-item requests, per-model granularity, everything as draft R0) are in Engineering §12.1. **This plan does not define a second mapping.**
- **Authority.** `bom_authority(db, user, "electrical", action)` → `electrical:bom:create|edit|approve` (Engineering §3.1).
- **The `electrical_jobs.design_bom_id` column** (Engineering §4.3).

### 5.2 What this plan adds (Electrical-specific inputs to that migration)

| Legacy field | Goes to | Why |
|---|---|---|
| `panel_id` → panel tag | `design_bom_lines.location_ref` (**proposed new nullable column, String 50**; fallback: prefix in `remarks`) | Grouping by enclosure on the RRV ("JB-2", "Driver desk") is how the electrician reads the BOM. It also helps Hydraulic (manifold block). **Coordinate with the Engineering E-1 column list** (§12 collision note). |
| `category` | Suggests the Item Master category on new-item requests | Store creates codes faster |
| `rating`, `specification` | `new_item_spec` for unmapped lines. Ignored when mapped (the Item Master holds the spec). | One spec per item (R6) |
| `estimated_unit_cost` | Not migrated (exported) | Cost comes from the Item Master / last PO rate (Engineering §6) |
| `selection_status`, `procurement_status`, `p2p_request_id` | Not migrated. They stay in the read-only table and the export. | Engineering §12.1 step 4 |

### 5.3 Sequencing rule (avoids migrating twice)

```
EL-0 hide/read-only  ─►  EL-1 8 stages + RRV link  ─►  [Engineering E-1 lands]  ─►  EL-2:
    a) drawings → Design register (this plan §8.4)       ← FIRST, so BOM lines can reference the new doc ids
    b) BOM → design_bom (Engineering §12.1 tool)         ← second
    c) electrical_job_documents + jobs.design_bom_id backfill
─►  [Engineering E-3 shortage runs]  ─►  EL-3 purchase requirement on shortage runs
─►  EL-4 drop
```

**Interim stage 5 gate (before EL-3):** for packages whose BOM hasn't been migrated, use the existing rule (no legacy line in `required`). For migrated packages, use: every *Buy* line of the released system BOM revision has `available_qty ≥ qty` (`production.service.available_qty`), or an open PR/PO line matched by `part_code = item_code` (the same matching as Engineering §5.6). From EL-3, the gate is: "the latest Engineering shortage run for this package's system BOM × 1 RRV, in this project's context, is ≤ 14 days old and every shortage line has a `pr_number`."

> **ERP standard / why — migrate once, to the final shape.** Adding a mandatory `store_item_id` to `electrical_bom_items` (the master plan's §10 wording) would force users to clean every line in Electrical. Engineering E-1 would then make them re-check the same lines when moving to `design_bom_lines`. Data cleansing is the most expensive part of any ERP migration, so it is done once, in the target tables, with a dry-run report the Electrical lead signs off.

---

## 6. Link to Production → RRV Build

### 6.1 Stage catalog (Production §17)

The RRV Build stage `electrical_integration` **keeps its key** (no data migration on `production_rrv_build_stages`). Only its label changes, to **"Electrical Installation (wiring/harness)"**. The Hydraulic/Pneumatic split, which adds `pneumatic_integration` and renumbers `sequence`, is specified in the Hydraulic plan §6. Both changes ship in **one** Production commit.

### 6.2 Gate changes in `production/service.py` → `rrv_stage_gate_problems`

**`electrical_integration`** (replaces "all Electrical jobs handed_over/closed"):

```
packages = electrical_jobs where rrv_build_id = build.id
           (fallback until backfilled: erp_project_id = build.erp_project_id), status != cancelled
none   → "There's no Electrical package for RRV build RRV-2026-0012. Ask Electrical to create one
          (Electrical → Packages → New, pick this build), or mark this stage N/A with a reason."
each   → stages requirement, schematic_wiring, electrical_bom, ebom_release, purchase_requirement done:
          "Electrical package ELJ-2026-0004 hasn't finished 'EBOM Release' — the Electrical head must
           release BOM-2026-0050 before installation can be signed off."
checklist (this RRV Build stage): all items ticked and signed:
          "Tick every item of the electrical installation checklist (6 of 9 done) and sign it."
```

**`final_assembly`** gains: every linked package has `testing_qc` completed. "Electrical package ELJ-2026-0004 has 2 failed tests without a passing retest (T-003, T-007). Electrical must close them before final assembly."

**Why the test gate sits on Final Assembly and not on stage 5:** package stage 6 (Installation) is completed *from* RRV Build stage 5, and the tests (package stage 7) can only run after installation. Putting the test check on stage 5 would create a circular gate. The order is: Package 1–5 → RRV stage 5 (checklist) → Package 6 (mirror) → Package 7 (tests) → RRV stage 8 Final Assembly.

### 6.3 Installation checklist (new, Production-side)

- Production adds a **`checklist` JSON column on `production_rrv_build_stages`**: `[{"text", "done", "by_id", "at"}]` plus `signed_by_id` and `signed_at`. The JSON is seeded when the stage starts, from the Electrical setting "Installation checklist template" (§35: harness routing, clamping, grommets, labels, earthing, fuse ratings). Hydraulic and Pneumatic use the same column with their own templates (Hydraulic plan §6.3).
- The electrician works in **Production** (they have the Production app, not Electrical). That is why the checklist lives on the RRV Build stage and not on the package.
- **Labour:** electrical installation hours are booked on the RRV Build's **main WO**, and no electrical WO exists (R4, Production §17 change 2). No change is needed. Note the convention in the RRV Build help text.

### 6.4 Package stage 6 (mirror)

Package stage `installation` has gate "the linked RRV Build stage `electrical_integration` is completed". The package's *Complete* button is enabled only then. No cross-module write is made: Production never writes Electrical rows.

### 6.5 `_integration()` panel (`production/routes/rrv_builds.py`)

It shows each linked package with its current stage, stages 1–5 done (y/n), the testing_qc state and a link. It is read by `rrv_build_id`, with `erp_project_id` as the fallback.

> **ERP standard / why — installation is a production operation; design and test evidence are engineering's.** The RRV Build is the *production order* of the vehicle. Fitting the harness is an operation on it, with labour booked to the vehicle's order (cost roll-up, D5). Electrical owns *what* is fitted (released drawings/BOM) and *whether it works* (routine tests on each vehicle). Splitting it this way stops two departments from each claiming "done" for the same physical work.

---

## 7. Permission registry changes

### 7.1 `MODULES["electrical"]` (`core/permission_registry.py`)

| Phase | Subtabs |
|---|---|
| Today | `dashboard, project_work, jobs ("RRV Electrical Jobs"), drawings, purchase, testing, troubleshooting` |
| EL-0 | `jobs` label → "RRV Electrical Packages". `troubleshooting` label → "Troubleshooting (retired, read-only)" (the key stays so existing grants don't break). Add `reports`. |
| EL-2 | Add `bom` ("Electrical BOM"), as Engineering §3.1/§10 expect. `drawings` label → "Drawings (Design register)". |
| EL-3 | Add `settings` ("Settings", last) |
| EL-4 | Remove `troubleshooting` |

### 7.2 Grant migration (one Alembic data step per phase, idempotent)

`users.granular_permissions` is a JSON list of `module:subtab:action`. The defaults below keep people working. **Admin reviews them in the Permission Matrix after deploy.**

| New grant | Given to users who have | Reason |
|---|---|---|
| `electrical:reports:view` | `electrical:dashboard:view` | Read-only |
| `electrical:bom:view/create/edit` | `electrical:jobs:edit` | Same people edited BOM lines on the job |
| `electrical:bom:approve` | `electrical:drawings:approve` | Heads who approved drawings release EBOMs (four-eyes still enforced in code) |

```sql
-- EL-2 example (Postgres; JSON column). Adds electrical:bom:approve to drawing approvers.
UPDATE users
   SET granular_permissions = (granular_permissions::jsonb || '["electrical:bom:approve"]'::jsonb)::json
 WHERE granular_permissions::jsonb ? 'electrical:drawings:approve'
   AND NOT granular_permissions::jsonb ? 'electrical:bom:approve';
```

Users with **no** matrix grants for `electrical` remain unrestricted (`can_view_tab` behaviour), so they need no change.

### 7.3 Design register access for electrical engineers (EL-2)

Today `design/routes/documents.py` is gated by `require_app_access("design")`, and writes need Design team membership (`design/access.require_team`). The recommended change, symmetric with Engineering's `bom_authority`, is a **`doc_authority(db, user, discipline, action)`** in the Design module:

| Discipline | Author / checker | Approver (release) |
|---|---|---|
| mechanical, structural, … | Design team (unchanged) | Design `head` (D6, unchanged) |
| electrical | `electrical:drawings:create/edit` | The Electrical department head, **or a user the head assigns** as release delegate (holding `electrical:drawings:approve`) |

The read endpoints widen to `require_any_app_access("design", "electrical", "hydraulic", "pneumatic")`, with non-Design users filtered to their disciplines. **Decided 2026-10-07 (owner decision #2, §13):** electrical drawings are released in the Design register by the Electrical department head **or a user the head assigns**. Design keeps numbering, revisions and ECN. The fallback (Electrical engineers on the Design app, Design head releasing) is not taken. `doc_authority` must therefore check "is the discipline head, or is a release delegate the head has assigned" — the assignment is made by the head (not by Admin), recorded with who assigned it and when, and revocable by the head. Four-eyes still applies: the releaser cannot be the author.

---

## 8. Data migration

### 8.1 Backup (before **every** phase that changes data: EL-1, EL-2, EL-4)

```bash
# 0. Is this the database we think it is? (prod was found fresh on 05-Oct-2026)
psql "$DATABASE_URL" -c "select min(created_at), count(*) from users;"
psql "$DATABASE_URL" -c "
  select 'electrical_jobs', count(*) from electrical_jobs union all
  select 'electrical_job_stages', count(*) from electrical_job_stages union all
  select 'electrical_bom_items', count(*) from electrical_bom_items union all
  select 'electrical_drawings', count(*) from electrical_drawings union all
  select 'electrical_drawing_revisions', count(*) from electrical_drawing_revisions union all
  select 'electrical_issues', count(*) from electrical_issues union all
  select 'electrical_tests', count(*) from electrical_tests;"
# 1. Full dump + module dump, kept in D:\PremnathrailBackup\dumps
pg_dump -Fc "$DATABASE_URL" -f "prod-$(date +%Y%m%d-%H%M)-pre-EL-<phase>.dump"
pg_dump -Fc "$DATABASE_URL" -t 'electrical_*' -t production_rrv_build_stages -t production_rework_orders \
        -f "electrical-$(date +%Y%m%d-%H%M)-pre-EL-<phase>.dump"
# 2. Verify the dump is restorable (lists tables; non-zero TABLE DATA entries)
pg_restore --list "electrical-…dump" | grep -c "TABLE DATA"
```

Record the row counts in the release note. The post-migration checks in §8.6 compare against them. If the counts are tiny (prod reset), the data steps still run, because they are idempotent and cheap. Only the human-review steps (§8.4 duplicates, Engineering §12.1 item mapping) become trivial.

### 8.2 EL-0: read-only guards (no data change)

Two layers protect the retired tables:

1. **API:** writes to issues, commissioning fields and commissioning-phase tests return 410/422 with the real reason (§4.5).
2. **Database (Postgres only; Alembic checks `dialect.name`):** a guard trigger, so no forgotten code path or script can write.

```sql
CREATE OR REPLACE FUNCTION app_retired_table_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is retired and read-only since % (%). Data is exported under Reports → Retired data.',
    TG_TABLE_NAME, TG_ARGV[0], TG_ARGV[1] USING ERRCODE = 'P0001';
END $$ LANGUAGE plpgsql;

-- No Electrical trigger in EL-0: the open issues are still moved by EL-1 (§8.5), so the
-- API-level block is enough until then.
-- EL-1 (last step of the migration, after the issue move):
CREATE TRIGGER trg_retired_guard BEFORE INSERT OR UPDATE OR DELETE ON electrical_issues
  FOR EACH STATEMENT EXECUTE FUNCTION app_retired_table_guard('<EL-1 date>', 'R4: troubleshooting → RRV Build rework');
-- EL-2 (after drawing + BOM migration verified):
CREATE TRIGGER trg_retired_guard BEFORE INSERT OR UPDATE OR DELETE ON electrical_drawings          FOR EACH STATEMENT EXECUTE FUNCTION app_retired_table_guard('<EL-2 date>', 'R6: Design register');
CREATE TRIGGER trg_retired_guard BEFORE INSERT OR UPDATE OR DELETE ON electrical_drawing_revisions FOR EACH STATEMENT EXECUTE FUNCTION app_retired_table_guard('<EL-2 date>', 'R6: Design register');
CREATE TRIGGER trg_retired_guard BEFORE INSERT OR UPDATE OR DELETE ON electrical_bom_items         FOR EACH STATEMENT EXECUTE FUNCTION app_retired_table_guard('<EL-2 date>', 'R6: shared BOM engine');
```

The function is created once (shared with Hydraulic; `CREATE OR REPLACE` makes it safe to create from either migration). Each `downgrade()` drops its triggers.

### 8.3 EL-1: stages 20 → 8 (Alembic data step, pure SQL, deterministic)

```sql
-- 1. Snapshot (kept until EL-4)
CREATE TABLE electrical_job_stages_legacy_20 AS SELECT * FROM electrical_job_stages;

-- 2. Mapping (NULL = retired, ignored for status)
CREATE TEMP TABLE el_stage_map(old_key text PRIMARY KEY, new_key text);
INSERT INTO el_stage_map VALUES
 ('requirement','requirement'), ('system_design',NULL), ('schematics','schematic_wiring'),
 ('component_selection','electrical_bom'), ('electrical_bom','electrical_bom'), ('cable_design','electrical_bom'),
 ('panel_design',NULL), ('component_specification','electrical_bom'), ('drawing_revision','schematic_wiring'),
 ('purchase_requirement','purchase_requirement'), ('electrical_assembly','installation'),
 ('wiring_installation','installation'), ('panel_assembly',NULL), ('electrical_testing','testing_qc'),
 ('inspection_qc','testing_qc'), ('troubleshooting',NULL), ('commissioning',NULL),
 ('final_documentation','as_built'), ('handover',NULL), ('as_built_records','as_built');

CREATE TEMP TABLE el_new_catalog(new_key text PRIMARY KEY, seq int);
INSERT INTO el_new_catalog VALUES ('requirement',1),('schematic_wiring',2),('electrical_bom',3),('ebom_release',4),
 ('purchase_requirement',5),('installation',6),('testing_qc',7),('as_built',8);

-- 3. Aggregate old rows per (job, new stage)
CREATE TEMP TABLE el_agg AS
SELECT s.job_id, m.new_key,
       bool_and(s.status IN ('completed','not_applicable')) AS all_done,
       bool_or (s.status = 'completed')                     AS any_completed,
       bool_or (s.status IN ('in_progress','completed'))    AS any_started,
       min(s.started_at) AS started_at, max(s.completed_at) AS completed_at,
       (array_agg(s.completed_by_id ORDER BY s.completed_at DESC NULLS LAST))[1] AS completed_by_id,
       (array_agg(s.assignee_id ORDER BY s.sequence) FILTER (WHERE s.assignee_id IS NOT NULL))[1] AS assignee_id,
       min(s.planned_start_date) AS planned_start_date, max(s.planned_end_date) AS planned_end_date,
       string_agg(s.stage_key || ': ' || s.remarks, ' | ' ORDER BY s.sequence) FILTER (WHERE s.remarks IS NOT NULL) AS remarks
  FROM electrical_job_stages_legacy_20 s JOIN el_stage_map m ON m.old_key = s.stage_key
 WHERE m.new_key IS NOT NULL
 GROUP BY s.job_id, m.new_key;

-- 4. Replace rows (unique (job_id, stage_key) forces delete-then-insert)
DELETE FROM electrical_job_stages;
INSERT INTO electrical_job_stages (job_id, stage_key, sequence, status, assignee_id, planned_start_date, planned_end_date,
                                   started_at, completed_at, completed_by_id, remarks, created_at, updated_at)
SELECT j.id, c.new_key, c.seq,
       CASE
         WHEN j.status IN ('handed_over','closed') AND c.new_key IN ('ebom_release') THEN 'not_applicable'
         WHEN a.all_done AND a.any_completed THEN 'completed'
         WHEN a.all_done                     THEN 'not_applicable'
         WHEN a.any_started                  THEN 'in_progress'
         ELSE 'not_started' END,
       a.assignee_id, a.planned_start_date, a.planned_end_date, a.started_at, a.completed_at, a.completed_by_id,
       CASE WHEN j.status IN ('handed_over','closed') AND c.new_key = 'ebom_release'
            THEN 'Package finished before the 8-stage scope (migrated <EL-1 date>); no four-eyes EBOM release existed.'
            ELSE a.remarks END,
       now(), now()
  FROM electrical_jobs j CROSS JOIN el_new_catalog c
  LEFT JOIN el_agg a ON a.job_id = j.id AND a.new_key = c.new_key;

-- 5. Status
UPDATE electrical_jobs SET status = 'completed' WHERE status = 'handed_over';
-- 6. Cables / tests
UPDATE electrical_cables SET status = 'terminated' WHERE status = 'tested';
-- (electrical_tests.phase = 'commissioning' rows are left as history)
```

`downgrade()` restores from the snapshot (`DELETE …; INSERT … SELECT * FROM electrical_job_stages_legacy_20;` and `UPDATE electrical_jobs SET status='handed_over' WHERE status='completed'`).

**Backfill `rrv_build_id`** (only where unambiguous; the rest go to a report):

```sql
UPDATE electrical_jobs j SET rrv_build_id = b.id
  FROM production_rrv_builds b
 WHERE j.rrv_build_id IS NULL AND j.erp_project_id IS NOT NULL
   AND b.erp_project_id = j.erp_project_id AND b.is_deleted = false
   AND (SELECT count(*) FROM production_rrv_builds b2
         WHERE b2.erp_project_id = j.erp_project_id AND b2.is_deleted = false) = 1;
```

### 8.4 EL-2: drawings → Design register (admin-triggered, dry-run first)

This runs through the same framework as Engineering §12: `POST /engineering/admin/migrate/electrical_drawings?dry_run=true`. That is a new **source** in `engineering/migration.py`, not a second tool. It is Python because `doc_number` comes from `design/access.next_number` (`<TYPE>-<YEAR>-NNNN`), and duplicates need human review. The SQL below is what each run does per drawing, inside one transaction per drawing.

**Prerequisite (Design session, master plan §8 item 1):** document types `wiring_diagram`, `harness_drawing`, `panel_layout` exist in `DESIGN_DOCUMENT_TYPES`.

| `electrical_drawings.drawing_type` | `design_documents.document_type` |
|---|---|
| `schematic`, `single_line` | `schematic` |
| `wiring_diagram`, `panel_wiring` | `wiring_diagram` |
| `harness` | `harness_drawing` |
| `panel_ga` | `panel_layout` |
| `layout` | `ga_drawing` |
| `cable_schedule` | `specification` |
| `other` | `other` |

| `electrical_drawing_revisions.status` | `design_document_revisions.status` |
|---|---|
| `draft` | `draft` |
| `submitted` | `in_review` |
| `approved` (latest approved) | `released` |
| `approved` (older) / `superseded` | `superseded` |
| `rejected` | `superseded`, with `change_summary` = "Rejected in Electrical module: <decision_comment>" (Design has no *rejected*; the revision index is kept so labels stay continuous) |

```sql
-- per drawing d (not deleted), skipping any already in legacy_migration_map
INSERT INTO design_documents (doc_number, title, description, document_type, discipline, erp_project_id,
                              legacy_number, owner_id, created_by_id, status, created_at, updated_at, is_deleted)
VALUES (:next_number, d.title, d.description, :mapped_type, 'electrical', j.erp_project_id,
        d.drawing_number, d.created_by_id, d.created_by_id, 'active', d.created_at, now(), false)
RETURNING id INTO :doc_id;

-- per revision r of d, ordered by revision_index
INSERT INTO design_document_revisions (document_id, revision_index, revision_label, status, change_summary,
       created_by_id, submitted_at, approved_by_id, approved_at, approval_comment,
       released_by_id, released_at, created_at, updated_at, is_deleted)
VALUES (:doc_id, r.revision_index, r.revision_label, :mapped_status, coalesce(:rejected_note, r.change_summary),
       r.prepared_by_id, r.submitted_at,
       CASE WHEN r.status='approved' THEN r.decided_by_id END, CASE WHEN r.status='approved' THEN r.decided_at END,
       r.decision_comment,
       CASE WHEN :mapped_status='released' THEN r.decided_by_id END, CASE WHEN :mapped_status='released' THEN r.decided_at END,
       r.created_at, now(), false)
RETURNING id INTO :rev_id;

INSERT INTO design_revision_files (revision_id, file_role, file_name, sharepoint_path, sharepoint_url, file_size,
                                   mime_type, uploaded_by_id, created_at, updated_at, is_deleted)
SELECT :rev_id, 'primary', r.file_name, r.sharepoint_path, r.sharepoint_url, r.file_size, r.mime_type,
       r.prepared_by_id, r.created_at, now(), false
 WHERE r.file_name IS NOT NULL;

INSERT INTO legacy_migration_map (source_table, source_id, target_table, target_id, run_id, migrated_at, migrated_by_id)
VALUES ('electrical_drawings', d.id, 'design_documents', :doc_id, :run, now(), :admin),
       ('electrical_drawing_revisions', r.id, 'design_document_revisions', :rev_id, :run, now(), :admin);

INSERT INTO electrical_job_documents (job_id, document_id, role, is_as_built, created_by_id, created_at, updated_at)
VALUES (d.job_id, :doc_id, :role_from_type, d.is_as_built, :admin, now(), now());
```

- **Files are not copied.** The new file rows point at the same SharePoint path. Verify before EL-2 that Design's `GET …/content` (`design/files.py`) serves any SharePoint path, not only `Design-media/…`. If it doesn't, copy files in the dry run and report the count.
- **Migrated released revisions are history, not a fresh four-eyes release.** `reviewed_by_id` stays NULL and a Design event "Migrated from Electrical drawing E-SCH-01 R2 (approved by A. Kumar on 12-Sep-2026)" is written. The next change goes through Design's normal flow / ECN.
- **Duplicates:** the same `drawing_number` (trimmed, case-insensitive) on several jobs, which are per-vehicle copies. The dry run lists them. The default is to migrate the copy with the highest approved revision as the document and link the other jobs to it through `electrical_job_documents`. Other copies' revisions are exported, not migrated.
- **Order:** drawings first, then the Engineering BOM migration, so system BOM headers can carry `document_id` of the migrated schematic (Engineering §12.1 gains a "resolve drawing via `legacy_migration_map`" step).

### 8.5 EL-1: open troubleshooting issues → RRV Build rework

Run in Python (`rework_number` comes from Production's number series). Per issue:

```sql
-- candidates
SELECT i.*, j.job_number, j.rrv_build_id
  FROM electrical_issues i JOIN electrical_jobs j ON j.id = i.job_id
 WHERE i.is_deleted = false AND i.status IN ('open','investigating');

-- for each with j.rrv_build_id IS NOT NULL
INSERT INTO production_rework_orders (rework_number, build_id, source, title, defect_description, root_cause,
       corrective_action, assigned_to_id, status, hours_spent, created_by_id, created_at, updated_at, is_deleted)
VALUES (:next_rwk, j.rrv_build_id, 'internal',
        left('Electrical: ' || i.title || ' (was ' || j.job_number || ' / ' || i.issue_number || ')', 255),
        i.symptom, i.root_cause, i.corrective_action, i.assigned_to_id,
        CASE i.status WHEN 'open' THEN 'open' ELSE 'in_progress' END, 0, i.reported_by_id, i.created_at, now(), false);
INSERT INTO legacy_migration_map VALUES ('electrical_issues', i.id, 'production_rework_orders', :rwk_id, :run, now(), :admin);
```

Issues whose job has no build are listed in the dry-run report. The Electrical lead links the job to a build (then re-runs) or closes the issue with a reason **before** the EL-1 guard trigger goes on. Resolved/closed issues are history only (export).

### 8.6 Post-migration checks (every phase)

```sql
-- every job has exactly 8 stage rows
SELECT job_id FROM electrical_job_stages GROUP BY job_id HAVING count(*) <> 8;            -- expect 0 rows
-- no live drawing left unmapped (EL-2)
SELECT d.id FROM electrical_drawings d WHERE d.is_deleted = false
   AND NOT EXISTS (SELECT 1 FROM legacy_migration_map m WHERE m.source_table='electrical_drawings' AND m.source_id=d.id)
   AND NOT EXISTS (SELECT 1 FROM electrical_job_documents x JOIN design_documents dd ON dd.id=x.document_id
                    WHERE x.job_id=d.job_id AND lower(trim(dd.legacy_number))=lower(trim(d.drawing_number)));  -- expect 0
-- no open issue left behind (EL-1)
SELECT id FROM electrical_issues i WHERE is_deleted=false AND status IN ('open','investigating')
   AND NOT EXISTS (SELECT 1 FROM legacy_migration_map m WHERE m.source_table='electrical_issues' AND m.source_id=i.id); -- expect 0
```

### 8.7 Export (before the read-only period ends)

`GET /electrical/reports/retired/{issues|drawings|bom|commissioning}.xlsx` produces one sheet per table with every column plus resolved names (user, job number, PR number). The Electrical head downloads them and files them in SharePoint `Electrical-media/_retired/<date>/`. **EL-4 does not start until the owner confirms these files are filed** (§10 exit criterion).

### 8.8 EL-4: drop (separate Alembic migration, ≥1 release after EL-2)

Pre-check: backup (§8.1), exports filed (§8.7), and §8.6 checks still at 0 rows. Then:

```sql
DROP TABLE IF EXISTS electrical_issues;                 -- FKs to tests/panels/cables point *from* it
DROP TABLE IF EXISTS electrical_bom_items;              -- only after Engineering confirms its migration report is signed
DROP TABLE IF EXISTS electrical_drawing_revisions;
DROP TABLE IF EXISTS electrical_drawings;
DROP TABLE IF EXISTS electrical_job_stages_legacy_20;
ALTER TABLE electrical_jobs  DROP COLUMN commissioning_location, DROP COLUMN commissioned_on, DROP COLUMN handover_to_name,
                             DROP COLUMN handover_to_organization, DROP COLUMN handover_date, DROP COLUMN handover_remarks,
                             DROP COLUMN handed_over_at;
ALTER TABLE electrical_panels DROP COLUMN status, DROP COLUMN assembled_by_id, DROP COLUMN assembled_at;
DELETE FROM electrical_tests WHERE phase = 'commissioning';   -- exported in 8.7
ALTER TABLE electrical_tests DROP COLUMN phase;
```

`downgrade()` recreates the empty structures only. Data comes back from the dump. Say so in the migration docstring.

**The same commit must also** (deploy-crash rule, memory "model import sync"): delete `models/issue.py`, `models/drawing.py` and `models/bom.py` and their routes/schemas. Remove their imports from `alembic/env.py` and `main.py`, and their `register_audited` lines from `core/audit_registry.py`. Remove `troubleshooting` from the registry. Remove the dead frontend pages/components (`troubleshooting/`, `IssuesTab`, `DrawingsTab` legacy parts, `HandoverTab`) and the `electricalApi` methods and types in `lib/api.ts` / `types/index.ts`. Update `lib/tour/modules/electrical.ts` and the `NotificationBell` ENTITY_LINK entries.

---

## 9. UI hide steps (EL-0, one release, no schema change)

1. `ElectricalNav.tsx`: remove the Troubleshooting tab and rename "RRV Jobs" → "Packages". Add "Reports" (Retired data exports only for now).
2. `jobs/[id]/page.tsx`: remove the `issues` tab and add a banner on the Stages tab: "Troubleshooting has moved to Production → RRV Build → Rework (from <EL-1 date>). Existing issues are read-only under Reports → Retired data."
3. `HandoverTab.tsx`: hide the commissioning + handover fields. Keep only "Request QC Inspection" and its status (label "QC").
4. `TestsTab.tsx`: hide the phase picker (default `factory`). Commissioning tests show greyed with a "history" tag.
5. `PanelsTab.tsx`: hide the status column and the bulk-status action.
6. `DocumentsTab.tsx`: hide the categories `commissioning_report`, `handover_certificate` and `manual` in the upload picker.
7. `JobForm.tsx`: drop the commissioning/handover inputs. Add the **RRV Build** picker (`/electrical/lookups/rrv-builds`) in EL-1.
8. `app/dashboard/page.tsx` landing card description → "RRV electrical package — requirement, drawings (Design register), EBOM, purchase readiness, installation on the RRV, factory tests and as-built." The Sidebar label is unchanged.
9. Backend: reject the retired fields/writes (§4.5). No guard triggers yet (§8.2).
10. Tour (`lib/tour/modules/electrical.ts`): remove the Troubleshooting step and update the job → package wording.

UI rules: nav above the header, "← Back" secondary pill top-right, `ConfirmDialog`/`PromptDialog` only, real error messages.

---

## 10. Phased delivery

| Phase | Content | Depends on | Exit criteria |
|---|---|---|---|
| **EL-0 Hide** (1 release) | §9 UI hides; API rejects retired writes; Reports → Retired data exports; registry labels; backup taken | — | No user can create an issue, commissioning test or commissioning/handover value from the UI or the API. Exports download with all rows. `test_electrical.py` is updated for the rejections and passes. |
| **EL-1 Re-scope core** | 8-stage catalog + gates (`service.py`); stage data migration §8.3; status `handed_over → completed`; `rrv_build_id` + backfill; issues → rework §8.5 + guard trigger; cables `tested` removed; RRV Build gate changes §6 + checklist column (one Production commit, shared with the Hydraulic plan); dashboard KPIs | Production commit coordinated (§12) | Every job shows 8 stages, and none shows a retired key. A test build: RRV stage 5 is refused until package stages 1–5 are done and the checklist is signed. After it completes, package stage 6 can be completed. Final Assembly is refused while a package test has an open failure. Zero open issues are left unmapped. `test_rrv_builds.py` and `test_electrical.py` are green. |
| **EL-2 Shared registers** | Design `doc_authority` + read widening (Design session); doc types; drawing migration §8.4; Engineering BOM migration for electrical (Engineering §12.1); `electrical_job_documents`; BOM tab on the shared editor; stage 2/3/4/8 gates on Design/BOM state; legacy drawing/BOM writes → 410; guard triggers | **Engineering E-1** committed; Design session committed | An Electrical engineer, **without the Design app**, creates a wiring diagram, gets it checked and released by the Electrical head (or the head's assigned delegate), links it to a package, edits the system BOM, and releases it. Every legacy drawing and BOM line has a `legacy_migration_map` row or a dry-run report entry signed by the Electrical lead. |
| **EL-3 Purchase + reports + settings** | Stage 5 on Engineering shortage runs; Purchase Requirement tab; reports (EBOM per RRV, items to buy, long-lead, test results per RRV); §35 settings (test master + limits, checklist template, voltages, wastage %, cable schedule required, N/A-able stages) | **Engineering E-3** | For one package: a shortage run shows the to-buy lines, "Raise PR" opens the P2P prefill, and after the PR is submitted stage 5 completes. A test with IR 0.5 MΩ against a 1 MΩ limit is judged *fail*. |
| **EL-4 Drop** (≥1 release after EL-2 in production) | §8.8 | Exports filed and confirmed by the owner; Engineering BOM migration signed | `alembic upgrade head` on a copy of the prod dump succeeds. The app boots. No route, page or tour references a dropped table or field (grep). The audit registry imports are clean. |

---

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Parallel sessions edit the same shared files (§12) | Clobbered work, forked Alembic head | Re-read before each edit and use small anchored inserts. Run `alembic heads` right before writing `down_revision`. Upgrade the dev DB only to our own revision. |
| Circular gates between the package and the RRV Build | Neither can complete | The order is fixed in §6.2 and covered by a test (build stage 5 → package 6 → package 7 → build stage 8). |
| Duplicate drawing numbers across per-vehicle jobs | Duplicate Design documents | Dry-run duplicate report; one document, many job links (§8.4) |
| Design `content` endpoint can't read `Electrical-media` paths | Migrated revisions without viewable files | Verify in the EL-2 dry run; copy files if needed |
| Users lose access to drawings when the Electrical register goes read-only | Work stops | EL-2 ships `doc_authority` and the read widening in the **same** release as the 410s |
| Package per vehicle vs BOM per model (Engineering Q3) | Per-vehicle deviations get lost | Engineering's dry run lists "deviations to review". Real per-vehicle differences become a project variant or an ECN. |
| Stage-count change breaks old reports/tests that assume 20 | Test failures, wrong progress % | `job_progress` already uses `len(stages)`. Update `test_electrical.py` in EL-1. |
| The prod DB may hold little or no data (05-Oct reset) | Wasted review effort | Check row counts first (§8.1). Human-review steps are skipped when empty, but migrations still run so code paths are exercised. |
| Model deletions in EL-4 without the import sync | Deploy crash (has happened before) | §8.8 checklist; boot the app on the dump copy before pushing |

---

## 12. Collision status (`git status`, 07-Oct-2026)

| File / area | Status | This plan touches it in | Handling |
|---|---|---|---|
| `backend/app/modules/electrical/**` (models, routes, schemas, service) | **Clean** | EL-0…EL-4 | Ours. Still re-read before editing. |
| `backend/app/tests/test_electrical.py` | Clean | EL-0, EL-1 | Ours |
| `backend/app/core/permission_registry.py` | **Modified (uncommitted, other sessions)** | EL-0, EL-2, EL-3, EL-4 | Anchored edit inside `"electrical": {…}` only |
| `backend/app/core/audit_registry.py` | **Modified** | EL-2 (new link table), EL-4 (removals) | Anchored |
| `backend/app/main.py`, `backend/alembic/env.py` | **Modified** | EL-2, EL-4 | Anchored, plus the import-sync check |
| `backend/app/modules/main/models/user.py` | **Modified** | — (no new app key for Electrical) | — |
| `backend/alembic/versions/` | Many untracked migrations from other sessions | Every phase | `alembic heads` first. Our migrations only. |
| `backend/app/modules/production/service.py`, `production/models/rrv_build.py` | **Clean** | EL-1 (gates, checklist column) | One coordinated Production commit with the Hydraulic split |
| `backend/app/modules/production/routes/rrv_builds.py`, `backend/app/tests/test_rrv_builds.py` | **Modified (another session)** | EL-1 (`_integration()`, tests) | Wait for that session's commit, or make a minimal anchored edit |
| `backend/app/modules/design/models/document.py`, `design/routes/documents.py`, `design/service.py` | **Modified**; `design/access.py`, `design/models/bom.py`, `design/bom_service.py` **untracked** | EL-2 (doc types, `doc_authority`, read widening) | **Do not start EL-2 until the Design session has committed**. Same rule as Engineering §14. |
| `backend/app/modules/engineering/**` | Doesn't exist yet | EL-2/EL-3 (migration source, shortage) | Owned by the Engineering build |
| `frontend/src/components/electrical/ElectricalNav.tsx` | **Modified (uncommitted)** | EL-0, EL-2, EL-3 | Re-read and keep the other session's change (likely the Project Work tab) |
| `frontend/src/app/dashboard/electrical/project-work/` | **Untracked (other session)** | — | Leave as is |
| `frontend/src/app/dashboard/electrical/{jobs, drawings, purchase, testing, troubleshooting}`, `components/electrical/*` (other than the Nav) | Clean | EL-0…EL-4 | Ours |
| `frontend/src/lib/api.ts`, `frontend/src/types/index.ts`, `frontend/src/components/erp/NotificationBell.tsx`, `frontend/src/app/dashboard/page.tsx` | **Modified** | EL-0 (card text), EL-1/2 (types), EL-4 | Anchored |
| `frontend/src/lib/tour/modules/electrical.ts` | **Untracked (directory new, other session)**; `lib/tour/registry.ts` **modified** | EL-0, EL-4 | Edit `electrical.ts` only after that session commits |
| `frontend/src/components/Sidebar.tsx`, `frontend/src/hooks/useAuth.ts` | Clean | — | No change for Electrical |
| `docs/MODULE_DETAILED_PLAN.md`, `docs/02-modules/engineering/` | Untracked | — | Reference only. §5 of this plan lists the deltas Engineering should absorb. |

**Deltas for the Engineering plan (to raise with its owner, not edited here):** (1) add `location_ref` to the E-1 `design_bom_lines` columns; (2) add the `electrical_drawings` and `hydraulic_circuits` sources to `engineering/migration.py` and run them **before** the BOM sources; (3) adopt `legacy_migration_map` alongside `legacy_source`; (4) the pneumatic authority row becomes `pneumatic:bom:*` (see the Hydraulic plan §7).

---

## 13. Decisions needing the owner's confirmation

The top five across both plans are summarised in the Hydraulic plan §13. The Electrical-specific ones:

1. **The 8 stages and their gates (§4.1).** In particular, retiring System Design, Panel Design/Assembly, Troubleshooting, Commissioning and Handover from Electrical. **Default: as in §4.1** (master plan §26 Q1).
2. **Who releases electrical drawings.** **DECIDED (2026-10-07): the Electrical department head, or a user the head assigns, releases electrical drawings in the Design register through discipline authority (§7.3). Design keeps numbering, revisions and ECN.** This is a deliberate change to D6 ("Design head releases") for the E/H/P disciplines. The alternative (keep D6, give Electrical engineers the Design app) is rejected.
3. **Electrical tests gate Final Assembly, not Electrical Installation (§6.2).** **Default: yes**, because it avoids a circular gate. The alternative adds a separate "Electrical Testing" RRV Build stage (14 stages).
4. **Installation checklist on the RRV Build stage (Production-side), signed by the electrician (§6.3).** **Default: yes.**
5. **Cable schedule optional per RRV (§35 setting, default off)**, and panels kept as an enclosure list only. **Default: yes** (master plan §26 Q1, second half). If harnesses are made in-house (§26 Q4), a harness becomes a mechanical-style *make* assembly with its own Production BOM. It is not an electrical make line, because R3 blocks those.
