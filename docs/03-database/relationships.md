# ERP-PremnathRail — Database Relationships Document

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Database
**Document:** Database Relationships
**Backend Location:** `backend/app/modules/*/models/*.py`
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document defines the database relationships used by ERP-PremnathRail.

It records:

* Foreign-key relationships
* Parent-child relationships
* Cardinality
* Nullable relationships
* ORM cascade behavior
* Database-level cascade behavior
* Cross-module relationships
* Polymorphic relationships
* Relationships intentionally not enforced by foreign keys

This document should be used together with the Database Schema and Database Indexing documents.

---

# 2. Relationship Model

The database uses several relationship patterns:

```text
1 — N
One parent → many children

N — 1
Many records → one parent

Optional relationship
Nullable foreign key

Polymorphic relationship
Application-level reference without FK
```

---

# 3. ERP Module Relationships

## 3.1 Project → Service Requests

```text
erp_projects
      │
      └── 1 : N
            ↓
erp_service_requests
```

**Foreign Key:** `service_requests.project_id`

Properties:

* Non-nullable
* Indexed
* Foreign key
* ORM `delete-orphan` cascade

Deleting a Project deletes its associated Service Requests through the configured ORM relationship.

---

## 3.2 Project → Project Attachments

```text
erp_projects
      │
      └── 1 : N
            ↓
erp_project_attachments
```

**Foreign Key:** `project_id`

Properties:

* Non-nullable
* `delete-orphan` cascade

---

## 3.3 Project Attachment → Shares

```text
erp_project_attachments
          │
          └── 1 : N
                ↓
erp_project_attachment_shares
```

**Foreign Key:** `attachment_id`

Properties:

* Non-nullable
* ORM `delete-orphan`
* Database `ON DELETE CASCADE`

Both ORM and database-level deletion behavior are therefore defined.

---

## 3.4 User → Attachment Shares

```text
users
  │
  └── 1 : N
        ↓
erp_project_attachment_shares
```

**Foreign Key:** `user_id`

Properties:

* Nullable
* `ON DELETE CASCADE`

The relationship is optional because an attachment share may target:

* A specific user
* A department
* A designation

Department and designation are currently stored as strings and are matched against the user's current organizational attributes.

---

## 3.5 Service Request → Service Materials

```text
erp_service_requests
          │
          └── 1 : N
                ↓
erp_service_materials
```

**Foreign Key:** `service_request_id`

Properties:

* Non-nullable
* `delete-orphan`

---

## 3.6 Service Request → Attachments

```text
erp_service_requests
          │
          └── 1 : N
                ↓
erp_service_request_attachments
```

**Foreign Key:** `service_request_id`

Properties:

* Non-nullable
* `delete-orphan`

---

## 3.7 Service Material → Attachments

```text
erp_service_materials
          │
          └── 1 : N
                ↓
erp_service_material_attachments
```

**Foreign Key:** `service_material_id`

Properties:

* Non-nullable
* `delete-orphan`

---

# 4. CRM Module Relationships

## 4.1 Organization → Contacts

```text
crm_organizations
       │
       └── 1 : N
             ↓
crm_org_contacts
```

**Foreign Key:** `org_id`

Properties:

* Non-nullable
* `delete-orphan`

---

## 4.2 Organization → Inquiries

```text
crm_organizations
       │
       └── 1 : N
             ↓
crm_inquiries
```

**Foreign Key:** `org_id`

Properties:

* Non-nullable
* Indexed
* No delete cascade declared

---

## 4.3 Organization → Tenders

```text
crm_organizations
       │
       └── 1 : N
             ↓
crm_tenders
```

**Foreign Key:** `org_id`

Properties:

* Non-nullable
* Indexed
* No delete cascade declared

---

## 4.4 Inquiry → Tasks

```text
crm_inquiries
      │
      └── 1 : N
            ↓
crm_inquiry_tasks
```

**Foreign Key:** `inquiry_id`

Properties:

* Non-nullable
* `delete-orphan`

---

## 4.5 Inquiry → Approvals

```text
crm_inquiries
      │
      └── 1 : N
            ↓
crm_inquiry_approvals
```

**Foreign Key:** `inquiry_id`

Properties:

* Non-nullable
* `delete-orphan`

---

## 4.6 Inquiry → Quotations

```text
crm_inquiries
      │
      └── 1 : N
            ↓
crm_quotations
```

**Foreign Key:** `inquiry_id`

Properties:

* Non-nullable
* `delete-orphan`

---

## 4.7 Quotation → Line Items

```text
crm_quotations
      │
      └── 1 : N
            ↓
crm_quotation_line_items
```

**Foreign Key:** `quotation_id`

Properties:

* Non-nullable
* `delete-orphan`

---

## 4.8 Tender → Tasks

```text
crm_tenders
      │
      └── 1 : N
            ↓
crm_tender_tasks
```

**Foreign Key:** `tender_id`

Properties:

* Non-nullable
* `delete-orphan`

---

## 4.9 Tender → Competitors

```text
crm_tenders
      │
      └── 1 : N
            ↓
crm_tender_competitors
```

**Foreign Key:** `tender_id`

Properties:

* Non-nullable
* `delete-orphan`

---

# 5. CRM Purchase Order Relationships

A CRM Purchase Order belongs to an Organization.

```text
crm_organizations
        │
        └── 1 : N
              ↓
crm_purchase_orders
```

**Foreign Key:** `org_id`

Properties:

* Non-nullable

A Purchase Order may additionally reference:

```text
crm_inquiries
      ↑
      │ nullable
      │
crm_purchase_orders

crm_tenders
      ↑
      │ nullable
      │
crm_purchase_orders
```

Therefore, a CRM Purchase Order:

* Always belongs to an Organization.
* May trace to an Inquiry.
* May trace to a Tender.
* May have neither Inquiry nor Tender.

---

# 6. CRM Activities

## 6.1 Activity → Attachments

```text
crm_activities
      │
      └── 1 : N
            ↓
crm_activity_attachments
```

**Foreign Key:** `activity_id`

Properties:

* Non-nullable
* Indexed
* `delete-orphan`

---

## 6.2 Activity → Organization

```text
crm_activities
      │
      └── N : 1
            ↓
crm_organizations
```

**Foreign Key:** `org_id`

Properties:

* Nullable

---

## 6.3 Activity → Contact

```text
crm_activities
      │
      └── N : 1
            ↓
crm_org_contacts
```

**Foreign Key:** `org_contact_id`

Properties:

* Nullable
* Retained as the primary contact reference

The application also supports multiple attendees through the separate contact collection mechanism.

---

# 7. CRM Notes

Notes may optionally belong to:

```text
crm_organizations
crm_org_contacts
```

Relationships:

```text
crm_notes
   ├── N : 1 → crm_organizations
   └── N : 1 → crm_org_contacts
```

Both references are nullable.

---

# 8. CRM Documents

CRM Documents may optionally belong to an Organization.

```text
crm_documents
      │
      └── N : 1
            ↓
crm_organizations
```

**Foreign Key:** `org_id`

The broader entity association may additionally use the polymorphic relationship described below.

---

# 9. CRM Polymorphic Associations

Several CRM tables use polymorphic references rather than database foreign keys.

Affected entities:

* `crm_activities`
* `crm_notes`
* `crm_documents`
* `crm_discussions`
* `crm_stage_logs`

The conceptual structure is:

```text
related_module
      +
related_id
      ↓
Target CRM Entity
```

For example:

```text
related_module = "inquiry"
related_id = 42
```

means that the record refers to Inquiry `42`.

The database does not enforce that relationship.

---

# 10. CRM Document Sub-References

`crm_documents` may additionally contain:

```text
related_sub_module
related_sub_id
```

These provide a second-level application-managed association.

They are not database-enforced foreign keys.

---

# 11. Polymorphic Relationship Trade-Off

Polymorphic references provide flexibility because one table can serve multiple CRM entity types.

However:

* The database cannot prevent dangling IDs.
* Referential integrity is application-enforced.
* Generic SQL joins cannot be performed without knowing the target table.
* `related_module` determines which entity `related_id` represents.

Therefore, application-level validation is required.

---

# 12. Users as a Database Hub

The `users` table is referenced throughout ERP-PremnathRail.

Typical references include:

```text
created_by_id
approver_id
raised_by_id
assigned_service_person_id
approved_by_id
closed_by_id
performed_by_id
```

However, most of these are not database-enforced foreign keys.

---

# 13. Enforced User Relationships

The currently enforced user foreign keys include:

### Attachment Sharing

```text
erp_project_attachment_shares.user_id
        ↓
users.id
```

### Purchase

```text
purchase_requisitions.raised_by_id
purchase_requisitions.approver_id
purchase_requisitions.approved_by_id
purchase_requisitions.closed_by_id
        ↓
users.id
```

### P2P

```text
p2p_requests.requested_by_id
p2p_requests.approver_id
p2p_requests.approved_by_id
p2p_requests.closed_by_id
p2p_requests.assigned_buyer_id
        ↓
users.id
```

---

# 14. Unenforced User References

Several user-related fields remain plain integer references.

Examples include:

* `erp_service_requests.created_by_id`
* `crm_activities.created_by_id`
* `rnd_calculation_history.user_id`
* `notifications.user_id`
* `feedback.user_id`
* `audit_logs.performed_by_id`

Equivalent patterns also exist across:

* CRM
* Design
* Electrical
* Store
* Vendor

The database therefore does not guarantee that every such ID corresponds to an existing user.

---

# 15. Purchase Module Relationships

The Purchase module is connected to ERP Service processes.

```text
erp_projects
      │
      └── 1 : N
            ↓
purchase_requisitions

erp_service_requests
      │
      └── 1 : N
            ↓
purchase_requisitions
```

Foreign keys:

```text
purchase_requisitions.project_id
purchase_requisitions.service_request_id
```

Both are non-nullable.

There is no ORM relationship to the ERP models even though database-level foreign keys exist.

---

# 16. Service Material → Purchase Relationship

The reverse connection is:

```text
erp_service_materials
          │
          └── pr_id
                ↓
purchase_requisitions
```

`pr_id` is nullable.

Service Material may additionally retain:

```text
pr_number
pr_status
```

These provide a denormalized mirror of purchasing state.

---

# 17. Purchase Requisition → Items

```text
purchase_requisitions
          │
          └── 1 : N
                ↓
purchase_requisition_items
```

**Foreign Key:** `purchase_requisition_id`

Properties:

* Non-nullable
* `delete-orphan`

---

# 18. Purchase Requisition Item → Service Material

```text
purchase_requisition_items
          │
          └── N : 1
                ↓
erp_service_materials
```

**Foreign Key:** `service_material_id`

This represents the Service Material from which the purchasing item originated.

The purchasing item acts as a snapshot of the service requirement at PR-raise time.

---

# 19. Purchase User Relationships

Purchase Requisitions contain user references for:

* Request raiser
* Approver
* Approver who completed approval
* Closer

These are database-level foreign keys to `users`.

---

# 20. P2P Module

P2P is intentionally independent from the ERP Service Request workflow.

```text
p2p_requests
      │
      ├── Request Items
      ├── Attachments
      ├── RFQs
      └── Purchase Orders
```

There is no foreign key from `p2p_requests` to ERP Projects or Service Requests.

---

# 21. P2P Request → Items

```text
p2p_requests
      │
      └── 1 : N
            ↓
p2p_request_items
```

**Foreign Key:** `p2p_request_id`

Properties:

* Non-nullable
* `delete-orphan`

---

# 22. P2P Request → Attachments

```text
p2p_requests
      │
      └── 1 : N
            ↓
p2p_request_attachments
```

**Foreign Key:** `p2p_request_id`

Properties:

* Non-nullable
* `delete-orphan`

---

# 23. P2P Item → Attachment

A P2P attachment may optionally belong to a specific request item.

```text
p2p_request_items
      │
      └── 1 : N
            ↓
p2p_request_attachments
```

**Foreign Key:** `item_id`

Properties:

* Nullable
* Optional item-level scoping

---

# 24. P2P Item → Store Item

A P2P request item may optionally reference the Store item master.

```text
p2p_request_items
      │
      └── N : 1
            ↓
stock_items
```

**Foreign Key:** `stock_item_id`

Properties:

* Nullable

This allows a P2P item to use a structured Store item instead of relying exclusively on free text.

---

# 25. P2P → RFQ

A P2P Request may have RFQs.

```text
p2p_requests
      │
      └── 1 : N
            ↓
rfqs
```

**Foreign Key:** `p2p_request_id`

The relationship is nullable according to the current schema.

---

# 26. RFQ → Attachments

```text
rfqs
 │
 └── 1 : N
       ↓
rfq_attachments
```

**Foreign Key:** `rfq_id`

Properties:

* Non-nullable
* `delete-orphan`

---

# 27. P2P → Purchase Orders

```text
p2p_requests
      │
      └── 1 : N
            ↓
p2p_purchase_orders
```

**Foreign Key:** `p2p_request_id`

The relationship is nullable according to the current schema.

---

# 28. P2P Purchase Order → Items

```text
p2p_purchase_orders
       │
       └── 1 : N
             ↓
p2p_purchase_order_items
```

**Foreign Key:** `p2p_purchase_order_id`

Properties:

* Non-nullable
* `delete-orphan`

---

# 29. R&D Module

The R&D module is intentionally isolated.

No R&D table has a foreign key to another application module.

```text
R&D
 ├── Calculation History
 ├── Braking
 ├── Hydraulic
 ├── Load Distribution
 ├── Qmax
 ├── Spline
 ├── Tractive Effort
 └── Vehicle Performance
```

`user_id` references are application-level integer pointers rather than enforced foreign keys.

---

# 30. R&D Calculation History

Calculation history and individual tool calculation tables are correlated at application level.

The correlation uses information such as:

```text
user_id
tool_name
calculation_name
created_at
```

There is no foreign key directly connecting the history record to its corresponding calculation snapshot.

---

# 31. Design Module

The Design module contains engineering documents.

```text
design
└── engineering_documents
```

The current structure does not declare foreign keys to the major ERP or CRM entities.

---

# 32. Electrical Module

The Electrical module contains:

```text
electrical_work_orders
```

There is currently no foreign key connecting Electrical Work Orders directly to:

```text
erp_projects
```

The conceptual similarity to Service Requests does not create a database relationship.

---

# 33. Store Module

Store maintains relationships among:

```text
stock_items
store_locations
stock_balances
stock_transactions
```

Conceptually:

```text
Stock Item
    │
    ├── Stock Balance ── Location
    │
    └── Stock Transactions ── Location
```

Stock balances are computed from stock transactions at the application level rather than through a database view.

---

# 34. P2P → Store Relationship

P2P Request Items may optionally reference Store Items.

```text
p2p_request_items
        │
        └── stock_item_id
                ↓
          stock_items
```

This is a nullable foreign key.

---

# 35. Vendor Module

The Vendor module contains:

```text
vendors
```

Currently:

```text
purchase_requisitions.vendor
p2p_requests.vendor
```

remain free-text vendor fields.

There is no database foreign key to:

```text
vendors.id
```

Therefore the relationship currently exists through application convention/name matching.

---

# 36. Future Vendor Relationship

A future database design could introduce:

```text
vendor_id
    ↓
vendors.id
```

Such a change would formalize the currently informal vendor relationship.

This should only be implemented through an approved database migration and corresponding product/architecture change.

---

# 37. Purchase vs P2P Separation

The two purchasing systems are intentionally decoupled.

| Area                  | Purchase                 | P2P                             |
| --------------------- | ------------------------ | ------------------------------- |
| Origin                | Service Request Material | Standalone departmental request |
| ERP FK                | Yes                      | No                              |
| Project FK            | Yes                      | No                              |
| Service Request FK    | Yes                      | No                              |
| Service Material link | Yes                      | No                              |
| Store Item link       | No                       | Optional                        |
| RFQ pipeline          | No                       | Yes                             |
| P2P PO pipeline       | No                       | Yes                             |

The separation is deliberate.

---

# 38. Relationship Summary

| Parent                            | Child                              | FK                            | Nullable | Cascade          |
| --------------------------------- | ---------------------------------- | ----------------------------- | -------- | ---------------- |
| `erp_projects`                    | `erp_service_requests`             | `project_id`                  | No       | `delete-orphan`  |
| `erp_projects`                    | `erp_project_attachments`          | `project_id`                  | No       | `delete-orphan`  |
| `erp_project_attachments`         | `erp_project_attachment_shares`    | `attachment_id`               | No       | ORM + DB CASCADE |
| `users`                           | `erp_project_attachment_shares`    | `user_id`                     | Yes      | DB CASCADE       |
| `erp_service_requests`            | `erp_service_materials`            | `service_request_id`          | No       | `delete-orphan`  |
| `erp_service_requests`            | `erp_service_request_attachments`  | `service_request_id`          | No       | `delete-orphan`  |
| `erp_service_materials`           | `erp_service_material_attachments` | `service_material_id`         | No       | `delete-orphan`  |
| `erp_projects`                    | `purchase_requisitions`            | `project_id`                  | No       | —                |
| `erp_service_requests`            | `purchase_requisitions`            | `service_request_id`          | No       | —                |
| `purchase_requisitions`           | `purchase_requisition_items`       | `purchase_requisition_id`     | No       | `delete-orphan`  |
| `erp_service_materials`           | `purchase_requisition_items`       | `service_material_id`         | No       | —                |
| `purchase_requisitions`           | `erp_service_materials`            | `pr_id`                       | Yes      | —                |
| `p2p_requests`                    | `p2p_request_items`                | `p2p_request_id`              | No       | `delete-orphan`  |
| `p2p_requests`                    | `p2p_request_attachments`          | `p2p_request_id`              | No       | `delete-orphan`  |
| `p2p_request_items`               | `p2p_request_attachments`          | `item_id`                     | Yes      | `delete-orphan`  |
| `stock_items`                     | `p2p_request_items`                | `stock_item_id`               | Yes      | —                |
| `p2p_requests`                    | `rfqs`                             | `p2p_request_id`              | Yes      | —                |
| `rfqs`                            | `rfq_attachments`                  | `rfq_id`                      | No       | `delete-orphan`  |
| `p2p_requests`                    | `p2p_purchase_orders`              | `p2p_request_id`              | Yes      | —                |
| `p2p_purchase_orders`             | `p2p_purchase_order_items`         | `p2p_purchase_order_id`       | No       | `delete-orphan`  |
| `crm_organizations`               | `crm_org_contacts`                 | `org_id`                      | No       | `delete-orphan`  |
| `crm_organizations`               | `crm_inquiries`                    | `org_id`                      | No       | —                |
| `crm_organizations`               | `crm_tenders`                      | `org_id`                      | No       | —                |
| `crm_organizations`               | `crm_purchase_orders`              | `org_id`                      | No       | —                |
| `crm_inquiries`                   | `crm_purchase_orders`              | `inquiry_id`                  | Yes      | —                |
| `crm_tenders`                     | `crm_purchase_orders`              | `tender_id`                   | Yes      | —                |
| `crm_inquiries`                   | `crm_inquiry_tasks`                | `inquiry_id`                  | No       | `delete-orphan`  |
| `crm_inquiries`                   | `crm_inquiry_approvals`            | `inquiry_id`                  | No       | `delete-orphan`  |
| `crm_inquiries`                   | `crm_quotations`                   | `inquiry_id`                  | No       | `delete-orphan`  |
| `crm_quotations`                  | `crm_quotation_line_items`         | `quotation_id`                | No       | `delete-orphan`  |
| `crm_tenders`                     | `crm_tender_tasks`                 | `tender_id`                   | No       | `delete-orphan`  |
| `crm_tenders`                     | `crm_tender_competitors`           | `tender_id`                   | No       | `delete-orphan`  |
| `crm_activities`                  | `crm_activity_attachments`         | `activity_id`                 | No       | `delete-orphan`  |
| `crm_organizations`               | `crm_activities`                   | `org_id`                      | Yes      | —                |
| `crm_organizations`               | `crm_notes`                        | `org_id`                      | Yes      | —                |
| `crm_organizations`               | `crm_documents`                    | `org_id`                      | Yes      | —                |
| `crm_org_contacts`                | `crm_activities`                   | `org_contact_id`              | Yes      | —                |
| `crm_org_contacts`                | `crm_notes`                        | `org_contact_id`              | Yes      | —                |
| `store_locations` / `stock_items` | `stock_balances`                   | Location / Item FKs           | No       | —                |
| `stock_items` / `store_locations` | `stock_transactions`               | Item / Location FKs           | No       | —                |
| Polymorphic                       | CRM shared entities                | `related_module + related_id` | Mixed    | None             |

---

# 39. Database-Enforced vs Application-Enforced Relationships

The system contains two distinct relationship categories.

### Database-enforced

These use actual foreign keys.

```text
Parent
  ↓
Foreign Key
  ↓
Child
```

### Application-enforced

These use integer/string references without database constraints.

```text
Module
  ↓
related_module
  +
related_id
  ↓
Target Entity
```

Developers must know which category they are working with before modifying a relationship.

---

# 40. Relationship Change Rules

Update this document when:

* A foreign key is added.
* A foreign key is removed.
* Cardinality changes.
* Nullability changes.
* Cascade behavior changes.
* A new cross-module relationship is introduced.
* An application-level relationship becomes database-enforced.
* A database-enforced relationship becomes application-level.

---

# 41. Migration Requirements

Relationship changes must be implemented through controlled database migrations.

A relationship migration should document:

* Previous relationship
* New relationship
* Constraint/index changes
* Existing-data handling
* Rollback considerations

Migration history remains the authoritative technical record of actual database changes.

---

# 42. Related Documents

* Project Charter
* BRD
* PRD
* Scope Document
* Software Architecture Document
* HLD
* LLD
* Database Design
* Database Schema
* Database Indexes
* Database Migrations
* ER Diagram
* Security Documentation
* Module Documentation

---

# 43. Version Control

```text
v1.0
Initial database relationship baseline

v1.1
Minor relationship changes

v1.2
Additional module relationships

v2.0
Major database relationship redesign
```

Previous approved versions should be retained.

---

# 44. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 45. Document Status

**Document:** Database Relationships
**Project:** ERP-PremnathRail
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Organization:** PremnathRail
**Date:** 31 August 2026
