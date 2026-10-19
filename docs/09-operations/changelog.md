# ERP-PremnathRail — Changelog

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Operations
**Document:** Changelog
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Living Document

---

# 1. Purpose

This document records significant changes made to ERP-PremnathRail, including user-facing features, fixes, security improvements, integrations, infrastructure changes, and important internal changes.

The changelog is maintained as a **historical record**. Existing entries should not be overwritten when new changes are released.

---

# 2. Change Categories

Changes should be classified as:

| Category       | Purpose                                           |
| -------------- | ------------------------------------------------- |
| Feature        | New functionality                                 |
| Enhancement    | Improvement to existing functionality             |
| Fix            | Correction of defective behavior                  |
| Security       | Security or access-control improvement            |
| Integration    | External-system or API change                     |
| Infrastructure | Deployment, Docker, server, or environment change |
| Database       | Schema or migration change                        |
| UI/UX          | Interface or usability change                     |
| Maintenance    | Dependency, refactoring, or maintenance work      |

---

# 3. User-Facing Changes

## 2026-10-07 — Sales Orders, Maintenance PM & Spares, Module Settings, Guided Tours, Production Fixes

* **Sales (new module, Phase 1 — order book and delivery schedule).** Sales orders can be created from a won CRM inquiry, an awarded tender, or a direct customer PO, with lines, one delivery row per RRV, consignees, a billing plan that must add up to 100%, LD and warranty terms, and the customer PO / LOA attached. Submitting routes the order through Sales Head → Director → Partner by value, and to a Partner for any deviation from standard terms (uncapped or high LD cap, long warranty, low advance); the submitter can never approve, and each level must be a different person. The SO number (`SO/<FY>/<NNNN>`) is issued at confirmation, and confirmation closes the CRM inquiry / tender as ordered. Each vehicle is linked to its RRV build, and its status, committed date, risk (at-risk / overdue) and LD (accrued and forecast — shown, not posted) are derived daily. Customer amendments go through the same approval chain with a field-by-field diff; DP extensions are recorded against the customer's letter, with or without LD. The Order Acknowledgement is a managed Word document. Dashboard, Delivery board and Reports (order book, backlog, LD exposure) are included. CRM inquiry and tender pages show **Create Sales Order** or the linked order.
* **Maintenance Phase 2 and Phase 3 items.** Preventive-maintenance plans with checklists and spares kits, auto-generated PM work orders and overdue reminders; a bill of spares per asset and a Spares page with Raise PR; Reports with MTTR/MTBF and Excel export; Excel import of the machine list; AMC & warranty contract tracking with expiry reminders; QR asset tags with scan-to-report.
* **Module Settings pages.** Sales, Maintenance and HR now have a Settings page where admins (or users explicitly granted `<module>:settings:edit`) change limits, defaults and reminder windows. Every change is audited and can be reset to the default. HR → Settings includes the **sandwich leave rule** (default off).
* **Guided tours across modules.** Step-by-step tours were added or refreshed for CRM, Design, Electrical, ERP, Finance, HR, Hydraulic, Maintenance, Organization, P2P, Production, Project Management, Quality, R&D, Sales and Store pages.
* **Production fixes.** Finished goods received through a Quality final-inspection lot are now reported as work-order output; a workstation under Maintenance is blocked correctly (including records with empty fields); editing a work order keeps its RRV build, machine and priority; a draft work order can't be raised on a closed build; rework records are guarded on delete, cancel and list; RRV build detail endpoints now require the RRV Builds tab permission.

## 2026-09-02 — Item Master Expansion, Back-Button & Layout Consistency, Vendor PAN

* Expanded Item Master with a full create/edit form: Item Type, Description, Stock/Purchase UOM, Item Specification, Manufacturer/Part Number, Make or Buy, Default Warehouse, Minimum/Maximum Stock, GST/Tax, Quality Inspection Required, Batch/Serial Tracking, and Item Status, alongside the existing Item Code/Name/Group/HSN.
* Added an Item Master Edit page and a dropdown filter on the Item Group column.
* Added a full-width inline "New Stock Item" form on the Stock Items page (replacing the separate `/store/new` route).
* Added a PAN field to the Supplier (P2P) and Vendor (Purchase) create/edit forms and detail views.
* Standardized every "Back" button app-wide to the same pill style and position (top-right of the page header), and added missing Back buttons and module navigation bars that were absent on several ERP, CRM, and P2P detail pages.
* Standardized the corner radius on buttons across the application.
* Fixed sidebar, dashboard module cards, and CRM detail-tab visual glitches (color bleed on hover, scrollbar overflow, hover-ring clipping).
* Renamed "Locations" to "Storage Locations" in the Store module.

## 2026-09-01 — P2P Supplier Detail Page & Item Master

* Added a Supplier detail page under P2P Supplier.
* Simplified the P2P navigation bar.
* Fixed invisible input borders across the application.

## 2026-08-05 — CRM Activities: Photos & Fixes

* Added Activity photos through camera capture or drag-and-drop.
* Photos are visible from Organization Activities, Inquiry Activities, and Activities list views.
* Fixed Organization Activities so activities associated with its Inquiries and Tenders are displayed correctly.
* Activity creation now provides a searchable Organization-scoped Inquiry/Tender selection.
* Updated Microsoft Teams permissions to support camera/media capture on mobile and desktop.

## 2026-08-05 — Purchase: Material Remarks & Photos

* Added remarks to Purchase Requisition materials.
* Added material-photo viewing from the Purchase Requisition page.
* CRM Activities gained date, Minutes of Meeting, and contact-linking functionality.

## 2026-08-03 — Feedback

* Added Feedback navigation.
* Users can submit issues and suggestions to administrators.
* Added administrator feedback notifications and review functionality.

## 2026-08-03 — Minutes of Meeting PDF Export & Login Cleanup

* Added PDF export for CRM Inquiry Minutes of Meeting.
* Updated MOM Responsibility to use the BD Owner.
* Simplified the sign-in page.

## 2026-08-02 — Calendar Fix

* Fixed calendar clipping inside scrollable panels.

## 2026-08-02 — CRM Minutes of Meeting

* Added formatted Word export for Minutes of Meeting.
* Organizations can be added or edited from CRM pages.
* Activities display organization and contact context.

## 2026-08-02 — Service Request Email

* Fixed PremnathRail logo rendering in Service Request emails.

## 2026-08-01 — Purchase Improvements

* Added manual Purchase Requisition status override.
* Materials are automatically marked as issued after complete receipt.

---

# 4. Technical and Internal Changes

## 2026-10-07

* **Sales module (Phase 1)** — `backend/app/modules/sales/` (models, service, routes for orders, amendments, schedule / DP extensions, dashboard / reports, lookups, documents, settings; OA report) and `frontend/src/app/dashboard/sales/**`. New tables `sales_orders`, `sales_order_lines`, `sales_order_schedules`, `sales_billing_plan_lines`, `sales_order_amendments`, `sales_delivery_extensions`, `sales_approvals`, `sales_attachments`, and nullable `sales_order_id` / `sales_order_line_id` / `sales_schedule_id` (unique) on `production_rrv_builds` — migration `c5e8a2d4f7b1_add_sales_module_phase1`. Daily job `sales_scheduler` (06:30 IST, `tasks/sales_scheduler.py`). CRM hook `crm/services/won.py → mark_won`. All models registered in `core/audit_registry.py`. Tests `test_sales.py`, `test_sales_crm_handoff.py`, `test_sales_hardening.py`. Documented in `docs/02-modules/sales/overview.md`.
* **Shared settings framework** — `core/settings_framework.py` (`SettingSpec`, `ModuleSettingsDef`, `register_module_settings`, `make_settings_router`): typed values only (no metadata customization), code defaults stay live (a row exists only while a value differs), all-or-nothing validated saves with a per-module cross-field rule, audit on every change / reset, explicit `<module>:settings:edit` grant, optional per-plant values. Table `module_settings` — migration `b3d8f1a6c2e9_module_settings`. Used by Sales, Maintenance, HR and Store; frontend `components/shared/ModuleSettingsPage.tsx`. Tests `test_settings_framework.py`.
* **Store valuation foundation (switched off)** — weighted-average engine `store/services/valuation.py`, called only from `post_stock_transaction()` while the Store setting `valuation_enabled` is on. It ships **off**, with no settings router or UI toggle; with it off the ledger stays quantity-only, exactly as before. It is to be switched on only by the planned cut-over (backfill). Migration `d4a7c9e1f3b6_store_valuation_foundation`. Tests `test_store_valuation.py`.
* **Maintenance Phase 2/3** — PM plans, plan tasks and spares kit (`maintenance_pm_plans`, `…_tasks`, `…_spares`), asset bill of spares, and the PM link on work orders — migration `e7c4a1b9d2f5_maintenance_phase2_pm_spares`. New routes `pm_plans`, `spares`, `reports`, `contracts`, `asset_tags` (QR SVG + lookup by code), asset Excel import / template, Maintenance settings. Jobs `maintenance_pm_scheduler` (06:00 IST) and `maintenance_amc_reminders` (06:15 IST). Tests `test_maintenance_pm.py`, `test_maintenance_spares.py`, `test_maintenance_reports.py`, `test_maintenance_contracts.py`, `test_maintenance_tags.py`.
* **HR** — `hr/settings.py` adds `leave_sandwich_rule` (default off) on the shared framework; `hr/services/leave.py` applies it when counting leave days.
* **Guided tours** — per-module tour bundles in `frontend/src/lib/tour/modules/*.ts` and new / updated page configs in `frontend/src/lib/tour/configs/`, wired through `lib/tour/registry.ts`.
* **Production fixes** — output reporting through the Quality final-inspection lot, workstation / Maintenance block, work-order edit preserving build / machine / priority, draft-WO-on-closed-build guard, rework delete / cancel / list guards, RRV Builds tab permission on build detail endpoints. Tests `test_production_review_fixes.py`, `test_cov_production_bom.py`, `test_cov_production_execution.py`.

## 2026-09-02

* Expanded the `items` table with `item_type`, `description`, `purchase_uom`, `item_specification`, `manufacturer_part_number`, `make_or_buy`, `default_warehouse_id` (FK to `store_locations`), `minimum_stock`, `maximum_stock`, `gst_tax`, `quality_inspection_required`, `batch_serial_tracking`, and `item_status`, with a GET/PUT-by-id route pair added to the `item` module.
* Expanded the `stock_items` table with the same catalog-detail columns (`item_type`, `purchase_uom`, `item_specification`, `manufacturer_part_number`, `make_or_buy`, `default_warehouse_id`, `minimum_stock`, `maximum_stock`, `hsn_sac`, `gst_tax`, `quality_inspection_required`, `batch_serial_tracking`).
* Added a `pan` column to the `vendors` table plus schema/route support.
* Removed the standalone `/dashboard/store/new` route in favor of an inline create form on the Stock Items list page.

## 2026-09-01

* Added the `item` module (central item master: code, name, group, HSN/SAC, unit of measure) with list, create, and bulk-create endpoints.
* Added the `items` table via Alembic migration.
* Added `itemsApi` to the frontend API client.
* Added a Supplier detail route (`p2p/supplier/[id]`).

## 2026-08-06

* Fixed mobile layout overflow.
* Added real camera capture functionality.
* Added responsive mobile text sizing.
* Added CRM Activity attachment backend functionality and tests.

## 2026-08-05

* Simplified Purchase Requisition routes.
* Improved Activity form selection.
* Added Purchase Requisition item remarks/photos.
* Improved CRM Activity MOM functionality.
* Added Service Material attachments.

## 2026-08-03

* Improved notification and permission-check consistency.
* Added Teams notification support.
* Hardened R&D PDF/LaTeX report generation.
* Added LaTeX escaping for user-supplied values.
* Added Feedback backend and frontend functionality.
* Improved CRM organization and inquiry forms.
* Updated the Updates component.

## 2026-08-02 and Earlier

* Fixed date-field calendar clipping.
* Added Word MOM export.
* Added organization creation/editing across CRM.
* Added Activity organization/contact context.
* Fixed Service Request email logo rendering.
* Added Purchase Requisition status override.
* Added automatic material issuance after full receipt.
* Improved Machine Assets natural sorting.
* Improved R&D PDF error handling.
* Added TeX Live to Docker.
* Added Purchase Requisition functionality from Service Request materials.
* Updated Teams app package version.
* Added CRM Activity follow-up reminders.
* Added inline CRM contact creation.
* Hardened authentication and permissions.
* Added Azure AD synchronization functionality.
* Corrected baseline Alembic migration.
* Consolidated deployment into a single Dockerfile.
* Fixed production Next.js Suspense requirements.
* Improved R&D deep links and UI consistency.
* Added production Docker configuration.
* Improved authentication, CORS, CRM, and upload security.
* Established Alembic migrations.
* Extended the User model for remote database compatibility.
* Initial ERP-PremnathRail application infrastructure and documentation established.

---

# 5. Change History Record

Future entries should use the following structure:

```text
Date:
Category:
Title:

Changed:
- 

Reason:
- 

Affected Module:
- 

User Impact:
- 

Technical Impact:
- 

Database Change:
Yes / No

Security Impact:
Yes / No

Migration Required:
Yes / No

Testing Completed:
Yes / No

Related Bug / Requirement:
-

Release / Deployment Reference:
-

Prepared By:
-
```

---

# 6. Changelog Rules

### 6.1 Historical Entries

Once a change has been released and recorded, the historical entry should normally remain unchanged.

If an existing entry contains an error, correct it transparently rather than silently rewriting the history.

### 6.2 New Changes

Every significant released change should receive a new dated entry.

### 6.3 User-Facing Changes

User-visible functionality should also be reflected in the application's user-facing **What's New / Updates** feed where applicable.

### 6.4 Internal Changes

Backend, security, database, deployment, or infrastructure changes that do not require a user-facing announcement may be recorded only in the technical changelog.

### 6.5 Database Changes

Database schema changes should reference the applicable migration.

### 6.6 Security Changes

Security-related changes should identify the affected security area without exposing sensitive implementation details.

---

# 7. Versioning

ERP-PremnathRail currently does not use formal semantic versioning for the main web application.

Therefore, the primary historical identifier is:

**Date + Change Description**

Other independently versioned components, such as the Microsoft Teams application package, may maintain their own version numbers.

---

# 8. Relationship With Other Documents

The changelog records **what changed**.

It should not replace:

* PRD — what should be built
* BRD — business requirements
* Scope — what is included/excluded
* Test Plan — how functionality is tested
* Bug Tracking — defect lifecycle
* UAT — business acceptance
* Architecture — how the system is designed
* Database Documentation — database structure
* Deployment Documentation — how changes reach production

---

# 9. Historical Retention

Previous changelog entries should be retained.

A new release or update should **add a new entry rather than overwrite the previous entry**.

This provides a historical timeline of the application's evolution.

---

# 10. Document Maintenance

This document should be updated when:

* A significant feature is released.
* A major bug is fixed.
* A security change is deployed.
* A database migration is introduced.
* An integration changes.
* Deployment infrastructure changes.
* A significant UI/UX change is released.
* A new Teams application version is published.

Minor internal code changes do not necessarily require a changelog entry.

---

# 11. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 12. Document Information

**Document:** Changelog
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Operations
**Version:** 1.0
**Status:** Living Document
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
