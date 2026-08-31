# ERP-PremnathRail — Database Indexing Document

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Database
**Document:** Database Indexing
**Backend Location:** `backend/app/modules/*/models/*.py`
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document records the indexes currently defined in the ERP-PremnathRail database.

It documents:

* Unique indexes
* Business-key indexes
* Non-unique indexes
* Indexed foreign keys
* Known indexing gaps
* How indexes are declared
* Relationship with database schema and migrations

The purpose is to provide a factual reference of the current database indexing state.

It does not automatically determine whether the current indexing strategy is optimal. Performance requirements should be evaluated using actual query patterns, table sizes, and database performance measurements.

---

# 2. Indexing Overview

Indexes exist primarily to support:

* Business-key lookups
* Search/autocomplete
* Foreign-key filtering
* User-specific queries
* Parent-child lookups
* Audit filtering
* Notification feeds
* Inventory lookups
* Calculation history

Indexes may be:

* Unique
* Non-unique
* Single-column
* Composite

---

# 3. Unique Business-Key Indexes

The following fields have uniqueness requirements.

| Table                   | Column           | Index / Constraint |
| ----------------------- | ---------------- | ------------------ |
| `users`                 | `email`          | Unique + indexed   |
| `users`                 | `azure_id`       | Unique             |
| `api_keys`              | `key_hash`       | Unique + indexed   |
| `erp_projects`          | `serial_number`  | Unique + indexed   |
| `erp_service_requests`  | `request_number` | Unique + indexed   |
| `purchase_requisitions` | `pr_number`      | Unique + indexed   |
| `p2p_requests`          | `p2p_number`     | Unique index       |
| `crm_organizations`     | `gst_number`     | Unique             |
| `crm_inquiries`         | `universal_id`   | Unique + indexed   |
| `crm_tenders`           | `universal_id`   | Unique + indexed   |

---

# 4. Special Uniqueness Case — Project Attachment Shares

`erp_project_attachment_shares` previously contained a unique constraint on:

```text
attachment_id + user_id
```

The constraint was subsequently removed when department and designation-based sharing was introduced.

This allows the same user to receive access through multiple share records.

For example:

```text
Attachment
   │
   ├── User Share
   │
   └── Department Share
```

The removal of uniqueness is therefore an intentional part of the current sharing model.

---

# 5. Vendor Business Key

The `vendors` table currently does not have a declared unique business key.

Vendor identity is currently matched by name in application logic.

Therefore:

```text
Vendor
   ↓
Name-based identification
```

rather than a database-enforced unique vendor identifier.

---

# 6. ERP Indexes

## `erp_service_requests`

Indexed fields include:

* `project_id`
* `assigned_service_person_id`
* `created_by_id`
* `request_number`

Purpose:

* Service Requests by Project
* Assigned Service Requests
* Records created by a user
* Service Request number lookup

---

## `erp_projects`

Indexed business field:

* `serial_number`

Purpose:

* Unique machine/project identification
* Fast serial-number lookup

---

# 7. Purchase Indexes

## `purchase_requisitions`

Indexed/unique fields include:

* `pr_number`
* `project_id`
* `service_request_id`

Purpose:

* Purchase Requisition lookup
* Project-based filtering
* Service Request-based filtering

These fields represent important connections between ERP Service Requests and Purchase.

---

# 8. CRM Organization Indexes

## `crm_organizations`

Indexed fields include:

* `name`
* `gst_number` — unique

Purpose:

* Organization search
* Autocomplete
* GST-based uniqueness

---

## `crm_org_contacts`

Indexed:

* `org_id`

Purpose:

* Finding contacts belonging to an organization.

---

# 9. CRM Inquiry Indexes

## `crm_inquiries`

Indexed fields:

* `universal_id`
* `org_id`
* `created_by_id`

Purpose:

* Inquiry identification
* Inquiries by organization
* Inquiries created by a user

---

## `crm_inquiry_tasks`

Indexed:

* `inquiry_id`

Purpose:

* Finding tasks associated with an Inquiry.

---

## `crm_inquiry_approvals`

Indexed:

* `inquiry_id`

Purpose:

* Finding approvals associated with an Inquiry.

---

## `crm_quotations`

Indexed:

* `inquiry_id`

Purpose:

* Finding quotations associated with an Inquiry.

---

# 10. CRM Tender Indexes

## `crm_tenders`

Indexed:

* `universal_id`
* `org_id`
* `tender_number`
* `created_by_id`

Purpose:

* Tender identification
* Organization filtering
* Tender-number lookup
* User-specific tender queries

---

## `crm_tender_tasks`

Indexed:

* `tender_id`

Purpose:

* Finding tasks associated with a Tender.

---

## `crm_tender_competitors`

Indexed:

* `tender_id`

Purpose:

* Finding competitors associated with a Tender.

---

# 11. CRM Purchase Order Indexes

## `crm_purchase_orders`

Indexed:

* `inquiry_id`
* `tender_id`
* `org_id`

Purpose:

* Inquiry-based filtering
* Tender-based filtering
* Organization-based filtering

---

# 12. CRM Shared Entity Indexes

## `crm_activities`

Indexed:

* `org_id`
* `created_by_id`

Purpose:

* Organization filtering
* User-specific activity queries

---

## `crm_activity_attachments`

Indexed:

* `activity_id`

Purpose:

* Finding attachments belonging to an activity.

---

## `crm_notes`

Indexed:

* `org_id`
* `created_by_id`

Purpose:

* Organization filtering
* User-specific note queries

---

## `crm_documents`

Indexed:

* `related_id`

---

## `crm_discussions`

Indexed:

* `related_id`

---

## `crm_stage_logs`

Indexed:

* `related_id`

These three entities use polymorphic references.

---

# 13. Platform Indexes

## `feedback`

Indexed:

* `user_id`

Purpose:

* User-specific feedback queries
* Administrative feedback filtering

---

## `notifications`

Indexed:

* `user_id`

Purpose:

* Per-user notification feed

---

## `audit_logs`

Indexed:

* `entity_type`

Purpose:

* Filtering the audit trail by entity type.

---

# 14. R&D Indexes

## `rnd_calculation_history`

Indexed:

* `user_id`
* `tool_name`

Purpose:

* User's saved calculations
* Filtering calculations by tool

---

## R&D Calculation Tables

The R&D calculation tables are indexed by:

* `user_id`

This supports user-specific saved-calculation queries.

---

## `rnd_spline_calculations`

Additional indexed field:

* `doc_no`

This is the only individual R&D calculation table currently identified with an indexed business field beyond `user_id`.

---

# 15. Store Indexes

Store-related tables include indexes around item and location relationships.

Relevant tables:

```text
stock_items
store_locations
stock_balances
stock_transactions
```

These indexes support:

* Item-scoped lookups
* Location-scoped lookups
* Stock balance queries
* Inventory transaction queries

---

# 16. P2P Indexes

## `p2p_requests`

Indexed/unique:

* `p2p_number`

The unique index was explicitly created when the table was renamed from `pr_requests`.

The business key provides direct P2P Request identification.

---

# 17. Areas Where Indexing Is Thin

The current database contains several areas where indexes are not consistently present.

These are documented as **observed gaps**, not automatically classified as defects.

---

## 17.1 Polymorphic References

Several CRM tables index:

```text
related_id
```

but do not index:

```text
related_module
```

Affected areas include:

* `crm_activities`
* `crm_notes`
* `crm_documents`
* `crm_discussions`
* `crm_stage_logs`

The actual filtering pattern may involve both:

```text
related_module
+
related_id
```

The current implementation therefore does not have a composite index covering both values.

---

## 17.2 Service Material Foreign Key

`erp_service_materials.service_request_id` does not currently have an explicit index.

It is a required relationship used to retrieve materials for a Service Request.

The current database therefore does not automatically provide an index simply because the field is a foreign key.

---

## 17.3 Project Attachment Foreign Key

`erp_project_attachments.project_id` does not currently have an explicit index.

This is another parent-child relationship where indexing is not automatically provided by PostgreSQL.

---

## 17.4 Child Table Foreign Keys

Several child-table foreign keys are not explicitly indexed.

Examples include:

```text
purchase_requisition_items.purchase_requisition_id
purchase_requisition_items.service_material_id

p2p_request_items.p2p_request_id

p2p_request_attachments.p2p_request_id
p2p_request_attachments.item_id

erp_service_request_attachments.service_request_id

erp_service_material_attachments.service_material_id
```

Other structurally similar child relationships, such as:

```text
crm_activity_attachments.activity_id
```

are indexed.

The current implementation therefore does not apply one completely uniform indexing rule across all child tables.

---

# 18. User Reference Indexing

Many fields referencing users are not explicitly indexed.

Examples include:

* `created_by_id`
* `performed_by_id`
* `assigned_*_id`

These occur across several modules.

Some are also not backed by database-level foreign-key constraints.

This means user-specific filtering on some tables may require broader database scans as data volume increases.

---

# 19. PostgreSQL Foreign-Key Consideration

PostgreSQL does not automatically create an index on the referencing side of a foreign key.

Therefore:

```text
Foreign Key
     ≠
Automatic Index
```

A foreign-key column requires an explicit index when query patterns benefit from one.

This is particularly relevant for:

* Parent-child lists
* Joins
* Filtered relationships
* Delete/update operations involving related records

---

# 20. How Indexes Are Declared

The current codebase primarily declares indexes directly on model columns.

Typical declaration:

```text
index=True
```

Unique business keys may use:

```text
unique=True
```

Explicit migration-level index creation may use:

```text
op.create_index(...)
```

The source review found no standalone `sa.Index(...)` declarations in model files.

---

# 21. Model-Level Indexing

The primary model-level pattern is:

```text
Column
  ├── index=True
  └── unique=True
```

This keeps index declarations close to the corresponding model field.

---

# 22. Migration-Level Indexing

Migration files may explicitly create indexes when an index is added to an existing structure.

Example conceptually:

```text
Migration
   ↓
Create Index
   ↓
Existing Table
```

The migration history should remain the authoritative record of when a database index was introduced or removed.

---

# 23. Index Naming and Traceability

Where indexes or constraints are explicitly named, their names should remain stable and traceable through migrations.

Example:

```text
uq_project_attachment_share
```

When an index or constraint is intentionally removed, the migration should document that removal.

---

# 24. Index Maintenance

Indexes should be reviewed when:

* A new high-volume query is introduced.
* A major module is added.
* A new foreign-key relationship is introduced.
* Search patterns change.
* Large data growth occurs.
* Query performance degrades.
* A major schema change occurs.

Index changes should be based on actual application query patterns and database behavior.

---

# 25. What This Document Does Not Define

This document does not define:

* Complete table schemas
* Column data types
* Foreign-key cardinalities
* Migration implementation details
* Query execution plans
* Performance benchmarks
* Database tuning configuration

Those belong in separate database documentation.

---

# 26. Related Database Documents

```text
database/
├── database-design.md
├── schema.md
├── relationships.md
├── indexes.md
└── migrations.md
```

### `database-design.md`

High-level database architecture and entity relationships.

### `schema.md`

Complete table and column reference.

### `relationships.md`

Foreign-key relationships, cardinality, nullability and cascade behavior.

### `indexes.md`

Current indexing structure and indexing gaps.

### `migrations.md`

Database schema evolution history.

---

# 27. Index Change Management

This document should be updated when:

* An index is added.
* An index is removed.
* A unique constraint changes.
* A composite index is introduced.
* A major indexing strategy changes.

Minor database operations that do not change indexing do not require a document revision.

---

# 28. Version Control

```text
v1.0
Initial database indexing baseline

v1.1
Index additions/removals

v1.2
Additional module indexing

v2.0
Major database indexing redesign
```

Previous approved versions should be retained.

Migration files should also remain permanently available for technical traceability.

---

# 29. Current Status

**Database Indexing:** Documented
**Database:** PostgreSQL
**Scope:** Current application database
**Status:** Current baseline

The document describes the indexing state identified during the source review and should be updated as the database evolves.

---

# 30. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 31. Document Information

**Document:** Database Indexing Document
**Project:** ERP-PremnathRail
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Organization:** PremnathRail
**Date:** 31 August 2026
