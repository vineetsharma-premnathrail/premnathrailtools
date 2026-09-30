# Electrical Module — Overview

**Module:** Electrical (RRV electrical creation)
**App key:** `electrical`
**Backend Location:** `backend/app/modules/electrical/`
**Frontend Location:** `frontend/src/app/dashboard/electrical/`
**Migration:** `e8b0c2d4f6a1_add_electrical_module.py`
**Date:** 30 September 2026

---

# 1. Purpose

Tracks the electrical system of each RRV (rail-road vehicle) from the customer's requirement to the as-built record. One **RRV Electrical Job** (`ELJ-YYYY-NNNN`) is raised per vehicle, optionally linked to the ERP machine it belongs to. Every job gets the full 20-stage scope. A stage can only be completed once its evidence exists in the job, and the backend enforces that.

This replaces the earlier `electrical_work_orders` table, which was added in `d6f0a2b8c4e9` and dropped in `ae88c635814e`. That table was a flat work-order list with no scope stages.

---

# 2. Scope → stages

| # | Stage | Phase | Completion gate (enforced in `service.stage_gate_problems`) |
|---|---|---|---|
| 1 | Electrical Requirement | Design | System voltage + requirement text on the job. **Required.** |
| 2 | Electrical System Design | Design | — |
| 3 | Electrical Schematics | Design | An approved schematic or single line diagram. |
| 4 | Component Selection | Design | Every BOM line has make + part number and is *Selected*. |
| 5 | Electrical BOM | Design | At least one BOM line. **Required.** |
| 6 | Cable / Wiring Design | Design | At least one cable in the schedule. |
| 7 | Panel Design | Design | At least one panel. Can be marked N/A. |
| 8 | Component Specification | Design | Every BOM line has a rating or specification. |
| 9 | Electrical Drawing / Revision | Design | Every drawing has an approved revision; no open revisions. |
| 10 | Purchase Requirement | Procurement | No BOM line still *To Buy*: each is linked to a P2P PR or marked *In stock*. |
| 11 | Electrical Assembly | Build | — |
| 12 | Wiring / Harness Installation | Build | Every cable is at least *Installed*. |
| 13 | Panel Assembly | Build | Every panel is at least *Assembled*. |
| 14 | Electrical Testing | Test & QC | At least one factory test; every failure has a passing retest. **Required.** |
| 15 | Inspection & QC | Test & QC | The final inspection raised in Quality is *Passed* or *Conditionally passed*. |
| 16 | Troubleshooting | Test & QC | No issue is open or under investigation. |
| 17 | Commissioning | Handover | Commissioning date set; at least one commissioning test; no open failures. |
| 18 | Final Electrical Documentation | Handover | A test report, commissioning report or O&M manual uploaded; no open drawing revisions. |
| 19 | RRV Electrical Handover | Handover | Stages 1–18 done or N/A; handed-over-to name and date set. **Required.** Completing it moves the job to *Handed Over*. |
| 20 | As-Built Electrical Records | Handover | At least one approved drawing marked *As-built*. |

Stages run in parallel; order is not forced except by the gates. Any non-required stage can be marked **Not applicable** with a reason, and a completed stage can be reopened.

**Job lifecycle:** `draft → in_progress → handed_over → closed`, plus `on_hold` (freezes stage work) and `cancelled`. Starting or completing the first stage moves a draft to in progress. Closing needs every stage done. A closed job is read-only.

---

# 3. Data model (all tables prefixed `electrical_`)

| Table | Holds |
|---|---|
| `electrical_jobs` | Job identity, planning, the requirement fields, the Quality inspection link, and commissioning/handover fields. |
| `electrical_job_stages` | The 20 stage rows per job, each with owner, planned dates, status and completed by/at. |
| `electrical_bom_items` | Component lines: category, make/part number, rating/spec, selection status, procurement status, P2P PR link and the panel it is mounted in. |
| `electrical_panels` | Panels/enclosures: tag, type, location, IP rating, and design → assembly → installation status. |
| `electrical_cables` | Cable schedule: tag, from/to, cores × size, length, harness, and design → cut → installed → tested status. |
| `electrical_drawings` / `electrical_drawing_revisions` | Drawing register with R0, R1 … revisions going draft → submitted → approved/rejected. Approving a revision supersedes the previous approved one. The approver must be someone other than the preparer. |
| `electrical_tests` | Test records for the factory and commissioning phases. A failure stays on record and is cleared by a retest (`retest_of_id`). |
| `electrical_issues` | Troubleshooting log. Resolving an issue needs a root cause and the corrective action. |
| `electrical_documents` | Job files, optionally tied to a stage. |

Files live in SharePoint under `Electrical-media/<job number>/…` and are streamed through the backend.

**Why drawings aren't on `design_documents`:** the Design module was not live when this was built. `design_documents` already has a `discipline` column, so the electrical drawings can be folded into it later.

---

# 4. Integrations

- **ERP:** a job can point at an `erp_projects` machine. Picking the machine prefills customer and serial number.
- **Procurement (P2P):** *Raise PR* on a BOM line opens the P2P New PR form prefilled with that line. *Link PR* then attaches the PR number to the line and moves it to *PR Raised*. The PR itself is processed in Procurement as usual.
- **Quality:** *Request QC Inspection* raises a `final` `quality_inspections` row (batch number = job number) and notifies Quality users. The Inspection & QC stage reads that inspection's status.
- **Notifications:** sent to the lead engineer and stage owners on assignment, to the lead engineer on drawing submission and handover, to the preparer when a drawing is approved or rejected, and to the assignee and reporter on issues.
- **Audit trail:** every electrical model is registered in `app/core/audit_registry.py`.

---

# 5. Permissions

App access comes from `require_app_access("electrical")`. Permission Matrix subtabs are `dashboard`, `jobs`, `drawings`, `purchase`, `testing` and `troubleshooting`. Job changes check `jobs:create|edit|delete`, and drawing approval checks `drawings:approve`. Users with no matrix grants are unrestricted, the same as every other module.

---

# 6. Screens

| Route | Screen |
|---|---|
| `/dashboard/electrical` | Dashboard: KPIs, open jobs by phase, handovers due, recent jobs |
| `/dashboard/electrical/jobs` | Job list with status, phase and "my jobs" filters |
| `/dashboard/electrical/jobs/new` | Create a job (RRV details + requirement) |
| `/dashboard/electrical/jobs/[id]` | Job page with phase tracker and tabs: Stages, Details & Requirement, BOM, Panels, Cables, Drawings, Tests, Troubleshooting, QC & Handover, Documents. `?tab=` deep-links. |
| `/dashboard/electrical/drawings` | Drawing register across jobs, with an "awaiting approval" filter |
| `/dashboard/electrical/purchase` | Purchase requirements across jobs |
| `/dashboard/electrical/testing` | Test register, with a "needs retest" filter |
| `/dashboard/electrical/troubleshooting` | Open issues across jobs |

Tests: `backend/app/tests/test_electrical.py` walks one job through all 20 stages.
