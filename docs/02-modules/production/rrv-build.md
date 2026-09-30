# Production — RRV Build (Rail-cum-Road Vehicle) — Overview & Build Plan

**Module:** Production → RRV Builds
**App key:** `production` (Permission Matrix subtab `rrv_builds`)
**Backend:** `backend/app/modules/production/` (`models/rrv_build.py`, `routes/rrv_builds.py`, `schemas/rrv_build.py`, RRV section of `service.py`)
**Frontend:** `frontend/src/app/dashboard/production/rrv-builds/`
**Prepared by:** Vineet Sharma
**Date:** 30 September 2026

---

# 1. Purpose

The Production module already runs generic manufacturing:
* versioned BOMs with routing
* work orders with material reservation, issue and return
* shop-floor time booking
* a Quality gate per operation
* finished-goods receipt into Store
* planning and costing

What it lacks is the **vehicle**. An RRV is built one unit at a time, through sub-assemblies, a main assembly, electrical and hydraulic integration, final inspection, rail and road trials, rework, and finally a handover to the customer. Today none of that exists as one record, so nobody can answer "where is RRV #14, what is left, and is it ready to hand over?".

An **RRV Build** is that record: one row per vehicle. It ties together the work orders that make it, the stage checklist it moves through, its vehicle tests, its rework, and its handover. On handover it writes the finished vehicle into the machine registry (`erp_projects`), which Service works from for warranty and service tickets.

**It deliberately doesn't duplicate what other modules own.** Electrical integration and hydraulic integration are stages whose completion is gated on the Electrical module's job and the Hydraulic module's systems and tests for the same machine. Quality inspections stay in Quality. Stock movements stay in Store. Drawings stay in Design.

# 2. Coverage of the requested scope

| Requested | Delivered as |
|---|---|
| Production Planning | Build targets (start, completion, handover), a *Planning* stage gate, and the build list with overdue flags. Material/capacity planning stays on the existing Planning page. |
| Work Orders | Existing work orders, linked to a build with a role (`main` = final vehicle assembly, `sub_assembly`). A build can raise new WOs pre-linked, or link existing ones. |
| BOM | Existing versioned BOM and routing (each WO snapshots its BOM). |
| Production Stages | A 12-stage catalog seeded per build, with assignee, planned dates and an evidence gate per stage. |
| Assembly / Sub-Assembly / Final Assembly | Stages gated on the linked WOs: sub-assembly WOs complete → main WO started → main WO complete. |
| Material Consumption | A per-build consumption roll-up across all linked WOs (required, issued, returned, consumed, value), plus a *Material Kitting* stage gated on nothing outstanding. |
| Quality Inspection | Existing per-operation gates, plus a build-level **Final Inspection** raised into Quality (type `final`). The stage is gated on it passing. |
| Testing | Vehicle test records (rail/road trials, brakes, guide-wheel deployment, etc.). The build carries its list of required tests; the *Testing* stage needs the latest record of each to be a pass. |
| Rework | Rework orders raised **automatically** when a vehicle test fails, the final inspection fails, or a linked WO's operation inspection fails; manual raising is also possible. Lifecycle: open → in progress → done → verified. The verifier can't be the person who did it, and verification needs a passing retest or re-inspection. |
| RRV Completion | A stage gated on every earlier stage being done and the vehicle identity (serial, chassis) captured. It registers or updates the machine in `erp_projects`. |
| Production Handover | A stage gated on the handover details. It sets the machine active, fills in delivery/commissioning/handover/warranty dates, and issues a printable **Handover Certificate** PDF. |

# 3. Stage catalog

| # | Key | Stage | Gate (what must be true to complete it) | N/A allowed |
|---|---|---|---|---|
| 1 | `planning` | Production Planning | Target completion and handover dates set; a main work order linked | – |
| 2 | `material_kitting` | Material Kitting & Issue | Every linked, non-cancelled WO released, with nothing left to issue | – |
| 3 | `sub_assembly` | Sub-Assemblies | At least one sub-assembly WO, all completed/closed | ✓ |
| 4 | `main_assembly` | Chassis & Main Assembly | Main WO started; sub-assembly stage done | – |
| 5 | `electrical_integration` | Electrical Integration | Machine linked; its Electrical jobs all handed over/closed | ✓ |
| 6 | `hydraulic_integration` | Hydraulic & Pneumatic Integration | Machine linked; each of its hydraulic systems has a completed passing test | ✓ |
| 7 | `final_assembly` | Final Assembly | Main WO completed/closed; electrical and hydraulic stages done | – |
| 8 | `final_inspection` | Final Quality Inspection | Build's final inspection passed / conditionally passed | – |
| 9 | `testing` | Vehicle Testing | Latest record of every required test is a pass | – |
| 10 | `rework_closure` | Rework & Punch-list Closure | No rework order open, in progress or awaiting verification | – |
| 11 | `rrv_completion` | RRV Completion | Stages 1–10 done; serial and chassis numbers captured | – |
| 12 | `handover` | Production Handover | Completion done; handover date, recipient and location captured | – |

Completing **RRV Completion** or **Handover** needs the Permission Matrix `approve` right on RRV Builds. It also needs one of: build manager, production manager (`is_production_manager`), or admin. Marking a stage N/A needs a reason. Reopening a stage is refused while any later stage is done.

Build statuses: `planned → in_progress → completed → handed_over`, plus `on_hold` (with reason) and `cancelled` (with reason).

# 4. Data model (all new tables prefixed `production_`)

* **`production_rrv_builds`** holds the vehicle record:
  * `build_number` (`RRV-YYYY-NNNN`)
  * model, customer, customer PO number and date, order reference
  * `erp_project_id` (the machine; optional until completion, when it's created if missing)
  * planned serial, chassis, engine, year of manufacture
  * branch, build manager, priority, status, target dates, `required_tests` (JSON list)
  * `final_inspection_id` (→ `quality_inspections`)
  * handover fields: date, commissioning date, handed-over-to name and organisation, location, customer acceptance ref, warranty months, remarks, handed-over by/at
  * hold and cancel reasons
* **`production_rrv_build_stages`** has one row per catalog stage (unique build + key): status (`not_started`, `in_progress`, `completed`, `not_applicable`), assignee, planned dates, started, completed by/at, remarks.
* **`production_rrv_tests`** holds vehicle test records: type, date, result (`pass`/`fail`), expected/observed, remarks, tested by, witnessed by (e.g. customer or RDSO inspector), and `retest_of_id`.
* **`production_rework_orders`** (`RW-YYYY-NNNN`):
  * build, plus source: `test`, `final_inspection`, `operation_inspection` or `internal`
  * links to the source test / inspection / work order, and an optional NCR (→ `quality_ncrs`)
  * defect, root cause, corrective action, assignee, due date, status, hours
  * done by/at, verified by/at, verification remarks, cancel reason
* **`production_rrv_events`** is the append-only build timeline.
* **`production_work_orders`** gains `rrv_build_id` and `build_role` (`main` / `sub_assembly`). Only one main WO per build is allowed. A linked WO inherits the build's machine.

# 5. API — `/api/v1/production/rrv-builds`

* **Builds:**
  * `GET` list; `POST` create (seeds stages and default required tests); `GET /{id}` detail
  * `PATCH /{id}`; `DELETE /{id}` (planned builds with no WOs only)
  * `POST /{id}/hold`, `/resume`, `/cancel`
* **Work orders and material:** `POST /{id}/work-orders/{wo_id}` (link, with role); `DELETE /{id}/work-orders/{wo_id}` (unlink); `GET /{id}/material-consumption`.
* **Stages:** `PATCH /{id}/stages/{key}` (assignee, dates), `POST .../start`, `.../complete`, `.../not-applicable`, `.../reopen`.
* **Final inspection:** `POST /{id}/request-final-inspection`.
* **Tests:** `POST /{id}/tests`; `DELETE /{id}/tests/{test_id}`.
* **Rework:**
  * `POST /{id}/rework`
  * `POST /rework/{rid}/start`, `/done`, `/verify`, `/reject-verification`, `/cancel`
  * `GET /rework` (all builds)
* **Handover:** `GET /{id}/handover-certificate` (PDF).

Work order create (`POST /production/work-orders`) accepts optional `rrv_build_id` and `build_role`.

# 6. Frontend

* A new **RRV Builds** tab in `ProductionNav` (subtab `rrv_builds`).
* **List:** status tabs, a progress bar (stages done / 12), the current stage, and target handover with an overdue flag.
* **New build form.**
* **Build detail** has tabs:
  * *Stages*: checklist with gate messages, start/complete/N/A/reopen, assignee
  * *Work Orders & Material*: linked WOs, raise/link, consumption roll-up
  * *Tests*: record, results, retests
  * *Rework*: orders and lifecycle actions
  * *Handover*: details, certificate
  * *Timeline*
* **Rework page:** every open rework order across builds.
* **WO create page:** accepts `?rrv_build_id=&build_role=` prefill.

# 7. Testing

`backend/app/tests/test_rrv_builds.py` covers:
* create, stage seeding and gates
* WO linking and the one-main rule
* consumption roll-up
* failed test → auto rework → verify needs a retest by a different person
* failed final inspection → rework
* completion registering the machine
* handover writing dates and warranty to the machine
* the certificate PDF
* permission rules
