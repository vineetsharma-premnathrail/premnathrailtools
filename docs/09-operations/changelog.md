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
