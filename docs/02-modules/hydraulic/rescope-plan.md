# Hydraulic & Pneumatic Modules — Re-scope Implementation Plan

**Modules:** Hydraulic (`hydraulic`) and **Pneumatic (`pneumatic`, a new app-key alias over the same tables)**
**Spec:** `docs/MODULE_DETAILED_PLAN.md` §11 (Hydraulic), §12 (Pneumatic), §17 (RRV Build stages 6–8), §25 (clean-up list + migration rule), §36–§37 (settings), rules R2–R6, decisions D1–D8
**Aligned with:** `docs/02-modules/engineering/plan.md` (§2.2, §3.1, §12.2, §13: hydraulic/pneumatic BOMs and `hyd_components` move to `design_bom*` + Item Master), `docs/02-modules/production/rrv-build.md`
**Companion plan:** `docs/02-modules/electrical/rescope-plan.md` (shares the guard trigger, `legacy_migration_map`, the RRV Build checklist column and the Production commit)
**Prepared for:** Vineet Sharma
**Date:** 07 October 2026
**Status:** Plan only. No code has been written. §13 lists the five decisions that need the owner across both plans. Each has a recommended default, so HY-0 can start. **Decided 2026-10-07:** #1 (discipline release authority) and #5 (export and drop maintenance/service/spares/running hours).

---

## 1. Summary

The Hydraulic & Pneumatic module was built as a **fluid-power asset system**. It has a system register with running hours and an "under maintenance" status, its own component catalog, its own circuit approval flow, its own BOMs pointing at that catalog, maintenance plans, service records that issue Store stock, and a spare-parts list with reorder levels. Under R2–R6 its job is narrower: **circuit drawings, the Hydraulic/Pneumatic BOM per RRV model or project, design calculations, and the factory pressure/leak tests done on each RRV.**

The re-scope:

1. **Retire maintenance, service records, spare parts and running hours (R5).** These are hidden in HY-0, then made read-only, exported, and dropped in HY-4. Customer service moves to Service & Commissioning. Plant equipment belongs to Maintenance.
2. **`hyd_components` → Item Master, and HBOM/PBOM → the shared BOM engine** (`design_bom*`, `discipline = hydraulic | pneumatic`). Both moves run through the Engineering migration tool (Engineering §12.2), **once**.
3. **Circuits → Design register** (`design_documents`, types `hydraulic_circuit` / `pneumatic_circuit`). This runs *before* the BOM migration, so migrated BOM headers can point at the migrated drawing.
4. **A system becomes a design object per RRV model/project** (status `active | obsolete`, progress derived from evidence). **Tests become per-vehicle** (`rrv_build_id` on `hyd_tests`), and a system ↔ RRV Build link table records which vehicles carry which system.
5. **The Production RRV Build stage "Hydraulic & Pneumatic Integration" is split** into *Hydraulic Installation* (existing key) and *Pneumatic Installation* (new key), each gated on "system BOM released + required tests passed on this vehicle + installation checklist signed".
6. **Pneumatic gets its own app key, nav, sidebar entry and Permission Matrix rows** (`pneumatic`). It is a filtered view of the same tables (`system_type = 'pneumatic'`), with no copied code and no new tables.

> **ERP standard / why — design object vs. serial-numbered unit.** ERP and PLM systems keep the *design* of a system (its circuit, its BOM, its calculations) once per product or variant, and keep *unit* evidence (routine tests, as-built deviations) per serial number. The current module mixes the two. A `hyd_system` carries both a BOM *and* running hours and service history, as if each system were one physical machine in the plant. Once the design is per model and the evidence is per vehicle, a new RRV of the same model reuses the released circuit and BOM, and only its own tests are added.

---

## 2. Current state (read from code, 07-Oct-2026)

| Area | Where | What it does today |
|---|---|---|
| Systems | `models/system.py` → `hyd_systems` | `system_type` hydraulic/pneumatic (the plan's "medium" is this column). Number `HYS-`/`PNS-YYYY-NNNN`. Status `design, under_build, testing, commissioned, in_service, under_maintenance, decommissioned`. `running_hours`, `commissioned_on`, `location`, `equipment_ref`, `erp_project_id`, `branch_id`, technical ratings. |
| Components | `models/component.py` → `hyd_components` | Own catalog (`PMP-0001`…), `system_type` incl. `both`, optional `store_item_id`, ratings (bore/rod/stroke/displacement/pressure…), `specifications` JSON, `unit_cost`, `datasheet_url` |
| Circuits | `models/circuit.py` → `hyd_circuits` | One row per revision letter (A, B…), shared `circuit_number` (`CKT-YYYY-NNNN`). Status `draft → under_review → approved → superseded`. Files are `hyd_documents` with `entity_type = 'circuit'`. |
| BOM | `models/bom.py` → `hyd_boms`, `hyd_bom_items` | `HBOM-YYYY-NNNN` with revision letter, `draft → released → obsolete`. Lines point at `component_id` (NOT NULL → `hyd_components`), with `tag_number`. |
| Calculations | `calculations.py`, `models/calculation.py` | 10 hydraulic and 3 pneumatic calc types (`pneumatic_cylinder_force`, `air_consumption`, `air_receiver_sizing`), recomputed server-side |
| Tests | `models/testing.py` → `hyd_tests`, `hyd_test_readings` | Per system **or component**. 12 test types, readings auto-judged. No vehicle link. |
| Maintenance / service / spares | `models/maintenance.py` (`hyd_maintenance_plans`, `hyd_service_records`, `hyd_service_parts`), `models/spare_part.py` (`hyd_spare_parts`) | Plans by days/running hours. Service records flip the system to `under_maintenance` and **issue Store stock** (`reference_type = 'hyd_service'`). Spares carry min stock / reorder / shelf life. |
| Documents | `models/document.py` → `hyd_documents` | Polymorphic: `system, component, circuit, test, service_record` |
| Routes | `routes/*.py`. Every router uses `require_app_access("hydraulic")` + `require_tab_action("hydraulic", <subtab>, …)`. | See §4.5 |
| Production link | `production/service.py` `hydraulic_integration` gate; `production/routes/rrv_builds.py` `_integration()` | Requires every non-decommissioned system of the build's machine (`erp_project_id`) to have a latest completed test that is pass/conditional. One stage covers both media. |
| Frontend | `dashboard/hydraulic/{page, systems, components, circuits, bom, calculations, testing, maintenance, service, spares, project-work}`; `components/hydraulic/*` | Nav: Dashboard · Project Work · Systems · Components · Circuits · BOM · Calculations · Testing · Maintenance · Service Records · Spare Parts |
| Permissions | `MODULES["hydraulic"]`, label "Hydraulic & Pneumatic" | Subtabs `dashboard, project_work, systems, components, circuits, bom, calculations, testing, maintenance, service_records, spare_parts` |
| Audit | `core/audit_registry.py` ~447–465 | All models registered |
| Tests | `backend/app/tests/test_hydraulic.py`, `test_rrv_builds.py` | — |

---

## 3. Target scope

| | Hydraulic | Pneumatic |
|---|---|---|
| Systems | Power pack, rail-gear / guide-wheel deployment, brake, outrigger, crane/platform (§36 system types) | Air brake, compressor & air receiver, horn, actuators (§37) |
| Drawing | Design register, `hydraulic_circuit` | Design register, `pneumatic_circuit` |
| BOM | `design_boms` `bom_kind = system`, `discipline = hydraulic` | same, `discipline = pneumatic` |
| Calculations | Cylinder force/speed, pump flow/power, motor, pipe sizing, pressure drop, accumulator, reservoir, heat load | Cylinder force/load ratio, free-air consumption, air receiver sizing |
| Tests (per RRV) | Pressure, proof, leak, relief-valve setting, function (+ flushing cleanliness) | Air leak, brake application/release time, pressure-switch setting, safety-valve setting |
| **Not in scope** | Running hours, maintenance plans, service records, spare stock, plant hydraulic systems | Plant air monitoring, compressor maintenance, running hours |

---

## 4. Current → target mapping

### 4.1 Stages (derived, not stored)

Hydraulic has **no stage table today**, and every stage below has objective evidence. Stages are therefore **computed** (a `system_progress(db, system)` function in `service.py`), not stored. That avoids a second status that can disagree with the evidence. Electrical keeps stored stages because it already has data, assignees and planned dates in them (Electrical plan §4.1).

| # | Stage (§11 "same pattern as Electrical") | Level | Evidence (stage is done when…) |
|---|---|---|---|
| 1 | Requirement | System | `system_type`, application, working pressure and flow are set (pneumatic: working pressure + free-air demand) |
| 2 | Circuit drawing released | System | A linked Design document (`hyd_system_documents`, role `circuit`) has a released revision |
| 3 | HBOM / PBOM | System | `design_bom_id` has a revision with ≥1 line, every line is an Item Master item, and tags are unique |
| 4 | BOM release | System | The system BOM has a released revision (four-eyes; approver = the discipline head) |
| 5 | Purchase requirement | Vehicle | The latest Engineering shortage run for the system BOM in the build's project context has no unraised shortage (HY-3). Before HY-3: shown as "not tracked". |
| 6 | Installation on RRV | Vehicle | The RRV Build stage checklist (`hydraulic_integration` / `pneumatic_integration`) is signed |
| 7 | Pressure/leak test & QC | Vehicle | Every required test type (§6.2) has a latest completed test with `rrv_build_id` = this build and result pass/conditional |
| 8 | As-built | System | Each linked circuit flagged as-built has a revision released after the first linked vehicle's installation, **or** the system records `as_built_waiver_reason` (N/A: "built as drawn") |

The system detail page shows stages 1–4 as a checklist and stages 5–7 as a **Vehicles** matrix: one row per linked RRV Build, with columns purchase / installed / tests / RRV stage status. Stage 8 is a checklist row.

> **ERP standard / why — type test vs. routine test.** Industrial standards (IEC/ISO practice, RDSO for rolling stock) separate *type tests* (done once to prove a design) from *routine tests* (done on every unit before it leaves the works). Design calculations and the released circuit are the type side and belong to the system. Pressure, proof and leak tests on the RRV are routine tests and belong to the vehicle. That is why tests gain `rrv_build_id` and the Production gate reads "tests *for this build*", not "latest test of the system".

### 4.2 System status

| Current | Target | SQL |
|---|---|---|
| `design`, `under_build`, `testing`, `commissioned`, `in_service`, `under_maintenance` | **`active`** | `UPDATE hyd_systems SET status='active' WHERE status <> 'decommissioned';` |
| `decommissioned` | **`obsolete`** | `UPDATE hyd_systems SET status='obsolete' WHERE status='decommissioned';` |

`HYD_SYSTEM_STATUSES = ("active", "obsolete")`. Progress comes from §4.1. Old values are kept in `hyd_systems_legacy_snapshot` (§8.3) for the export.

> **ERP standard / why — master-data status vs. transaction progress.** A design object's status answers only "can it be used for new work?" (active/obsolete). "How far has it got?" belongs to the transactions and documents around it. Mixing the two produced `under_maintenance`, a monitoring status that rule R5 forbids, set by a service-record transaction.

### 4.3 Tables

| Table | Target | Phase | Notes |
|---|---|---|---|
| `hyd_systems` | **Keep** as the design object | HY-1 | Status collapse (§4.2). Add `rrv_model` (String 150, free text like `electrical_jobs.rrv_model`, replaced later by Engineering's `rrv_model_item_id`) and `as_built_waiver_reason` (Text). `design_bom_id` is added by **Engineering E-1** (Engineering §4.3, defensive `inspect`). Hide in HY-0, drop in HY-4: `running_hours`, `commissioned_on`, `location`. `equipment_ref` relabelled "Variant / equipment ref". |
| **new** `hyd_system_rrv_builds` | System fitted on vehicle | HY-1 | `id, system_id FK, rrv_build_id FK, created_by_id, timestamps`, unique (`system_id`, `rrv_build_id`). Backfilled from `erp_project_id` (§8.3). After Engineering E-2, it can be auto-filled from the build's frozen master BOM. |
| **new** `hyd_system_documents` | System ↔ Design documents | HY-2 | `id, system_id, document_id FK design_documents, role (circuit / ga / calculation / other), is_as_built, created_by_id, timestamps`, unique (`system_id`, `document_id`) |
| `hyd_tests` | **Keep** | HY-1 | Add `rrv_build_id` (FK, nullable, indexed). It is **required for new system tests** when the system has linked builds. New types: `brake_application_time`, `pressure_switch_setting`, `safety_valve_setting`. New component-level tests are rejected (incoming component checks are Quality's incoming inspection). Existing component tests stay as history. `component_id` is dropped in HY-4 after export. Number `PTST-` for pneumatic (§37). |
| `hyd_test_readings` | Keep | — | — |
| `hyd_calculations` | **Keep** | HY-3 | Add `design_document_id` (nullable FK) for "attach to drawing" (§11) |
| `hyd_documents` | **Keep** for `system` and `test` | HY-2 / HY-4 | `circuit` rows migrate to `design_revision_files`. `component` and `service_record` rows are exported, then deleted in HY-4. |
| `hyd_circuits` | **Migrate** → Design register, read-only, drop | HY-2 → HY-4 | §8.4 |
| `hyd_components` | **Migrate** → `store_items` (Engineering §12.2), read-only, drop | HY-0 (stop the gap) → HY-2 → HY-4 | HY-0 rule: **new components require `store_item_id`** |
| `hyd_boms`, `hyd_bom_items` | **Migrate** → `design_bom*` (Engineering §12.2 step 3), read-only, drop | HY-2 → HY-4 | `tag_number` → `design_bom_lines.tag_number` |
| `hyd_maintenance_plans` | **Retire** | HY-0 hide + RO → HY-4 drop | No replacement (R5) |
| `hyd_service_records`, `hyd_service_parts` | **Retire** | HY-0 → HY-4 | Customer service → Service & Commissioning (ERP service requests). The Store ledger rows with `reference_type = 'hyd_service'` are **kept** (they are stock history), and the export keeps the record numbers that explain them. |
| `hyd_spare_parts` | **Retire** | HY-0 → HY-4 | Customer spares list → Service "recommended spares" from the frozen master (Engineering Phase 3). Reorder levels: offered to Store as a one-off copy (§8.5). |

### 4.4 Screens and tabs

| Current Hydraulic tab | Target Hydraulic tab | Pneumatic tab (`/dashboard/pneumatic/...`) | Phase |
|---|---|---|---|
| Dashboard | Dashboard (systems by progress, BOMs awaiting release, vehicles awaiting tests, failed tests). No maintenance due, no low stock. | Dashboard (pneumatic only) | HY-1 |
| Project Work | Keep | Project Work (needs a "Pneumatic" department, §13 #2) | HY-1 |
| Systems | Systems (no running hours/location; **Vehicles** tab; derived stages) | Systems | HY-1 |
| Components | HY-0: visible, create requires an Item Master link. HY-2: **hidden**, "Legacy component master" under Reports → Retired data. | — | HY-0 / HY-2 |
| Circuits | HY-2: **Circuits (Design register filter)**, with "Open in Design" and "Link to system" | Circuits | HY-2 |
| BOM | HY-2: shared `BomLinesEditor`, `discipline = hydraulic` | BOM (`discipline = pneumatic`) | HY-2 |
| Calculations | Keep (hydraulic calc types) | Calculations (pneumatic calc types) | HY-1 |
| Testing | Testing (system tests, RRV Build picker, new types) | Testing | HY-1 |
| Maintenance | **Hidden** | — | HY-0 |
| Service Records | **Hidden** | — | HY-0 |
| Spare Parts | **Hidden** | — | HY-0 |
| — | **Reports** (HBOM per RRV, test results per RRV, Retired data exports) | Reports | HY-0 (retired), HY-3 |
| — | **Settings** (§36, last) | Settings (§37) | HY-3 |

The Sidebar shows "Hydraulic" and "Pneumatic" as two entries. The landing cards are rewritten to the new scope.

### 4.5 Endpoints

| Current | Target | Phase |
|---|---|---|
| `/hydraulic/systems` CRUD | Keep. `running_hours`, `commissioned_on` and `location` are rejected with 422: "Running hours and plant location are no longer tracked (rule R5: no monitoring of RRV systems). Service history for a customer's RRV is in Service & Commissioning." Statuses `active/obsolete`. | HY-0 (reject), HY-1 |
| — | **New** `GET/POST/DELETE /hydraulic/systems/{id}/rrv-builds`, `GET /hydraulic/systems/{id}/progress` | HY-1 |
| — | **New** `GET/POST/DELETE /hydraulic/systems/{id}/documents-links` | HY-2 |
| `/hydraulic/components` CRUD | HY-0: `POST` requires `store_item_id`. HY-2: writes → 410 ("Components are Item Master items now: MT-HYD-0042. Edit specs in Store → Items."). GET until HY-4. | HY-0 / HY-2 |
| `/hydraulic/circuits` (+ `submit`, `approve`, `return`, `revise`) | HY-2: writes → 410 with the new Design doc number. GET until HY-4. | HY-2 |
| `/hydraulic/boms` (+ `export`, `release`, `revise`) | HY-2: writes → 410 ("Moved to the shared BOM engine as BOM-2026-0051 R1 — edit on the BOM tab"). GET + `export` until HY-4. Authoring is `/design/boms` (Engineering §7.1). | HY-2 |
| `/hydraulic/calculations` (+ `types`, `compute`) | Keep. `types` is filtered by the caller's media. HY-3 adds `POST /{id}/attach-document`. | HY-1 / HY-3 |
| `/hydraulic/tests` (+ `start`, `complete`, `retest`) | Keep. `rrv_build_id` is required when the system has linked builds. `component_id` is rejected on create. New types. | HY-1 |
| `/hydraulic/maintenance-plans`, `/hydraulic/service-records` (+ `start`, `complete`, `cancel`), `/hydraulic/spare-parts` | HY-0: GET only, writes → **410** ("Maintenance, service and spares tracking were retired from the Hydraulic module on <date> (rule R5). Customer RRV service → Service & Commissioning → Service Requests. This record stays read-only; export it from Reports → Retired data."). HY-4: removed. | HY-0 |
| `/hydraulic/documents` | Keep. New uploads are limited to `system` and `test`. | HY-0 |
| `/hydraulic/dashboard` | Reworked | HY-1 |
| `/hydraulic/lookups/*` | Remove `spare-parts`, `maintenance-plans`, `store-locations` (HY-4). `components` → Item Master search filtered to the hydraulic/pneumatic categories (HY-2). Add `rrv-builds` (HY-1). | HY-1…HY-4 |
| — | **New** `/hydraulic/reports/{bom-per-rrv|test-results}` and `/hydraulic/reports/retired/{maintenance|service|spares|components|circuits|boms|running-hours}.xlsx` | HY-0 (retired), HY-3 |

Routes keep the `/hydraulic/*` prefix for both media. The **caller's apps** decide which rows they see (§7.2). No `/pneumatic/*` backend routers are created.

---

## 5. Alignment with the Engineering BOM plan (no double migration)

- **Owned by Engineering, not repeated here:** `hyd_components` → `store_items` (match on `store_item_id`, then part no. + manufacturer, else create the Store item after Store-head approval), technical attributes → `store_items.specification`, `hyd_boms` → `design_boms` (one per `bom_number`, revisions in letter order, `legacy_source = hyd_bom:<number>/<rev>`), `hyd_systems.design_bom_id` (Engineering §12.2, §4.3). Authority: `bom_authority(…, "hydraulic"|"pneumatic", …)`.
- **Inputs from this plan:**
  1. **Circuits migrate first** (§8.4). Engineering's step 3 then sets `design_boms.document_id` from `hyd_boms.circuit_id` via `legacy_migration_map` (`hyd_circuits` → `design_documents`).
  2. `discipline` of each migrated BOM = the hyd BOM's `system_type`. `bom_kind = system`.
  3. Category mapping for auto-created Store items: hydraulic categories (pump, motor, valves, cylinder, accumulator, filter, reservoir, cooler, hose, fitting, manifold, seal, gauge, sensor) → Store category "Hydraulic" sub-categories. Pneumatic categories (compressor, air_receiver, frl_unit, air_dryer, pneumatic_actuator, solenoid_valve) → "Pneumatic". `both` → "Hydraulic" with a note (Store decides). Store owns the final list (§36/§37 "sub-categories → Item Master").
  4. `datasheet_url` goes into the item's specification line ("Datasheet: <url>"). The Item Master has no attachment table today. Component `hyd_documents` are exported.
- **Interim rule (HY-0):** new `hyd_components` need `store_item_id`, so the unmapped set stops growing before the migration.
- **Pneumatic** has little or no BOM data today. Pneumatic systems start on the shared engine from HY-2 (Engineering §13).
- **Authority row change for Engineering §3.1:** pneumatic = `pneumatic:bom:create|edit|approve` (the app-key alias, §7), **not** `hydraulic:pneumatic_bom`.

---

## 6. Link to Production → RRV Build

### 6.1 Stage split (one Production commit, shared with the Electrical plan §6)

| # | Key | Label | N/A | Change |
|---|---|---|---|---|
| 5 | `electrical_integration` | Electrical Installation (wiring/harness) | ✓ | Label only (Electrical plan) |
| 6 | `hydraulic_integration` | **Hydraulic Installation** | ✓ | Label + gate |
| 7 | **`pneumatic_integration`** | **Pneumatic Installation** | ✓ | **New** |
| 8 | `final_assembly` | Final Assembly | – | Depends on 5, 6, **7**. Electrical tests gate (Electrical plan §6.2). |

Keys are kept so existing stage rows, events and tests stay valid. The catalog (`PRODUCTION_RRV_STAGES`) gains one tuple after `hydraulic_integration`. For existing builds (Alembic data step, pure SQL):

```sql
-- shift later stages down one place, per build
UPDATE production_rrv_build_stages s SET sequence = s.sequence + 1
 WHERE s.sequence > (SELECT h.sequence FROM production_rrv_build_stages h
                      WHERE h.build_id = s.build_id AND h.stage_key = 'hydraulic_integration')
   AND NOT EXISTS (SELECT 1 FROM production_rrv_build_stages p
                    WHERE p.build_id = s.build_id AND p.stage_key = 'pneumatic_integration');

-- add the pneumatic stage, copying the combined stage's state (it covered both media)
INSERT INTO production_rrv_build_stages (build_id, stage_key, sequence, status, assignee_id, planned_start_date,
       planned_end_date, started_at, completed_at, completed_by_id, remarks, created_at, updated_at)
SELECT h.build_id, 'pneumatic_integration', h.sequence + 1, h.status, h.assignee_id, h.planned_start_date,
       h.planned_end_date, h.started_at, h.completed_at, h.completed_by_id,
       CASE WHEN h.status IN ('completed','not_applicable')
            THEN 'Split from "Hydraulic & Pneumatic Integration" on <HY-1 date>; status copied. ' || coalesce(h.remarks,'')
            ELSE h.remarks END,
       now(), now()
  FROM production_rrv_build_stages h
 WHERE h.stage_key = 'hydraulic_integration'
ON CONFLICT (build_id, stage_key) DO NOTHING;   -- uq_production_rrv_build_stage
```

`downgrade()` deletes the `pneumatic_integration` rows and shifts the sequence back. Progress displays use the stage count, so "/12" in the frontend and docs becomes "/13" (`rrv-build.md` §3 is updated in the same commit).

### 6.2 Gates (`production/service.py` → `rrv_stage_gate_problems`)

**`hydraulic_integration`** (and `pneumatic_integration` with `system_type = 'pneumatic'`):

```
systems = hyd_systems joined via hyd_system_rrv_builds (rrv_build_id = build.id), system_type = <medium>, status = 'active'
          (fallback until backfilled: erp_project_id = build.erp_project_id)
none  → "No hydraulic system is linked to RRV build RRV-2026-0012. Link it in Hydraulic → Systems → <system> → Vehicles,
         or mark this stage N/A with a reason (e.g. 'model has no pneumatic system — brakes are hydraulic')."
each  → BOM released: design_bom_id has a released revision
         (before HY-2: the system's latest hyd_boms row is 'released')
         "HYS-2026-0003 (Rail-gear deployment) has no released HBOM — the Hydraulic head must release BOM-2026-0051."
each  → for every required test type: latest completed hyd_test with system_id = s.id AND rrv_build_id = build.id,
         result in (pass, conditional)
         "HYS-2026-0003 on this vehicle: Proof test not recorded; Leak test latest result is FAIL (HTST-2026-0041) — record a passing retest."
stage → installation checklist on this RRV Build stage fully ticked and signed
```

**Required test types** (constants in HY-1, settings in HY-3):

- Hydraulic: `pressure_test`, `proof_test`, `leak_test`, `relief_valve_setting`, `functional_test`
- Pneumatic: `leak_test`, `brake_application_time`, `pressure_switch_setting`, `safety_valve_setting`

`conditional` counts as pass only when `witnessed_by` is filled (QC witness, §36 "QC witness required: pressure, proof"). Without a witness the message is: "Conditional result needs a QC witness name."

### 6.3 Installation checklist

This uses the same `production_rrv_build_stages.checklist` JSON + `signed_by_id/at` as Electrical (Electrical plan §6.3). Templates:

- Hydraulic: hose routing & clamping, fitting torque, flushing to the cleanliness target, oil grade & level, filter elements fitted, relief set & sealed, labels.
- Pneumatic: tube routing, fittings, drain valves, receiver safety valve tagged, brake chamber connections.

Labour is booked on the main WO (R4 pattern).

### 6.4 `_integration()` panel

It lists hydraulic and pneumatic systems separately, each with BOM released (y/n), required tests passed on this vehicle (n of m), and a link.

---

## 7. Pneumatic as its own nav / permission alias

### 7.1 Registry and app list

| File | Change |
|---|---|
| `main/models/user.py` `AVAILABLE_APPS` | Add `"pneumatic"` |
| `modules` table (Alembic) | `INSERT INTO modules (key,label,icon,description,is_active,sort_order,…) VALUES ('pneumatic','Pneumatic','wind','RRV pneumatic systems — air brake circuits, PBOM, calculations and air tests on each RRV.',true,<after hydraulic>,now(),now())`, with a DELETE in `downgrade()`. `UPDATE modules SET label='Hydraulic' WHERE key='hydraulic'`. |
| `core/permission_registry.py` | `MODULES["hydraulic"]["label"]` → "Hydraulic". New `MODULES["pneumatic"] = {"label": "Pneumatic", "subtabs": {dashboard, project_work, systems, circuits, bom, calculations, testing, reports, settings}}` |
| Frontend | `AppModule` union (`types/index.ts`), `useRequireApp` union (`hooks/useAuth.ts`), Sidebar icon + entry, landing card (`app/dashboard/page.tsx`), `lib/tour/modules/pneumatic.ts` + registry |

### 7.2 Row-level filtering by medium (backend)

Every Hydraulic router dependency changes from `require_app_access("hydraulic")` to `require_any_app_access("hydraulic", "pneumatic")`. Helpers go in `hydraulic/service.py`:

```python
def media_for(user) -> set[str]:            # {"hydraulic"}, {"pneumatic"} or both, from user.get_apps()
def app_for(system_type: str) -> str:        # "hydraulic" | "pneumatic"
def require_medium(user, system_type, subtab, action) -> None:
    # 403 unless system_type ∈ media_for(user) and can_perform(user, app_for(system_type), subtab, action)
```

- **Lists** filter `system_type IN media_for(user)`. An explicit `?system_type=` outside the caller's media gets 403: "You have access to Pneumatic only — ask an admin for the Hydraulic app to see hydraulic systems."
- **Get / write** on a record check `require_medium(user, record.system_type, …)`. The static `require_tab_action("hydraulic", …)` decorators become in-handler checks, because the app depends on the record.
- `calculations/types` returns only the caller's media. Creating a system of the other medium is refused.
- Numbering: systems already use `PNS`. Tests use `PTST` for pneumatic. BOMs use the shared engine's numbers once on `design_bom`.

### 7.3 Frontend

- The hydraulic list/detail/new pages move their body into `components/hydraulic/pages/*` with a `medium` prop. `app/dashboard/hydraulic/**` and `app/dashboard/pneumatic/**` become thin wrappers (`<SystemsListPage medium="pneumatic" />`). `HydraulicNav` takes `medium` and the base path. Units follow the medium (bar + L/min vs bar + Nl/min).
- Pneumatic routes: `/dashboard/pneumatic`, `/project-work`, `/systems[/new|/id]`, `/circuits`, `/bom`, `/calculations[/new|/id]`, `/testing[/new|/id]`, `/reports`, `/settings`.

### 7.4 Grant migration (so nobody loses access on the day of the split)

```sql
-- every user with the hydraulic app also gets pneumatic (admin can remove it afterwards)
UPDATE users SET assigned_apps = (assigned_apps::jsonb || '["pneumatic"]'::jsonb)::json
 WHERE assigned_apps::jsonb ? 'hydraulic' AND NOT assigned_apps::jsonb ? 'pneumatic';

-- copy matrix grants hydraulic:<subtab>:<action> → pneumatic:<subtab>:<action> for the shared subtabs
UPDATE users u SET granular_permissions = (
  SELECT json_agg(DISTINCT g) FROM (
    SELECT jsonb_array_elements_text(u.granular_permissions::jsonb) AS g
    UNION
    SELECT 'pneumatic:' || substr(g2, 11)                         -- strip 'hydraulic:' (10 chars)
      FROM jsonb_array_elements_text(u.granular_permissions::jsonb) AS g2
     WHERE g2 LIKE 'hydraulic:%'
       AND split_part(g2, ':', 2) IN ('dashboard','project_work','systems','circuits','bom','calculations','testing')
  ) x)
 WHERE u.granular_permissions::jsonb::text LIKE '%"hydraulic:%';
```

After deploy, the admin removes the apps people shouldn't have. That is the only manual step.

> **ERP standard / why — partition by data, not by copying modules.** SAP restricts by organisational value (plant, purchasing group) inside one transaction. It does not build a second purchasing module per plant. Here the partition value is `system_type`. One code path and one set of tables give two independently grantable views. The Pneumatic team never sees hydraulic records, and a fix to tests applies to both.

---

## 8. Data migration

### 8.1 Backup (before HY-1, HY-2, HY-4)

```bash
psql "$DATABASE_URL" -c "select min(created_at), count(*) from users;"          # right database? (05-Oct reset)
psql "$DATABASE_URL" -c "
  select 'hyd_systems', count(*) from hyd_systems union all
  select 'hyd_components', count(*) from hyd_components union all
  select 'hyd_circuits', count(*) from hyd_circuits union all
  select 'hyd_boms', count(*) from hyd_boms union all
  select 'hyd_tests', count(*) from hyd_tests union all
  select 'hyd_maintenance_plans', count(*) from hyd_maintenance_plans union all
  select 'hyd_service_records', count(*) from hyd_service_records union all
  select 'hyd_spare_parts', count(*) from hyd_spare_parts union all
  select 'open service records', count(*) from hyd_service_records where status in ('open','in_progress') and is_deleted=false;"
pg_dump -Fc "$DATABASE_URL" -f "prod-$(date +%Y%m%d-%H%M)-pre-HY-<phase>.dump"
pg_dump -Fc "$DATABASE_URL" -t 'hyd_*' -t production_rrv_build_stages -t users -t modules \
        -f "hydraulic-$(date +%Y%m%d-%H%M)-pre-HY-<phase>.dump"
pg_restore --list "hydraulic-…dump" | grep -c "TABLE DATA"
```

The dumps are stored in `D:\PremnathrailBackup\dumps`, and the row counts are recorded in the release note.

### 8.2 HY-0: hide + read-only (no data change)

**Pre-cutover:** open service records (`open` / `in_progress`) are listed to their owners, who complete or cancel them **before** the release. An open record with Store issues pending would otherwise freeze. If any remain at cutover, the release step cancels them with `cancel_reason = 'Retired <date> (rule R5) — open at cutover; customer service continues in Service & Commissioning'` and lists them in the release note.

Guard triggers (shared function from the Electrical plan §8.2; `CREATE OR REPLACE`):

```sql
CREATE TRIGGER trg_retired_guard BEFORE INSERT OR UPDATE OR DELETE ON hyd_maintenance_plans FOR EACH STATEMENT EXECUTE FUNCTION app_retired_table_guard('<HY-0 date>','R5: no maintenance/monitoring');
CREATE TRIGGER trg_retired_guard BEFORE INSERT OR UPDATE OR DELETE ON hyd_service_records   FOR EACH STATEMENT EXECUTE FUNCTION app_retired_table_guard('<HY-0 date>','R5: service → Service & Commissioning');
CREATE TRIGGER trg_retired_guard BEFORE INSERT OR UPDATE OR DELETE ON hyd_service_parts     FOR EACH STATEMENT EXECUTE FUNCTION app_retired_table_guard('<HY-0 date>','R5');
CREATE TRIGGER trg_retired_guard BEFORE INSERT OR UPDATE OR DELETE ON hyd_spare_parts       FOR EACH STATEMENT EXECUTE FUNCTION app_retired_table_guard('<HY-0 date>','R5/R6: spares → Item Master + Service');
```

These are Postgres only (Alembic checks the dialect; the SQLite tests rely on the API 410s). `downgrade()` drops them.

### 8.3 HY-1: status, links, tests, stage split

```sql
-- snapshot for export/downgrade
CREATE TABLE hyd_systems_legacy_snapshot AS
  SELECT id, system_number, status, running_hours, commissioned_on, location, erp_project_id FROM hyd_systems;

UPDATE hyd_systems SET status = CASE WHEN status = 'decommissioned' THEN 'obsolete' ELSE 'active' END;

-- system ↔ vehicle links from the shared machine
INSERT INTO hyd_system_rrv_builds (system_id, rrv_build_id, created_at, updated_at)
SELECT s.id, b.id, now(), now()
  FROM hyd_systems s JOIN production_rrv_builds b ON b.erp_project_id = s.erp_project_id
 WHERE s.is_deleted = false AND b.is_deleted = false
ON CONFLICT (system_id, rrv_build_id) DO NOTHING;

-- tests → vehicle, only where unambiguous (exactly one linked build)
UPDATE hyd_tests t SET rrv_build_id = l.rrv_build_id
  FROM hyd_system_rrv_builds l
 WHERE t.rrv_build_id IS NULL AND t.system_id = l.system_id
   AND (SELECT count(*) FROM hyd_system_rrv_builds l2 WHERE l2.system_id = t.system_id) = 1;
```

Plus the RRV Build stage split (§6.1) and the pneumatic grants (§7.4).

**Plant-scope systems report:** systems with `erp_project_id IS NULL`, no `hyd_system_rrv_builds` row and a `location` filled are probably plant equipment (plant air network, press power pack). They are listed for the owner. The default is to mark them `obsolete` with reason "Plant equipment — tracked in Maintenance (own plant)". The Maintenance team re-creates any it needs as assets. The data is not moved automatically, because the asset models differ.

### 8.4 HY-2: circuits → Design register (admin tool, dry run first)

Source `hydraulic_circuits` in `engineering/migration.py`, **run before** the `hydraulic` BOM source. **Prerequisite:** Design doc types `hydraulic_circuit` (HC) and `pneumatic_circuit` (PC) exist.

```sql
-- documents: one per circuit_number
-- revisions: every hyd_circuits row of that number, ordered by letter (A, B, …, Z, AA)
WITH ordered AS (
  SELECT c.*, row_number() OVER (PARTITION BY c.circuit_number ORDER BY length(c.revision), c.revision) - 1 AS rev_index,
         max(c.id) FILTER (WHERE c.status = 'approved') OVER (PARTITION BY c.circuit_number) AS released_id
    FROM hyd_circuits c WHERE c.is_deleted = false)
SELECT * FROM ordered;            -- driver query; per circuit_number the tool does:

INSERT INTO design_documents (doc_number, title, description, document_type, discipline, legacy_number,
                              owner_id, created_by_id, status, created_at, updated_at, is_deleted)
VALUES (:next_number, first.title, first.description,
        CASE first.system_type WHEN 'pneumatic' THEN 'pneumatic_circuit' ELSE 'hydraulic_circuit' END,
        first.system_type, coalesce(first.drawing_number, first.circuit_number),
        first.created_by_id, first.created_by_id, 'active', first.created_at, now(), false)
RETURNING id INTO :doc_id;

-- per row c (rev_index order)
INSERT INTO design_document_revisions (document_id, revision_index, revision_label, status, change_summary,
       created_by_id, submitted_at, approved_by_id, approved_at, approval_comment, released_by_id, released_at,
       created_at, updated_at, is_deleted)
VALUES (:doc_id, c.rev_index, 'R' || c.rev_index,
        CASE c.status WHEN 'draft' THEN 'draft' WHEN 'under_review' THEN 'in_review'
                      WHEN 'approved' THEN 'released' ELSE 'superseded' END,
        'Migrated from ' || c.circuit_number || ' Rev ' || c.revision || coalesce(': ' || c.change_note, ''),
        c.created_by_id, c.submitted_at, c.approved_by_id, c.approved_at, c.review_remarks,
        CASE WHEN c.status = 'approved' THEN c.approved_by_id END, CASE WHEN c.status = 'approved' THEN c.approved_at END,
        c.created_at, now(), false)
RETURNING id INTO :rev_id;

-- files attached to that circuit row
INSERT INTO design_revision_files (revision_id, file_role, file_name, sharepoint_path, sharepoint_url, file_size,
       mime_type, uploaded_by_id, created_at, updated_at, is_deleted)
SELECT :rev_id,
       CASE WHEN row_number() OVER (ORDER BY (d.doc_type IN ('circuit_diagram','schematic')) DESC, d.id) = 1
            THEN 'primary' ELSE 'supporting' END,
       d.file_name, d.sharepoint_path, d.sharepoint_url, d.file_size, d.mime_type, d.uploaded_by_id, d.created_at, now(), false
  FROM hyd_documents d WHERE d.entity_type = 'circuit' AND d.entity_id = c.id AND d.is_deleted = false;

INSERT INTO legacy_migration_map (source_table, source_id, target_table, target_id, run_id, migrated_at, migrated_by_id)
VALUES ('hyd_circuits', c.id, 'design_document_revisions', :rev_id, :run, now(), :admin);
-- plus one row ('hyd_circuits', c.id, 'design_documents', :doc_id, …) for every row of the number,
-- which Engineering's BOM step uses to set design_boms.document_id from hyd_boms.circuit_id

INSERT INTO hyd_system_documents (system_id, document_id, role, is_as_built, created_by_id, created_at, updated_at)
VALUES (first.system_id, :doc_id, 'circuit', false, :admin, now(), now())
ON CONFLICT (system_id, document_id) DO NOTHING;
```

- If the source data has more than one `approved` row per number (it shouldn't), only the highest becomes `released`. The others become `superseded` and are listed in the report.
- Migrated releases are history (no `reviewed_by_id`) and get a Design event "Migrated from CKT-2026-0003 Rev B". The next change goes through Design / ECN.
- Then: **Engineering §12.2** (components → items, HBOM → `design_bom`). `hyd_systems.design_bom_id` is set to each system's released BOM.

### 8.5 Spares → Store reorder levels (optional, Store-approved)

```sql
-- dry-run list for the Store head; applied only to the rows they tick
SELECT sp.part_code, si.item_code, sp.min_stock_qty, sp.reorder_qty, si.reorder_level, si.reorder_quantity
  FROM hyd_spare_parts sp JOIN store_items si ON si.id = sp.store_item_id
 WHERE sp.is_deleted = false AND (si.reorder_level IS NULL OR si.reorder_quantity IS NULL)
   AND (sp.min_stock_qty > 0 OR sp.reorder_qty > 0);
-- apply (ticked ids)
UPDATE store_items si SET reorder_level = coalesce(si.reorder_level, sp.min_stock_qty),
                          reorder_quantity = coalesce(si.reorder_quantity, sp.reorder_qty)
  FROM hyd_spare_parts sp WHERE sp.store_item_id = si.id AND sp.id = ANY(:ticked_ids);
```

### 8.6 Post-migration checks

```sql
SELECT status, count(*) FROM hyd_systems GROUP BY status;                        -- only active / obsolete
SELECT b.id FROM production_rrv_builds b WHERE b.is_deleted = false
   AND (SELECT count(*) FROM production_rrv_build_stages s WHERE s.build_id = b.id) <> 13;   -- expect 0
SELECT c.id FROM hyd_circuits c WHERE c.is_deleted = false AND NOT EXISTS
  (SELECT 1 FROM legacy_migration_map m WHERE m.source_table='hyd_circuits' AND m.source_id=c.id
      AND m.target_table='design_document_revisions');                            -- expect 0 (HY-2)
SELECT h.id FROM hyd_boms h WHERE h.is_deleted = false AND NOT EXISTS
  (SELECT 1 FROM design_boms d WHERE d.legacy_source LIKE 'hyd_bom:' || h.bom_number || '/%');  -- expect 0 (HY-2)
SELECT id FROM hyd_components WHERE is_deleted = false AND store_item_id IS NULL; -- expect 0 (HY-2)
SELECT id FROM hyd_tests WHERE is_deleted = false AND system_id IS NOT NULL AND rrv_build_id IS NULL
   AND created_at > '<HY-1 date>';                                               -- expect 0
```

### 8.7 Export

`/hydraulic/reports/retired/*.xlsx` covers maintenance plans, service records + parts (with the Store `reference_number`s), spares, components (all rating columns + `specifications`), circuits, BOMs + lines, the running-hours snapshot, and component tests. The Hydraulic head files them in SharePoint `Hydraulic-media/_retired/<date>/`. Export-and-drop was approved by the owner on 2026-10-07 (§13 #5); HY-4 still waits for confirmation that the exports are filed.

### 8.8 HY-4: drop (separate Alembic migration, ≥1 release after HY-2 in production)

```sql
DELETE FROM hyd_documents WHERE entity_type IN ('component','circuit','service_record');   -- exported / migrated
DROP TABLE IF EXISTS hyd_service_parts;
DROP TABLE IF EXISTS hyd_service_records;
DROP TABLE IF EXISTS hyd_maintenance_plans;
DROP TABLE IF EXISTS hyd_spare_parts;
DROP TABLE IF EXISTS hyd_bom_items;
DROP TABLE IF EXISTS hyd_boms;                          -- before hyd_circuits (circuit_id FK)
DROP TABLE IF EXISTS hyd_circuits;
ALTER TABLE hyd_tests DROP COLUMN component_id;         -- FK to hyd_components; component tests exported
DROP TABLE IF EXISTS hyd_components;
ALTER TABLE hyd_systems DROP COLUMN running_hours, DROP COLUMN commissioned_on, DROP COLUMN location;
DROP TABLE IF EXISTS hyd_systems_legacy_snapshot;
DROP FUNCTION IF EXISTS app_retired_table_guard() CASCADE;   -- only if Electrical EL-4 has also run; else leave it
```

`downgrade()` recreates empty structures only; data comes back from the dump. **Same commit:** delete `models/maintenance.py`, `models/spare_part.py`, `models/component.py`, `models/circuit.py`, `models/bom.py` and their routes/schemas. Remove their imports from `alembic/env.py` and `main.py`, and their `register_audited` lines (~448–465). Remove subtabs `components, maintenance, service_records, spare_parts` from the registry. Remove the `dashboard/hydraulic/{components, maintenance, service, spares}` pages and their forms, the `hydraulicApi` methods and types, the `NotificationBell` `hyd_circuit` link (→ Design document link), and the tour steps. Boot the app on a copy of the prod dump before pushing.

---

## 9. UI hide steps (HY-0, one release)

1. `HydraulicNav.tsx`: remove Maintenance, Service Records and Spare Parts. Add Reports (Retired data).
2. `systems/[id]/page.tsx`, `SystemForm.tsx`: remove running hours, commissioned on, location and the maintenance/service panels. Status picker: Active / Obsolete (backend still accepts the old values until HY-1; the form sends `active`).
3. `ComponentForm.tsx`: the Item Master item is mandatory, with the hint "Every component must be an Item Master item (rule R6). Ask Store to create the code first."
4. `testing/new`: hide component-level test creation.
5. `HydDocumentsPanel.tsx`: entity choices limited to system/test.
6. Dashboard: remove the "maintenance due" and "low-stock spares" cards.
7. Landing card text: "RRV hydraulic systems — circuits (Design register), HBOM, calculations, and pressure/leak tests on each RRV." Sidebar label "Hydraulic" (Pneumatic arrives in HY-1).
8. Tour `lib/tour/modules/hydraulic.ts`: remove the retired steps.
9. Backend: the 410s and 422s from §4.5, plus the guard triggers from §8.2.

---

## 10. Phased delivery

| Phase | Content | Depends on | Exit criteria |
|---|---|---|---|
| **HY-0 Hide** | §9; 410s on maintenance/service/spares; guard triggers; component create needs an item; retired exports; open service records closed | — | No user can create or edit a plan, service record or spare, or set running hours, from the UI, the API or SQL (trigger). Exports contain every row. `test_hydraulic.py` is updated and green. |
| **HY-1 Re-scope core + Pneumatic + Production** | Status collapse; `rrv_model`, `as_built_waiver_reason`; `hyd_system_rrv_builds`; `hyd_tests.rrv_build_id` + new types + PTST; derived progress + Vehicles tab; **Pneumatic app key** (§7) with grant copy; RRV Build split + gates + checklist (**one Production commit with Electrical EL-1**) | Production commit coordinated | A pneumatic-only user sees only PNS systems, and gets a clear 403 on a HYS id. A test build is refused at Hydraulic Installation until the HBOM is released, each required test has passed **on that build** and the checklist is signed. Pneumatic Installation can be marked N/A with a reason. Existing builds show 13 stages, and their states are preserved. |
| **HY-2 Shared registers** | Design doc types + `doc_authority` (hydraulic/pneumatic heads, or a user the head assigns, release); circuits → Design (§8.4); Engineering §12.2 (components → items, HBOM → `design_bom`); `hyd_system_documents`; BOM tab on the shared editor (both media); legacy writes → 410; triggers on `hyd_circuits`, `hyd_components`, `hyd_boms`, `hyd_bom_items` | **Engineering E-1**, Design session committed | A hydraulic engineer without the Design app releases a circuit and a system BOM. A pneumatic engineer does the same for a PBOM. Every legacy circuit, component and BOM has a map row or a signed dry-run entry. Where-used for a hose fitting returns both hydraulic and mechanical BOMs. |
| **HY-3 Purchase, reports, settings** | Stage 5 on Engineering shortage runs; reports; §36/§37 settings (required tests, proof multiplier, hold time, witness, leak drop limit, units, velocity bands, checklists); calc "attach to drawing" | **Engineering E-3** | The required test list comes from settings. A leak test with 0.2 bar/5 min against a 0.1 bar limit is judged *fail*. A calculation is attached to its circuit document. |
| **HY-4 Drop** | §8.8 | Exports filed and confirmed; ≥1 release after HY-2 | Migration runs on a dump copy and the app boots. A grep finds no reference to the dropped tables, fields, pages or subtabs. The Store ledger still shows the `hyd_service` transactions. |

---

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Open service records at cutover | Stock issues half-done, angry users | Pre-cutover list; owners close them first; auto-cancel with reason as the last resort (§8.2) |
| Users lose hydraulic data visibility after the Pneumatic split | Work stops | §7.4 grant copy in the same migration; admin trims afterwards |
| Tests recorded before HY-1 have no vehicle | Builds in progress fail the new gate | Unambiguous backfill (§8.3). Otherwise the tester re-links the test to the build (a PATCH allowed on completed tests for `rrv_build_id` only, audited). |
| Static `require_tab_action` decorators replaced by in-handler checks | A missed check means a permission hole | One helper (`require_medium`) used everywhere, plus a test per endpoint for pneumatic-only, hydraulic-only and both |
| Plant systems silently obsoleted | Loss of useful records | Owner-reviewed report; exports keep everything |
| Auto-creating Store items from `hyd_components` | Duplicate / badly coded items | Store-head approval of the dry-run list (Engineering §12.2) |
| Circuit letters (A, B) become R-labels (R0, R1) | Confusion when reading old paper | `change_summary` and `legacy_number` keep the old reference. Customers/RDSO see the new labels from the next issue (Engineering Q6). |
| Parallel-session collisions (§12) | Lost work / forked head | Anchored edits; `alembic heads`; one coordinated Production commit |
| Model deletes in HY-4 without import sync | Deploy crash | §8.8 checklist; boot on a dump copy |

---

## 12. Collision status (`git status`, 07-Oct-2026)

| File / area | Status | Touched in | Handling |
|---|---|---|---|
| `backend/app/modules/hydraulic/**` | **Clean** | HY-0…HY-4 | Ours. Re-read before editing. |
| `backend/app/tests/test_hydraulic.py` | Clean | HY-0…HY-2 | Ours |
| `backend/app/core/permission_registry.py` | **Modified (other sessions)** | HY-0, HY-1 (pneumatic), HY-4 | Anchored edits in `"hydraulic"` + a new `"pneumatic"` block |
| `backend/app/modules/main/models/user.py` (`AVAILABLE_APPS`) | **Modified** | HY-1 | One-token anchored insert |
| `backend/app/modules/main/models/module.py` | Clean | — (seed via Alembic) | — |
| `backend/app/core/audit_registry.py`, `backend/app/main.py`, `backend/alembic/env.py` | **Modified** | HY-1 (link table), HY-4 | Anchored + import sync |
| `backend/alembic/versions/` | Many untracked (other sessions) | Every phase | `alembic heads` first |
| `backend/app/modules/production/service.py`, `production/models/rrv_build.py` | **Clean** | HY-1 | One commit with Electrical EL-1 |
| `backend/app/modules/production/routes/rrv_builds.py`, `backend/app/tests/test_rrv_builds.py` | **Modified (another session)** | HY-1 | Wait for that commit, or a minimal anchored edit |
| `backend/app/modules/design/**` (several M, several untracked) | In progress (Design session) | HY-2 | Do not start HY-2 before the Design commit |
| `backend/app/modules/rnd/tools/hydraulic/api.py`, `frontend/src/app/dashboard/rnd/hydraulic/page.tsx` | **Modified (R&D session)** | **None.** That is the R&D locomotive calculator, a different module. | Don't touch |
| `frontend/src/components/hydraulic/HydraulicNav.tsx` | **Modified (uncommitted)** | HY-0, HY-1 | Re-read and keep the other change (likely Project Work) |
| `frontend/src/app/dashboard/hydraulic/project-work/` | **Untracked (other session)** | HY-1 (copy pattern for pneumatic) | Don't modify |
| `frontend/src/app/dashboard/hydraulic/**` (other pages), `components/hydraulic/*` (other than the Nav) | Clean | HY-0…HY-4 | Ours |
| `frontend/src/types/index.ts`, `lib/api.ts`, `components/erp/NotificationBell.tsx`, `app/dashboard/page.tsx` | **Modified** | HY-0…HY-4 | Anchored |
| `frontend/src/components/Sidebar.tsx`, `frontend/src/hooks/useAuth.ts` | Clean | HY-1 (pneumatic entry / union) | Ours, still anchored |
| `frontend/src/lib/tour/modules/hydraulic.ts` (dir untracked), `lib/tour/registry.ts` (M) | Other session | HY-0, HY-1 (`pneumatic.ts`) | After that session commits |
| `docs/02-modules/engineering/plan.md`, `docs/MODULE_DETAILED_PLAN.md` | Untracked | — | Deltas listed in Electrical plan §12 (pneumatic authority = `pneumatic:bom:*`; circuits/drawings sources before BOMs; `legacy_migration_map`; `location_ref`) |

---

## 13. The five decisions that need the owner's confirmation (both plans)

1. **Discipline heads release their own drawings in the Design register.** **DECIDED (2026-10-07):** E/H/P drawings are released in the Design register by the discipline department head (Electrical / Hydraulic / Pneumatic) **or a user the head assigns**, through a discipline-aware `doc_authority` (the same idea as Engineering's `bom_authority`). Design keeps numbering, revisions and ECN. *This amends D6 ("only the Design head releases") for the three disciplines.* The rejected alternative was: discipline engineers get the Design app and the Design head releases everything. Implementation note: the delegate is assigned by the head, recorded (who/when) and revocable; four-eyes still applies (releaser ≠ author).
2. **Pneumatic is its own app key (`pneumatic`), not a subtab of Hydraulic.** Default: yes. It has its own sidebar entry, Permission Matrix rows and Project Work page, over the same `hyd_*` tables filtered by `system_type`. All current Hydraulic users get it on day one. This changes Engineering §3.1's `hydraulic:pneumatic_bom` to `pneumatic:bom`, and it needs a **"Pneumatic" department** in Organization if PM milestones are to be given to that team (master plan §26 Q2).
3. **Design per model, evidence per vehicle.** Default: a hydraulic/pneumatic system is a design object per RRV model/project (`active/obsolete`, progress derived from evidence). Tests carry `rrv_build_id`. A link table records which builds carry which system. The Electrical package stays per vehicle and references the per-model BOM (Engineering Q3). The consequence: the RRV Build gate checks tests **on that vehicle**, not "the latest test of the system".
4. **RRV Build stage design.** Defaults: keep the existing keys; split out `pneumatic_integration` (13 stages; existing builds get a copy of the combined stage's state); gate each installation stage on "discipline BOM released + required tests on this vehicle + installation checklist signed"; put the checklist on the RRV Build stage (Production-owned, signed by the fitter); **electrical tests gate Final Assembly** to avoid a circular gate. The required test lists are those in §6.2 (master plan §26 Q5).
5. **Retire without replacement inside these modules.** **DECIDED (2026-10-07): export and drop is approved for now** — HY-4 can proceed once the §8.7 exports are filed. Detail as planned: maintenance plans, service records, spare parts and running hours are dropped after export. Customer service moves to Service & Commissioning. Plant-scope systems are marked obsolete (Maintenance re-creates what it needs). Spare reorder levels are offered to Store once. `hyd_components` without an Item Master match are **auto-created as Store items after Store-head approval**. Open service records must be closed by their owners before HY-0.

Further Hydraulic-specific defaults (no confirmation needed unless the owner disagrees): `conditional` test results count only with a QC witness; component-level bench tests stop (Quality's incoming inspection covers them); circuit letters become R-labels with the old reference kept; the Electrical-specific choices are in the Electrical plan §13.
