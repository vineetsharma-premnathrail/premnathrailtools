# ERP-PremnathRail — Database Schema Reference

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Database
**Document:** Database Schema Reference
**Backend Location:** `backend/app/modules/*/models/*.py`
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document provides the column-level reference for the ERP-PremnathRail database.

It describes:

* Database tables
* Columns
* Data types
* Nullability
* Defaults
* Primary keys
* Foreign keys
* Business purpose
* Module ownership
* Important schema behavior

The schema reference represents the database structure currently implemented in the application.

---

# 2. Schema Source of Truth

The schema is derived from:

```text
backend/app/modules/*/models/*.py
```

and cross-checked against:

```text
backend/alembic/versions/
```

The model files describe the application-level database structure, while Alembic migrations describe how that structure has evolved.

---

# 3. Common Database Mixins

Two common mixins are used across the application.

## 3.1 TimestampMixin

Adds:

```text
created_at
updated_at
```

Both use:

```text
DateTime(timezone=True)
```

`created_at` receives a server-side `now()` default.

`updated_at` is refreshed when the record is updated.

---

## 3.2 SoftDeleteMixin

Adds:

```text
is_deleted
deleted_at
```

Typical behavior:

```text
is_deleted = False
deleted_at = NULL
```

When a business record is deleted:

```text
is_deleted = True
deleted_at = timestamp
```

This supports the application's Recycle Bin behavior without physically deleting most business records.

---

# 4. Current Database Size

The current schema contains:

**55 tables across 10 modules.**

Modules containing database tables:

1. Main
2. ERP
3. CRM
4. Purchase
5. P2P
6. R&D
7. Design
8. Electrical
9. Store
10. Vendor

Two additional module directories currently do not define their own database models:

* HR
* Service

---

# 5. Module Summary

| Module     | Tables | Primary Purpose                                                   |
| ---------- | -----: | ----------------------------------------------------------------- |
| Main       |      6 | Identity, authorization, audit, notifications, feedback, API keys |
| ERP        |      7 | Projects, machines, service requests and materials                |
| CRM        |     18 | Organizations, inquiries, tenders, quotations and CRM activities  |
| Purchase   |      2 | ERP-origin purchase requisitions                                  |
| P2P        |      7 | Standalone procurement requests, RFQs and P2P purchase orders     |
| R&D        |      8 | Engineering calculations and calculation history                  |
| Design     |      1 | Engineering document register                                     |
| Electrical |      1 | Electrical work orders                                            |
| Store      |      4 | Stock items, locations, balances and transactions                 |
| Vendor     |      1 | Vendor master                                                     |

---

# 6. Main Module

**Location:**

```text
backend/app/modules/main/models/
```

The Main module provides the application's common infrastructure.

---

## 6.1 `users`

The central identity and authorization table.

Authentication is based on Microsoft SSO.

| Column                          | Type       | Nullable | Default | Purpose                        |
| ------------------------------- | ---------- | -------- | ------- | ------------------------------ |
| `id`                            | Integer PK | No       | Auto    | User identifier                |
| `email`                         | String     | No       | —       | Unique login identity          |
| `name`                          | String     | No       | —       | Display name                   |
| `azure_id`                      | String     | Yes      | —       | Microsoft SSO subject ID       |
| `role`                          | String     | No       | `user`  | Application role               |
| `is_active`                     | Boolean    | No       | `True`  | Account activation             |
| `designation`                   | String     | Yes      | —       | Job title                      |
| `department`                    | String     | Yes      | —       | Department                     |
| `phone`                         | String     | Yes      | —       | Contact number                 |
| `assigned_apps`                 | JSON       | No       | `[]`    | Module access                  |
| `erp_permissions`               | JSON       | No       | `[]`    | ERP permission flags           |
| `is_azure_admin`                | Boolean    | No       | `False` | Azure tenant-admin flag        |
| `hashed_password`               | String     | Yes      | —       | Dormant local-auth field       |
| `azure_display_name`            | String     | Yes      | —       | Cached Microsoft display name  |
| `profile_photo_url`             | String     | Yes      | —       | Cached profile photo           |
| `must_change_password`          | Boolean    | No       | `False` | Dormant local-auth field       |
| `dismissed_announcements`       | JSON       | No       | `[]`    | Announcement tracking          |
| `encrypted_graph_refresh_token` | String     | Yes      | —       | Stored token field             |
| `service_permissions`           | JSON       | Yes      | —       | Service permissions            |
| `is_department_head`            | Boolean    | Yes      | —       | Department-head routing        |
| `project_plant_head`            | String     | Yes      | —       | Approval routing               |
| HR profile fields               | Mixed      | Yes      | —       | HR-related profile information |

---

## 6.2 `audit_logs`

Generic audit trail for application activity.

| Column            | Type        | Nullable | Purpose                   |
| ----------------- | ----------- | -------- | ------------------------- |
| `id`              | Integer PK  | No       | Record ID                 |
| `entity_type`     | String(100) | No       | Target entity type        |
| `entity_id`       | Integer     | Yes      | Target entity ID          |
| `action`          | String(50)  | No       | Action performed          |
| `field_name`      | String(100) | Yes      | Changed field             |
| `old_value`       | Text        | Yes      | Previous value            |
| `new_value`       | Text        | Yes      | New value                 |
| `summary`         | Text        | Yes      | Human-readable summary    |
| `performed_by_id` | Integer     | Yes      | User who performed action |
| `performed_at`    | DateTime    | No       | Action timestamp          |

---

## 6.3 `notifications`

Stores in-app notifications for users.

Important fields:

* `user_id`
* `title`
* `message`
* `notification_type`
* `entity_type`
* `entity_id`
* `is_read`
* `read_at`
* `created_at`

---

## 6.4 `feedback`

Stores user feedback and suggestions.

Important fields:

* `user_id`
* `message`
* `is_read`
* `read_at`
* `created_at`

---

## 6.5 `api_keys`

Stores credentials used by external systems.

Only the hashed API key is stored.

Important fields:

* `name`
* `key_hash`
* `prefix`
* `allowed_apps`
* `is_active`
* `created_by_id`
* `last_used_at`
* `created_at`

---

## 6.6 `modules`

Database-backed application module registry.

Used to maintain the available application modules and drive module-access configuration.

Current module concepts include:

```text
ERP
CRM
Purchase
P2P
R&D
Design
Electrical
HR
Store
Vendor
```

---

# 7. ERP Module

**Location:**

```text
backend/app/modules/erp/models/
```

The ERP module manages deployed machines/projects and their service operations.

---

## 7.1 `erp_projects`

Represents a deployed machine, vehicle or asset.

Important fields include:

```text
machine_type
model_name
serial_number
engine_number
chassis_number
application_type
status
po_number
po_date
delivery_date
commissioning_date
handover_date
client_company
client_name
client_designation
client_email
client_phone
client_address
client_gst
site_name
site_location
site_state
site_pincode
site_country
zone
is_export
warranty_start_date
warranty_end_date
extended_warranty
extended_warranty_end
amc_status
amc_end_date
operator_name
operator_phone
operator_email
operator_qualification
specifications
installed_options
software_version
year_of_manufacture
notes
tech_notes
warranty_terms
```

`serial_number` is the unique machine identity.

Mixins:

* TimestampMixin
* SoftDeleteMixin

---

## 7.2 `erp_project_attachments`

Stores file metadata associated with a Project.

The actual file is stored externally through SharePoint.

Important fields:

* `project_id`
* `filename`
* `content_type`
* `size`
* `sharepoint_path`
* `sharepoint_url`
* `created_by_id`
* `is_private`

---

## 7.3 `erp_project_attachment_shares`

Controls access to private project attachments.

A share can target:

* User
* Department
* Designation

Important fields:

* `attachment_id`
* `user_id`
* `department`
* `designation`

The rule that exactly one target type is selected is enforced by application logic.

---

## 7.4 `erp_service_requests`

Central service-ticket table.

Important fields include:

```text
request_number
project_id
issue_title
issue_description
issue_category
sub_category
status
priority
root_cause
failure_mode
warranty_status
warranty_claim_number
warranty_claim_status
warranty_approved_amount
assigned_service_person_id
assigned_to_name
created_by_id
opened_at
closed_at
expected_date_to_attend
expected_completion_date
actual_date_attended
actual_completion_date
actual_service_duration_hours
downtime_hours
resolution_description
service_report_notes
preventive_actions
customer_feedback
customer_satisfaction
customer_sign_off_name
customer_sign_off_date
service_cost
transport_cost
accommodation_cost
miscellaneous_cost
total_material_cost
tax_percentage
tax_amount
total_bill
payment_status
invoice_number
```

Mixins:

* TimestampMixin
* SoftDeleteMixin

---

## 7.5 `erp_service_materials`

Stores spare parts/material requirements for Service Requests.

Important fields:

* `service_request_id`
* `material_name`
* `part_number`
* `model_number`
* `description`
* `estimated_budget`
* `reason`
* `quantity`
* `unit`
* `is_warranty_covered`
* `phase`
* `status`
* `pr_id`
* `pr_number`
* `pr_status`
* `received_quantity`
* `receiving_status`

This table provides the connection between ERP Service and Purchase.

---

## 7.6 `erp_service_material_attachments`

Stores attachment metadata for Service Materials.

Important fields:

* `service_material_id`
* `filename`
* `content_type`
* `size`
* `sharepoint_path`
* `sharepoint_url`
* `created_by_id`

---

## 7.7 `erp_service_request_attachments`

Stores file metadata attached to Service Requests.

The attachment references the corresponding Service Request.

---

# 8. CRM Module

**Location:**

```text
backend/app/modules/crm/models/
```

The CRM module contains 18 tables.

| Table                      | Purpose                         |
| -------------------------- | ------------------------------- |
| `crm_organizations`        | Customer/prospect organizations |
| `crm_org_contacts`         | Organization contacts           |
| `crm_inquiries`            | Sales inquiries                 |
| `crm_inquiry_tasks`        | Inquiry tasks                   |
| `crm_inquiry_approvals`    | Inquiry approvals               |
| `crm_quotations`           | Quotations                      |
| `crm_quotation_line_items` | Quotation line items            |
| `crm_tenders`              | Tender opportunities            |
| `crm_tender_tasks`         | Tender tasks                    |
| `crm_tender_competitors`   | Tender competitors              |
| `crm_purchase_orders`      | Sales-side purchase orders      |
| `crm_activities`           | CRM activities and visits       |
| `crm_activity_attachments` | Activity attachments            |
| `crm_notes`                | CRM notes                       |
| `crm_documents`            | CRM documents                   |
| `crm_discussions`          | CRM discussions                 |
| `crm_stage_logs`           | CRM stage history               |
| `crm_products`             | Product master                  |
| `crm_payment_terms`        | Payment-term master             |

---

# 9. CRM Organizations

## `crm_organizations`

Stores customer/prospect organization information.

Typical information includes:

* Organization name
* Organization type
* Railway zone/division
* Address
* GST number
* Contact information

Mixins:

* TimestampMixin
* SoftDeleteMixin

---

# 10. CRM Contacts

## `crm_org_contacts`

Stores individual contacts associated with organizations.

Typical information:

* Name
* Designation
* Mobile
* Email
* Department
* Organization

---

# 11. CRM Inquiry

## `crm_inquiries`

Stores sales inquiries.

Major concepts:

* Organization
* Universal ID
* Pipeline stage
* Status
* Product
* Quantity
* Budget
* Follow-up scheduling
* Creation information

Mixins:

* TimestampMixin
* SoftDeleteMixin

---

# 12. CRM Inquiry Supporting Tables

### `crm_inquiry_tasks`

Tracks tasks associated with an Inquiry.

### `crm_inquiry_approvals`

Tracks Inquiry approval records.

### `crm_quotations`

Stores quotations issued against an Inquiry.

### `crm_quotation_line_items`

Stores itemized quotation details, including GST-related line-item information.

---

# 13. CRM Tender

## `crm_tenders`

Stores tender/bid opportunities.

Tracks:

* Tender calendar
* Publication
* Submission
* Technical opening
* Financial opening
* Award outcome
* Competitor decision

Mixins:

* TimestampMixin
* SoftDeleteMixin

---

# 14. CRM Tender Supporting Tables

### `crm_tender_tasks`

Tasks associated with Tenders.

### `crm_tender_competitors`

Competitors associated with Tenders.

---

# 15. CRM Purchase Orders

## `crm_purchase_orders`

Represents sales-side purchase orders.

A Purchase Order:

* Always belongs to an Organization.
* May reference an Inquiry.
* May reference a Tender.
* May exist without either.

---

# 16. CRM Shared Activity System

The following tables provide reusable CRM functionality:

```text
crm_activities
crm_activity_attachments
crm_notes
crm_documents
crm_discussions
crm_stage_logs
```

Several of these use:

```text
related_module
related_id
```

for polymorphic entity association.

The database does not enforce these polymorphic relationships through foreign keys.

---

# 17. CRM Product and Payment Masters

## `crm_products`

Standardized CRM product master.

## `crm_payment_terms`

Standardized payment-term master.

These support consistent product and payment-term selection in CRM workflows.

---

# 18. Purchase Module

**Location:**

```text
backend/app/modules/purchase/models/
```

The Purchase module contains two tables.

---

## 18.1 `purchase_requisitions`

Represents a Purchase Requisition raised from an ERP Service Request's Materials tab.

Important fields:

```text
pr_number
project_id
service_request_id
status
raised_by_id
priority
required_by_date
purchase_reason
category_code
requirement_type
approver_id
approver_name
vendor
po_number
po_date
expected_delivery_date
notes
approved_by_id
approved_at
closed_by_id
closed_at
```

---

## 18.2 `purchase_requisition_items`

Stores material lines within a Purchase Requisition.

Important fields:

* `purchase_requisition_id`
* `service_material_id`
* `material_name`
* `part_number`
* `unit`
* `quantity_requested`
* `quantity_received`
* `item_status`
* `remarks`

The item is snapshotted from the originating Service Material.

---

# 19. P2P Module

**Location:**

```text
backend/app/modules/p2p/models/
```

The P2P module provides standalone department-raised procurement.

Tables:

```text
p2p_requests
p2p_request_items
p2p_request_attachments
rfqs
rfq_attachments
p2p_purchase_orders
p2p_purchase_order_items
```

---

# 20. `p2p_requests`

Standalone procurement request.

It is independent from:

```text
purchase_requisitions
```

Important fields include:

* `p2p_number`
* `category_code`
* `project_label`
* `assigned_buyer_id`
* `vendor`
* `rfq_number`
* `quotation`
* `vendor_comparison`
* `selected_vendor`
* Approval information
* Approval comments
* Multi-head approval routing information

`p2p_number` is unique and indexed.

---

# 21. P2P Request Items

## `p2p_request_items`

Stores individual requested items.

Includes:

* Item/part information
* Estimated budget
* Reason
* Quantity
* Nullable Store `stock_item_id`

The Store reference allows a P2P request item to connect to the central Store item master.

---

# 22. P2P Attachments

## `p2p_request_attachments`

Stores files attached to P2P Requests.

An attachment may optionally be scoped to an individual request item.

`doc_type` distinguishes:

```text
supporting
specification
po_document
```

---

# 23. RFQ

## `rfqs`

Stores Requests for Quotation associated with P2P Requests.

## `rfq_attachments`

Stores RFQ attachments.

These support the vendor quotation and comparison stage before Purchase Order issuance.

---

# 24. P2P Purchase Orders

## `p2p_purchase_orders`

Formal Purchase Orders issued from approved P2P Requests.

This PO is distinct from:

```text
crm_purchase_orders
purchase_requisitions.po_number
```

---

## `p2p_purchase_order_items`

Stores individual PO line items.

---

# 25. R&D Module

**Location:**

```text
backend/app/modules/rnd/models/
```

The R&D module contains eight tables.

---

## 25.1 `rnd_calculation_history`

Cross-tool calculation save/history table.

Stores:

* `user_id`
* `tool_name`
* `calculation_name`
* `inputs_json`
* `results_json`
* `created_at`

---

# 26. R&D Calculation Tables

The following snapshot tables exist:

```text
rnd_braking_calculations
rnd_hydraulic_calculations
rnd_load_distribution_calculations
rnd_qmax_calculations
rnd_spline_calculations
rnd_tractive_effort_calculations
rnd_vehicle_performance_calculations
```

They store structured calculation inputs and outputs alongside JSON snapshots.

---

# 27. R&D Tool-Specific Fields

| Table                                  | Main Calculation Fields                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------------------------- |
| `rnd_braking_calculations`             | mass, reaction time, wheels, mode, friction, speed, gradient, braking force                   |
| `rnd_hydraulic_calculations`           | mode, weight, axles, speed, pressure, wheel diameter, slope, motor/pump sizing                |
| `rnd_load_distribution_calculations`   | configuration, load, front percentage, Q1/Q3 percentages, delta ratio, status                 |
| `rnd_qmax_calculations`                | diameter, bending stress, head velocity, Qmax                                                 |
| `rnd_spline_calculations`              | document number, teeth, pitch, pressure angle, diameters, engagement, material, safety factor |
| `rnd_tractive_effort_calculations`     | mode, load, locomotive weight, speed, gradient, curvature, traction effort, power             |
| `rnd_vehicle_performance_calculations` | GVW, speed, axles, axle ratio, shunting load, power, traction values                          |

The R&D module is currently isolated from the other modules at database foreign-key level.

---

# 28. Design Module

## `engineering_documents`

**Location:**

```text
backend/app/modules/design/models/
```

Stores engineering document-control information.

Typical concepts:

* Document number
* Revision
* Engineering document metadata
* SharePoint pointer

---

# 29. Electrical Module

## `electrical_work_orders`

**Location:**

```text
backend/app/modules/electrical/models/
```

Stores Electrical work orders.

Tracks:

* Assignment
* Status
* Completion
* Electrical work information

---

# 30. Store Module

**Location:**

```text
backend/app/modules/store/models/
```

Tables:

```text
stock_items
store_locations
stock_balances
stock_transactions
```

---

# 31. Store Item Master

## `stock_items`

Central item master for Store.

Used to identify inventory items consistently.

P2P request items may reference this table.

---

# 32. Store Locations

## `store_locations`

Represents physical or logical storage locations.

---

# 33. Stock Balances

## `stock_balances`

Stores current on-hand quantity for an item at a location.

Conceptually:

```text
Item + Location → Current Balance
```

---

# 34. Stock Transactions

## `stock_transactions`

Append-only inventory ledger.

Records:

* Receipts
* Issues
* Adjustments

Current stock balances are derived from the transaction history at application level.

---

# 35. Vendor Module

## `vendors`

**Location:**

```text
backend/app/modules/vendor/models/
```

Stores vendor master information.

Typical information:

* Vendor name
* Contact details
* Category

The Vendor table exists as the central vendor master, while some existing Purchase/P2P vendor fields remain free-text.

---

# 36. HR Module

The HR module directory exists:

```text
backend/app/modules/hr/
```

but currently does not contain its own database model.

HR-related fields currently exist directly in the `users` table.

Examples include:

* HR profile information
* Department-head status
* Project/plant-head information

A dedicated HR schema may be introduced later if required.

---

# 37. Service Module

The Service module directory exists:

```text
backend/app/modules/service/
```

but currently does not contain independent database models.

Service functionality currently resides under:

```text
backend/app/modules/erp/
```

Relevant tables are:

```text
erp_service_requests
erp_service_materials
erp_service_request_attachments
erp_service_material_attachments
```

A separate Service module should be documented if one is introduced later.

---

# 38. Database Design Characteristics

The current database contains several design patterns:

### Central identity

```text
users
```

provides the primary application identity record.

### Module separation

Business data is separated into module-owned tables.

### Parent-child structures

Examples:

```text
Project
 └── Service Requests
      └── Service Materials
```

and:

```text
P2P Request
 ├── Items
 ├── Attachments
 ├── RFQs
 └── Purchase Orders
```

### Polymorphic associations

CRM shared functionality uses:

```text
related_module
related_id
```

### External document storage

Files are represented through metadata and SharePoint pointers rather than storing file binaries directly in the database.

---

# 39. Data Lifecycle

Business records may use SoftDeleteMixin.

Conceptually:

```text
Active Record
     ↓
Soft Delete
     ↓
Recycle Bin
     ↓
Restore / Permanent Cleanup
```

The exact lifecycle is determined by the relevant application module.

---

# 40. Schema Change Management

The database schema changes through controlled migrations.

Schema changes include:

* New table
* New column
* Removed column
* Column modification
* New foreign key
* Removed foreign key
* New index
* Removed index
* Constraint changes

Every structural change should have a corresponding migration.

---

# 41. Historical Schema Tracking

Previous schema documentation should be retained for historical reference.

However, the current schema document should describe the currently implemented database.

Historical information should not be confused with the active schema.

---

# 42. Related Database Documents

```text
database/
├── schema.md
├── relationships.md
├── indexes.md
├── migrations.md
└── er-diagram.md
```

### `schema.md`

Column-level database reference.

### `relationships.md`

Foreign-key relationships, cardinality and cascade behavior.

### `indexes.md`

Database indexes and indexing behavior.

### `migrations.md`

Database evolution history.

### `er-diagram.md`

Visual/narrative representation of database relationships.

---

# 43. Document Update Rules

Update this document when:

* A table is created.
* A table is removed.
* A column is added.
* A column is removed.
* A column's type changes.
* Nullability changes.
* Default behavior changes.
* A major schema structure changes.

Minor application-code changes that do not affect the database schema do not require a schema-document update.

---

# 44. Version Control

```text
v1.0
Current schema baseline

v1.1
Minor schema changes

v1.2
Additional module/schema changes

v2.0
Major database architecture/schema revision
```

Previous approved versions should remain available for technical and historical traceability.

---

# 45. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 46. Document Information

**Document:** Database Schema Reference
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
