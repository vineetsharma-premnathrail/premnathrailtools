ARCHITECTURE REPORT v2: R&D rework, Sales retirement (Stage 1), priority Standard/Urgent. Revised with the owner decisions of 2026-10-30 and aligned with BA spec.md §3, §5, §6, §11. This version replaces my v1 handback.

FILE NOTE: I could not write docs/agent-runs/2026-10-30-rnd-rework-sales-removal/architecture.md because my tools are read-only (Read/Grep/Glob). Manager: save the "architecture.md" section below as that file. I changed no files. git status was not run (no shell tool). The snapshot in the brief shows protected files backend/app/db/session.py, middleware/error_handler.py and store item_import.py / items.py / service.py as modified; no slice here touches them.

==== 30-LINE SUMMARY (top risks first) ====
1. Sales Stage 1: delete Sales routes, services, schemas, reports, events, scheduler, settings, permissions, sidebar entry and UI. KEEP the 8 sales model files plus a read-only `sales/legacy.py` so the mappers, FKs (13 FK columns in other modules), historic invoice reversal and fresh-install migrations keep working. Do not touch the sales imports in main.py or env.py.
2. RISK: old migration d2f6a9c4e1b7 imports app.modules.sales.approvals at upgrade time. Guard that import in the same change, or `alembic upgrade head` breaks on an empty DB (this has happened twice in prod).
3. Products move INTO CRM as ONE tab, `crm:products`. Pricing becomes a feature inside that tab. Old sales:products, sales:pricing, applications, product_mapping and products:* grants are aliased at runtime AND rewritten by the migration.
4. RISK: FinishedProduct is data-scoped under "sales". Moving it to "crm" scope would show BD users only their own products. Recommendation: the product master is master data and should not be owner-scoped; the tab permission is the gate. verify with security.
5. NO Units. One project = one machine. Production WO / RRV build, Store issue / reservation / dispatch, QC lot / inspection call, and P2P link at PROJECT level (order_project_id, element NULL) when a project has no live units.
6. The columns for project-level links already exist everywhere. The blocks are code, at five places: store/services/project_stock.py:179-182, store/routes/stock_reservations.py:99-103, production/order_project_links.py:333-339, rrv_builds.py:206-209, 592-597 and the units lookup (units.py:30-75).
7. One new hub function, so_projects.resolve_link(), applies the rule "unit required only if the project has live units". The PM 360/Units tab shows one "whole project" row from project-level department cells.
8. PM New Project: remove the Finance budget section (projects/new/page.tsx:94, :138; backend create ignores internal_order_id). Edit-form linking stays untouched (verify).
9. PM "+ Create Project" chooser offers New Project (PM form) or New Prototype (R&D form). "From Sales Order" is removed.
10. R&D intake: new table rnd_requirements with the number RDR-YYYY-NNNN, and rnd_requirement_revisions (codes -R0, -R1, …) that carry the review state (submitted, accepted, returned, responded, superseded). Return is allowed from Accepted until R&D responds. Respond, new tasks and R&D offer upload all require Accepted.
11. The hook is in crm requirement_movement.create_rnd_request, same transaction as the send. The TOR email stays; bell to R&D heads and subscribers; no Teams. A Teams reminder fires only when a revision sits unreviewed for 2 working days, then every 3 days (new job).
12. Technical Offer = upload (DOCX stacked into the quotation, PDF attached separately). The rnd_technical_offers table gains origin rnd/bd, document_id and requirement_revision_no. A BD offer needs no R&D requirement, is quotable immediately, and cannot be deleted once a quotation uses it.
13. Discussion is removed on both CRM and R&D (tables kept). The Access tab and Share Department are removed: R&D users with view see every requirement, and people outside R&D see only requirements where they hold a task. The Design/EHP Requirements tabs and pages go. Milestones (requirement and prototype) go.
14. R&D Tasks: no new type column (type = which table). progress_percent is added, read-only when a checklist exists. revision_no is added to requirement tasks for the "requirement changed" flag. New tab rnd:tasks with view and create, plus an explicit feature analytics. Department = the assignee's users.department.
15. Priority: core/priority.py and lib/priority.ts. The API is strict (AC-38): "high" gets 422. Imports map legacy values. 17 columns plus the maintenance settings rows are migrated: high, critical and urgent become urgent; everything else becomes standard.
16. Origin: product_improvement becomes existing_projects. new_development, process_research and customer_requirement become new_project (source link kept).
17. ONE migration after c3e5a7b9d1f2. Recheck heads first; parallel sessions edit the chain.
18. RISK: Finance can no longer bill new projects "from order". Stage 2 is out of scope. verify that AR invoices can be raised by customer, and count live historic SOs before shipping.
19. RISK: the CRM lock "frozen by live SO" (rule of 10-13) would freeze records forever. Default: drop the freeze and keep the delete guard; the new optional PM "CRM source" link also blocks delete (AC-67). Manager to confirm.
20. Spec AC-61 (Add Unit) is superseded by the owner's no-Units decision, so AC-61 is replaced by AC-61b (project-level links). Spec §3A ("products module") is superseded by "Products in CRM".
21. Eight slices with disjoint files. The new S8 (project-level linking) owns so_projects/units and every module's order_project_links. Manager-only: registries, api.ts, types, Sidebar.
22. Order: Manager registry batch together with the S2/S3 deletions, then S1 migration, then backend slices, then the Manager's api.ts/types, then frontend, then QA (ruff F821 py312, a single alembic head, npm test:ui = 0, Playwright, CRM tours).

==== architecture.md ====

# Architecture: R&D rework, Sales retirement (Stage 1), priority Standard/Urgent
Run 2026-10-30-rnd-rework-sales-removal · Size L · Alembic head at launch c3e5a7b9d1f2 (no migration revises it as of this scan).
Inputs: requirement.md, current-state.md, spec.md (BA), and the owner decisions of 2026-10-30 (two coordinator updates).

## 0. Decision summary
Sales is retired in Stage 1. Every user-facing and API surface goes, together with its permissions, events, scheduler, approval definitions and settings. The 8 Sales model files stay as a passive data layer. They are needed for FKs in Finance, PM, Production, P2P and Store, for reversing historic invoices, and for the baseline/fresh-install migration chain. A read-only helper, `sales/legacy.py`, serves the code that still reads historic orders. Stage 2 (billing on projects, dropping the tables) is out of scope.

Products and Pricing move into CRM as one "Products" tab; Pricing is a feature inside it.

Projects are always one machine, and new projects never get Units. Every downstream module therefore links at project level when a project has no live units. Historic sales-order projects keep their unit rules.

PM New Project loses its Finance budget link. "+ Create Project" asks New Project or New Prototype.

R&D gets its own intake record: an R&D ID, revisions carrying the review state, accept/return, a Timeline, document categories, upload-only Technical Offers (BD may upload too), task-centred work with progress and analytics. Discussion, Access, Share Department and Milestones are removed; no table is dropped. Priority becomes Standard/Urgent everywhere. All of this ships as one migration.

Owner decisions applied: High/Critical become Urgent. R&D ID is RDR-YYYY-NNNN with revisions -R0, -R1 and so on. Return is allowed from Accepted until R&D responds. Discussion is removed on both sides. An uploaded DOCX offer is stacked into the quotation and a PDF is attached separately. The TOR email stays and a bell is added.

Overrides of spec.md: §3A (separate products module) becomes Products in CRM. §3B and AC-61 (Add Unit) become project-level linking (AC-61b below). §3C (staged retirement) is accepted as Stage 1.

## 1. Sales removal impact

### 1.1 Keep
- backend/app/modules/sales/__init__.py, models/__init__.py and models/{order,amendment,extension,approval,attachment,crm_document_link,delivery,proforma}.py.
- They are FK targets of: accounts payment_transaction.py:81-82, collections.py:48, bank_guarantee.py:66; projects/models/project.py:65-66 and element.py:40-43 (NOT NULL); p2p_request.py:282; production work_order.py:61-62, mrp.py:115-116, rrv_build.py:85-87.
- Their imports in main.py:106-113 and alembic/env.py:100-107 stay unchanged.
- accounts/services/billing.py stays. on_ar_changed reverses SO billing on cancel or credit of historic invoices (accounts/service.py:1034,1053; notes.py:195; vouchers.py:705).

### 1.2 New: backend/app/modules/sales/legacy.py (S2)
Read-only, no routes. Contents:
- `today_ist`, re-exported from app.core.reporting.dates.
- `get_order(db, so_id)`: 404 "Sales order #<id> no longer exists — refresh the page."
- `rows_for_machine`, copied from sales/delivery.py.
- `live_order_for_source`, copied from service.py:632.
- `STATUS_LABEL`.

Also new, backend/app/modules/sales/retired_routes.py: one router, `/sales/{path:path}` for any method, returning 410 "Sales Orders were removed on 2026-10-30. Projects are created in Project Management › All Projects › + Create Project." (AC-60). The Manager mounts it.

### 1.3 Delete (S2)
- sales/routes/*, schemas/*, reports/*, access.py, approvals.py, events.py, views.py, service.py, pricing.py, proforma.py, delivery.py, crm_documents.py, settings.py.
- app/tasks/sales_scheduler.py, core/events/sales.py, core/features/sales.py (both auto-discovered packages), accounts/routes/sales_billing.py, and feature accounts:sales_invoices.bill_from_so.
- Tests: test_sales.py, test_sales_approvals.py, test_sales_delivery_billing.py.
- Tests to rewrite so they build SalesOrder from the models only: test_idor_production_projects_sales.py, test_order_project_*.py, _so_project_helpers.py, test_accounts_payment_differences.py:363, test_co_product_costing_copa.py.
- scripts/demo/seed_sales.py; model-only fixes in seed_accounts.py:386 and seed_production.py:211.

### 1.4 Unlink / replace (backend)
| file:line | action | owner |
|---|---|---|
| crm/services/stage_guard.py:15-35 | ensure_no_live_order / ensure_not_with_sales become no-ops (signatures kept). Recorded rule 10-13 is reversed; Manager to confirm. | S2 |
| crm/services/stage_guard.py:38-65 | record_links keeps historic SOs and adds PM projects whose source is this record ("project PEW-82") — AC-67 | S2 |
| crm/services/quotation_status.py:125,156-170,317 | Move the quotation SettingSpecs and sales_head into crm/settings.py ("BD Head (quotation approver)"). Hints point to CRM › Settings. | S2 |
| crm/routes/inquiries.py:47-49 | `_out` uses legacy.live_order_for_source (information only) | S2 |
| crm/routes/workflow.py:356-364 | Historic-SO guard kept (model import). Message: "Quotation QT-… can't be {action}: historic sales order SO-… was raised from it — make a new quotation instead." | S3 (owns workflow.py) |
| crm/routes/organizations.py:409,576 | keep | — |
| accounts/services/billing.py:152,225,304-306,364; credit.py:201 | import from sales.legacy | S2 |
| accounts/routes/receivables.py:44 | drop ("sales","orders") | S2 |
| store/routes/material_issues.py:477-485 | Remove the on_store_dispatch block. Dispatch posts at project level (§2.3). sales_order_id is accepted and ignored. | S2 |
| production/service.py:814 | remove the on_rrv_handover call | S2 |
| production/order_project_links.py, design/order_project_links.py:44,448-467, quality/services/order_project_inspection.py:28,139,144, quality/order_project_links.py:28 | sales.legacy imports, plus project-level linking (§2.3) | S8 |
| main/routes/analytics.py:86-138,216-220 | remove the 3 Sales tiles | S2 |
| core/optimistic_lock.py:132 | remove the SalesOrder entry | S2 |
| products/routes/{products,price_conditions,applications}.py | "sales","products"/"pricing"/"applications" becomes crm:products (pricing writes need the feature crm:products.pricing:create/edit/delete) | S2 |
| products/access.py:14 | Remove register_scoped (master data; see §8) or register under "crm". Decision: remove; verify with security. | S2 |
| core/features/products.py | register_features("crm","products", specifications, prices, pricing). Lands with the registry edit. | S2 |
| p2p/account_assignment.py:41,152 | keep (model read); verify that no "sales order" PR purpose is offered | S2 |
| alembic/versions/d2f6a9c4e1b7…py:94-96 | `try: mod = importlib.import_module(module)` / `except ModuleNotFoundError: log.info("skipped %s — module retired", module); continue` | S1 |
| core/audit_registry.py, core/sod_rules.py:77-78, core/jobs.py:36, main.py, permission_registry.py, user.py | Manager (§7) | M |
| approval_workflows | migration M8 deactivates them | S1 |

### 1.5 Frontend
- Delete (S4): app/dashboard/sales/** EXCEPT a new catch-all app/dashboard/sales/[[...slug]]/page.tsx. It shows "Sales Orders were removed. Projects are created in Project Management." with a link and no crash (AC-64).
- Delete (S4): components/sales/{OrderTermsFields, AmendmentPanel, DeliveryPanel, SalesNav, SoCrmDocuments, CrmDocumentPicker, OrderEditors, ProformaPanel, DeliveryConfirmPanel, BillingStatusPanel}.tsx, components/finance/SalesBillingDue.tsx, lib/tour/configs/sales*.ts, lib/tour/modules/sales.ts and their registry.ts entries.
- KEEP: components/sales/ProjectUnitPicker.tsx (owned by S8), ProjectUnitTable.tsx, SalesUi.tsx, labels.ts. More than 25 importers in other modules; moving them is a follow-up.
- Edit (S4): finance GuaranteesTab.tsx:164 and payments/page.tsx:263 (remove the SO pickers, keep historic labels); finance/sales/page.tsx:22,181 (remove the Billing Due tab); store MaterialIssueForm.tsx:160-179 (remove the SO rows picker; dispatch picks the project); erp/NotificationBell.tsx:69-72 (sales_* links go to /dashboard/sales, which is the catch-all page; add rnd_requirement_accepted, rnd_requirement_returned and rnd_review_reminder links); app/dashboard/page.tsx:119-122,211,259-260 (remove the Sales card); lib/recordRef.ts:9 (comment only); finance tours.
- Products into CRM (S4): app/dashboard/products/** keeps its URL and renders CrmNav above the header with "Products" active. Gate: useRequireApp('crm') plus can('crm','products','view'). Change every `can('sales','products'|'pricing',…)` / `canFeature('sales','products',…)` to crm products (pricing → canFeature('crm','products','pricing',…)). Files: ProductsNav.tsx (delete or reduce to CrmNav), PriceConditionsPanel.tsx, ProductSalesPanels.tsx, ProductForm.tsx, products/page.tsx, products/[id]/page.tsx, products/new, products/[id]/edit. PriceConditionsPanel:139 uses the CRM organisations lookup instead of salesApi.lookupCustomers.
- CrmNav "Products" tab (subtabKey 'products'): S4 owns components/crm/CrmNav.tsx (verify the file name).
- Manager: Sidebar.tsx:91-97 (remove the Sales entry; no separate Products entry), useAuth.ts:68 (drop 'sales'), api.ts (remove salesApi, projectsApi.salesOrdersAwaitingProject/createFromSalesOrder, accountsApi.salesBillingOrder/createInvoiceFromSalesOrder and the billing-due block at ~4907-4910), types/index.ts.

## 2. Project Management

### 2.1 Create Project chooser (S7)
- Entry points: projects/all/page.tsx:52-74 and projects/page.tsx:54-58. "+ New Project" becomes "+ Create Project", which opens components/projects/CreateProjectChooser.tsx (FormSheet popup, createPortal to body).
- New Project goes to /dashboard/projects/new. Enabled by meta.can_create.
- New Prototype goes to /dashboard/rnd/projects/new?from=pm. Enabled by can('rnd','projects','create'). Otherwise it is disabled with "You need R&D › Prototype / Research › Create — ask an admin to grant it in Organization › Role & Permissions."
- If both rights are missing, the button is hidden (AC-58/59).
- Delete the "From Sales Order" button, its fetch and FromSalesOrderSheet.tsx. Backend: routes/units.py:94-148 (S8 owns units.py).
- rnd/projects/new (S5): with from=pm, "← Back" returns to PM; after create, open the R&D project at its Tasks tab.

### 2.2 PM New Project form (S7)
- Remove Finance: projects/new/page.tsx:94 (ProjectBudgetSection) and :138 (internal_order_id).
- Backend projects/routes/project.py:278-293 and :328: create ignores internal_order_id. If one is sent, return 422 "Finance budgets aren't linked when a project is created — link one later from the project's Overview, if needed." Recommended: the edit flow (:407-423) stays unchanged until the owner says otherwise (verify).
- Optional "CRM source" (inquiry or tender) on New Project, for traceability and the AC-67 delete guard: pm_projects.source_kind / source_id (§3). Picker shows records at "Order Received". It does not freeze the CRM record.
- "R&D users can open projects to create tasks" means R&D project tasks live on Prototype / Research projects. PM projects are not linked to R&D tasks in v1. Open point 6 (R&D view-only on PM All Projects) is awaiting the owner.

### 2.3 Project-level linking without Units (S8)
Rule: a project with live PmProjectElement rows (historic SO projects) still needs a unit. A project with no live units, which is every new project (one project = one machine), is linked at project level: order_project_id = project, order_project_element_id = NULL. The columns already exist on every downstream table (work orders, RRV builds, MRP planned orders, stock reservations, material issues and issue lines, PR/PO/GRN lines, inspection lots and calls, design requests/BOMs, electrical jobs, hydraulic systems).

New hub API in projects/so_projects.py:
- `def project_has_units(db, project_id) -> bool` (live, non-cancelled elements).
- `def resolve_link(db, project_id: int | None, element_id: int | None, *, what: str, allow_closed=False) -> tuple[PmProject | None, PmProjectElement | None]`:
- element given → resolve_element.
- project only → resolve_project; if project_has_units, raise 422 "Pick the vehicle / lot of {code} this {what} is for — this project was created from a sales order and has units."
- otherwise return (project, None).
- Department providers: `fn(db, project, elements)` must also return the key `None` for project-level work (records with order_project_id = project and element NULL). The 360 shows one "Whole project · <machine serial>" row (UnitsTab).
- `refresh_project_lifecycle` reads the project-level cells for unit-less projects.

| Screen / flow | Today | Change |
|---|---|---|
| Units picker GET /projects/units/lookup (units.py:30-75) | project rows only when include_projects; unit rows otherwise | Always add a project row (element_id null, display "PEW-82 · <client> · machine <serial>") for projects without live units, also with `kind`, so pickers with requireElement=true can pick them. Remove the SalesOrder join (no SO for new projects); keep an outer join for historic display. |
| ProjectUnitPicker.tsx (keeps its path) | placeholder "Pick project unit (vehicle / lot)…" | Placeholder "Pick project (or its vehicle / lot)…". Project rows are selectable when requireElement is set. |
| Production work order apply_wo_element (production/order_project_links.py:298-345) | no element → order_project_id=None | Use resolve_link; keep project-level. SO auto-fill only for historic projects. |
| RRV build (rrv_builds.py:206-209, 592-597) | build ↔ unit via sales schedule | Build carries order_project_id; element optional. WO/build consistency compares projects when either element is NULL. One live build per unit-less project. 409 "PEW-82 already has build RB-… — one project is one machine." |
| MRP planned orders (production/routes/mrp.py:388-389) | element from SO schedule | Project-level when no schedule. |
| Store material issue (store/services/project_stock.py:163-230) | project-only → 422 at :179-182 | resolve_link. Line elements stay None for unit-less projects. Dispatch issue: project picked (required for issue type dispatch) and the machine via the existing erp_project_id field. The PM 360 "dispatch" cell comes from dispatch issues with order_project_id (date, issue no.), not from SalesDeliveryEvent. |
| Store reservation (store/routes/stock_reservations.py:94-103) | project-only → 422 | resolve_link. Reserved for the project. |
| Project stock, GRN line links (project_stock.py:431) | element from GRN line | project-level when NULL |
| QC inspection lot / call (quality/services/order_project_inspection.py:54-67) | already allows project only | Keep. so_requirement returns None for unit-less projects (no SO agency rule). |
| P2P PR/PO/GRN lines (p2p/order_project_links.py:111-160) | element optional | resolve_link |
| Design / Electrical / Hydraulic (design/order_project_links.py:74) | element optional | resolve_link |
| PM Units tab (UnitsTab.tsx, S7) | unit table + "Open sales order" | Unit-less project: a single "Whole project" row with the department cells. Remove the "Open sales order" button. |
AC-61b (replaces AC-61): given a project created in PM, when Production, Store, Quality or Dispatch pick it, they link to the project itself; no "pick a unit" error; the PM 360 shows their status on the Whole project row. Historic SO projects still require their unit.

## 3. Data model (S1): ONE migration, down_revision "c3e5a7b9d1f2"
File `<rev>_rnd_intake_sales_retired_priority.py`. Run `alembic heads` immediately before creating it.

### 3.1 New tables
**rnd_requirements** (model rnd/models/requirement.py RndRequirement; TimestampMixin)
- id PK.
- rd_number String(20) NOT NULL UNIQUE (uq_rnd_requirement_number). Generated by next_sequential_id(prefix=f"RDR-{yyyy}-", column) under an advisory lock; yyyy = IST year of the first send.
- source String(20) NOT NULL ('inquiry'|'tender'), record_id Integer NOT NULL. UNIQUE(source, record_id) uq_rnd_requirement_source_record; index on record_id.
- status String(20) NOT NULL server_default 'submitted'. Index. Mirror of the latest revision: submitted, accepted, returned, responded.
- current_revision Integer NOT NULL server_default 0.
- first_received_at DateTime(tz) NOT NULL, last_received_at DateTime(tz) NOT NULL.

**rnd_requirement_revisions** (RndRequirementRevision)
- id PK.
- requirement_id FK rnd_requirements ON DELETE CASCADE, NOT NULL, index.
- revision_no Integer NOT NULL. UNIQUE(requirement_id, revision_no).
- revision_code String(30) NOT NULL UNIQUE, f"{rd}-R{n}" (R0 first).
- status String(20) NOT NULL server_default 'submitted' (submitted, accepted, returned, responded, superseded).
- crm_rnd_request_id FK crm_rnd_requests ON DELETE SET NULL, NULL, index.
- movement_log_id FK audit_logs ON DELETE SET NULL, NULL. This is the snapshot; it is not copied.
- changed_fields JSON NULL (cache of changed labels).
- submitted_by_id FK users NULL; submitted_at DateTime(tz) NOT NULL.
- reviewed_by_id FK users NULL; reviewed_at DateTime(tz) NULL; review_remarks Text NULL; return_reason Text NULL.
- responded_at DateTime(tz) NULL.
- last_reminded_at DateTime(tz) NULL (Teams reminder cadence).
- created_at.

### 3.2 Altered tables
- rnd_requirement_tasks:
- + progress_percent SmallInteger NOT NULL server_default '0', CHECK 0-100 (ck_rnd_req_task_progress).
- + revision_no Integer NULL (the revision current when the task was created; drives the "requirement changed since task created" flag, AC-16).
- priority server_default 'standard'.
- rnd_project_tasks: + progress_percent (same CHECK, ck_rnd_proj_task_progress); priority server_default 'standard'.
- rnd_technical_offers:
- + origin String(10) NOT NULL server_default 'rnd' ('rnd'|'bd').
- + document_id Integer FK crm_documents ON DELETE SET NULL, NULL.
- + requirement_revision_no Integer NULL.
- + notes Text NULL.
- + index (source, record_id).
- scope, technical_details and the other authoring columns are kept but unused.
- rnd_requirement_doc_visibility: + category String(40) NULL. One row per requirement document. shared_with_all is ignored from now on.
- rnd_documents: + category String(40) NULL (project documents, same list).
- pm_projects: + source_kind String(20) NULL, + source_id Integer NULL (optional CRM source, AC-67), index (source_kind, source_id).
- pm_task_subtasks.priority: server_default 'standard'.
- Model files (S1): defaults and *_PRIORITIES tuples become standard/urgent. RND_PROJECT_ORIGINS = ("existing_projects","new_project") with labels "Existing Projects" / "New Project" and project_type map existing_projects → product_improvement, new_project → new_product. RND_DOC_CATEGORIES:
- customer_specification "Customer Specification"
- technical_specification "Technical Specification"
- reference_standard "Reference Standard"
- drawing "Drawing"
- calculation "Calculation"
- test_report "Test Report"
- datasheet "Datasheet"
- technical_offer "Technical Offer" (system only, not in the picker)
- other "Other"

### 3.3 Data steps (idempotent; counts logged per table)
- M1 Intake backfill.
- Group crm_rnd_requests (ORDER BY created_at, id) by (source, record_id).
- Add records with technical_offer_sent_at and no request row (legacy; verify the column names and is_deleted).
- Number RDR per IST year in first-send order.
- One revision per send, R0..Rn. Revision status: open → accepted (spec §7, so the review queue isn't flooded); responded → responded; superseded → superseded.
- requirement.status = latest revision status; current_revision = n.
- M2 Doc categories.
- Insert missing rnd_requirement_doc_visibility rows (department 'rnd') for CrmDocument related_sub_module = REQ_DOC with category 'other'.
- rnd_documents.category from document_type: specification → technical_specification, drawing → drawing, test_report → test_report, everything else → other.
- M3 Offers. Status draft or submitted (Word-created, not released) → status 'draft', returned_reason = "Offer creation was replaced by upload — upload the final file" (AC-34). Released and superseded offers are unchanged.
- M4 Origin. product_improvement → existing_projects; new_development, process_research, customer_requirement → new_project. source_kind/source_id, origin_note and project_type are kept.
- M5 Priority. On every column in §5.1: `CASE WHEN lower(trim(priority)) IN ('urgent','critical','high') THEN 'urgent' ELSE 'standard' END` (followup_priority: NULL stays NULL). Maintenance module_settings priority_* rows are mapped the same way (verify the value format).
- M6 Progress. closed or submitted → 100. Open with a checklist → round(100 × done / total). Otherwise 0.
- M7 Grants (roles.permissions, users.granular_permissions):
- sales:products[.f]:a → crm:products[.f]:a
- sales:pricing:a → crm:products.pricing:a (also add crm:products:view)
- sales:applications|product_mapping:a → crm:products:a
- products:*:a and products:<tab>:a (retired module) → crm:products:a
- sales:*:a → crm:products:a
- drop the remaining sales:*
- drop the removed rnd features: requirements.{milestones, milestone_status, departments, discussion, access}, projects.{milestones, milestone_status}
- drop {design, electrical, hydraulic}:requirements:*
- drop crm discussion grants
- add rnd:tasks:view to holders of rnd:requirements:view, rnd:projects:view or rnd:project_work:view
- add rnd:tasks:create to holders of a requirements.tasks or projects.tasks create grant
- add rnd:requirements.review:approve and :reject nowhere (heads have them by record rule)
- M8 `UPDATE approval_workflows SET is_active=false WHERE module_key='sales'`. Pending sales approval requests are closed as cancelled with the note "Sales module retired" (verify the table and columns).
- M9 module_settings rows for sales quotation_* and sales_head_id move to module_key 'crm' (key quotation_head_id) unless a crm row already exists.
- Downgrade drops the new tables and columns. M3-M9 are irreversible (stated in the docstring).
- Live-DB safety: every added column is nullable or has a server_default. CHECK constraints are added after the backfill. All touched tables are small.

## 4. API contract (prefix /api/v1; every route: permission + data scope + IDOR; real errors)

### 4.1 Intake (S3)
- GET /rnd/requirements (requirements.py:76). Rows add rd_number, status, revision_code, last_received_at, needs_my_review. Order: needs_my_review first, then rd_number ascending.
- Visibility (AC-21): R&D-side users (rnd:requirements:view) see all. Others see only requirements where they hold a non-cancelled task (legacy rnd_requirement_access rows are still honoured read-only).
- GET /rnd/requirements/{source}/{record_id}. Adds requirement{...} and revisions[{revision_no, revision_code, status, submitted_by/at, reviewed_by/at, review_remarks, return_reason, changed_fields}]. 403 "You don't have access to this requirement — ask the R&D head (<names>) to give you a task on it." (AC-20).
- POST …/accept {remarks?} and POST …/return {reason}.
- Permission: R&D head, admin, or rnd:requirements.review approve (accept) / reject (return). 403 "Only the R&D head (<names>) or someone with R&D › Requirements › Review can accept or return — an admin grants it in Organization › Role & Permissions." (AC-14).
- Latest revision only, row FOR UPDATE. 409 "R<n> is newer — review the latest revision." (AC-13).
- Accept: only from submitted.
- Return: from submitted or accepted. 409 "Already answered — ask BD to re-send if it must change." (AC-12). 422 "Enter the reason BD must fix (at least 10 characters)." (AC-9).
- Effects: revision and requirement status updated; AuditLog; bell to the BD requester and the BD owner (crm events rnd_accepted / rnd_returned); latest CrmRndRequest.status 'returned' on return.
- Gates (AC-15): respond (requirements.py:265), POST requirement task, R&D offer upload → 409 "Accept the requirement first (RDR-…-R<n> is <status>)."
- BD send/re-send. Existing checks run first (AC-5/6). Then requirement_movement.create_rnd_request → rnd.services.requirements.on_bd_submit(...), same transaction: upsert with an RDR number; new revision; an unanswered previous revision (submitted/accepted) becomes superseded; returned/responded revisions keep their status; requirement.status = submitted. Bell to the heads and the tor_received subscribers; the sender is skipped; no duplicates; no Teams (AC-17). The TOR email is unchanged.
- Reminder job (new, S3 file rnd/tasks/review_reminders.py; the Manager registers it in core/jobs.py and the main.py scheduler): revisions in submitted for 2 working days get a Teams + bell reminder to the heads, repeated every 3 days, using last_reminded_at (AC-18).
- Timeline: GET /rnd/requirement-work/{source}/{id}/history (keep requirement_milestones.py:409; delete its milestone CRUD). Newest first. Covers revisions, review, response, tasks, offers, documents and project links.

### 4.2 Technical Offers (S3)
- POST /rnd/requirement-work/{source}/{record_id}/technical-offers (multipart: file .docx/.pdf, title, offer_date, notes?, revise_of_id?).
- Requires an accepted requirement, plus offer_team create or head.
- Number TO-<suffix>[-Rn] (existing rule). Status submitted ("Pending release"). requirement_revision_no = current.
- The file is a CrmDocument (related_sub_module "technical_offer", doc_category "Technical Offer"). An upload can complete a migrated draft.
- Errors: 422 "Only Word (.docx) or PDF files can be uploaded as a Technical Offer." / "The file is empty." / 413 "The file is <n> MB; the limit is <limit> MB." (reuse the CRM upload limit; verify) — AC-28.
- Existing /release and /return (head) stay. Return needs a reason.
- PATCH: title, offer_date and notes only, while not released.
- Authoring endpoints: build_docx, Edit in Word and tor-options are removed (AC-25; verify there are no other callers).
- GET /rnd/requirement-work/technical-offers/{id}/file: IDOR check offer → (source, record_id) → access download. Legacy offers serve their managed document.
- BD side (S3, crm/routes/workflow.py):
- POST /crm/{inquiries|tenders}/{id}/technical-offers (multipart file, title, offer_date, notes). Feature crm:inquiries_tenders.technical_offer:create plus CRM scope (_load_live_*). origin 'bd', number BTO-<suffix>[-Rn], status 'released'. No R&D requirement needed (AC-31).
- DELETE /crm/technical-offers/{id} (BD origin only, feature delete). 409 "Used by quotation <no.> — remove it from the quotation first." (AC-32).
- R&D release/upload endpoints refuse BD users with 403 (AC-35).
- The quotation picker (:188, :179) lists released R&D and BD offers, plus superseded ones only for existing quotations. Response fields: origin, based_on_earlier_revision, label "Uploaded by BD, not reviewed by R&D".
- Quotation Word (:658-670): DOCX is stacked; PDF is attached separately with a screen note (AC-33).

### 4.3 Documents (S3)
- Upload adds a required Form category (not technical_offer). 422 "Pick a category." The department/visibility fields are removed.
- GET list returns category and category_label and accepts a `?category=` filter.
- PATCH /rnd/requirement-work/documents/{id}/category, by the uploader or a head. The visibility route is deleted.

### 4.4 R&D Tasks (S3; new router rnd/routes/tasks.py prefix "/tasks", service rnd/services/task_board.py)
- Filters: type, requirement_id, rnd_project_id, assigned_to_id, department, status (open/submitted/closed/cancelled/overdue/pending), priority, due_from, due_to, progress_band (0 / 1-49 / 50-99 / 100), q, page, page_size.
- GET /rnd/tasks → {items, total}.
- Row: key, id, type, title, parent{kind, id, ref, title, source?, record_id?}, assignee{id, name, department}, creator, priority, status, work_status, progress_percent, progress_from_checklist, start_date, due_date, closed_at, days_overdue, requirement_changed.
- Order: parent ref ascending, then id ascending.
- Scope (AC-55): analytics feature, head or admin → all tasks; otherwise tasks assigned to or created by me.
- GET /rnd/tasks/analytics → totals{total, pending, completed, overdue, avg_progress} (cancelled excluded; pending + completed + overdue = total, AC-53), by_user[], by_project[]. Project progress = average of non-cancelled tasks (AC-56).
- POST /rnd/tasks (multipart). Body: type plus requirement (source, record_id) or rnd_project_id, then title, details, assignee, start, due, priority, checklist, files.
- Permission: rnd:tasks:create and the record rule (requirement accepted and openable, or project lead), via create functions refactored out of requirement_work.py:735 and project_tasks.py:277 (milestone args dropped).
- 403 when create is missing (AC-49). The existing start-after-due message applies (AC-48).
- Progress endpoints (requirement_work.py:1141, project_tasks.py:558) accept progress_percent.
- 422 "Progress must be a whole number from 0 to 100."
- With a checklist, progress is computed and 422 "This task has a checklist — progress follows the ticked steps." Complete sets 100; reopen caps at 99 (AC-50/51).
- Overdue = open and due < today IST. Department = users.department of the assignee. Excel export: out of scope (spec §9).

### 4.5 Removed (S3)
- Milestone CRUD (requirement_milestones.py:198-393, project_milestones.py:198-378; their /history routes stay).
- Access (requirement_work.py:251, 280; my-access :245 stays for flags).
- Shares (:413, :432).
- Visibility (:538).
- department_requirements.py (whole router).
- crm/routes/requirement_discussion.py.
- Discussion recipient settings in crm/settings.py.
- Event department_replied.

## 5. Priority (S6 unless the file is owned elsewhere)

### 5.1 Columns (M5)
crm_inquiries.priority, crm_inquiries.followup_priority, crm_tenders.priority, design_requests, design_change_notices, electrical_jobs, maintenance_requests, maintenance_work_orders, production_work_orders, production_rrv_builds, p2p_requests, pm_projects, pm_project_tasks, pm_task_subtasks, rnd_projects, rnd_project_tasks, rnd_requirement_tasks, erp_service_requests (case only). Plus the maintenance settings priority_* rows.

Not in scope: severities, sampling, characteristic class, and the computed collections priority (accounts/services/collections.py:217).

### 5.2 Contract
- backend/app/core/priority.py: PRIORITIES = ("standard","urgent"), LABELS.
- `parse_priority(v, default="standard") -> str`: accepts standard/urgent in any case; otherwise 422 "Priority must be Standard or Urgent." (AC-38).
- `map_legacy_priority(v) -> str`: for imports only (CRM bulk import, SR import).
- Sort rank {urgent: 0, standard: 1}.
- frontend/src/lib/priority.ts: `type Priority`, PRIORITY_OPTIONS (Standard is the default), priorityLabel, priorityTone, isUrgent.
- Also: the design change_requests `_PRIORITY` mapper; maintenance/settings.py:31-50 (A-down urgent, everything else standard); every rank dict or colour map; CRM tours (crmInquiryForm, crmInquiryDetailPage, crmTenderForm, crmOrganizationDetail), which S6 updates except tours owned by S5. rnd/services/task_fields.py is S3.

## 6. Cross-cutting
- No approval-engine hook for accept/return (spec §3H). Offer release keeps the head rule. Sales workflows are deactivated (M8).
- Audit (Manager, audit_registry.py): register RndRequirement (entity_type "rnd_requirement", ref rd_number) and RndRequirementRevision (ref revision_code), both module "rnd". Remove the Sales registrations. FinishedProduct, ProductSpecification and ProductApplication move to module_key "crm".
- Notifications:
- core/events/rnd.py (S3): tor_received keeps its key, label "New requirement received", channels ("bell",); new review_pending (reminder, channels ("bell","teams"), kind reminder); remove department_replied.
- core/events/crm.py (S3): rnd_accepted and rnd_returned (bell) to the requester and the owner.
- Record links: requirement and project pages use recordPath/useRecordId. Task rows open their parent through a signed ref (AC-57). There is no new record kind.
- Data scope (rnd/scope.py, S3): register RndRequirementTask and RndProjectTask (owner created_by_id, assigned assigned_to_id; plus project team for project tasks).
- Numbering: RDR uses next_sequential_id (advisory lock, AC-2). Revision numbers are taken under the requirement row lock. TO and BTO are unique; an IntegrityError becomes 409 "Two uploads got the same number — upload again." Idempotency-Key middleware and useFormDraft cover double clicks (AC-72).

## 7. Permissions (Manager snippets)
permission_registry.py:
```python
"crm": _module("CRM",
  ("dashboard", "Dashboard", V),
  ("organizations", "Customer Organizations", _with(CRUD, "export", "import")),
  ("inquiries_tenders", "Inquiries & Tenders", WORKFLOW),
  ("products", "Products", CRUD),            # NEW — product master; Pricing is a feature of this tab
  ("reports", "Reports", REPORT),
  ("settings", "Settings", SETTINGS),
),
"rnd": … ("requirements", "Requirements", ["view","create","edit"]),
       ("tasks", "R&D Tasks", ["view","create"]),   # NEW
# design/electrical/hydraulic: delete the "requirements" tab. Delete the whole "sales" module.
```
- Delete PRODUCT_TABS.
- legacy_grant_aliases: map sales:{products,applications,product_mapping}[.f]:a → crm:products[.f]:a; sales:pricing:a → [crm:products.pricing:a, crm:products:view]; sales:*:a and products:*:a / products:<tab>:a → crm:products:a; other sales:* → [].
- legacy_access (698-702): `keep |= {g for g in standard_module_grants("crm") if g.split(":")[1].split(".",1)[0] == "products"}`.
- user.py: AVAILABLE_APPS without "sales" and "products". get_apps: plain `modules.add(mk)`.
- Mount the sales retired_routes router and rnd tasks router. Remove the sales routers, sales_billing, department_requirements and requirement_discussion. Remove the sales_scheduler job; add the rnd review-reminder job.
- core/features/products.py (S2):
- register_features("crm","products",
  - `_feature("specifications", …, "section", {"view": "view"})`,
  - `_feature("prices", …, "sensitive", {"view": "view"})`,
  - `_feature("pricing", "Pricing", "section", {"view": "view", "create": "create", "edit": "edit", "delete": "delete"}, "Country prices inside a product.")`)
- core/features/rnd.py (S3):
- requirements: remove milestones, milestone_status, departments, discussion, access. history is relabelled "Timeline" (key kept, AC-26). Add `_feature("review", "Review (accept / return to BD)", "action", {"view": "view", "approve": None, "reject": None}, …)`. Relabel documents and technical_offers to upload wording.
- projects: remove milestones and milestone_status.
- Add register_features("rnd","tasks", `_feature("analytics", "All R&D tasks & analytics", "action", {"view": None}, …)`).
- Remove the milestone pickers. Add register_pickers("rnd","tasks", ("assign", …)) or reuse the existing requirement/project pickers (S3 decides; record it).
- core/features/crm.py (S3): inquiries_tenders `_feature("technical_offer", "Technical Offers (BD upload)", "action", {"view": "view", "create": "edit", "delete": "edit"})`. Remove the discussion feature (verify its key).
- Role editor: no Sales module, no products module, CRM shows Products. The memory notes "Products under Sales" (10-19) and the rnd requirement-work notes need updating after release.

## 8. Security and compliance
- IDOR: offer → requirement access; task → parent + scope; document → requirement access; units lookup stays existence-only (no scoped data).
- The analytics and list endpoints apply scope in SQL before aggregating.
- Products scope: removing owner-scope on the product master is a deliberate change (masters are tab-gated, like vendors). Security agent to confirm. The alternative registers under "crm" and copies the 'sales' scope into a new 'crm_products' key (needs a data_scope sub-key, which the data model does not support).
- Uploads: magic-byte check (DOCX zip containing word/document.xml; PDF header), size limit, sanitised filename, existing CRM storage.
- Deny by default: rnd:tasks and the review/analytics features are granted only via M7 or explicit ticks.
- Python 3.12: import every annotated type; ruff F821 --target-version py312.

## 9. Alternatives
- Hard-deleting the Sales models: rejected (FK and NOT NULL dependencies, historic invoices, fresh-install migrations).
- A separate products module: rejected by the owner (Products in CRM).
- Add Unit in PM: rejected by the owner (one project = one machine). Project-level linking reuses the existing order_project_id columns.
- One merged task table: rejected (duplicates extend/approve/sub-task flows; spec §5).
- Copying revision snapshots: rejected (AuditLog snapshots exist).
- Engine-routed accept/return: rejected (spec §3H).

## 10. ADR draft
**Status:** Proposed 2026-10-30.
**Context:** The owner retired Sales and moved project start to PM (one project = one machine, no units, no Finance link at creation). Products moved into CRM. R&D needs a formal intake (ID, revisions, accept/return), upload-only offers (BD too), task analytics and two-value priority. Sales tables are FK targets across Finance, PM, Production, P2P and Store, and are part of the migration chain.
**Decision:**
1. Stage 1 retirement: keep the Sales models plus a read-only legacy helper; remove all else; serve 410 on /sales/*.
2. Products becomes the CRM "Products" tab; Pricing is a feature; grants are aliased and rewritten.
3. Downstream modules link at project level when a project has no units, through so_projects.resolve_link.
4. R&D owns rnd_requirements and rnd_requirement_revisions (with review state), keyed on the CRM (source, record_id).
5. Offers are uploads with an origin column.
6. Tasks stay in two tables with progress_percent; analytics come from one scoped API.
7. Priority is standard/urgent via core/priority.py.
8. One migration.
**Consequences:**
- (+) No data loss, fresh installs work, minimal churn, the core flow stays unbroken without units.
- (−) Dead-weight Sales models; no new SO-driven billing or delivery automations (Stage 2 is pending); the CRM SO freeze is dropped; recorded decisions of 10-08, 10-09, 10-19 and 10-24 are reversed (update memory).
- Follow-ups: move the components/sales shared helpers, Stage 2 billing, table drop after a retention OK.

## 11. Build partition (one owner per file; re-read shared files before editing)
- **Manager:**
- backend/app/main.py (remove lines 22, 363-372, 470, 485, 678-687, 786, 837, 1004-1006; add the rnd tasks router, the sales retired router and the review-reminder job; add model imports for RndRequirement and RndRequirementRevision)
- alembic/env.py (add those 2 imports only)
- core/permission_registry.py, core/audit_registry.py, core/jobs.py, core/sod_rules.py:77-78
- modules/main/models/user.py
- frontend lib/api.ts, types/index.ts, hooks/useAuth.ts, components/Sidebar.tsx
- **S1 database:**
- rnd/models/{requirement.py (new), requirement_work.py, project_task.py, project.py, technical_offer.py, document.py}
- projects/models/{project.py, task.py}
- the priority default/tuple lines in crm/models/{inquiry,tender}.py, design/models/{request,change_notice}.py, electrical/models/job.py, maintenance/models/{request,work_order}.py, production/models/{work_order,rrv_build}.py, p2p/models/p2p_request.py
- the new migration, and the d2f6a9c4e1b7 import guard
- **S2 backend-sales:**
- the §1.3 deletions, sales/legacy.py, sales/retired_routes.py
- crm/services/{stage_guard,quotation_status}.py, crm/settings.py (quotation specs; S3 removes the Discussion specs in the same file → **assign crm/settings.py to S2, and S3 sends S2 the keys to remove**)
- crm/routes/{inquiries,tenders}.py (sales lines + priority lines)
- accounts/services/{billing,credit}.py, accounts/routes/receivables.py, core/features/accounts*.py
- store/routes/material_issues.py, production/service.py, main/routes/analytics.py, core/optimistic_lock.py
- products/routes/*, products/access.py, core/features/products.py
- sales-related tests and seed scripts
- **S3 backend-rnd/crm-intake:**
- rnd/routes/{requirements, requirement_work, requirement_milestones, project_milestones, project_tasks, technical_offers, dashboard, projects, tasks (new)}.py; delete department_requirements.py
- rnd/services/{requirements (new), task_board (new), requirement_access, task_fields, technical_offers, project_origin, events}.py; delete requirement_shares.py if unused
- rnd/tasks/review_reminders.py (new), rnd/scope.py, rnd/schemas/*
- crm/services/requirement_movement.py, crm/routes/workflow.py; delete crm/routes/requirement_discussion.py
- core/events/{rnd,crm}.py, core/features/{rnd,crm}.py, rnd tests
- **S4 frontend-sales + products:** §1.5 (sales catch-all page, deletions, finance/store/bell/dashboard edits, products pages → crm:products, CrmNav Products tab, finance tours).
- **S5 frontend-rnd + CRM panels:**
- app/dashboard/rnd/{page, requirements/page, requirements/[source]/[id]/page, tasks/page, projects/page, projects/[id]/page, projects/new/page}.tsx
- components/rnd/{RndNav, RequirementTasksTab, TasksBoard, RequirementTechnicalOffersTab, RequirementDocumentsTab, ProjectOriginFields, RndProjectHistory}.tsx
- new TaskCreateSheet, RndTaskAnalytics, RequirementReviewBar (ConfirmDialog/PromptDialog), TechnicalOfferUploadSheet
- delete RequirementAccessTab, RequirementDepartmentsTab, RndMilestonePlan, DeptRequirementsList, DeptRequirementDetail, components/crm/{RequirementDiscussionTab, SalesOrderHandoff}.tsx, app/dashboard/{design,electrical,hydraulic}/requirements/**, and the Requirements tab in those navs
- components/crm/{InquiryDetailPanel, TenderDetailPanel}.tsx (no SO handoff or lock banner, no Discussion, R&D ID / revisions / "Returned by R&D: <reason>" + Re-send, BD offer upload/delete, quotation offer label)
- tours rnd*.ts, crmInquiryDetailPage.ts, crmTenderDetail.ts
- Never touch the calculator pages.
- **S6 priority:** core/priority.py and lib/priority.ts (deliver first, with the contract in §5.2), then the priority code in design, electrical, hydraulic, maintenance, production (schemas, routes, explosion, shop_floor, reports, mrp schemas), p2p, projects (schemas, routes/project.py, project_tasks.py, work.py, access.py), erp, crm (schemas, reporting, exports, bulk_import), the frontend priority controls in those modules, components/crm/constants.ts, and the CRM tours not owned by S5. Skip files owned by other slices and list them in the report.
- **S7 PM chooser/form:** projects/all/page.tsx, projects/page.tsx, projects/new/page.tsx, components/projects/CreateProjectChooser.tsx (new), FromSalesOrderSheet.tsx (delete), the CRM-source picker in the PM form (component in components/projects/), projects/[id]/tabs/UnitsTab.tsx, backend projects/routes/project.py (create ignores the budget, accepts source_kind/source_id; S6 must leave priority lines in this file to S7), projects/schemas/project.py (S7; priority lines included), tours projectsAllList/projectsShared/projectsDetail/projectsNewForm.
- **S8 project-level linking:** projects/so_projects.py, projects/routes/units.py, projects/views.py, projects/schemas/units.py, store/services/project_stock.py, store/routes/stock_reservations.py, production/order_project_links.py, production/routes/{rrv_builds,mrp}.py, quality/services/order_project_inspection.py, quality/order_project_links.py, design/order_project_links.py, p2p/order_project_links.py, components/sales/ProjectUnitPicker.tsx, plus tests for AC-61b. Priority lines in these files: S8 applies the S6 contract.

Ordering:
1. S6 contract files and S1 models/migration (local `alembic upgrade head` allowed).
2. The Manager backend registry batch, together with the S2/S3 file deletions in the same step (otherwise the app fails to import).
3. S2, S3, S7 (backend part) and S8 in parallel.
4. Manager api.ts/types from the slices' snippets.
5. S4, S5, S7 (frontend part).
6. QA: one `alembic heads`; `ruff check --select F821 --target-version py312 app alembic`; pytest (rnd, crm, products, projects, store, production, quality, accounts, idor); npm build and `npm run test:ui` = 0; Playwright on localhost (intake accept/return, offer upload, R&D Tasks, PM chooser, project-level issue/reservation/WO, CRM Products tab); CRM tours updated before push.

## 12. verify items and risks
- Prod read-only counts before shipping: live SOs and unbilled milestones; pending sales approvals; users whose only path to a requirement is an access row; distinct priority values per table; maintenance settings value format.
- Column names for the M1 legacy backfill (technical_offer_sent_at, is_deleted) and the approval request table/columns for M8.
- The CRM discussion feature key; the CrmNav file name; the offer upload size limit.
- That Finance can raise an AR invoice by customer for a new project (the Stage 2 gap). Record it in the final report.
- RRV build creation for a unit-less project: confirm Production's UI flow (build per project) with the owner.
- Risk: parallel sessions moving the alembic head or the shared registries. Re-read and re-chain right before the commit.
- Risk: recorded decisions reversed (10-08 per-requirement access, 10-09 department share, 10-13 CRM SO freeze, 10-19 Products under Sales, 10-24 R&D milestones). Update memory after release.

## 13. Open points (owner)
1. Drop the CRM freeze by a historic SO? (default: yes; the delete guard stays)
2. R&D roles view-only on PM All Projects (spec open point 6)?
3. Edit form: keep the Finance budget link on existing projects? (default: keep)
4. Products master without owner data-scope? (default: yes, tab-gated)
5. Optional CRM source link on PM New Project? (default: yes, optional)