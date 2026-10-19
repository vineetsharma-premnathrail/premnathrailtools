# R&D Module — Overview

**Module:** R&D (Research & Development)
**App key:** `rnd`
**Backend Location:** `backend/app/modules/rnd/`
**Frontend Location:** `frontend/src/app/dashboard/rnd/`, shared components in `frontend/src/components/rnd/`
**Prepared by:** Vineet Sharma
**Date:** 7 October 2026
**Status:** Live. It has two halves: the **R&D project workflow** (projects, feasibility, experiments, prototypes, documents, release of a prototype BOM to Production, and the CRM requirement inbox) and the **seven engineering calculators** with a shared calculation history. Three pages, Experiments, Prototypes and Documents, still exist and work, but the nav currently hides them (see 3.1). Whether they come back is a pending decision.

This document replaces the 29 August 2026 version, which only covered the calculators and said every route was behind one gate. That is no longer true: most routers now also check a Permission Matrix subtab, and some do not (see 3.2).

---

# 1. Purpose

The R&D module answers four questions:

1. **What has Sales/CRM asked R&D to look at, and have we answered?** This is the Requirements inbox. It shows CRM inquiries and tenders that were sent with "Send Technical Requirement to R&D".
2. **Which development projects are running, at what stage, and against what budget?** This covers R&D projects, their stage gates, the feasibility study and the handover checklist.
3. **What did we build and test, and did it pass?** This covers prototypes (with a costed BOM) and experiments (with measured parameters and a pass/fail result).
4. **Does the design meet the numbers?** This is the seven engineering calculators: braking, hydraulic drive, Qmax, load distribution, tractive effort, vehicle performance and spline. Each produces a downloadable report and can be saved to a shared history.

The module ends where Production begins. A validated prototype's BOM is released to Production as a **draft** Production BOM, and Production adds the routing and activates it (6.6).

> **Engineering note: why R&D hands over a *draft* BOM and never an active one.**
> In SAP PLM/PP, the engineering BOM (what R&D designed) and the manufacturing BOM (what the shop floor builds, with routing, scrap and operations) are separate objects, and only Production activates the manufacturing BOM. If R&D could create an active BOM, an untested part list could go straight into MRP and purchasing. Here R&D releases the part list it validated, Production checks it and adds operations, and only then does it become live. The prototype is frozen once released, so the source of record cannot change under Production's feet.

---

# 2. How R&D relates to other modules

| Other module | What R&D uses | Direction |
|---|---|---|
| **CRM** | Inquiries and Tenders with `technical_offer_sent_at` set, the request assignment (`CrmRndRequest`), the send history (audit log `<source>_tor`), and CRM documents flagged `shared_via_tor`. | R&D reads the CRM record directly; nothing is copied. R&D's *response* (remarks, delay reason, files) is written back to CRM: files become `CrmDocument` rows under `CRM-media/…/rnd-response`, and an `rnd_responded` audit entry is logged on the CRM record. |
| **Production** | `production_boms` / `production_bom_items`, and `generate_bom_number()`. | R&D **writes** one draft BOM per release (6.6). It reads the BOM back to show its number, version and status. Deleting that draft in Production un-freezes the prototype. |
| **Store (Item Master)** | `store_items` for prototype BOM lines and for the finished product picked at release. | Read only, through R&D's own `GET /rnd/lookups/store-items` (R&D users usually don't have the `store` app). |
| **Project Management** | The **Project Work** tab is the shared `MyTasks` + `DepartmentWork` component (milestones given to the R&D department, and the user's tasks). | Display only. There is no link between PM projects and R&D projects. |
| **SharePoint** | R&D documents are stored under `RnD-media/…/RnD/<project number>`. Requirement responses go under `CRM-media`. | Write |
| **Design** | Nothing yet. Plan §13 item 3 (attach a calculation report to a Design document) is not built. | — |

---

# 3. Access and gates

The module is gated by the app key `rnd`. Fine-grained rights come from the Permission Matrix (`core/permission_registry.py`, `MODULES["rnd"]`). `require_tab_access` follows the platform rule: a user the matrix has **never** been configured for in this module passes every subtab check; once any grant exists, only granted subtabs pass.

## 3.1 Subtabs and nav

| Subtab key | Label | Shown in nav? | What the backend gates with it |
|---|---|---|---|
| `dashboard` | Dashboard | Yes | `GET /rnd/dashboard` |
| `project_work` | Project Work | Yes | Nothing in R&D (the PM component has its own checks) |
| `requirements` | Requirements | Yes | Whole `/rnd/requirements` router |
| `projects` | R&D Projects | Yes ("Projects") | Whole `/rnd/projects` router, including feasibility |
| `experiments` | Experiments & Tests | **Hidden, decision pending** | Whole `/rnd/experiments` router |
| `prototypes` | Prototypes | **Hidden, decision pending** | Whole `/rnd/prototypes` router, including release to Production |
| `documents` | Documents | **Hidden, decision pending** | Nothing; the documents router deliberately skips it (see 3.2) |
| `all` | Engineering Tools | Yes | Nothing (frontend nav only). The key is the old calculator landing page, kept so existing grants still apply. |
| `braking` … `spline` (7 keys) | One per calculator | Yes, as a second row inside Engineering Tools | Nothing (frontend nav only) |
| `history` | History | Yes | Nothing (frontend nav only) |

**Hidden pages.** `RndNav` no longer lists Experiments, Prototypes or Documents, and the project detail page no longer lists a project's experiments or prototypes either (the API still returns them in `GET /rnd/projects/{id}`). The pages under `/dashboard/rnd/experiments`, `/prototypes` and `/documents`, including the **Release to Production** panel, still work when opened by URL. Until a decision is taken, the only way to release a prototype BOM is to open `/dashboard/rnd/prototypes/<id>` directly. <!-- decision pending: bring back the three tabs, or fold experiments/prototypes/documents into the project page -->

## 3.2 What is and isn't gated (backend)

| Router | Gate |
|---|---|
| `/rnd/tools/*` (all seven calculators) | `rnd` app only, once on the parent router (`routes/calculations.py`). **No per-tool subtab check**: hiding "Braking" in the matrix hides the nav pill, but the API still answers. |
| `/rnd/history/*` | `rnd` app only (recently added on the router). No `history` subtab check. Owner-or-admin checks on detail, rename and delete; admin-only on `/admin/*`. |
| `/rnd/dashboard` | `rnd` app + `dashboard` subtab |
| `/rnd/lookups/store-items` | `rnd` app only |
| `/rnd/projects/*` | `rnd` app + `projects` subtab |
| `/rnd/experiments/*` | `rnd` app + `experiments` subtab |
| `/rnd/prototypes/*` | `rnd` app + `prototypes` subtab |
| `/rnd/documents/*` | `rnd` app only, on purpose: documents appear inside experiment and prototype pages, and a subtab gate would 403 them there. Delete is uploader-or-admin. |
| `/rnd/requirements/*` | `rnd` app + `requirements` subtab. Responding is further limited to the assigned engineer or an admin (checked in `crm/services/requirement_movement.mark_responded`). |

**No action-level gates.** Nothing in R&D uses `require_tab_action`. Anyone who can *view* a subtab can also create, edit, delete, change stage, record the feasibility recommendation and release to Production. There is no separate "approve" right for the Go/No-Go decision or the release.

> **Engineering note: why the missing approve right matters.**
> The feasibility recommendation and the BOM release are the two points where R&D commits the company to something: spending on production tooling, and a part list that purchasing will act on. In a stage-gate process these are signed off by someone other than the person doing the work (a gate review board; here, a partner or the R&D head). Today the system records *who* set the recommendation (`reviewed_by_id`) and *who* released (`released_by_id`), so it is auditable, but it does not stop the engineer approving their own work. If that separation is wanted, the fix is `require_tab_action("rnd", "projects", "approve")` on the stage and feasibility routes and `("prototypes", "approve")` on release.

## 3.3 Typical roles

| Role | Access needed |
|---|---|
| **R&D engineer** | `rnd` app; `requirements`, `projects`, the tools and `history`. Answers CRM requests assigned to them. |
| **R&D head** | Everything above, plus the hidden `experiments` / `prototypes` subtabs while those pages are reached by URL. Sees all users' calculation history only if they are an admin (there is no "R&D lead" level for history). |
| **CRM / BD** | Nothing in R&D. They send requests and read the response from the CRM side (`/crm/rnd-requests`, CRM-gated). |

---

# 4. Data model

All project-side tables use `TimestampMixin`; projects, experiments, prototypes and documents also use `SoftDeleteMixin`. Projects, experiments, prototypes, prototype BOM lines, feasibility studies and documents are registered in `core/audit_registry.py`, so field changes reach `audit_logs`. Choice lists are coded tuples in the model files (no admin-editable lookup tables).

Migrations: `284fe3a833c2_add_rnd_module_projects_experiments_prototypes.py` and `a9691d4d422a_add_rnd_documents_and_prototype_release.py`.

## 4.1 `rnd_projects` (`RndProject`), numbered `RND-YYYY-NNNN`

| Column | Notes |
|---|---|
| `project_number`, `title`, `objective` (required), `scope`, `remarks` | |
| `project_type` | `new_product`, `product_improvement`, `process_development`, `technology_research` |
| `priority` | `low`, `medium`, `high`, `critical` |
| `stage` | `initiation` → `research` → `development` → `feasibility` → `handover` → `closed` (gates in 6.2) |
| `status` | `active`, `on_hold`, `cancelled`. A cancelled project can't change stage. |
| `lead_id`, `team_member_ids` (JSON list of user ids) | Validated to exist; duplicates removed |
| `start_date`, `target_end_date`, `actual_end_date` | Target can't be before start. `actual_end_date` is stamped on the move to Closed. |
| `budget_amount` | Compared with actual spend = sum of live prototypes' BOM cost |
| `handover_specs_final`, `handover_bom_approved`, `handover_process_documented`, `handover_quality_standards`, `handover_notes` | The handover checklist. All four must be ticked to close. |
| `handed_over_at` | Stamped the first time the project enters Handover |

## 4.2 `rnd_feasibility_studies` (`RndFeasibilityStudy`), one per project

Four checks, each with a rating (`feasible`, `conditional`, `not_feasible`) and notes: **costing** (`material_cost`, `labour_cost`, `overhead_cost`, `target_selling_price`), **sourcing**, **process** and **quality**. Then a `recommendation` (`go`, `conditional_go`, `no_go`), `decision_notes`, and `reviewed_by_id` / `reviewed_at`, which are stamped whenever the recommendation changes. The API adds `estimated_unit_cost` (sum of the three costs) and `estimated_margin_pct` = (price − unit cost) / price × 100.

## 4.3 `rnd_experiments` (`RndExperiment`), numbered `EXP-YYYY-NNNN`

| Column | Notes |
|---|---|
| `project_id` (required), `prototype_id` (optional, must belong to the same project) | |
| `experiment_type` | `research`, `lab_test`, `field_trial`, `simulation`, `validation` |
| `status` | `planned`, `in_progress`, `completed`, `cancelled`. Completed needs a `result`. |
| `result` | `pass`, `fail`, `inconclusive` |
| `objective`, `method`, `experiment_date`, `conducted_by_id` (defaults to the creator) | |
| `parameters` (JSON) | Rows of `{parameter, specification, measured, unit, result}`; row `result` is `pass`, `fail` or blank, and every row needs a parameter name |
| `observations`, `conclusion` | |

## 4.4 `rnd_prototypes` (`RndPrototype`), numbered `PRT-YYYY-NNNN`, and `rnd_prototype_bom_items`

| Column | Notes |
|---|---|
| `project_id`, `name`, `version` (default `v1`), `description`, `build_date`, `findings` | |
| `status` | `design`, `building`, `testing`, `validated`, `rejected` |
| `production_bom_id`, `released_at`, `released_by_id` | Set by the release to Production (6.6) |

BOM lines: `store_item_id` (optional), `item_code`, `item_name` (required), `quantity` (> 0), `uom`, `unit_cost` (≥ 0), `remarks`. A line can be free text because R&D often uses parts that aren't in the Item Master yet, but only Item Master lines can be released. Line cost = quantity × unit cost; prototype BOM cost = sum of lines.

## 4.5 `rnd_documents` (`RndDocument`)

Attached to a project, optionally narrowed to one of its experiments or prototypes. `doc_type`: `specification`, `drawing`, `test_report`, `research_note`, `process_document`, `other`. The bytes live in SharePoint; the row holds `sharepoint_path`, `sharepoint_url`, `file_name`, `file_size`, `mime_type`, `title`, `version` and the uploader. When an experiment or prototype is moved to another project, its documents move with it.

## 4.6 Calculation history

- `rnd_calculation_history` (`CalculationHistory`): one row per save from any calculator: `user_id`, `tool_name`, `calculation_name`, `inputs_json`, `results_json`, `created_at`.
- Seven per-tool snapshot tables (`models/tool_calculations.py`): `rnd_braking_calculations`, `rnd_hydraulic_calculations`, `rnd_load_distribution_calculations`, `rnd_qmax_calculations`, `rnd_spline_calculations`, `rnd_tractive_effort_calculations`, `rnd_vehicle_performance_calculations`. Each copies the key inputs and results into typed columns (for example braking `mass_kg`, `gbr_percent`; spline `safety_factor`, `verdict`) plus the full JSON. They are written best-effort after the main row: if the shape is unexpected, the snapshot is skipped and logged, and the main save still succeeds.

> **Engineering note: why typed snapshot columns as well as JSON.**
> JSON is enough to replay a calculation, but you can't easily ask "every braking calculation over 20 t with GBR under 10%" of a JSON blob across seven different shapes. The typed tables are what a future report or an RRV-model link (plan §13 item 3) would query. Nothing reads them yet.

---

# 5. Number series

| Document | Format | Generator |
|---|---|---|
| R&D project | `RND-YYYY-NNNN` | `service.generate_project_number` |
| Experiment | `EXP-YYYY-NNNN` | `service.generate_experiment_number` |
| Prototype | `PRT-YYYY-NNNN` | `service.generate_prototype_number` |
| Draft Production BOM from a release | Production's own series | `production.service.generate_bom_number` |

The sequence restarts each calendar year. Concurrent saves are serialised with a Postgres advisory lock on the prefix (skipped on SQLite tests), the same pattern as Quality.

---

# 6. Workflows

## 6.1 Requirement inbox (CRM → R&D → CRM)

1. In CRM, BD uses **Send Technical Requirement to R&D** on an inquiry or tender and assigns an R&D engineer with a due date.
2. The record appears in **R&D › Requirements**: organisation, product or tender, quantity, required-by date, priority, BD owner, who sent it last, how many times it was sent, and the latest request with its assignee. **Assigned to me** filters to the user's own requests.
3. If CRM edited the record after the last send, the row is flagged `edited_after_send`, meaning a re-send is due.
4. The detail page shows the requirement fields, the organisation and contact, and the full movement history. TOR PDFs and attached client documents open through `/crm/documents/{id}/content`, which allows `shared_via_tor` documents.
5. The assignee (or an admin) **responds** with remarks and/or files. A late answer needs a delay reason. A superseded request (CRM re-sent it) or an already-answered one returns 409.

## 6.2 Project lifecycle and stage gates

```
Initiation → Research → Development → Feasibility → Handover → Closed
```

`POST /rnd/projects/{id}/stage` runs `service.check_stage_gate`:

- **Moving backwards** is always allowed (unless the project is cancelled).
- **Into Handover or beyond** needs a feasibility study with a recommendation, and that recommendation must not be `no_go`.
- **Into Closed** needs all four handover checklist boxes ticked.
- A **cancelled** project can't change stage until its status is set back to Active.

Stages can be skipped forward (Initiation straight to Feasibility is allowed); only the two gates above are enforced.

> **Engineering note: why only two gates.**
> This follows the stage-gate model (Cooper) mapped onto SAP PS: most stage moves are the project lead's call, but two are business decisions. *Feasibility → Handover* is the Go/No-Go: can we make it at a cost, from materials we can buy, with a process we can run, to a quality we can hold? *Handover → Closed* checks that Production actually received specs, an approved BOM and routing, process documents and quality standards. Without the second gate, projects get "closed" with the knowledge still in the engineer's head.

## 6.3 Feasibility study

`PUT /rnd/projects/{id}/feasibility` creates or updates the single study. Ratings and recommendation are checked against the coded lists; costs can't be negative. Changing the recommendation stamps the reviewer and time.

## 6.4 Experiments

Created as `planned`. The user edits type, links, parameters and dates, and moves the status. **Completed requires an overall Result.** Delete is a soft delete with no other checks.

## 6.5 Prototypes and BOM cost

Created in `design` with an optional BOM. Saving with `bom_items` replaces the whole BOM. The BOM cost of every live prototype rolls up into the project's **Actual** spend, shown against budget on the project page.

A prototype can't move to another project while experiments in its current project reference it. It can't be deleted while experiments reference it, or after its BOM was released.

**Status is free.** Any status, including `validated`, can be set directly; the system does not check that a passing validation experiment exists, even though the release error message asks the user to "record the passing validation experiments".

## 6.6 Release to Production (prototype → draft Production BOM)

`POST /rnd/prototypes/{id}/release-to-production` with `product_item_id` (the finished product's Store item), `base_quantity` (default 1) and optional `remarks`. The UI is `ReleaseToProductionPanel` on the prototype page.

Checks, in order, each with its own error message:

1. Not already released (409, quoting the existing BOM number).
2. Prototype status is `validated`.
3. The BOM has at least one line.
4. **Every line is an Item Master part** (free-text lines are listed by line number).
5. Every linked Store item still exists.
6. Every quantity is > 0, and base quantity is > 0.
7. The product item exists and is not one of the BOM's own components.
8. There is no other open **draft** BOM for that product (409; Production must activate or delete it first).

Then it creates a `ProductionBom` with `status="draft"`, `version` = the product's highest BOM version + 1, the prototype's description, and remarks "Released from R&D PRT-… (v…), project RND-…". Lines that use the same part are **merged into one line with the summed quantity**; scrap is 0. The prototype stores `production_bom_id`, `released_at` and `released_by_id`.

After release, the prototype's **BOM is frozen** (409 on BOM edits) and it can't be deleted. If Production deletes the draft BOM, the freeze lifts and the prototype can be released again.

> **Engineering note: why free-text parts block the release.**
> A Production BOM drives MRP, purchase requisitions and stock issues. All three need a real item code with a unit of measure, a reorder rule and a valuation. A free-text "M12 bolt, high tensile" can't be bought or issued. So R&D is free to sketch with free text during development, but before handover Store must create the items. That is also the moment the part gets reviewed for standardisation, which is cheaper than doing it after the first production order.

## 6.7 Handover and close

On the project page, the **Handover to Production** section has the four checklist ticks and notes. Ticking "Approved BOM & routing" is a manual statement; it is not linked to a prototype actually being released, or to Production having activated the BOM.

## 6.8 Documents

`POST /rnd/documents` (multipart) uploads one or more files with a type, title, version and optional experiment or prototype link (which must belong to the same project). `GET /rnd/documents/{id}/content` streams the bytes through the app's Graph token. The raw SharePoint link is never handed out. Both return 503 with a clear message if `SHAREPOINT_SITE_ID` isn't set. A project can't be deleted while it has documents, experiments or prototypes.

---

# 7. Engineering tools: common behaviour

## 7.1 Routes

Each tool is its own sub-router under `/api/v1/rnd/tools/<tool>`. Route names are **not uniform**: this is historical, and plan §13 item 2 (standardise on `/calculate`, `/report.docx`, `/report.pdf`) is not done.

| Tool | Calculate | Word report | PDF report |
|---|---|---|---|
| Braking | `POST /braking/braking_calculate` | `POST /braking/braking_download_docx` (**not used by the UI**) | `POST /braking/braking_report_pdf` (LaTeX) |
| Hydraulic | `POST /hydraulic/calculate` | `POST /hydraulic/download-report` | `POST /hydraulic/hydraulic_report_pdf` (LaTeX, one template per mode) |
| Qmax | `POST /qmax/calculate` | `POST /qmax/download-report` | — |
| Load distribution | `POST /load-distribution/calculate` | `POST /load-distribution/download-report` | — |
| Tractive effort | `POST /tractive-effort/calculate` | `POST /tractive-effort/download-report` | — |
| Vehicle performance | `POST /vehicle-performance/calculate` | `POST /vehicle-performance/download-report` (with matplotlib charts) | — |
| Spline | `POST /spline/calculate` | `POST /spline/docx` | `POST /spline/report` (LaTeX) |

Spline also has `GET /spline/` → redirect to `/spline_calculator.html`, a legacy static page that no longer exists in the repo.

Every endpoint recalculates from the posted inputs; reports are never built from a stored result. Errors: `ValueError` → 400 "<reason> — correct the highlighted input and recalculate"; anything else → 500 "Calculation failed unexpectedly — report this with your inputs to the R&D tool owner." Spline's `/calculate` has no such wrapper (see 8.7).

Some folders contain files that nothing imports: `tractive_effort/calculate.py`, `vehicle_performance/calculate.py`, `vehicle_performance/core.py`, `spline/calculate.py`, `spline/validation.py`, and a second `create_spline_docx` in `spline/reports/pdf_builder.py`. The real code paths are named in each section below. The frontend `components/rnd/ToolCalculatorPage.tsx` is also unused.

## 7.2 Reports

- **Word (.docx)** is built with `python-docx` and streamed as a download. These are plain downloads, **not** the managed "Save & Edit in Word" documents used elsewhere in the portal (feedback rule: Word is the document of record). Bringing the calculators onto that pattern is open.
- **PDF** (braking, hydraulic, spline) renders a Jinja2 `.tex` template from `backend/app/utils/templates/` (`template.tex` for braking, `hydraulic_{cc,speed,pressure,gear}_template.tex`, `spline_template.tex`) and compiles it with `pdflatex`, falling back to `xelatex`.
- **LaTeX safety.** Every free-text field (doc no., made/checked/approved by, date, material) goes through `tools/latex_utils.escape_latex` before rendering, so `\input{/app/.env}` prints as text instead of including the file. The compiler runs with `-no-shell-escape` and `openin_any=p` / `openout_any=p` (reads and writes limited to the temp folder). `lualatex` is excluded because `\directlua` can reach the OS. `:` and `;` are deliberately not escaped. This closes plan §13 item 1 (C-01).
- Braking computes its context once for both PDF and DOCX, so the Word report receives the **LaTeX-escaped** strings: a doc no. `BRK_001` appears as `BRK\_001` in Word.

## 7.3 Saving to history

Every calculator page saves automatically after a successful calculation (`rndApi.saveHistory`, fire-and-forget). Opening a history row navigates to `/dashboard/rnd/<tool>?load=<id>`, which reloads the inputs and recalculates. The save's `.catch(() => {})` means a failed save (for example 413 too large, or 403) is **silent**, which goes against the portal's "real error messages" rule.

---

# 8. The seven calculators

Units below are the units the code assumes. "Screen label" is what the user sees when it differs.

## 8.1 Braking (`tools/braking/`)

**Purpose.** Rail (and optionally road) stopping-distance check for a rail-road vehicle, with reference to DIN EN 15746-2 stopping distances. Code path: `api.py` → `validation.py` → `service.perform_braking_calculation` → `core.py`, `units.py`.

**Inputs**

| Field | Unit | Notes |
|---|---|---|
| `mass_kg` | kg | Screen: "GVW (kg)". > 0. |
| `reaction_time` | s | Default 1 |
| `num_wheels` | count | Screen: "Driving Wheels". > 0. Only used to report force per wheel. |
| `wheel_dia` | mm | Report only |
| `calc_mode` | `Rail` / `Rail+Road` | "Road mode" toggle |
| `rail_speed_input` | km/h, comma list | |
| `rail_gradient_input`, `rail_gradient_type` | comma list; `Degree (°)`, `1 in G` or `Percentage (%)` | 0 (flat) is always added |
| `road_speed_input`, `road_gradient_input`, `road_gradient_type` | km/h; % or ° | Road mode only |
| `mu` | — | Tyre–road friction, default 0.7, > 0 |
| `doc_no`, `made_by`, `checked_by`, `approved_by` | text | Report header |

**Formulas**

- Gradient to angle: degree as is; `1 in G` → θ = atan(1/G); % → θ = atan(p/100).
- **Rail braking force** (`calculate_max_rail_force`): for every pair (v, d) in the reference table `BRAKING_DATA` {8→3, 10→5, 16→12, 20→20, 24→28, 30→45, 32→50, 40→75, 50→135, 60→180 m}, a = v²/(2d) and F = m·a. The tool uses F_max = the largest of these. It does **not** depend on the speeds the user entered.
- Rail scenarios: flat gives F_net = F_max; *Moving up* gives F_net = F_max + W·sin θ; *Moving down* gives F_net = F_max − W·sin θ (W = m·g, g = 9.81).
- Deceleration a = |F_net / m|; braking distance = v²/(2a); reaction distance = v·t_r; total = reaction + braking.
- Road: N = W·cos θ, F_friction = μ·N, then F_net = F_friction (flat), + W·sin θ (up) or − W·sin θ (down).
- Compliance (rail only): the total is compared with `MAX_STOPPING_DISTANCES` {8→6, 10→9, 16→18, 20→27, 24→36, 30→55, 32→60, 40→90, 50→155, 60→230, 70→300, 80→400, 90→500, 100→620 m}. The limit used is that of the highest tabulated speed ≤ the input speed. Below 8 km/h the result is "Standard Not Found". Road rows are "N/A".
- GBR = F_max / (m·g) × 100.

**Outputs.** One row per mode × scenario × gradient × speed (gravitational force, applied force, net force, deceleration, braking distance, total, status), plus `gbr` and `max_force`.

**Reports.** PDF from `template.tex` (force-capability table, detailed rail and road steps). DOCX endpoint exists but the page only offers PDF.

> **Engineering note: what this tool really answers.**
> The braking force is not an input. The tool computes the force needed to meet the most demanding point of the reference table, then checks stopping distances *with that force*. Every pair in `BRAKING_DATA` needs about 0.77–0.82 m/s², and the maximum is 0.823 m/s² (at 8, 16 and 40 km/h). So for **any** mass, F_max = 0.823·m and **GBR always comes out at about 8.39%**. On flat track the check will always pass unless reaction time is large. Read it as "the brake must deliver at least this force (≈8.4% of weight)" — a sizing requirement — not as a verification of an actual brake design. To verify a real brake, the brake force (or brake cylinder pressure × rigging ratio × shoe friction) would need to be an input.

**Known discrepancies**

1. **`abs(f_net / mass)` hides a runaway.** When going down a gradient where W·sin θ > F_max (steeper than about 8.4%, roughly 1 in 12), F_net is negative: the vehicle cannot stop with that force. `abs()` turns this into a small positive deceleration and a long but finite stopping distance, instead of flagging "cannot stop".
2. **Screen and server compliance can disagree.** The page recomputes compliance in the browser with **linear interpolation** between tabulated speeds; the server status (and the PDF) uses the **lower tabulated speed's** limit. At 45 km/h the page allows ≈122 m while the server allows 90 m.
3. UI-only inputs: Brake type, calculation method (Force / Distance / Detail), custom or target distance, track standard and its curve, super-elevation, cant and gauge are **not sent** to the server. The "Distance" method and custom distance change only the on-screen table.
4. The scenario filters and "Show GBR" are not sent either; the PDF always prints every scenario and never the GBR block (`show_gbr` is always false server-side).
5. `reaction_time` is passed to `calculate_max_rail_force` but not used there.
6. History saves only `gbr`, `max_force` and the row count, not the rows.
7. DOCX gets LaTeX-escaped header text (7.2).

## 8.2 Hydraulic drive (`tools/hydraulic/`)

**Purpose.** Size the hydrostatic traction drive of a rail-road vehicle: pump → hydraulic motors → axle gearbox → wheels. Four modes. Code path: `api.py` → `validation.py` → `service.perform_hydraulic_calculation` → `core.py`.

**Inputs** (all sent as strings and parsed server-side)

| Field | Unit | Used in modes |
|---|---|---|
| `weight` | t | cc, speed, pressure |
| `axles`, `drive_axles` | count | cc, speed, pressure. Drive axles ≤ axles. |
| `wheel_diameter` | mm | all |
| `speed` | km/h (screen: "Target Speed") | cc, pressure, gear |
| `max_vehicle_rpm` | rpm (engine) | cc, speed |
| `pto_gear_ratio` | — (split-shaft PTO) | cc, speed |
| `engine_gear_ratio` | comma list | cc, speed |
| `axle_gear_box_ratio` | — | cc, speed, pressure |
| `slope_percent` + `slope_unit` | %, ratio (1:G) or degree; converted to % | cc, speed, pressure (the UI always sends %) |
| `curve_degree` + `curve_unit` | degree, %, ratio or radius in m (D = 1750/R); converted to degrees | cc, speed, pressure (the UI always sends degrees) |
| `num_motors`, `per_axle_motor` | count | cc, speed, pressure |
| `pressure` + `pressure_unit` | bar (Pa, kPa, MPa, kgf/cm² accepted) | cc, speed |
| `mech_eff_motor`, `vol_eff_motor` | % | mech: cc, speed, pressure; vol: cc |
| `motor_disp_in` | cc/rev | speed, pressure |
| `max_motor_rpm` | rpm | gear |
| `vol_eff_pump`, `mech_eff_pump` | % | vol: cc, speed; mech: cc (validated 0 < η ≤ 100) |
| `num_pumps`, `pump_disp_in` | count; cc/rev | cc (count), speed (both) |

**Resistance model** (shared by cc, pressure and speed modes; W in t, v in km/h, results in kN):

- Rolling: R_r = (A + B·v + C·v²)·W·g/1000 with A = 0.647 + 13.17/(W/axles), B = 0.00933, C = 0.057/W.
- Gradient: R_g = W·1000·g·s/100000 (= W·g·s/100, s in %).
- Curve: R_c = 0.4·W·D·g/1000 (D in degrees).
- Starting: R_s = 6·W·g/1000 (6 kg/t), **added at every speed**.
- Total R = R_r + R_g + R_c + R_s.

> **Engineering note: the rolling-resistance formula.**
> This is the Indian Railways locomotive resistance formula, R (kg) = (0.647 + 13.17/w)·W + 0.00933·v·W + 0.057·v², where w is the axle load in tonnes. Writing C as 0.057/W just lets the code multiply everything by W; the v² term is the air-drag part, and it does not grow with weight. Curve resistance of 0.4 kg/t per degree and starting resistance of 6 kg/t are the usual IR planning values.

**Mode `calc_cc` — Pump & Motor (cc)** (`calculate_displacement_mode`)

- Wheel: circumference = π·D/1000 (m); n_wheel = (v/3.6)/circ × 60; motor speed n_m = n_wheel × axle ratio.
- Torque: T_total = R·1000·r (r = D/2000 m); per axle = T_total / drive axles; per motor = per axle / motors per axle; at the motor shaft T_m = per motor / axle ratio; in kg·cm = T_m × 10.1972.
- **Motor displacement** V_m = T_m(kg·cm) × 2π / (p(kg/cm²) × η_m,mech), with p(kg/cm²) = p(bar) × 1.01972.
- Motor flow Q_m = V_m·n_m / η_m,vol / 1000 (L/min); total = Q_m × number of motors.
- Motor output power P = Q_m·p/600 × η_mech × η_vol (kW).
- For each engine gear: prop-shaft rpm = engine rpm / gear; pump rpm n_p = PTO × prop rpm; pump displacement = total flow / (n_p·η_p,vol) × 1000 (cc), split across `num_pumps`. Pump power per pump = p·Q_per pump/(600·η_p,mech).
- **Suggested standard sizes**: motor = next size *strictly above* the calculated value from {16, 23, 28, 32, 45, 56, 63, 80, 90, 107, 125}; pump from {10, 12, 16, 23, 28, 32, 45, 56, 63, 80, 90, 107, 125, 160, 180}. If nothing is bigger, the largest is suggested. The page shows a "Use" button next to the motor and pump displacement fields.
- **Sensitivity**: ±10% on pressure, motor volumetric efficiency and pump volumetric efficiency, recomputing displacements, flows and pump power.

**Mode `calc_motor_pressure` — Motor Pressure**: the same torque chain, then the required pressure p = T_m(kg·cm)·2π / (V_m·η_mech) in kg/cm², ÷ 1.01972 → bar. No pump results.

**Mode `calc_gear` — Gear Ratio**: required ratio = max motor rpm / wheel rpm at the target speed.

**Mode `calc_speed` — Speed** (`calculate_speed_mode`): fixed pump and motor sizes are given, and the tool finds the speed they can hold.

- Available motor torque T_avail = η_mech·p·V_m·0.015915 (N·m; 0.015915 = 1/20π for bar and cc). It does not depend on speed or gear.
- For v = 1…120 km/h: required torque per motor at the motor shaft = (T_total / drive axles / motors per axle) / axle ratio, from the resistance model at v.
- The matched case is the **highest whole km/h** where T_avail ≥ required. Also reported per gear: pump speed, pump flow, motor flow, motor rpm, axle rpm.

**Outputs.** A text report for the on-screen terminal panel, plus a `results` dict (the keys above).

**Reports.** DOCX (one layout per mode) and PDF (one LaTeX template per mode). The page has no doc-no./signature fields, so reports carry no document metadata and the file is named `Hydraulic_Report`.

**Known discrepancies**

1. **Speed mode ignores flow.** The speed found is the *torque-limited* maximum only. The flow-limited speed (`hydraulic_speed_kph`, from pump flow → motor rpm → wheel) is computed per gear but never compared, so the result can exceed what the pump can actually feed.
2. **Speed mode always reports the last gear.** T_avail is identical for every gear, so all gears pass or fail together and "Gear Ratio" is always the last value in the list.
3. **Speed mode divides pump speed by the number of pumps** (`pump_speed = (max_rpm/gear × PTO) / pumps`) and then does not multiply flow back by the pump count. With 2 pumps the motor flow is a quarter of what two pumps deliver. Needs review.
4. Speed mode uses the **pump** volumetric efficiency for motor speed; the motor's volumetric efficiency is not an input in that mode. Required torque uses drive axles × motors per axle and ignores "Total Motors".
5. Pump input power divides by the pump's mechanical efficiency only, not by its total efficiency (η_vol × η_mech), so it slightly underestimates engine power drawn.
6. Starting resistance (6 kg/t) is added at all speeds, which is conservative for running conditions. The same is true in the spline and vehicle-performance tools.
7. For the speed-mode PDF, `generate_hydraulic_pdf_report` suggests motor sizes from {16, 23, 45, 56, 63, …} (no 28 or 32) and picks the first size **≥** the input, while the core uses the full list and picks the first size **>** the result.
8. `mech_eff_motor` defaults to `"0"` in the schema; cc mode then fails with "Pressure or Mechanical Efficiency cannot be 0" if the field isn't sent. The UI always sends it.

## 8.3 Qmax (`tools/qmax/`)

**Purpose.** Maximum permissible wheel load for a given wheel/rail contact diameter, material strength and safety factor. Code path: `api.py` → `validation.py` → `service.py` → `core.calculate_qmax`.

**Inputs**

| Field | Unit | Notes |
|---|---|---|
| `d` | mm | Screen: "Worn Rail Head Diameter — d", with hint "Measured worn tread diameter of the wheel/rail contact"; report: "Worn rail diameter limit". > 0. |
| `sigma_b_selection` | `880`, `680` or `Custom` | Material tensile strength grade |
| `sigma_b_custom` | N/mm² | Used when Custom |
| `v_head` | — | Safety factor, default 1.1, > 0 |
| `e_param`, `q_applied` | mm; kN | **Browser only**, not sent to the server (see discrepancies) |

**Formula.** Qmax = C × (d/2) × (σB / v)², with C = 8.257 × 10⁻⁷ → kN. Tonnes = kN / 9.80665. The page also shows allowable stress σB / v.

**Outputs.** `qmax_kn`, `qmax_tonnes`, and the step-by-step text.

**Report.** DOCX only. The file is named `reports/pdf_builder.py`, but it only builds Word.

**Known discrepancies**

1. **`e_param` is browser-only.** When e > 0, the page replaces d with d_eff = √(d·e) and recomputes Qmax in the browser. The server, the DOCX report and the per-tool snapshot don't know about e, so the **report can show a different Qmax from the screen**. The history row stores the browser value.
2. **Compliance is browser-only**: Q_applied ≤ Qmax and the margin are shown on screen and in the CSV, but not in the DOCX.
3. The name of `d` is inconsistent (rail head vs wheel tread), and the page cites "EN 13674 / UIC 861-3" (rail standards) for a formula whose source is not referenced in the code. The source of C and the meaning of d should be confirmed and written into the report.
4. Calculation errors show a generic "Calculation failed. Check your inputs." instead of the server's reason.

## 8.4 Load distribution (`tools/load_distribution/`)

**Purpose.** Static wheel-load distribution check (Q1–Q4) and wheel unloading ΔQ/Q. Code path: `api.py` → `service.perform_load_distro_calc` → `core.perform_load_distribution_calculation`.

**Inputs**

| Field | Unit | Notes |
|---|---|---|
| `config_type` | `Bogie`, `Truck` or `Axle` | The UI offers Bogie and Axle only |
| `total_load` | t | > 0 |
| `front_percent` | % of total on the front | > 0 and ≤ 100 (the message says 0–100, but 0 is rejected) |
| `q1_percent`, `q3_percent` | % of front / rear load on the left wheel | > 0 and ≤ 100 |

**Formulas.** Front F = W × f/100, rear R = W − F; Q1 = F × q1/100, Q2 = F − Q1, Q3 = R × q3/100, Q4 = R − Q3. QL = the lowest Q. Q = the average of the heavier axle ((Q1+Q2)/2 if F ≥ R, else (Q3+Q4)/2). ΔQ = Q − QL; ratio = ΔQ/Q. **Pass if ΔQ/Q ≤ limit**, where the limit is `BOGIE_DELTA_Q_LIMIT` = 0.60 for Bogie and `TRUCK_DELTA_Q_LIMIT` = 0.50 for everything else (Truck **and Axle**).

**Outputs.** Q1–Q4, front and rear, QL and QH with their names, Q, ΔQ, ΔQ/Q, limit, status and message.

**Report.** DOCX only.

> **Engineering note: which limit is right depends on which check.**
> ΔQ/Q₀ ≤ 0.6 is the EN 14363 / UIC 530-2 wheel-unloading limit in the **twist test** (safety against derailment on twisted track). A **static weighing** check of a vehicle on level track is much tighter, because a new vehicle should be close to symmetric; that is the kind of number the "≤ 25%" on screen suggests. The tool does neither precisely: it takes the user's split percentages on level track and applies a twist-test-style limit. Before relying on PASS/FAIL, R&D should state which check this is and pick the limit from that clause.

**Known discrepancies**

1. **The screen says the limit is 25%; the backend uses 60% (Bogie) and 50% (Axle).** The config notes, formula card and standard note all say "ΔQ/Q ≤ 25% — UIC 518", but the PASS/FAIL comes from the backend constants. The result tile shows the backend limit (falling back to "60%" before a calculation), so the same page shows two different limits.
2. **Axle uses the Truck limit (50%)** because anything that isn't Bogie falls through to it.
3. The header cites "UIC 518 / EN 14363"; neither standard's clause is identified in the code.

## 8.5 Tractive effort (`tools/tractive_effort/`)

**Purpose.** Tractive effort, rail horsepower and OHE current for hauling a trailing load, using Indian Railways planning coefficients. Code path: `api.py` → `service.perform_te_calculation` → `core.perform_tractive_effort_calculation`.

**Inputs**

| Field | Unit | Notes |
|---|---|---|
| `load` | t | Screen: "Shunting / Train Load" (the trailing wagons) |
| `loco_weight` | t | Screen: "GVW of Locomotive" |
| `speed` | km/h | |
| `gradient` + `grad_type` | degrees or `1 in G` | ≥ 0; downhill can't be entered |
| `curvature` + `curvature_unit` | degrees or `Radius(m)` | ≥ 0 |
| `mode` | `Start` or `Running` | |

**Formulas** (results in kgf, written "kg")

- Gradient resistance per tonne: degree → tan θ × 1000; `1 in G` → 1000/G.
- Curve resistance per tonne: radius → 700/R; degree → the **degree value itself** (1 kg/t per degree).
- Rolling coefficients: Start → wagon 4.0, loco 6.0 kg/t; Running → wagon 1.3505, loco 2.913 kg/t.
- T1 = load × wagon coefficient; T2 = loco × loco coefficient; T3 = (load + loco) × gradient per tonne; T4 = (load + loco) × curve per tonne; **TE = T1 + T2 + T3 + T4**.
- Power HP = TE × V / 270 (V = 1 km/h in Start mode). 270 = 75 kgf·m/s × 3.6.
- OHE current I = HP × 735.5 / (22500 × 0.84 × 0.8) A (22.5 kV, efficiency 0.84, power factor 0.8).

**Outputs.** `T1`–`T4`, `te`, `power` (HP), `ohe_current`, `speed_for_power`.

**Report.** DOCX with step-by-step working.

**Known discrepancies**

1. **The DOCX shows 0 kg/t in its working.** The report reads `grad_rr_per_ton` and `curve_rr_per_ton` from the results, but the core never returns them. Steps 1 and 2 therefore print "R_grad = … = 0.0000 kg/t" and "T3 = W × 0.0000 = <real T3>": the final figures are right, but the working shown is wrong.
2. **Curve resistance is inconsistent between units.** Radius gives 700/R kg/t, which equals 0.4 kg/t per degree (R = 1750/D). Degree input gives 1.0 kg/t per degree, 2.5× higher for the same curve. The hydraulic, spline and vehicle-performance tools all use 0.4 kg/t per degree.
3. The page says Running mode uses "Speed-dependent rolling resistance (Davis formula)", but the Running coefficients are **constants**; TE doesn't change with speed (only HP does).
4. The page labels the current "OHE Current (25kV)", but the formula uses 22,500 V.
5. The unused `calculate.py` labels the power `power_kW`, but the value is HP.

## 8.6 Vehicle performance (`tools/vehicle_performance/`)

**Purpose.** For a rail-road vehicle with an engine torque curve and a gearbox: maximum tractive effort against the adhesion limit, tractive effort and shunting capability curves per gear and slope, and the maximum speed vs slope for a given shunting load. Code path: `api.py` → `validation.py` → `service.VehiclePerformanceCalculator`. `core.py` and `calculate.py` are not used.

**Inputs**

| Field | Unit | Notes |
|---|---|---|
| `loco_gvw` | kg | Screen: "GVW (kg)"; converted to tonnes internally |
| `max_speed` | km/h | **Stored only, not used** in any calculation |
| `num_axles` | count | Only in the rolling-resistance A term |
| `rear_axle_ratio` | — | |
| `gear_ratios` | comma list | Gearbox ratios |
| `shunting_load` | t | Trailing load |
| `max_curve` + `curve_unit` | degree, or m (radius → D = 1750/R) | |
| `max_slope` + `slope_unit` | %, or degree (→ tan θ × 100) | |
| `peak_power` | kW | Caps the torque curve |
| `friction_mu` | — | Wheel–rail adhesion |
| `wheel_dia` | m | |
| `min_rpm`, `max_rpm` | rpm | Engine speed range |
| `torque_curve` | {rpm: N·m} | Required; an empty curve is an error |
| `doc_no`, `doc_date`, `made_by`, `checked_by`, `approved_by` | text | Collected on the page, but **not printed** in the DOCX |

**Formulas** (forces in N, weight in t)

- Loco rolling resistance (A + B·v + C·v²)·W·9.81 with the IR coefficients from 8.2. Wagon (A = 0.6438797, B = 0.01047218, C = 0.00007323)·W·9.81. Gradient W·1000·9.81·s/100. Curve 0.4·W·D·9.81. Starting: loco 6·W·9.81, wagon 4·W·9.81.
- Engine rpm = wheel rpm × gear × axle ratio. Torque is interpolated from the curve (clamped at the ends). If T·ω exceeds peak power, T is cut to P/ω.
- Tractive effort F = 2·T·gear·axle ratio / D (= T·i/r). Adhesion limit F_adh = W·μ·1000·9.81. Effective F = min(F, F_adh).
- **Snapshot**: F at maximum torque and the highest gear ratio vs F_adh → "Limited by slipping" or "Not limited by slipping".
- **Tractive effort curve**: for slopes 0 to max in 0.5% steps, and each gear, 100 speeds from 0 to that gear's top speed at max rpm.
- **Shunting capability** (t) = (effective F − loco resistance incl. starting) / (resistance of 1 t of wagon incl. starting).
- **Speed vs slope table**: speeds from min rpm in the highest ratio to max rpm in the lowest ratio, but every point is evaluated in the **highest** ratio. The highest speed where effective F ≥ loco + wagon resistance (without starting resistance) is reported.

**Outputs.** `traction_snapshot`, `tractive_effort_graph`, `shunting_capability_graph`, `speed_vs_slope_table`. History saves only the snapshot and the table, which keeps it under the 200 KB history limit.

**Report.** DOCX, built in `reports/pdf_builder.py`, which repeats the physics ("exact copy from service.py"): inputs, torque curve, traction steps, resistance tables, gear-wise TE at key speeds, speed vs slope, matplotlib charts and a summary.

**Known discrepancies**

1. **The speed-vs-slope table uses the lowest gear for every speed**, but the speed range runs up to max rpm in the *top* gear. At the high end the engine would be far over max rpm; the torque curve is clamped at its last point instead, so the table can report speeds the vehicle cannot reach in that gear.
2. The shunting-capability curve includes starting resistance; the speed-vs-slope table doesn't. The two outputs answer slightly different questions without saying so.
3. `max_speed` is not used, so no result is capped at the vehicle's maximum speed.
4. The adhesion limit uses the full GVW (assumes all axles driven) and ignores `num_axles`.
5. Document metadata (doc no., made/checked/approved by) is collected but not printed, and the page's date field can't be changed (always today). Checked By and Approved By are prefilled with two named people.
6. The physics is written twice (service and report builder). A change to one must be copied to the other.

## 8.7 Spline (`tools/spline/`)

**Purpose.** Shear check of an involute (or straight-sided) spline that transmits wheel torque, with factor of safety and a SAFE/UNSAFE verdict. Code path: `api.py` → `core.calculate_spline_mode`. `validation.py` and `calculate.py` are not used.

**Inputs** (all sent as strings)

| Field | Unit | Notes |
|---|---|---|
| `number_teeth` (Z) | count | |
| `diametral_pitch` (P) | screen: "Diametral Pitch" | Default 0.19; see discrepancy 1 |
| `pressure_angle` | ° | Default 0 |
| `outer_diameter`, `inner_diameter` | mm | |
| `length_engagement` (L) | mm | |
| `yield_strength` (Syt) | MPa | |
| `material_type` | text | Report only |
| `loco_weight` | t | |
| `number_axles`, `wheels_per_axle` | count | |
| `speed` | km/h | Only for wheel rpm and resistances |
| `wheel_diameter` | m | |
| `friction_coeff` (μ) | — | |
| `doc_no`, `made_by`, `checked_by`, `approved_by`, `doc_date` | text | Report header |

**Formulas**

- Geometry: pitch diameter D = Z/P, module = 1/P, base diameter = D·cos φ, tooth thickness = π·D/(2Z), tooth height h = (OD − ID)/2, mean radius r_m = (OD + ID)/4.
- **Design torque (adhesion-limited, per wheel)**: F_t = (W·1000·g / number of wheels) × μ; T = F_t × wheel radius (N·m).
- Shear area A = Z·L·h (mm²). Shear stress τ = T·1000 / (A·r_m) (MPa).
- Allowable shear = Syt/√3 (von Mises). FOS = allowable / τ. **Verdict SAFE if FOS ≥ 1.5**, else UNSAFE.
- Torque capacity = allowable × A × r_m / 1000 (N·m).
- Informational only: IR rolling + starting resistance (8.2) and the per-wheel working torque from it, plus a second stress `shear_stress_wheel` = 2·T_work / (D·L·Z·h).

> **Engineering note: why the design torque comes from adhesion.**
> A spline in a wheel drive never has to carry more torque than the wheel can put onto the rail before it slips: beyond μ·N the wheel spins. Sizing to the adhesion limit (weight per wheel × μ × radius) gives the highest torque that can ever reach the spline in normal running, whatever the engine can produce. That is why the verdict uses this torque and not the much smaller running-resistance torque, which is shown for comparison only. Shock and fatigue factors (ANSI B92.1 / AGMA application factors) are not applied; the 1.5 FOS has to cover them.

**Outputs.** All the values above, plus `verdict` and `reason` ("FOS >= 1.5").

**Reports.** PDF (`spline_template.tex`) and DOCX (`docx_builder.py`).

**Known discrepancies**

1. **"Diametral pitch" is used as 1/module in mm.** Real diametral pitch (ANSI B92.1, teeth per inch, for example 16/32) would give D = Z/P in **inches** next to OD/ID in mm. The default 0.19 only works because it is effectively teeth per mm (D = 8/0.19 = 42.1 mm, between ID 39 and OD 44.8). The code comment ("inches if P is inches-based") and the label both mislead; "module = 1/P" is only true in this per-mm reading. Rename the field to module (mm) or convert.
2. The "shear" area uses the radial **tooth height** (Z·L·h). That is the usual *bearing/crushing* area; tooth-root shear is normally based on tooth thickness at the pitch line, with a load-sharing factor. Engineering review needed before the FOS is quoted to a customer.
3. `/calculate` has no error wrapper: a non-numeric field raises a `ValueError` that reaches the client as a bare 500. If τ = 0, the FOS is `inf`, which can't be encoded as JSON.
4. The page knows an `ACCEPTABLE` verdict that the backend never returns.
5. `GET /rnd/tools/spline/` redirects to a static page that no longer exists.

---

# 9. Calculation history (`routes/history.py`, `/rnd/history`)

| Endpoint | Behaviour |
|---|---|
| `POST /save` | Body: `tool_name` (Literal of the seven names; anything else is 422), `inputs`, `results`, optional `calculation_name` (≤ 255 chars; defaults to "<Tool> #n" per user and tool). **Serialised inputs + results over 200 KB → 413** with a real reason. Then the per-tool snapshot is written best-effort (4.6). |
| `GET /list?tool_name=` | The caller's own rows, newest first, **max 100** |
| `GET /detail/{id}` | 404 if missing; 403 unless owner or admin |
| `PATCH` or `PUT /rename/{id}` | Same handler; accepts `calculation_name` or `name`. Owner or admin. An empty body sets the name to null. |
| `DELETE /delete/{id}` | Owner or admin; hard delete of the generic row. The per-tool snapshot row stays. |
| `GET /admin/list?user_id&tool_name` | Admin only (`role == "admin"`), all users, **max 500** |
| `GET /admin/users` | Admin only; users with at least one saved calculation |

The whole router needs the `rnd` app, so a user who lost R&D access can no longer read even their own rows. Admins always pass. The frontend History page has a **View All Users** switch for admins and an "open in tool" action (7.3).

> **Engineering note: why history is per-user and the limit is 200 KB.**
> A calculation is an engineer's working; the record that matters is the report attached to a design review or offer. So the default view is "mine", and only admins see everyone's. Plan §38 suggests "R&D team" visibility as the default, which is not built. The 200 KB cap exists because `inputs` and `results` are free JSON: without it the endpoint could be used to store arbitrary blobs. Real payloads are a few KB; vehicle performance is the largest, and the page already leaves out the curve data.

---

# 10. Dashboard (`GET /rnd/dashboard`)

The API returns project counts by status and by stage (excluding cancelled), experiment open/completed/pass/fail/inconclusive counts and pass rate, prototype counts by status, total budget vs total spend (prototype BOM cost, excluding cancelled projects), and the six most recently updated projects and experiments.

The page currently shows only **Active Projects**, **Projects by Stage** (each bar links to the filtered project list) and **Recently Updated Projects**. The experiment, prototype and budget figures are computed but not displayed, consistent with those pages being hidden.

---

# 11. API endpoints

All under `/api/v1/rnd`.

**Projects**: `routes/projects.py`, router gate `rnd` + `projects`.
| Method and path | Notes |
|---|---|
| `GET /projects?stage&status&priority&project_type&search` | Includes lead, team, actual cost, experiment and prototype counts |
| `POST /projects` | Starts in Initiation / Active |
| `GET /projects/{id}` | Detail plus experiment and prototype summaries (with released BOM number) and feasibility flag |
| `PATCH /projects/{id}` | Fields including status and the handover ticks; **not** stage |
| `POST /projects/{id}/stage` | Stage gates (6.2) |
| `DELETE /projects/{id}` | Soft delete; refused while experiments, prototypes or documents exist |
| `GET` / `PUT /projects/{id}/feasibility` | Read / upsert the study |

**Experiments**: `routes/experiments.py`, gate `rnd` + `experiments`. `GET /experiments?project_id&prototype_id&status&result&experiment_type&search`, `POST /experiments`, `GET` / `PATCH` / `DELETE /experiments/{id}`.

**Prototypes**: `routes/prototypes.py`, gate `rnd` + `prototypes`. `GET /prototypes?project_id&status&search`, `POST /prototypes`, `GET` / `PATCH` / `DELETE /prototypes/{id}`, `POST /prototypes/{id}/release-to-production`.

**Documents**: `routes/documents.py`, gate `rnd`. `GET /documents?project_id&experiment_id&prototype_id&doc_type&search`, `POST /documents` (multipart), `GET /documents/{id}/content`, `DELETE /documents/{id}` (uploader or admin; the SharePoint delete is best-effort).

**Requirements**: `routes/requirements.py`, gate `rnd` + `requirements`. `GET /requirements?search&source&mine`, `GET /requirements/{source}/{record_id}`, `POST /requirements/requests/{request_id}/respond` (multipart `remarks`, `delay_reason`, `files`).

**Dashboard and lookups**: `routes/dashboard.py`. `GET /dashboard` (`rnd` + `dashboard`), `GET /lookups/store-items?search` (`rnd`; max 50 rows).

**Tools**: see 7.1. **History**: see 9.

---

# 12. Frontend pages

| Route | Page | In nav? |
|---|---|---|
| `/dashboard/rnd` | Dashboard | Yes |
| `/dashboard/rnd/project-work` | PM milestones and my tasks (shared components) | Yes |
| `/dashboard/rnd/requirements`, `/requirements/[source]/[id]` | CRM requirement inbox and detail, with Respond | Yes |
| `/dashboard/rnd/projects`, `/projects/new`, `/projects/[id]` | Project list, create, detail (stage bar, budget vs actual, details, feasibility, handover) | Yes |
| `/dashboard/rnd/tools` | Engineering Tools landing, with cards for the seven calculators | Yes |
| `/dashboard/rnd/{braking,hydraulic,qmax,load-distribution,tractive-effort,vehicle-performance,spline}` | Calculators; second nav row inside Engineering Tools | Yes |
| `/dashboard/rnd/history` | Saved calculations; admin all-users view | Yes |
| `/dashboard/rnd/experiments`, `/new`, `/[id]` | Experiments with the parameter table and documents panel | **Hidden, decision pending** |
| `/dashboard/rnd/prototypes`, `/new`, `/[id]` | Prototypes with the BOM editor, documents panel and **Release to Production** | **Hidden, decision pending** |
| `/dashboard/rnd/documents` | All R&D documents by project | **Hidden, decision pending** |

Shared components in `components/rnd/`: `RndNav`, `ReleaseToProductionPanel`, `RndDocumentsPanel`, `TeamMemberPicker`, `TerminalPanel` (the text output panel on calculator pages), `ChartJsLineChart` (vehicle performance), `StatCard`, `toolStyles`. `ToolCalculatorPage` is unused. All pages use `useRequireApp('rnd')`; subtab hiding is done in the nav with `filterTabsByAccess`, so a hidden page still opens by URL if the backend allows it.

---

# 13. Status against the plan (MODULE_DETAILED_PLAN §13 and §38)

| Plan item | Status |
|---|---|
| §13.1 Fix C-01 (LaTeX injection), rotate secrets | **Done** for the code: escaping on every free-text field, `-no-shell-escape`, `openin_any=p`, no lualatex (7.2). Secret rotation is an ops task, not tracked here. |
| §13.2 Standardise routes; `.docx` as document of record, PDF secondary | **Not done.** Routes still differ (7.1); braking offers only PDF in the UI; Word reports are plain downloads, not managed documents. |
| §13.3 Save a calculation against an RRV model or project; attach the report to a Design document | **Not done.** History is per user, with no project or model link. |
| §13.4 Shared inputs from the RRV model master | **Not done.** Every input is typed or imported from CSV. |
| §38 Settings (editable constants, report header block, history visibility, PDF safe mode) | Only "PDF safe mode" exists, and it is hard-coded on. Constants are in each tool's `constants.py`, not settings. |

The project workflow (projects, feasibility, experiments, prototypes, release, requirements) was built beyond plan §13, which only described the calculators.

---

# 14. Known discrepancies: summary

The detail is in each section. These are listed for triage and are **not fixed** by this document.

> **Owner decision (2026-10-07): the calculator formulas are NOT to be changed.** The engineering discrepancies below (rows 1–10) stay as documented. Each is pinned by an `xfail(strict=True, raises=AssertionError)` test in `backend/app/tests/test_cov_rnd_calc_{braking,hydraulic,load_distribution,qmax,spline,tractive_effort,vehicle_performance}.py`, which asserts the expected-correct behaviour and is marked as expected to fail against today's maths. If someone changes a formula, the matching test starts passing, and because the marks are strict an XPASS **fails the test run** — that is intended, so a formula change needs a fresh owner decision, not a quiet fix. Rows 11–14 (access gates, error text, nav, dead code) are not formula changes and are outside this decision.

| # | Where | Discrepancy |
|---|---|---|
| 1 | Load distribution | Screen says ΔQ/Q ≤ 25%; backend passes up to 60% (Bogie) / 50% (Axle, which falls through to the Truck limit) |
| 2 | Braking | `abs(f_net/mass)`: on downhill gradients steeper than about 8.4%, a vehicle that can't stop is shown with a finite stopping distance |
| 3 | Braking | Brake force isn't an input; GBR is always about 8.39% whatever the mass |
| 4 | Braking | Screen compliance interpolates; server/PDF uses the lower tabulated speed; several UI inputs and filters are never sent |
| 5 | Hydraulic (speed mode) | Torque-only speed limit (flow ignored); always reports the last gear; pump speed divided by the number of pumps |
| 6 | Hydraulic | Motor size lists and rounding differ between core (>) and PDF (≥) |
| 7 | Qmax | `e_param` and Q_applied are browser-only; report can differ from the screen; meaning of d and source standard unclear |
| 8 | Tractive effort | DOCX working shows 0 kg/t for gradient and curve; degree-curve = 1.0 kg/t/° vs 0.4 elsewhere; "Davis / speed-dependent" label on constant coefficients; "25 kV" label on a 22.5 kV formula |
| 9 | Vehicle performance | Speed table uses the lowest gear past its rpm limit; `max_speed` unused; metadata not in report; physics duplicated |
| 10 | Spline | "Diametral pitch" is really 1/module in mm; shear area uses tooth height; `/calculate` 500s on bad input |
| 11 | All tools | No per-tool subtab gate on the API; history saves fail silently; several pages show generic error text |
| 12 | Projects / prototypes | No action-level (approve) gates; prototype can be set Validated without a passing experiment; handover "BOM approved" tick isn't linked to a release |
| 13 | Nav | Experiments, Prototypes, Documents hidden while their pages and the release flow still work by URL |
| 14 | Dead code | `*/calculate.py`, `vehicle_performance/core.py`, `spline/validation.py`, the duplicate spline DOCX builder, `ToolCalculatorPage.tsx`, `GET /spline/` redirect |

---

# 15. What this module does not do

- It does not link a calculation to an R&D project, an RRV model or a Design document. Reports are downloaded and attached by hand.
- It does not create active Production BOMs, routings or Item Master records. Release creates a draft BOM only; Store creates items; Production activates.
- It does not book R&D spend to Accounts. "Actual" is the sum of prototype BOM cost (quantity × unit cost typed by R&D), not purchase or stock-issue cost. Labour and outside test costs are not captured.
- It does not reserve or issue stock for prototype builds.
- It does not keep a parts or materials library for the calculators; there are no editable engineering constants (plan §38).
- It does not send notifications for R&D project events. The CRM request flow has its own notifications on the CRM side.

---

# 16. Related documentation

- [CRM overview](../crm/overview.md): Send Technical Requirement to R&D and the request assignment
- [Production: RRV build](../production/rrv-build.md): where the released draft BOM is completed and activated
- [Store overview](../store/overview.md): the Item Master that release requires
- [Projects (PM) overview](../projects/overview.md): the Project Work tab
- [Design overview](../design/overview.md): the document-control module the reports should eventually attach to
- [Platform: access and permissions](../platform/access-and-permissions.md): app gate, subtab gate and the "unconfigured user passes" rule
- [Module detailed plan](../../MODULE_DETAILED_PLAN.md) §13 and §38
