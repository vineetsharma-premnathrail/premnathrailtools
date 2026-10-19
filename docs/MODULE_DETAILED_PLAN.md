# PremnathRail Portal — Module-wise Detailed Plan

**Company:** Premnath Rail — RRV (Road-Rail Vehicle) manufacturer
**Prepared for:** Vineet Sharma
**Date:** 06 October 2026
**Revised:** 06 October 2026 — aligned with decisions already taken (Partners replace MD, PM standalone, HR incl. leave, Word documents of record, periodic inventory, Design register built, Quality Phase 1 built). See §0A.
**Based on:** `docs/02-modules/*`, `docs/erp-review/05-summary-and-roadmap.md`, backend `app/modules/*`, frontend `app/dashboard/*`, Item Master v3 status (29-Sep-2026)

---

## 0. Business rules that drive this plan

| # | Rule | Impact on the system |
|---|---|---|
| R1 | Premnath Rail manufactures **RRVs**. The RRV is the only product. | Every engineering, purchase, store and production record must trace to an **RRV / project (machine)**. |
| R2 | **Electrical, Hydraulic and Pneumatic are design disciplines.** Their output is **drawings + BOM** only. | These modules are scoped to *Drawing → BOM → Release*. They are not plant-equipment or product-monitoring systems. |
| R3 | **No electrical components are manufactured.** All electrical items (relays, switches, cables, lamps, batteries, harness parts, panels if bought) are **bought-out items**. | Electrical BOM lines are always *Buy* items from the Item Master. No electrical work orders or electrical manufacturing routing. |
| R4 | **Electrical work happens only on the RRV** (wiring / harness / installation during the build). | Electrical installation is a **stage inside Production → RRV Build**, not a standalone job lifecycle. |
| R5 | **No monitoring.** No condition monitoring, running hours, IoT, sensor data, power monitoring or maintenance plans for E/H/P. | Remove/hide running-hours, maintenance plans, service records and spares tracking from the Hydraulic module; no monitoring features in Electrical. |
| R6 | One Item Master, one Store ledger, one document-control register. | Discipline modules **reference** Item Master items and Design documents; they don't keep their own catalogs or drawing registers long-term. |

### 0A. Standing decisions this plan must respect

| # | Decision (date) | Effect on this plan |
|---|---|---|
| D1 | **MD role removed; Partners are the top approval level** (`is_partner`, set only in Organization → Company Info → Partners) — 06-Oct-2026 | Every "Director / MD" approval or escalation below reads **Director / Partner**. No MD role is reintroduced. |
| D2 | **Project Management stays standalone** — no links from `pm_*` to Sales/CRM/P2P/Store/Production/Service yet — 06-Oct-2026 | Project ↔ Sales Order / RRV Build links and milestone auto-status are a **separate, later integration step (P5)**, started only on explicit go-ahead. |
| D3 | **HR & Administration is owned by the portal** — employee master, joiner/mover/leaver, leave, attendance, holidays, admin services. Only payroll stays in ADP — 29-Sep-2026 | §22/§47 cover leave and attendance. HR exit flow is the fix for leaver access (C-10). |
| D4 | **Generated documents are Word documents of record** ("Save & Edit in Word" primary, PDF only a secondary download) — app-wide | Handover certificate, GRN, issue slip, inspection report, PO, quotation, calculation reports: managed Word document first. |
| D5 | **Finance: periodic inventory** (closing-stock valuation posted at period end, auto-reversed), **no TDS/TCS**, e-invoice = capture fields only | Store valuation (weighted average) feeds the closing-stock entry and management costing reports; no perpetual GRN/issue postings to GL. |
| D6 | **Design register already built** (one register for all disciplines, checker + approver, Design head releases, customer approval, ECR → ECN with department acknowledgements, BOM revisions) | §8 is reduced to the remaining follow-up: migrating Electrical/Hydraulic drawing tables into it. |
| D7 | **Quality Phase 1 built** (stock types, inspection plans, AQL sampling, inspection lots, NCR disposition) | §18 lists only what remains. |
| D8 | **No metadata customization** — stages, statuses, screens, fields are code | Part B settings are values/masters only. |

---

## 1. Module map and end-to-end flow

```text
CRM (Inquiry/Tender) ─► Sales (Quotation → Customer PO/Order)
        │
        ▼
Project Management (one project per order / RRV batch; milestones per department)
        │
        ▼
Design (GA, mechanical drawings, document control, ECN)
   ├── Electrical  : schematic + wiring drawing  → Electrical BOM (EBOM)
   ├── Hydraulic   : circuit drawing             → Hydraulic BOM (HBOM)
   └── Pneumatic   : circuit drawing             → Pneumatic BOM (PBOM)
        │  (released discipline BOMs)
        ▼
Engineering BOM (RRV master BOM = Mech + EBOM + HBOM + PBOM) ─► Production BOM
        │
        ├─► Procurement (P2P: PR → RFQ → PO) ◄─ Vendor
        │         │
        │         ▼
        ├─► Store (GRN → Incoming QC → Stock → Issue to WO)
        │
        ▼
Production → RRV Build (sub-assembly → main assembly → electrical installation →
             hydraulic/pneumatic installation → final assembly)
        │
        ▼
Quality (incoming, in-process, final inspection, NCR/CAPA) → Vehicle testing (rail/road trials)
        │
        ▼
Handover → Service & Commissioning (machine registry, warranty, service requests)
        │
        ▼
Finance (AP from PO/GRN/Invoice, AR from customer invoice, GL, reports)
```

Support modules: Platform (auth, users, permissions, audit, notifications), Organization (company, plants, departments, cost centers), HR & Administration (employee master, leave, attendance, lifecycle; payroll in ADP), R&D (calculators), Maintenance (own plant machines only), Documents, Reports.

---

## 2. Priority and phasing (all modules)

| Phase | Window | Modules / work |
|---|---|---|
| **P0 — Fix & secure** | Week 1–2 | First re-verify each item against current code (some may already be fixed), then close the open ones. Critical/High items from ERP review: C-01 R&D LaTeX injection + key rotation, C-02/C-03/C-04 P2P approval bypass, C-05 Finance SoD, C-09 Store adjustment approval, C-11 logout, C-13 migration guard. |
| **P1 — Core RRV chain** | Week 3–8 | Item Master go-live (v3), Electrical/Hydraulic/Pneumatic re-scope (drawing + BOM), Engineering BOM roll-up, Production RRV Build, Store GRN + issue, P2P with prices. |
| **P2 — Controls & quality** | Week 9–14 | Quality linked to GRN and RRV Build, audit trail everywhere (C-12), Permission Matrix server-side (C-06), leaver access (C-10), CSRF (C-07). |
| **P3 — Commercial & finance** | Week 15–20 | CRM win → Sales Order, customer invoice from handover, RRV cost report (management, not GL), store valuation feeding the period-end closing-stock entry. |
| **P4 — Reports & polish** | Week 21+ | MIS dashboards, Word documents of record (PO, issue slip, inspection report, handover certificate), Teams notifications tuning. |
| **P5 — PM integration** | On go-ahead only (D2) | Project ↔ Sales Order / RRV Build links, milestone auto-status from source modules, project budget vs actual. |

---

## 3. Platform & Admin (`main`, `auth`, `users`, `admin`)

**Purpose:** sign-in (Microsoft SSO + Teams), users, module access, Permission Matrix, audit log, notifications, feedback.

**Current state:** SSO, JWT cookie, module assignment, audit registry, notifications, module allow-list lock (recent commits).

**Gaps / changes**

| # | Change | Ref |
|---|---|---|
| 1 | Enforce Permission Matrix on the server (`require_tab_access` on every router + page guards), not just nav hiding. | C-06 |
| 2 | Nightly Azure AD sync; deactivated users stay deactivated; revoke sessions on deactivation. | C-10 |
| 3 | Logout via refresh cookie even after access-token expiry. | C-11 |
| 4 | CSRF: Origin check + custom header for all unsafe methods. | C-07 |
| 5 | Move the hard-coded module allow-list into a DB/admin setting with audit. | — |
| 6 | Standard roles per department: Viewer, Maker, Checker/Approver, Head. | — |

**Acceptance:** a user without a subtab gets 403 from the API; a leaver cannot sign in after the next sync; every create/edit/delete/approve has an audit row.

---

## 4. Organization (`organization`)

**Purpose:** company, plants (branches), departments (with heads), cost centers, financial years, warehouses.

**Changes**

1. Audit trail on department head / branch changes (C-12).
2. Departments list fixed to Premnath structure: Design, Electrical, Hydraulic & Pneumatic, R&D, Purchase, Store, Production, Quality, Service, Finance, HR, Sales/BD, Maintenance, Management.
3. Cost center per department; mandatory on PR, issue slip and journal lines.
4. Soft delete only (no hard delete).

---

## 5. CRM (`crm`)

**Purpose:** customers (Railway zones, divisions, PSUs, contractors), contacts, inquiries, tenders, technical offers, activities, follow-ups.

**Scope for RRV business**

| Area | Plan |
|---|---|
| Product catalog | One product family: **RRV models** (variants by gauge, application: tower wagon, inspection, shunting, OHE, track maintenance etc.). Product master holds the standard configuration and the reference Engineering BOM. |
| Inquiry → Tender | Keep current 15/12-stage pipelines. Trim inquiry stages after "Purchase Order" — they belong to Projects/Production/Service and should be read-only mirrors. |
| Technical offer | Pull standard specs from the RRV model; attach Design GA drawing (released revision only). |
| Costing | Costing sheet = Engineering BOM × latest PO rate / standard cost + labour + overheads. |
| Win | **"Mark as Won"** creates a Sales Order and a Project (P3). |

**Acceptance:** a won inquiry produces exactly one Sales Order and one Project linked back to it.

---

## 6. Sales (`sales`)

**Purpose:** quotations, customer orders, pricing, delivery schedule.

**Plan**

1. Quotation (versioned) → approval (Sales Head; Director / Partner above value limits) → send.
2. Customer PO capture: PO no., date, quantity of RRVs, delivery schedule, LD clause, inspection agency (RDSO / RITES / customer).
3. Sales Order → one RRV Build per vehicle (auto-created in planned status).
4. Delivery: dispatch note against handover; triggers AR invoice in Finance.
5. Reports: order book, backlog by delivery month, quote win rate.

---

## 7. Project Management (`projects`, `pm`)

**Purpose:** one project per customer order (or RRV batch). Milestones per department, plans by department heads, tasks for team members (already built).

**Changes**

**Built already (06-Oct-2026):** Project (Draft → Active → On hold → Technically complete → Closed), department milestones, one plan per milestone by the department head, tasks with optional review. Customer / PO stay free text.

1. **Now:** apply the standard milestone template below manually per project; department heads mark milestones achieved with evidence.
2. Standard milestone template for an RRV order:

| # | Milestone | Department | Output |
|---|---|---|---|
| 1 | GA & mechanical drawings released | Design | Released GA + part drawings |
| 2 | Electrical drawing & EBOM released | Electrical | Released schematic/wiring drawing + EBOM |
| 3 | Hydraulic circuit & HBOM released | Hydraulic | Released circuit + HBOM |
| 4 | Pneumatic circuit & PBOM released | Pneumatic | Released circuit + PBOM |
| 5 | Engineering BOM frozen | Design | RRV master BOM |
| 6 | Long-lead items ordered | Purchase | POs issued |
| 7 | Material kitted | Store | Kit complete |
| 8 | RRV assembly complete | Production | Build at final assembly |
| 9 | Final inspection passed | Quality | Inspection report |
| 10 | Trials & handover | Production / Service | Handover certificate |

3. **P5 only (D2):** link project to Sales Order and RRV Builds; milestone auto-status from source modules (e.g. milestone 2 achieved when EBOM is released); project budget vs actual (PO value + store issues + labour).

---

## 8. Design — Engineering Document Control (`design`)

**Purpose:** single controlled register for all drawings and documents — mechanical, electrical, hydraulic, pneumatic. Revision R0/R1…, checker ≠ approver ≠ author, ECN.

**Built already (06-Oct-2026, D6):** one register with `discipline`, Design team roles (designer / reviewer / head), checker + approver with Design head release, customer approval gate, ECR (change board) → ECN with per-department acknowledgement, BOM with its own revisions, approved makes per item, settings (values only). Numbering `<TYPE>-<YEAR>-NNNN`, R0, R1… Not copied into Store; PM untouched.

**Decision:** **Electrical, hydraulic and pneumatic drawings live in the Design register** (`discipline` column already exists). The discipline modules show their drawings by filtering this register. This removes `electrical_drawings`/`electrical_drawing_revisions` and the separate circuit approval in Hydraulic over time.

**Remaining changes**

1. Document types to add (if not present): `wiring_diagram`, `harness_drawing`, `hydraulic_circuit`, `pneumatic_circuit`, `panel_layout`.
2. Link to RRV model (project link stays the Design-side task ↔ deliverable link, D2).
3. Released drawing → can be linked to a BOM (BOM header stores drawing no. + revision).
4. ECN impact: list affected BOMs; on implement, notify Electrical/Hydraulic/Production/Store and mark affected BOM "needs revision".
5. MDL export per project for customer/RDSO submission.

**Migration:** copy existing electrical drawings and hydraulic circuits into `design_documents` with their revisions and files; keep old tables read-only for one release, then drop.

---

## 9. Engineering BOM (`engineering`)

**Purpose:** the **RRV master BOM** — one per RRV model/project — combining mechanical, electrical, hydraulic and pneumatic BOMs.

**Structure**

```text
RRV Model / Project BOM (EBOM-RRV-xxxx Rev A)
 ├── Mechanical (Design)        – make + buy items, sub-assemblies
 ├── Electrical (Electrical)    – buy items only
 ├── Hydraulic  (Hydraulic)     – buy items (+ hoses/pipes made in-house if any)
 └── Pneumatic  (Pneumatic)     – buy items
```

**Rules**

1. Every line must be an **Item Master item** (no free text). New item → item request → Store/Item Master team creates code (CCC-SSS-NNNN).
2. Each discipline BOM is released by its own department (maker → checker). The master BOM freezes only when all four are released or marked N/A.
3. Line fields: item code, description (from master), qty per RRV, UOM, make/part no., drawing ref + rev, tag/position (e.g. relay K1, valve V3), make/buy, long-lead flag, remarks.
4. Revision on ECN only after freeze; previous revision obsolete.
5. Released master BOM → **push to Production BOM** (manual "Create Production BOM" button, with diff view).
6. Shortage check: BOM × number of RRVs vs Store stock + open POs → "Raise PR for shortage".

**Reports:** BOM comparison between revisions, where-used for an item, cost roll-up, long-lead list.

---

## 10. Electrical (`electrical`) — re-scoped

**Purpose (new):** create the **electrical drawings and Electrical BOM for each RRV model/project**, raise purchase requirements, and record the electrical installation and testing that happens **on the RRV during the build**.

**Out of scope (remove/hide):**

- Electrical component manufacturing (none — all bought out)
- Panel manufacturing as a separate product lifecycle
- Monitoring of any kind (power, battery, sensors, IoT, condition)
- Separate commissioning lifecycle (commissioning is part of RRV handover / Service)
- Maintenance of electrical systems

**Simplified stages (20 → 8)**

| # | Stage | Gate | Owner |
|---|---|---|---|
| 1 | Electrical Requirement | System voltage (e.g. 24 V DC), customer spec / tender clause attached | Electrical |
| 2 | Schematic & Wiring Drawing | Released Design document(s), discipline = electrical | Electrical |
| 3 | Electrical BOM | ≥1 line, every line an Item Master item with make + part no. + qty | Electrical |
| 4 | EBOM Release | Checked and approved (checker ≠ maker); pushed to Engineering BOM | Electrical Head |
| 5 | Purchase Requirement | No line in *To Buy*: each line in stock, reserved, or on a PR | Electrical / Purchase |
| 6 | Installation on RRV (wiring/harness) | Linked RRV Build stage "Electrical Installation" completed | Production (electrician) |
| 7 | Electrical Testing & QC | Insulation, continuity, polarity, lighting/horn/indicator function tests passed; QC sign-off | Electrical + Quality |
| 8 | As-built record | As-built drawing revision released (if changed) | Electrical |

**Data model changes**

| Table | Action |
|---|---|
| `electrical_jobs` | Keep, rename in UI to **"RRV Electrical Package"**; link mandatory to RRV Build or project. Remove commissioning fields. |
| `electrical_job_stages` | Reseed with the 8 stages above. |
| `electrical_bom_items` | Keep; add mandatory `store_item_id`; `selection_status` simplified to draft/released; procurement status reads from P2P/Store. |
| `electrical_cables` | Keep as optional **cable schedule** (tag, from/to, size, length) — it is part of the drawing/BOM. Drop "tested" status (testing is stage 7). |
| `electrical_panels` | Keep only as BOM grouping (panel/junction box on RRV) — no design→assembly→installation lifecycle. |
| `electrical_drawings`, `electrical_drawing_revisions` | Migrate into Design register, then retire. |
| `electrical_tests` | Keep for factory tests on the RRV only (no commissioning phase). |
| `electrical_issues` | Merge into RRV Build **rework/punch list**; retire. |

**Screens (new nav):** Dashboard · Packages · Drawings (Design filter) · BOM · Purchase Requirement · Testing · Reports.
Remove: Troubleshooting, Projects (duplicate of PM), standalone commissioning.

**Reports:** EBOM per RRV, items to buy, long-lead electrical items, test results per RRV.

---

## 11. Hydraulic (`hydraulic`) — re-scoped

**Purpose (new):** hydraulic **circuit drawings and Hydraulic BOM** per RRV model/project, design calculations, and factory pressure/leak tests on the RRV.

**Keep**

| Feature | Note |
|---|---|
| Systems | One hydraulic system per RRV model/project (power pack, brake, guide-wheel/rail-gear deployment, outrigger, crane/platform if fitted). Remove running hours and "under maintenance" status. |
| Circuits | Drawing moves to Design register (discipline = hydraulic); circuit page shows the linked document. |
| BOM | Keep `hyd_boms` / `hyd_bom_items`; every line must reference an Item Master item; release pushes into Engineering BOM. |
| Calculations | Keep (cylinder force/speed, pump flow/power, pipe sizing, pressure drop, accumulator, reservoir, heat load). Save calculation against the system and attach to the drawing. |
| Testing | Keep only factory tests on the RRV: pressure, proof, leak, relief setting, function. Linked to RRV Build stage "Hydraulic Installation". |

**Remove / hide (no monitoring, no maintenance)**

| Feature | Action |
|---|---|
| `hyd_maintenance_plans` | Hide and retire. |
| `hyd_service_records`, `hyd_service_parts` | Hide and retire. If a customer RRV needs service, use **Service & Commissioning** (ERP service requests). |
| `hyd_spare_parts` | Retire. Spares list for customers = Service module "recommended spares" from the Engineering BOM. |
| Running hours on systems | Remove. |
| `hyd_components` (separate catalog) | Replace with Item Master items (category Hydraulic Fitting / Hydraulic Component). Keep technical attributes (bore, rod, stroke, displacement, pressure rating) as item specification fields. |

**Stages (same pattern as Electrical):** Requirement → Circuit drawing released → HBOM → HBOM release → Purchase requirement → Installation on RRV → Pressure/leak test & QC → As-built.

**Screens:** Dashboard · Systems · Circuits (Design filter) · BOM · Calculations · Testing · Reports.

---

## 12. Pneumatic — separated view of the Hydraulic module

**Decision:** keep one backend module (`hyd_*` tables already carry `medium = hydraulic | pneumatic`), but give **Pneumatic its own nav entry and permission subtab**, so the Pneumatic team works only on pneumatic records. It is a filtered view of one module, not a second module — no duplicated code or tables.

**Scope:** RRV air brake circuit, compressor/air receiver, pneumatic actuators/horn, air piping.

| Item | Plan |
|---|---|
| Drawing | Design register, discipline = pneumatic |
| PBOM | `hyd_boms` with medium = pneumatic; Item Master items only |
| Calculations | Cylinder force/load ratio, free-air consumption, air receiver sizing |
| Tests | Air leak test, brake application/release time, pressure switch setting — on the RRV only |
| Not in scope | Plant air monitoring, compressor maintenance plans, running hours |

**Permission Matrix:** separate app key alias `pneumatic` (or subtab filter) so access can be granted independently.

---

## 13. R&D (`rnd`)

**Purpose:** engineering calculators — braking, hydraulic drive, load distribution, Qmax, spline, tractive effort, vehicle performance.

**Changes**

1. **P0:** fix C-01 (Spline LaTeX injection), rotate secrets.
2. Standardize tool routes (`/calculate`, `/report.docx` as the document of record, `/report.pdf` as secondary download — D4).
3. Save calculation against an RRV model/project; attach report to a Design document as supporting file.
4. Shared inputs from RRV model master (weight, axle load, wheel dia, gauge) instead of retyping.

---

## 14. Procurement — P2P (`p2p`) and Purchase (`purchase`)

**Decision:** one **Procurement** module. `purchase` becomes only the "raised from Service Request" entry point into P2P (already moving that way: "one Procurement module with a Purchase Team option").

**Flow:** PR (from BOM shortage / Service request / manual) → Dept head approval → Purchase → RFQ → comparison → vendor selection → PO approval (value-based) → PO issued → GRN (Store) → Incoming QC → Invoice (Finance).

**Must-fix**

| # | Change | Ref |
|---|---|---|
| 1 | Requester cannot approve own PR; all required approvers mandatory. | C-02 |
| 2 | Status changes only via transition endpoints (no PATCH status). | C-03 |
| 3 | PO lines must have price, tax, total before submit; approval limits by value (Purchase Head / Director / Partner). | C-04 |
| 4 | Vendor `qualification_status = qualified` / AVL required before PO. | Vendor §5 |
| 5 | PR lines must be Item Master items (free text only for services, flagged). | R6 |
| 6 | PR carries project / RRV Build / cost center. | — |

**Reports:** open PR/PO, PO vs GRN pending, vendor delivery performance, price history per item.

---

## 15. Vendor (`vendor`, finance vendors)

**Purpose:** single vendor master + vendor development (qualification, AVL, audits, scorecard).

**Changes**

1. Merge the Finance vendor master and the Vendor module into one table (bank/GST/payment days + qualification fields).
2. Qualification workflow: request → documents (GST, PAN, ISO, product catalog) → audit/score → approve to AVL.
3. Category mapping to Item Master categories (electrical, hydraulic, pneumatic, bearings, raw material, hardware…).
4. Scorecard save fix; quarterly score from GRN quality rejection + on-time delivery.

---

## 16. Store & Item Master (`store`)

**Purpose:** Item Master, locations/racks/bins, GRN, stock ledger, reservations, issues to work orders/RRV builds, returns, transfers, adjustments, cycle count.

**Item Master go-live (from v3 status)**

| Step | Action |
|---|---|
| 1 | Import Item_Master_Premnath_v3 (3,159 items, code CCC-SSS-NNNN, 29 categories). |
| 2 | Decide open points: negative stock (517 Tally items), Item Type (raw / bought-out / consumable / spare / sub-assembly), HSN, single cut-off date, Min/Max/Reorder, split generic items, confirm Hardware sheet vs Store Unit-2 locations. |
| 3 | Clear 63 MSC-TBC unclassified items. |
| 4 | Separate project stock (PEW-49/73/77/78) from free stock via reservations against the project. |
| 5 | Opening stock posted as one dated opening transaction per location. |
| 6 | Item request workflow for new items (requester → Store → approval → code). |

**Item categories to support E/H/P BOM:** Electrical (cable, connector, relay, switch, lamp, fuse/MCB, battery, harness accessory, panel/enclosure), Hydraulic (pump, motor, valve, cylinder, hose, fitting, filter, oil), Pneumatic (compressor, valve, cylinder, fitting, tube, air receiver), Mechanical, Bearing, Hardware, Raw Material, Consumables.

**Must-fix**

| # | Change | Ref |
|---|---|---|
| 1 | Stock adjustment: draft → approve by Store Manager (≠ creator). | C-09 |
| 2 | Restrict manual stock entry; cap returns at issued qty. | C-09 |
| 3 | Store users can record GRN without purchase rights. | Review §5 |
| 4 | Audit trail on all movements. | C-12 |
| 5 | GRN → Incoming QC hold → accepted qty to stock, rejected to rejection location. | P2 |
| 6 | Cancel/reversal for store documents; stock valuation (weighted average) — used for the period-end closing-stock entry and reports, no perpetual GL posting (D5). | P3 |

**Documents (Word of record, D4):** GRN, issue slip, material return note, transfer note, bin card.

---

## 17. Production (`production`) incl. RRV Build

**Purpose:** production BOM + routing, work orders, material issue, shop floor, planning, **RRV Build** (one record per vehicle), rework, handover certificate.

**RRV Build stage catalog (updated for E/H/P rules)**

| # | Stage | Gate |
|---|---|---|
| 1 | Production Planning | Target dates + main WO linked |
| 2 | Material Kitting & Issue | All WOs released, nothing outstanding to issue |
| 3 | Sub-Assemblies (chassis, rail gear, bogie frame…) | Sub-assembly WOs completed (N/A allowed) |
| 4 | Main Assembly | Main WO started; sub-assemblies done |
| 5 | **Electrical Installation (wiring/harness)** | Electrical package stages 1–5 done; installation checklist signed by electrician |
| 6 | **Hydraulic Installation** | HBOM released; pressure/leak test passed |
| 7 | **Pneumatic Installation** | PBOM released; air leak / brake test passed (N/A allowed) |
| 8 | Final Assembly | Main WO complete; stages 5–7 done |
| 9 | Final Quality Inspection | Final inspection passed / conditionally passed |
| 10 | Vehicle Testing (rail & road trials, brakes, rail-gear deployment, lights/horn) | Latest record of each required test = pass |
| 11 | Rework & Punch-list Closure | No open rework (incl. electrical/hydraulic punch points) |
| 12 | RRV Completion | Serial + chassis captured; machine registered |
| 13 | Production Handover | Handover details; handover certificate as Word document of record |

**Changes**

1. Split current "Hydraulic & Pneumatic Integration" into two stages (6, 7).
2. Electrical installation is a production activity: labour booked on the RRV Build / main WO, no separate electrical WO.
3. Production BOM created from released Engineering BOM (diff on revision).
4. Material consumption per RRV and cost roll-up (material + labour hours × rate) — management report, not a GL posting (D5).
5. Workstation status controlled by Maintenance (plant machines only).

---

## 18. Quality (`quality`)

**Purpose:** inspection plans, incoming/in-process/final inspection, lots, NCR, CAPA, customer complaints, supplier quality, standards, checklists, audits.

**Built already (Phase 1, D7):** stock types, inspection plans, AQL sampling, inspection lots, NCR disposition.

**Remaining changes**

1. Incoming inspection auto-created from GRN; stock blocked until accepted (verify against Phase 1 — lot creation from GRN may already exist).
2. In-process inspection per RRV Build stage (electrical installation checklist, hydraulic pressure test witness, weld inspection).
3. Final inspection + third-party (RDSO/RITES/customer) witness fields.
4. Failed inspection → NCR → rework order in RRV Build (already auto) → CAPA where repeat.
5. Audit trail + soft delete on NCR/CAPA/complaints (C-12).
6. Checklists templates for: Electrical installation, Hydraulic test, Pneumatic test, Final vehicle inspection, PDI before dispatch.
7. Supplier rejection % feeds Vendor scorecard.

---

## 19. Service & Commissioning (`erp`)

**Purpose:** machine registry (every delivered RRV), commissioning at customer site, warranty/AMC, service requests, field materials.

**Changes**

1. Machine created automatically at RRV Completion (already in RRV Build); no manual duplicates.
2. Commissioning record at site (date, report, customer sign-off) — this is the **only** commissioning lifecycle (removed from Electrical).
3. Service request: link to RRV's Engineering BOM to pick spares (item codes) instead of free text.
4. Recommended spares list per RRV model from Engineering BOM.
5. Fix C-08 (material photo IDOR).
6. Warranty claims linked to NCR/CAPA for repeat failures.

**Note:** no remote monitoring / telematics of customer RRVs (R5).

---

## 20. Maintenance (`maintenance`) — own plant only

**Purpose:** CMMS for **Premnath's own plant equipment** (welding machines, cranes, compressors, machine tools, DG sets). Not for RRVs and not for E/H/P design.

**Plan:** Phase 1 asset register + breakdown request + work order + spares via Store; Phase 2 PM schedule (calendar based); Phase 3 calibration of instruments (pressure gauges, meggers used in RRV testing). Keep optional — lowest priority.

---

## 21. Finance & Accounting (`accounts`)

**Purpose:** COA, banks, vendors, internal orders, journals, AP (3-way match), AR, bank reconciliation, period close, reports.

**Changes**

| # | Change | Ref |
|---|---|---|
| 1 | Role gates + maker ≠ checker on post/pay/reverse. | C-05 |
| 2 | 3-way match on GRN qty × PO price; cumulative cap. | C-04 |
| 3 | Fix: Close Period button for Finance Manager, discount invoices posting, on-screen bank accounts paying. | Review §5 |
| 4 | AR invoice from Sales Order / handover. | P3 |
| 5 | RRV costing report: material (store issues at valuation), labour, overheads → cost per RRV. Management report only; GL gets the period-end closing-stock entry (D5). | P3 |
| 6 | Build Fixed Assets, Budgets, Expenses (folders exist, empty). | P4 |
| 7 | GST: e-invoice / e-way bill fields captured only; no IRP/GSP API yet. No TDS/TCS (D5). | P4 |

---

## 22. HR (`hr`)

**Purpose:** HR & Administration (D3) — employee master and masters, joiner/mover/leaver lifecycle, leave, attendance, holidays, admin services (assets, visitors, travel, expense claims). **Payroll (salary, PF/ESI, payslips) stays in ADP.**

**Plan**

1. Employee master: designation, department, grade, reporting manager, skill tags (electrician, hydraulic fitter, welder) so Production can assign RRV stage owners.
2. Leave and attendance using the plant holiday calendar (shared with §29).
3. Leaver flow: exit → deactivate portal user and revoke sessions (closes C-10 together with §3).
4. Admin services: HR assets (laptops, SIMs), visitors, travel, expense claims.

---

## 23. Documents & Reports (`documents`, `reports`)

**Documents:** general (non-engineering) controlled documents — SOPs, policies, templates, approvals. Engineering drawings stay in Design.

**Reports:** standard MIS library:

| Report | Source |
|---|---|
| RRV build status (stage-wise, overdue) | Production |
| BOM release status per project (Mech/E/H/P) | Engineering BOM |
| Shortage vs open PO per RRV | Engineering BOM + Store + P2P |
| Stock value, slow/non-moving, negative stock | Store |
| PR/PO ageing, vendor performance | P2P / Vendor |
| NCR/CAPA trend, inspection pass % | Quality |
| Warranty failures by item | Service |
| Cost per RRV vs quoted | Finance + CRM |

---

## 24. Cross-module integration checklist

| From → To | Trigger | Data |
|---|---|---|
| CRM → Sales | Inquiry won | Customer, RRV model, qty, value |
| Sales → Projects / Production | Sales Order confirmed | Project + N planned RRV Builds |
| Design → E/H/P | Drawing released | Drawing no. + rev on BOM header |
| E/H/P → Engineering BOM | Discipline BOM released | BOM lines (Item Master codes) |
| Engineering BOM → Production | Master BOM frozen | Production BOM |
| Engineering BOM → P2P | Shortage | PR lines |
| P2P → Store | PO issued | Expected GRN |
| Store → Quality | GRN | Incoming inspection |
| Store → Production | Issue | Material consumption per RRV |
| Production → Quality | Stage complete / final | In-process / final inspection |
| Quality → Production | Fail | Rework order |
| Production → Service | RRV Completion / Handover | Machine registry, warranty |
| Production/Sales → Finance | Handover / dispatch | AR invoice |
| P2P/Store → Finance | Invoice | AP 3-way match |

---

## 25. Clean-up list (because of rules R2–R5)

| Module | Remove / hide | Replace with |
|---|---|---|
| Electrical | Stages 2, 7, 8, 11, 13, 16, 17 (system design, panel design, component spec, assembly, panel assembly, troubleshooting, commissioning) | 8-stage package (§10) |
| Electrical | Troubleshooting tab, Projects tab | RRV Build rework; PM |
| Electrical | Own drawing register | Design register (discipline = electrical) |
| Hydraulic | Maintenance, Service Records, Spare Parts tabs; running hours | Nothing (no monitoring); customer service → Service module |
| Hydraulic | Own component master | Item Master + spec fields |
| Hydraulic | Own circuit approval flow | Design register (discipline = hydraulic/pneumatic) |
| All | Free-text item lines on BOM/PR | Item Master codes |

**Migration rule:** hide in UI first (one release), keep tables read-only, export data, then drop in a later Alembic migration with backup.

---

## 26. Open decisions for management

1. Confirm the electrical **8-stage** package (§10) and whether a cable schedule is needed for every RRV.
2. Confirm Pneumatic as a separate department/nav (§12).
3. Confirm all E/H/P drawings move to the Design register (§8).
4. Are any hoses/pipes or harnesses **made in-house** (make items) or all bought out?
5. Required vehicle tests list per RRV model (for RRV Build gate).
6. PO approval value limits (Purchase Head / Director / Partner).
7. Item Master open points (§16 step 2).
8. Is Maintenance (own plant CMMS) needed now or later (§20)?

---
---

# PART B — Customizable Settings in Every Module

## 27. Settings framework (common to all modules)

**Boundary (existing project rule):** "No metadata customization" — statuses, workflow stages, screens and fields stay **in code**. What admins/heads can customize is **operational data**: masters, numbering, approvers, limits, defaults, tolerances, notifications, checklists, templates, routing. This keeps the system auditable and upgrade-safe.

**Scope rule:** build the shared framework once (§27, §49), then add only the settings a module's code actually reads, in that module's phase. The tables below are a catalogue to pick from, not a build list.

**One pattern for every module** (already used by Store `store_settings` and Quality settings):

| Part | Design |
|---|---|
| Table | `<module>_settings` (`key` unique, `value` JSONB, `updated_by_id`, timestamps) |
| Spec in code | `SETTING_SPECS = {key: {group, label, type, default, options, min, max, help}}` — types: `bool`, `int`, `decimal`, `text`, `select`, `multi_select`, `user`, `users`, `department`, `location`, `item_category`, `json_list` |
| API | `GET /<module>/settings` → `{values, specs, groups, can_edit}` · `PUT /<module>/settings` (partial) · `POST /<module>/settings/reset/{key}` |
| Read in code | `get_setting(db, "<module>", key)` → value or spec default (never crashes on missing key) |
| UI | **Settings** tab (last tab in each module nav), grouped cards, "Default" badge, Reset, Save; read-only view for non-editors |
| Access | Permission Matrix subtab `settings` (`view`, `edit`); default editor = module head + admin |
| Audit | Every change logged: key, old → new, who, when; "Change history" link per setting |
| Masters | Lists that users pick from (categories, test types, checklists, reasons) are **small master tables** with active/inactive + sort order, managed under Settings → Masters. Never hard delete; deactivate. |
| Number series | Shared `number_series` (prefix, FY reset yes/no, padding, next no.) per document type, editable by admin only, cannot go backwards |
| Org scope | Setting can be global or per plant (`branch_id` override) where marked **[P]** |

Phase: framework in **P1** (Platform), module settings delivered with each module's phase.

---

## 28. Platform & Admin — Settings

| Group | Setting | Type / default |
|---|---|---|
| Security | Allowed email domains | list · `premnathrail.com` |
| Security | Session idle timeout (min) | int · 30 |
| Security | Azure AD sync time (daily) | time · 02:00 |
| Security | Auto-deactivate on Azure disable | bool · on |
| Access | Module allow-list (replaces hard-coded lock) | users × modules |
| Access | Standard roles per module (Viewer/Maker/Checker/Head) → Permission Matrix template | json |
| Notifications | Channels per event type (in-app / Teams / email) | matrix |
| Notifications | Teams push only for approvals & reminders | bool · on |
| Notifications | Daily digest time | time · 09:00 |
| Files | Max upload size (MB) | int · 25 |
| Files | Allowed file types (PDF, images, DWG, DXF, STEP, XLSX, DOCX) | multi |
| Files | Share-link expiry (days) | int · 7 |
| Audit | Recycle-bin auto-purge (days) | int · 10 |
| General | Date format, time zone (Asia/Kolkata), currency (INR), FY start (April) | select |
| Branding | Company logo, letterhead for Word documents (and their PDF copies) | file |

---

## 29. Organization — Settings

| Group | Setting | Default |
|---|---|---|
| Masters | Plants/branches, departments, designations, cost centers, warehouses | — |
| Department | Department head + deputy (for approvals when head absent) | — |
| Department | Department → module mapping (which module a department works in) | Design→design, Electrical→electrical … |
| Finance year | Active financial year, lock previous FY | 2026-27 |
| Approval | Delegation: user, delegate, from–to date | — |
| Holidays | Plant holiday calendar **[P]** (used for due dates, SLA) | — |
| Shifts | Shift timings **[P]** (used by Production / Maintenance) | General 09:00–17:30 |

---

## 30. CRM — Settings

| Group | Setting | Default |
|---|---|---|
| Masters | Customer types (Zonal Railway, Division, PSU, Metro, Contractor, Export) | seeded |
| Masters | RRV product models & variants (gauge, application, std. configuration) | — |
| Masters | Lead sources, lost reasons, competitor list | seeded |
| Masters | Activity types (call, meeting, site visit, demo) | seeded |
| Pipeline | Inquiry stages shown in CRM (hide post-PO stages) | on |
| Follow-up | Reminder days before follow-up | 1 |
| Follow-up | Auto-flag inquiry stale after N days no activity | 15 |
| Tender | Bid due-date alert days | 7, 3, 1 |
| Tender | EMD/security deposit tracking required | on |
| Ownership | Auto-assign inquiry by region/customer → BD owner | table |
| Import | Allow bulk import (admin only) | on |
| Duplicates | Duplicate check on GSTIN / name | on |
| Templates | MOM template, technical-offer template | file |

---

## 31. Sales — Settings

| Group | Setting | Default |
|---|---|---|
| Quotation | Validity (days) | 30 |
| Quotation | Approval limits: Sales Head up to ₹X, Director above ₹X, Partner above ₹Y | table |
| Quotation | Max discount % without approval | 5 |
| Quotation | Terms & conditions templates (payment, delivery, warranty, LD) | text |
| Pricing | Price list per RRV model, effective from | table |
| Pricing | Default GST rate for RRV | 18 % (verify) |
| Order | Inspection agencies list (RDSO, RITES, customer, self) | seeded |
| Order | Auto-create RRV Builds on order confirmation | on |
| Order | Auto-create Project on order confirmation | on |
| Delivery | Dispatch documents required (PDI report, handover cert., invoice, e-way bill) | checklist |
| Numbering | QTN / SO number series | `QTN/26-27/0001` |

---

## 32. Project Management — Settings

| Group | Setting | Default |
|---|---|---|
| Templates | Milestone templates per RRV model (§7 list) — department, offset days from start, dependency | RRV standard |
| Rules | Task review required by default (per department) | dept choice |
| Rules | Milestone date change needs PM approval | on |
| Alerts | "At risk" when task overdue by N days | 1 |
| Alerts | Escalate to Director/Partner when milestone late > N days | 7 |
| Auto-status | Auto-achieve milestone from source module — P5 only (D2) | off |
| Masters | Project types, categories, priorities | seeded |
| Working days | Use plant holiday calendar for dates | on |
| Numbering | `PRJ-YYYY-NNNN` | — |

---

## 33. Design (Document Control) — Settings

| Group | Setting | Default |
|---|---|---|
| Masters | Document types (+ new: wiring diagram, harness drawing, hydraulic circuit, pneumatic circuit, panel layout) — prefix per type | seeded |
| Masters | Disciplines active (mechanical, electrical, hydraulic, pneumatic, structural…) | all |
| Revision | Revision label style (R0,R1… / A,B… / 00,01…) | R0 |
| Revision | Change summary mandatory from first revision after R0 | on |
| Approval | Default checker & approver per discipline | per dept |
| Approval | Allow admin stand-in | on |
| Approval | Review SLA (days) → reminder | 3 |
| Files | Primary file must be PDF | on |
| Files | Native CAD file required (DWG/STEP) | off |
| Linking | Project/RRV model link mandatory | on |
| ECN | ECN reasons list, priorities, approvers by priority | seeded |
| ECN | Notify on implement: departments list | Production, Store, Electrical, Hydraulic, Pneumatic |
| Title block | Drawing title-block fields / stamp ("Controlled copy", "Superseded") on PDF view | on |
| Export | MDL columns for customer/RDSO submission | std |

---

## 34. Engineering BOM — Settings

| Group | Setting | Default |
|---|---|---|
| Structure | BOM sections enabled: Mechanical / Electrical / Hydraulic / Pneumatic | all on |
| Structure | Max BOM levels | 5 |
| Freeze | Sections required before master BOM freeze (or allowed N/A) | all, N/A allowed |
| Lines | Only Item Master items allowed | on (locked) |
| Lines | Mandatory fields: make, part no., drawing ref, tag no. | make + part no. |
| Lines | Make/Buy default by item category | Electrical = Buy |
| Lines | Long-lead threshold (lead time days) | 45 |
| Revision | BOM revision only through ECN after freeze | on |
| Push | Auto-create Production BOM on freeze (else manual with diff) | manual |
| Shortage | Include open PO qty in shortage check | on |
| Shortage | Include reserved stock of other projects | off |
| Costing | Cost basis: last PO rate / standard cost / weighted avg | last PO rate |
| Numbering | `EBOM-RRV-NNNN` | — |

---

## 35. Electrical — Settings

| Group | Setting | Default |
|---|---|---|
| Stages | Which of the 8 stages can be N/A (e.g. cable schedule, as-built) | 6? no · 8 yes |
| Stages | Stage owners default (Electrical head / Production / Quality) | per §10 |
| Requirement | System voltages list (12 V DC, 24 V DC, 110 V DC, 230 V AC) | 24 V DC |
| Masters | Electrical item sub-categories (cable, connector, relay, switch, lamp, fuse/MCB, battery, horn, harness accessory, enclosure) — mapped to Item Master categories | seeded |
| Masters | Cable sizes & colours list, harness codes | seeded |
| BOM | Cable schedule required | off (optional) |
| BOM | Cable length wastage % added to BOM qty | 10 % |
| BOM | Release checker = must be different from maker | on (locked) |
| Purchase | Auto-raise PR for shortages on EBOM release | off (suggest only) |
| Testing | Test types master: insulation resistance, continuity, polarity, earth, lighting, horn, indicators, battery charging, functional | seeded |
| Testing | Limits per test (e.g. IR ≥ 1 MΩ @ 500 V) | editable |
| Testing | QC witness required for test types | IR, functional |
| Checklist | Installation checklist template (harness routing, clamping, grommets, labels, earthing, fuse ratings) | editable |
| Numbering | `ELP-YYYY-NNNN` | — |
| Not available | Monitoring, maintenance, commissioning settings | — (rule R5) |

---

## 36. Hydraulic — Settings

| Group | Setting | Default |
|---|---|---|
| Masters | System types (power pack, rail-gear deployment, brake, outrigger, crane/platform) | seeded |
| Masters | Hydraulic item sub-categories (pump, motor, valve, cylinder, hose, fitting, filter, oil) → Item Master | seeded |
| Masters | Oil grades (ISO VG 32/46/68), cleanliness classes (ISO 4406) | seeded |
| Units | Pressure unit (bar / MPa / psi), flow unit (L/min) | bar, L/min |
| Calculations | Velocity bands: suction / return / pressure line (m/s) | 0.6–1.2 / 2–4 / 4–6 |
| Calculations | Default efficiencies (pump volumetric/mechanical), safety factor | 0.92 / 0.9 / 1.5 |
| Calculations | Standard IEC motor sizes, accumulator sizes list | seeded |
| BOM | Hose length allowance % | 5 % |
| BOM | Tag numbering style (P1, V1, C1…) | ISO 1219 |
| Testing | Test types: pressure, proof (× working pressure), leak, relief setting, function | seeded |
| Testing | Proof test multiplier | 1.5 × |
| Testing | Hold time (min) for leak/proof test | 10 |
| Testing | QC witness required | pressure, proof |
| Numbering | `HYS`, `HBOM`, `HCALC`, `HTST` series | — |
| Removed | Maintenance plans, running hours, service, spares settings | — (rule R5) |

---

## 37. Pneumatic — Settings

| Group | Setting | Default |
|---|---|---|
| Masters | System types (air brake, compressor & receiver, horn, actuators) | seeded |
| Masters | Pneumatic item sub-categories (compressor, valve, cylinder, fitting, tube, air receiver, FRL) | seeded |
| Units | Pressure unit, flow unit (Nl/min) | bar, Nl/min |
| Calculations | Max load ratio warning % | 70 |
| Calculations | Working pressure default | 7 bar |
| Testing | Test types: air leak, brake application/release time, pressure switch setting, safety valve setting | seeded |
| Testing | Allowed leak drop (bar in N min) | 0.1 bar / 5 min |
| Testing | Brake application time limit (s) | per RRV model |
| Numbering | `PNS`, `PBOM`, `PTST` series | — |

---

## 38. R&D — Settings

| Group | Setting | Default |
|---|---|---|
| Inputs | RRV model reference data (weight, axle load, wheel dia., gauge, wheelbase) | from CRM model master |
| Constants | Adhesion coefficient (rail/road), rolling resistance, gradient, g | editable with help text |
| Reports | Report header/footer, "Prepared/Checked/Approved" block | on |
| History | Calculation visible to: owner / R&D team / all | R&D team |
| Security | PDF engine safe mode (no shell escape) | on (locked) |

---

## 39. Procurement (P2P) — Settings

| Group | Setting | Default |
|---|---|---|
| PR | PR approval: department head required | on (locked) |
| PR | Self-approval blocked | on (locked) |
| PR | Free-text lines allowed for: services only | on |
| PR | Project / RRV Build / cost center mandatory | on |
| Routing | **Auto-buyer by item category** (replaces hard-coded emails, P3-INT-12) | table: category → buyer |
| Routing | Fallback buyer when none matched | Purchase Head |
| RFQ | Minimum quotations by PO value (e.g. < ₹50k: 1, ≥ ₹50k: 3) | table |
| RFQ | RFQ response days | 7 |
| PO approval | Value limits: Purchase Head ≤ ₹X, Director ≤ ₹Y, Partner > ₹Y | table |
| PO approval | Approvers per level (users) | — |
| PO | Price mandatory on all lines before submit | on (locked) |
| PO | Vendor must be qualified / AVL | on |
| PO | PO terms templates (payment, delivery, inspection, warranty) | text |
| PO | Over-receipt tolerance % | 0 |
| Alerts | PO delivery overdue reminder (days) | 1, 7 |
| Numbering | PR / RFQ / PO series | `PR/26-27/0001` … |

---

## 40. Vendor — Settings

| Group | Setting | Default |
|---|---|---|
| Masters | Vendor categories mapped to Item Master categories | seeded |
| Qualification | Documents required (GST, PAN, MSME, ISO, catalog, bank proof) | checklist |
| Qualification | Audit required for categories (e.g. hydraulic cylinders, harness) | list |
| Qualification | AVL pass score | 70 |
| Scorecard | Weights: quality %, delivery %, price %, response % | 40/30/20/10 |
| Scorecard | Review frequency | quarterly |
| Block | Auto "under review" when rejection % > N | 5 % |
| Re-qualification | Re-audit due every N months | 24 |

---

## 41. Store & Item Master — Settings

| Group | Setting | Default |
|---|---|---|
| Item Master | Code format `CCC-SSS-NNNN` — category/sub-category code lists | from v3 |
| Item Master | Item types (raw, bought-out, consumable, spare, sub-assembly, tool) | seeded |
| Item Master | Mandatory fields: UOM, HSN, category, item type, min/max | UOM, category, type |
| Item Master | New item request approval (Store Head) | on |
| Item Master | Duplicate check on description + make + part no. | on |
| UOM | UOM list + conversions | seeded |
| Locations | Warehouses, racks, bins **[P]** | — |
| Stock | Allow negative stock | off |
| Stock | Valuation method (for closing-stock entry and reports, D5) | weighted average |
| Stock | Opening stock cut-off date | (decide) |
| Reorder | Min / Max / Reorder level per item **[P]**; auto PR suggestion | suggestion only |
| GRN | Incoming QC required by category | all except consumables |
| GRN | Short / excess receipt tolerance % | 0 / 0 |
| Issue | Issue only against WO / RRV Build / cost center | on |
| Issue | Challan rules (issue types, locations) — existing `challan_rules` | existing |
| Plant access | User → plants allowed — existing `plant_access` | existing |
| Adjustment | Approver (Store Manager), maker ≠ checker | on (locked) |
| Adjustment | Value limit needing Finance approval | ₹10,000 |
| Reservation | Project stock reservation expiry (days) | none |
| Cycle count | Frequency by ABC class (A monthly, B quarterly, C yearly) | as shown |
| Numbering | GRN / ISS / RTN / TRF / ADJ series | — |

---

## 42. Production & RRV Build — Settings

| Group | Setting | Default |
|---|---|---|
| RRV stages | Stages allowed N/A (sub-assemblies, pneumatic installation) | as §17 |
| RRV stages | Stage owner defaults (department/user) | per dept |
| RRV stages | Completion/Handover approvers | Production Manager |
| Tests | Required vehicle tests per RRV model (rail trial, road trial, braking, rail-gear deployment, guide wheel, lights/horn, gradient) | template per model |
| Tests | Witness required (customer/RDSO) per test | editable |
| Rework | Auto-raise rework on failed test / inspection | on |
| Rework | Verifier ≠ doer | on (locked) |
| WO | Material issue mode: full kit before start / partial allowed | partial |
| WO | Backflush consumption | off |
| Labour | Labour rate per hour by skill (fitter, electrician, welder, helper) | table |
| Labour | Time booking mandatory per stage | on |
| Workstations | Workstation list, capacity hours/day **[P]** | — |
| Handover | Warranty months default | 12 |
| Handover | Certificate template & signatories | template |
| Numbering | `RRV-YYYY-NNNN`, `WO-`, `RW-` | — |

---

## 43. Quality — Settings

| Group | Setting | Default |
|---|---|---|
| Roles | Quality role sets → users (existing Quality settings page) | existing |
| Incoming | Inspection required by item category / vendor | table |
| Incoming | Sampling plan (AQL level) by category | IS 2500 / AQL 1.0 |
| Incoming | Skip-lot after N consecutive accepts | 5 |
| In-process | Inspection points per RRV stage (electrical installation, hydraulic test, welding, painting) | template |
| Final | Final inspection checklist per RRV model | template |
| Final | Third-party agencies list | RDSO, RITES |
| Checklists | Checklist templates (editable items, pass criteria, photo required) | seeded |
| NCR | Disposition options (rework, use-as-is, return to vendor, scrap) | seeded |
| NCR | NCR → CAPA mandatory when repeat count ≥ N in 90 days | 2 |
| CAPA | Closure due days by severity | 7 / 15 / 30 |
| Complaints | Response SLA (hours) | 48 |
| Documents | Calibration-due blocks use of instrument in tests | on |
| Numbering | INS / NCR / CAPA / CC series | — |

---

## 44. Service & Commissioning — Settings

| Group | Setting | Default |
|---|---|---|
| Warranty | Default warranty months, starts from (handover / commissioning) | 12, commissioning |
| AMC | AMC types, renewal reminder days | 30 |
| SR | Issue categories, failure modes, priorities with SLA (response/resolution hours) | seeded |
| SR | Auto-assign engineer by region/customer | table |
| SR | Lock SR after closure | on |
| Commissioning | Commissioning checklist per RRV model | template |
| Commissioning | Customer sign-off required | on |
| Spares | Recommended spares list source (Engineering BOM flagged items) | on |
| Billing | Service charge rates (visit, per day, transport, accommodation) | table |
| Email | Client email on SR create/close; email template | on |
| Numbering | `SR-FY-NNNN` | existing |

---

## 45. Maintenance (own plant) — Settings

| Group | Setting | Default |
|---|---|---|
| Masters | Asset categories, criticality (A/B/C), failure codes | seeded |
| Requests | Who can raise (any department) | on |
| Priority | Default priority from criticality + machine down | matrix |
| PM | PM calendar templates per asset category | — |
| Calibration | Calibration frequency per instrument type (gauges, meggers, torque wrenches) | 12 months |
| Alerts | PM due-soon days | 7 |
| Numbering | `MRQ`, `MWO` series | — |

---

## 46. Finance & Accounting — Settings

| Group | Setting | Default |
|---|---|---|
| Account determination | Control/GST/round-off/stock/depreciation GL mapping (existing `AccountDetermination`) | seeded codes |
| GST | GST rates (existing `GSTRate`), RCM applicability, company GSTIN per plant **[P]** | existing |
| Numbering | JV / SI / PI / PAY series with FY reset (existing `NumberSeries`) | existing |
| 3-way match | Qty tolerance %, amount tolerance % | 2 % / 1 % |
| SoD | Maker ≠ checker on post / pay / reverse | on (locked) |
| Payment | Payment approval limits by value | table |
| Payment | Payment modes enabled | cheque, NEFT, RTGS |
| Period | Period close: who can close / reopen | Finance Mgr / Admin |
| AR | Dunning reminder days | 7, 15, 30 |
| Costing | Overhead absorption % on RRV cost | editable |
| Assets | Depreciation method & rates by asset class | SLM / Companies Act |
| Inventory | Closing-stock valuation posted at period end, auto-reversed next day (periodic, D5) | on (locked) |
| Reports | Close-pack contents | std |

---

## 47. HR — Settings

| Group | Setting | Default |
|---|---|---|
| Masters | Designations, grades, skill tags (electrician, hydraulic fitter, welder, painter, QC inspector) | seeded |
| Directory | Fields visible to all users (name, dept, phone) vs HR only (DOJ, manager) | as shown |
| Leave | Leave types, yearly quota, carry-forward, approver (reporting manager) | seeded |
| Attendance | Shift and holiday calendar source (Organization §29), late-mark grace (min) | 10 |
| Lifecycle | Exit checklist (assets returned, access revoked) | seeded |
| Assets | HR asset types (laptop, SIM, vehicle, tools) | seeded |
| Sync | Fields synced from Azure AD (overwrite or keep local) | keep local |

---

## 48. Documents & Reports — Settings

| Group | Setting | Default |
|---|---|---|
| Documents | Document categories (SOP, policy, form, template), approvers per category | seeded |
| Documents | Review period (months) before re-approval | 12 |
| Reports | Scheduled reports: report, recipients, frequency, format (XLSX / Word / PDF) | — |
| Reports | Dashboard widgets per role | std |
| Reports | Default date range | current month |

---

## 49. Settings delivery checklist (per module)

1. `<module>_settings` table + migration (or reuse common `module_settings` with `module_key`).
2. `SETTING_SPECS` in `app/modules/<module>/settings.py` with groups and defaults.
3. `get_setting()` used in service code — no hard-coded values left (e.g. P2P auto-buyer emails).
4. Settings routes with `require_tab_action("<module>", "settings", "edit")`.
5. Audit registry entry.
6. Frontend Settings tab using one shared `<ModuleSettings module="..."/>` component.
7. Masters pages under Settings → Masters (active/inactive, sort order).
8. Tests: default returned when unset, invalid value rejected (type/min/max/options), non-editor gets 403, change audited.
9. Seed script with Premnath defaults above.
10. Settings marked **(locked)** are shown read-only — they are controls, not preferences.
