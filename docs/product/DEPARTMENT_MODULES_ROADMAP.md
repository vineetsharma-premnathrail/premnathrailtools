# Department Modules — Master Roadmap

Covers all 17 departments requested: Accounts, HR, Design, R&D, Production,
Store, Purchase, Operations, Fluids (Hydraulic & Pneumatic), Electrical,
Service & Commissioning, Maintenance, Quality, Admin, Project Management,
Vendor Development, Business Development.

Two departments already have their own detailed phased plans — this doc
doesn't repeat them, just places them in context:
- **Purchase** → `docs/product/PURCHASE_MODULE_PLAN.md`
- **Electrical** → `docs/product/ELECTRICAL_MODULE_PLAN.md`

## Where each department stands today

| Department | Status |
|---|---|
| Purchase | Built (PR lifecycle) — roadmap written |
| Electrical | Not built — roadmap written |
| R&D | Built (calculation tools) — extend below |
| Business Development | Built (CRM: inquiries/tenders/quotations) — extend below |
| Admin | Built (users/roles/audit/notifications) — extend below |
| Service & Commissioning | Built under `erp.ServiceRequest`, needs its own identity — see below |
| Accounts, HR | **Conflict with `PRODUCT.md` non-goals** — see flag below |
| Design, Production, Store, Operations, Fluids, Maintenance, Quality, Project Management, Vendor Development | Not built — new modules below |

**Structural warning:** module access today is `AVAILABLE_APPS`, a hardcoded set in `backend/app/modules/main/models/user.py`, mirrored by hand in `frontend/src/types/index.ts`, `useAuth.ts`, and the admin UI's `APPS` array. That's fine for 4 modules; at 17 it's worth converting to a DB-backed module registry (a `modules` table + seed data) before building more than 2-3 of these, so adding a department is a data change, not a 4-file code change every time.

---

## ⚠️ Accounts and HR — confirm scope first

`docs/product/PRODUCT.md` lists both as explicit non-goals: *"Accounting/finance module (exists in SAP)"* and *"HR module (exists in ADP)."* Before building either, confirm whether that's outdated or still the company's position. If it still holds, scope these as **read-only visibility layers** over data the portal already owns, not systems of record:

- **Accounts**: roll up costs/values already captured elsewhere — CRM `PurchaseOrder.po_value` (customer orders), `ServiceRequest` billing fields (`service_cost`, `total_bill`, `payment_status`), Purchase module spend once Phase 3 costing lands. A dashboard, not a ledger.
- **HR**: extend the existing `User` record (already has name/email/role) with a profile (designation, department, date of joining, reporting manager) for org-chart and directory purposes. Leave, attendance, and payroll stay in ADP unless that decision changes.

If the answer is "no, we do want a real ledger / real HR system in the portal," that's a much larger scope than the rest of this roadmap and deserves its own dedicated plan — flag it back and we'll do that properly rather than squeeze it in here.

---

## Design

Engineering drawings/BOM ownership, distinct from R&D's calculations.
- Drawing/document repository (reuse the SharePoint attachment pattern from the Electrical plan — same mechanism, different document types: GA drawings, part drawings, BOM, ECN).
- Design review & approval workflow (draft → under review → approved → released), versioning with superseded-by pointers.
- Engineering Change Notice (ECN) tracking, linked to `erp_projects`, feeding Production and Store when a BOM changes.
- Natural shared infrastructure with Electrical/Fluids: consider one `engineering_documents` table with a `discipline` field (mechanical/electrical/fluids) rather than three parallel document tables.

## R&D (extend existing)

Already built: braking/hydraulic/load-distribution/qmax/spline/tractive-effort/vehicle-performance calculators, calculation history.
- Let other departments (Design, Fluids) request a calculation against a project and get notified when it's done, instead of it being a standalone tool.
- Calculation outputs become attachable engineering documents (ties into the Design doc repository above).
- Report template library so PDF outputs follow one house style across tools (already partially true — worth auditing consistency).

## Production

Shop-floor execution against a Project once it moves from Design/BOM to build.
- `production_orders`: linked to `erp_projects`, stage tracking (fabrication → sub-assembly → assembly → testing → painting → dispatch-ready).
- Machine/resource allocation and a schedule view (Gantt-style) per order.
- Material issue against the order pulls from Store (see below); a Quality gate blocks stage advancement until inspection sign-off.

## Store (Inventory)

Central stock ledger — this is the piece Purchase's GRN phase and Production both depend on, so design it once, not per-department.
- Stock master: part number, description, unit, quantity on hand, bin/location, reorder point.
- Goods receipt posts stock in (this **is** Purchase Phase 4's GRN — Store owns the ledger, Purchase's GRN is the transaction that writes to it).
- Material issue posts stock out — to Production orders, to `ServiceMaterial` for field service, or to Maintenance.
- Stock transfer between stores/sites, cycle-count/audit support.

## Operations

Ambiguous as named — worth a quick conversation on what this means at Premnath before scoping it in detail. Two common readings:
1. **Dispatch/logistics**: outbound shipment scheduling, transporter tracking, delivery proof, tied to `Project.delivery_date`.
2. **Cross-department ops dashboard**: a single view aggregating open items across Production/Store/Quality/Service for daily ops review.
Recommend starting with whichever one is causing pain today rather than building both speculatively.

## Fluids (Hydraulic & Pneumatic)

Mirrors the Electrical module's shape almost exactly — same three phases (work orders, engineering docs, safety/test records), different domain fields.
- Work orders: circuit/component tag, pressure rating, fluid type, fault type — same lifecycle as Electrical's `open → assigned → in_progress → testing → resolved → closed`.
- Documents: hydraulic/pneumatic circuit diagrams, component datasheets — same repository as Design/Electrical.
- Test records: pressure test, leak test, cycle test — same shape as Electrical's insulation/earthing tests.
- Given the near-identical shape, consider a shared `engineering_work_orders` / `engineering_test_records` table with a `discipline` column (electrical/fluids/mechanical) instead of three copies of the same schema.

## Electrical

See `docs/product/ELECTRICAL_MODULE_PLAN.md` — already scoped in full (work orders, drawings, internal task tracker, safety/test records, dashboard).

## Service & Commissioning

Mostly **already built** as `erp.ServiceRequest` (issue tracking, warranty, resolution, customer sign-off, billing) — it's filed under "erp" today rather than having its own identity. Two real gaps:
- **Commissioning** isn't a first-class workflow — `Project.commissioning_date` is just a date field. Add a `commissioning_checklists` entity (pre-commissioning checks, test results, customer training sign-off, punch-list items) linked to `erp_projects`, with a generated commissioning report (reuse the PDF/letterhead pattern from R&D reports).
- Consider whether this department should get its own `require_app_access("service")` scoping/dashboard (filtering existing `ServiceRequest` data) rather than sharing the generic ERP view — a permissions/UI change more than a data-model one.

## Maintenance

Distinct from Service & Commissioning (which is *client* machines) — this is upkeep of Premnath's **own** equipment: shop machinery, test rigs, tooling, company vehicles.
- Internal asset register (separate from `erp_projects`, which represents client-deployed machines).
- Preventive maintenance schedule with due dates, breakdown/downtime log, spares linked to Store.

## Quality

Gates material and work at every stage — incoming, in-process, final.
- Incoming inspection tied to Purchase's GRN (Phase 4) — accept/reject/reject-partial against a PO.
- In-process inspection gates within Production's stage tracker.
- Final inspection & test certificate before dispatch — railways commonly require third-party/RDSO witness, so add an inspection-agency/witness field.
- NCR (non-conformance report) and CAPA (corrective/preventive action) tracking, linked back to the PO/production order/service request that triggered it.

## Admin (extend existing)

Already built: users, `assigned_apps` permissions, audit log, notifications, API keys.
- Org-wide settings screen (holiday calendar, financial year config — already implicitly assumed by Purchase's FY-based PR numbering).
- If HR's employee profile lands, Admin becomes the natural home for managing it, not a separate system.
- Once department count grows, this is also where the DB-backed module registry (mentioned above) would live.

## Project Management

Broader scheduling/coordination layer over `erp_projects`, separate from the single-machine Project record that exists today.
- `project_milestones`/`project_tasks`: linked to `erp_projects`, Gantt-style view, dependencies.
- Budget vs. actual view — pulls from Purchase's Phase 3 budget tracking and Accounts' cost roll-up once those exist, rather than tracking cost twice.
- Cross-department task visibility — note CRM's `InquiryTask` already has a free-text `department` field used to assign pre-sales tasks across departments; worth reusing that same shape here instead of inventing a second task model.

## Vendor Development

Overlaps directly with Purchase Phase 1's vendor master — **design together, don't duplicate**. Recommendation: one `vendors` table, shared ownership:
- Purchase owns the transactional side (PR/PO issuance against a vendor).
- Vendor Development owns the qualification side: onboarding checklist, capability/certification records, audit schedule and scorecards, Approved Vendor List (AVL) status, with a `qualification_status` field gating whether Purchase can issue a PO to that vendor.

## Business Development (extend existing)

Already substantially built via CRM: `Organization` (railway zones/divisions), `Inquiry` → `Quotation` → `PurchaseOrder` (customer orders) → presumably converts into an `erp_projects` row, plus `Tender`, `InquiryTask` (cross-department), `InquiryApproval`.
- Tender-specific gaps: EMD/bid-bond tracking, competitor/pricing intelligence, win/loss analysis.
- Pipeline dashboard (stage funnel, weighted forecast) — natural fit for the `data:build-dashboard`-style approach used elsewhere.
- Confirm the Inquiry → Organization PO → `erp_projects` handoff is actually wired end-to-end; worth a quick trace before adding more on top.

---

## Suggested build order

Given the overlaps above, sequencing matters more than doing all 17 independently:

1. **Store** first — Purchase's GRN, Production, Maintenance, and Quality's incoming inspection all depend on one stock ledger existing.
2. **Purchase Phase 1 (vendors) + Vendor Development together** — same table, split ownership.
3. **Design's document repository**, then reuse it verbatim for Electrical and Fluids rather than building three.
4. **Production**, once Store exists to issue material from.
5. **Quality**, gating Production and Purchase's GRN.
6. Everything else (Operations, Project Management, Maintenance, Admin/HR extensions, Accounts visibility layer) can follow in whatever order matches actual pain points — none of them block each other.
