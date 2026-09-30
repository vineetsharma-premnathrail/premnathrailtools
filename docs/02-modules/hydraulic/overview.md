# Hydraulic & Pneumatic Module — Overview

**Module:** Hydraulic & Pneumatic (fluid power)
**App key:** `hydraulic`
**Backend Location:** `backend/app/modules/hydraulic/`
**Frontend Location:** `frontend/src/app/dashboard/hydraulic/`
**Migration:** `b8e2d4f6a1c3_add_hydraulic_pneumatic_module.py`
**Date:** 30 September 2026

---

# 1. Purpose

One place for everything about the hydraulic and pneumatic systems PremnathRail designs, builds and maintains, including power packs, brake and actuation circuits, tamping-unit hydraulics and plant air. The module answers these questions:

1. **What systems do we have, and what are they rated for?** The system register records pressure, flow, reservoir, fluid, cleanliness target and running hours.
2. **What are they made of?** The component master holds the catalog. The BOM lists each system's components, tagged against its circuit symbols.
3. **Is the design right?** Circuits and diagrams are under revision control with review and approval. The engineering calculations run on the server.
4. **Did it pass?** Pressure, proof, leak, flow, cleanliness and relief-setting tests record their readings, and each reading is judged pass or fail against its limits.
5. **Is it being looked after?** Maintenance plans track days and running hours, service records log the work done and the spares used, and the spare parts list is backed by Store stock.

Every record is tagged **hydraulic** or **pneumatic**. Components and spares can also be tagged **both**, for fittings, gauges and seals used on either medium.

---

# 2. Screens (sub-nav order)

| Tab | Route | Permission subtab |
|---|---|---|
| Dashboard | `/dashboard/hydraulic` | `dashboard` |
| Systems | `/systems` (All / Hydraulic / Pneumatic) | `systems` |
| Components | `/components` | `components` |
| Circuits | `/circuits` | `circuits` |
| BOM | `/bom` | `bom` |
| Calculations | `/calculations` (`/new` is the calculator) | `calculations` |
| Testing | `/testing` | `testing` |
| Maintenance | `/maintenance` | `maintenance` |
| Service Records | `/service` | `service_records` |
| Spare Parts | `/spares` | `spare_parts` |

Actions are gated per subtab through the Permission Matrix (`require_tab_action`): `create`, `edit`, `delete`, and `approve`. `approve` covers approving a circuit, releasing a BOM and completing a test.

---

# 3. Data model (`hyd_*` tables)

| Table | What it is | Numbering |
|---|---|---|
| `hyd_systems` | A hydraulic or pneumatic system, optionally linked to an ERP project and a plant. `flow_rate` is L/min for oil and Nl/min (free air) for pneumatic. | `HYS-2026-0001` / `PNS-2026-0001` |
| `hyd_components` | Component master. It has category-specific ratings (bore, rod and stroke for cylinders; displacement for pumps and motors) plus free label/value specs. It can link to a Store item. | `<CAT>-0001`, e.g. `PMP-0001`, `DCV-0003` |
| `hyd_circuits` | ISO 1219 circuit diagram. Each revision is its own row sharing `circuit_number`. The drawings are attached documents. | `CKT-2026-0001` Rev A, B… |
| `hyd_boms` + `hyd_bom_items` | A system BOM. Each line is a component with a circuit tag (P1, V3…) and a quantity. Cost rolls up from component unit costs. | `HBOM-2026-0001` Rev A… |
| `hyd_calculations` | A saved calculation. `results` is always recomputed on the server from `inputs`. | `HCALC-2026-0001` |
| `hyd_tests` + `hyd_test_readings` | A test or inspection on a system and/or a component. It holds readings with optional min/max limits. | `HTST-2026-0001` |
| `hyd_maintenance_plans` | A recurring task, every N days and/or every N running hours. | `HMP-2026-0001` |
| `hyd_service_records` + `hyd_service_parts` | A job actually done, with the spares it used. | `HSR-2026-0001` |
| `hyd_spare_parts` | A spare tracked for the systems. It can link to a component (what it's a spare for) and to a Store item (where its stock lives). | `HSP-00001` |
| `hyd_documents` | SharePoint-backed files attached to a system, component, circuit, test or service record (`Hydraulic-media/…`). | — |

All master and transaction tables are soft-delete. Every model is registered in `core/audit_registry.py`, so the audit trail is automatic.

---

# 4. Workflows and rules

- **Circuit:** draft → under review → approved → superseded.
  - A circuit can't be submitted without an attached drawing.
  - The submitter can't approve their own circuit (four-eyes rule; admins are exempt).
  - Returning a circuit needs remarks.
  - Only a draft can be edited, or have files added or removed.
  - *Raise New Revision* copies an approved circuit into the next revision. Approving that revision supersedes the old one.
  - The submitter is notified on approval or return.
- **BOM:** draft → released → obsolete.
  - Tag numbers must be unique within a BOM.
  - Releasing locks the BOM, and releasing a new revision makes the previous one obsolete.
  - The BOM can be exported to CSV.
- **Test:** planned → in progress → completed.
  - A reading with numeric limits and a measured value is judged automatically.
  - A test can't be marked *Pass* while any reading fails. *Conditional* needs remarks.
  - Completed tests are locked, and *Raise Re-test* copies the setup and limits into a new test.
- **Maintenance plan:** the due status is the worse of the two triggers.
  - Calendar trigger: `last_done + frequency_days`; *due soon* means within 7 days.
  - Hours trigger: `last_done_hours + frequency_hours` compared with the system's running hours; *due soon* means within the last 10 % of the interval.
  - Completing a service record raised against the plan moves `last_done_*` and `next_due_date` forward.
- **Service record:** open → in progress → completed / cancelled.
  - Breakdown, corrective and overhaul jobs set the system to *Under Maintenance* until the last such job closes.
  - Completing a job updates the system's running hours.
  - On completion, spares linked to Store items can be issued from a chosen Store location in the same step. This posts `issue` transactions through `post_stock_transaction` with `reference_type = "hyd_service"`.
- **Spares:** the module owns no stock, which is the same rule as the Maintenance plan.
  - Stock on hand and available quantity come from the Store ledger, and `min_stock_qty` is this module's reorder signal.
  - Stock status is `ok`, `low`, `out`, or `not_linked` (no Store item linked).
  - *Used in systems* is derived as spare → component → released BOMs → systems.

---

# 5. Calculations

These run on the server (`backend/app/modules/hydraulic/calculations.py`). The form is rendered from `GET /hydraulic/calculations/types`, so there are no duplicated formulas in the frontend. Each calculation validates its inputs with a user-facing message and returns primary results, secondary results and design warnings.

| Hydraulic | Pneumatic |
|---|---|
| Cylinder force (push/pull, area ratio) | Cylinder force and load ratio (warns above 70 %) |
| Cylinder speed and stroke time, return-line flow | Free-air consumption (Nl/min, Nm³/h) |
| Pump delivery flow | Air receiver sizing |
| Pump drive power and next IEC motor size | |
| Motor torque, speed and power | |
| Pipe/hose sizing against velocity bands (suction, return, pressure) | |
| Line pressure drop (Darcy–Weisbach, laminar or Blasius) | |
| Accumulator sizing (isothermal or adiabatic, next standard size, 4:1 check) | |
| Reservoir sizing | |
| Heat load and cooler sizing | |

These are separate from the R&D **locomotive hydrostatic-drive** tool (`rnd/tools/hydraulic`, table `hydraulic_calculations`). That tool stays in R&D, and the calculator links to it for R&D users.

---

# 6. Overlaps to decide

- **Maintenance module (`backend/app/modules/maintenance`, in progress).** It is a plant-equipment CMMS. This module's plans and service records are fluid-power specific: running-hour intervals, oil condition, fluid added, and spares tied to components through BOMs. Both modules issue spares through the Store ledger. Decide whether the two stay separate or whether hydraulic systems become Maintenance assets later.
- **Design module document control.** It already has `hydraulic` and `pneumatic` disciplines. Circuits here have their own lighter review and approval flow. Decide whether released circuit drawings should also be registered as Design documents.

---

# 7. Tests

`backend/app/tests/test_hydraulic.py` has 16 tests:

- The calculation engine, checked against hand-worked values.
- Numbering.
- Module access.
- The circuit workflow, including four-eyes and supersede.
- The BOM, covering release, revise, cost and CSV export.
- Server-side recompute of saved calculations.
- Reading auto-judgement and completion rules.
- The plan → service record → Store issue → plan roll-forward chain.
- Breakdown status handling.
- The dashboard.
