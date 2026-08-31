# ERP-PremnathRail — Database Design & Entity Relationships

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Document:** Database Design & Entity Relationships
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document describes the database structure and relationships of ERP-PremnathRail.

It explains:

* Major database entities
* Relationships between entities
* Module-level data ownership
* Cross-module relationships
* Parent-child relationships
* Database-level coupling
* Document references
* Important data-integrity considerations

The detailed column-level schema, indexes, migrations, and exact foreign-key rules should remain in their respective technical documents.

---

# 2. Database Architecture

ERP-PremnathRail uses a **centralized relational database**.

The database is organized around business modules while maintaining relationships where business processes require them.

```text id="x7p4f1"
                 PostgreSQL
                     │
       ┌─────────────┼─────────────┐
       │             │             │
      CRM           ERP           P2P
       │             │             │
   Organizations   Projects     Requests
   Inquiries       Services     RFQs
   Tenders         Materials    Purchase Orders
   Quotations
       │
       ├──────── Purchase
       ├──────── Vendor
       ├──────── Store
       ├──────── R&D
       ├──────── Design
       ├──────── Electrical
       └──────── HR
```

---

# 3. Data Design Principles

The database follows these principles:

1. Centralized structured business data.
2. Clear ownership of module-specific data.
3. Foreign keys where strong relationships are required.
4. Controlled cross-module relationships.
5. Avoid unnecessary duplication.
6. Preserve historical business information.
7. Use migrations for schema evolution.
8. Keep document files outside the relational database where SharePoint is the approved storage system.

---

# 4. Main Platform — Users

`users` is the central identity concept of the application.

Users can be associated with:

* Created records
* Assigned tasks
* Approvals
* Audit activities
* Notifications
* Feedback
* Administrative actions

Conceptually:

```text id="z8q2n3"
User
 ├── Created By
 ├── Assigned To
 ├── Approved By
 ├── Audit Activity
 ├── Notifications
 └── Feedback
```

Not every user reference is necessarily enforced as a database foreign key. Some relationships are maintained at the application level.

---

# 5. API Keys

`api_keys` provides an alternative identity mechanism for machine-to-machine/API access.

API keys are associated with allowed applications rather than necessarily being tied to an individual employee.

Conceptually:

```text id="c5h8v2"
API Key
   ↓
Allowed Applications
   ↓
API Access
```

---

# 6. ERP Module

The ERP module follows this hierarchy:

```text id="n4d7s9"
Project
   ↓
Service Requests
   ↓
Service Materials
```

A Project represents a deployed machine/business operational record.

A Project may have:

* Multiple Service Requests
* Multiple Project Attachments

---

# 7. Project Relationships

```text id="y4m2q8"
erp_projects
     │
     ├── erp_service_requests
     │
     └── erp_project_attachments
```

Deleting a Project is configured to cascade to its applicable child records according to the ORM/database relationship configuration.

---

# 8. Project Attachments

Project attachments represent documents associated with the Project/machine.

An attachment may be:

* Public according to applicable access rules
* Private

Private attachment access can be granted to:

* Specific user
* Department
* Designation

Conceptually:

```text id="b6x4j9"
Project Attachment
       ↓
Private?
       ↓
Attachment Shares
       ├── User
       ├── Department
       └── Designation
```

Department/designation-based access is evaluated against the user's current organizational attributes.

---

# 9. Service Request Relationships

A Service Request belongs to a Project.

```text id="k9w3m1"
Project
   │
   └── Service Request
          │
          ├── Service Materials
          │
          └── Service Request Attachments
```

Each Service Request can contain multiple Service Materials and attachments.

---

# 10. Service Material Relationships

Service Materials represent parts/materials required for a Service Request.

```text id="p7x2n5"
Service Request
      ↓
Service Material
      ↓
Purchase Requisition
```

The material may contain a nullable purchase-requisition reference.

This creates the database seam between ERP and Purchase.

---

# 11. CRM Module

CRM is centered around `crm_organizations`.

```text id="d8k4s2"
Organization
   │
   ├── Contacts
   ├── Inquiries
   └── Tenders
```

An Organization can have multiple contacts.

An Inquiry and Tender belong to an Organization.

---

# 12. CRM Inquiry Pipeline

The Inquiry pipeline contains:

```text id="j4q7z3"
Organization
     ↓
Inquiry
 ├── Tasks
 ├── Approvals
 └── Quotations
          ↓
     Quotation Items
```

Quotations contain multiple line items.

---

# 13. CRM Tender Pipeline

The Tender pipeline contains:

```text id="u8x5c1"
Organization
     ↓
Tender
 ├── Tasks
 └── Competitors
```

Inquiry and Tender are parallel CRM pipelines.

They do not directly depend on each other.

---

# 14. CRM Purchase Orders

CRM Purchase Orders belong to an Organization.

A Purchase Order may trace back to:

* An Inquiry
* A Tender

Conceptually:

```text id="m7k2d9"
Organization
     │
     └── Purchase Order
          ├── Inquiry (optional)
          └── Tender (optional)
```

This allows the organization to retain the commercial origin of a customer PO.

---

# 15. CRM Shared Entities

Several CRM entities operate across multiple CRM pipelines.

These include:

* Activities
* Notes
* Documents
* Discussions
* Stage Logs

Conceptually:

```text id="v3n8p4"
Inquiry ─────┐
Tender ─────┤
Quotation ──┤
             ↓
      Shared CRM Records
```

Some of these entities use polymorphic references rather than direct database foreign keys.

---

# 16. CRM Activities

Activities can represent:

* Calls
* Visits
* Meetings
* Minutes of Meeting
* Attendees

Activity attachments are associated directly with Activities.

---

# 17. CRM Master Data

CRM also contains master data such as:

* Products
* Payment Terms

These are referenced by applicable Inquiry and Quotation records to standardize business information.

---

# 18. Purchase Module

The Purchase module contains a Service-linked requisition system.

```text id="r5w2k8"
ERP Project
     ↓
Service Request
     ↓
Service Material
     ↓
Purchase Requisition
     ↓
Purchase Requisition Items
```

A Purchase Requisition is associated with the originating Project and Service Request.

---

# 19. Service Material → Purchase Relationship

The relationship is:

```text id="z4p6c2"
erp_service_materials
          │
          │ pr_id
          ▼
purchase_requisitions
```

Purchase Requisition Items represent the purchasing snapshot of the Service Material information at the time the requisition is raised.

The service material can retain purchase status/reference information.

---

# 20. P2P Module

P2P represents a separate standalone purchasing process.

```text id="a8m5s7"
P2P Request
     ↓
Request Items
     ↓
RFQ
     ↓
Purchase Order
     ↓
Purchase Order Items
```

P2P does not require a relationship to an ERP Service Request.

---

# 21. P2P Request Items & Store

P2P request items can optionally reference Store stock items.

```text id="e2v7q5"
P2P Request Item
       │
       └── optional
             ↓
         Stock Item
```

This allows a request to reference an existing inventory item instead of relying only on free-text descriptions.

---

# 22. P2P Vendor Relationship

P2P purchasing uses vendors during the RFQ and purchasing process.

Vendor relationships are currently not uniformly represented as direct foreign keys across all purchasing workflows.

Vendor master information should remain centralized.

---

# 23. Purchase vs P2P

The database intentionally contains two purchasing systems:

```text id="w9k3t6"
                 Purchasing
                    │
          ┌─────────┴─────────┐
          │                   │
      Purchase               P2P
          │                   │
 Service-linked          Standalone
```

### Purchase

Originates from Service Materials.

### P2P

Can originate independently from any department.

They currently share concepts/status conventions but are separate database systems.

---

# 24. R&D Module

R&D calculation data is deliberately flat.

There is a calculation history table and independent calculation tables for different engineering tools.

```text id="c6y2n8"
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

The individual calculation tables are not structurally linked to the history table through foreign keys.

Correlation is maintained through application-level information such as:

* User
* Tool
* Calculation name
* Creation time

---

# 25. Design Module

The Design module contains an engineering-document register.

```text id="h7x4q1"
Engineering Document
```

The current database structure does not establish direct foreign-key relationships to the major ERP or CRM entities.

Document storage is handled through the approved document-management architecture.

---

# 26. Electrical Module

Electrical work orders are represented as a standalone entity.

```text id="p2m9v6"
Electrical Work Order
```

The current database structure does not directly link Electrical Work Orders to ERP Projects through a foreign key.

---

# 27. Store Module

Store forms its own internal data structure.

```text id="r8c4z7"
Stock Item
     │
     ├──────────────┐
     │              │
     ▼              ▼
Stock Balance   Transactions
     │
     ▼
Location
```

Core entities include:

* Stock Items
* Store Locations
* Stock Balances
* Stock Transactions

Stock balances represent current item quantities at locations, while transactions represent inventory movements.

---

# 28. Vendor Module

The Vendor module contains the centralized Vendor master.

```text id="f3k8m2"
Vendor
  │
  ├── Purchasing
  └── P2P
```

Current purchasing relationships may use vendor names or application-level references rather than direct foreign keys in all cases.

---

# 29. HR Module

The current HR database structure is minimal.

The current implementation provides employee-directory functionality without a dedicated HR entity structure comparable to CRM or ERP.

Future HR expansion may introduce additional entities when the business requirements are approved.

---

# 30. Cross-Module Relationship Map

The major cross-module relationships are:

```text id="x8q5v3"
Users
  │
  ├──────── CRM
  ├──────── ERP
  ├──────── Purchase
  ├──────── P2P
  ├──────── R&D
  └──────── Administration

ERP
 │
 └── Service Material
          │
          ▼
      Purchase

P2P
 │
 └── Request Item
          │
          ▼
       Store

Purchase / P2P
 │
 └── Vendor
```

---

# 31. Database Integrity

Where a relationship is critical to data integrity, database foreign keys should be used.

Where polymorphic or flexible references are required, application-level validation may be used.

The system therefore contains both:

* Database-enforced relationships
* Application-enforced relationships

These should not be treated as equivalent.

---

# 32. Polymorphic Relationships

CRM uses polymorphic references in several shared tables.

Conceptually:

```text id="n7j2w4"
related_module
      +
related_id
      ↓
CRM Entity
```

This provides flexibility but means the database itself cannot always verify that the referenced record exists.

Application-level validation is therefore important.

---

# 33. Data Deletion

Parent-child entities may use cascade deletion where explicitly configured.

Other business records may use soft deletion.

Soft deletion generally follows:

```text id="m5x8c2"
Active
  ↓
deleted_at
  ↓
Hidden from normal queries
  ↓
Restore / Permanent Removal
```

Soft-delete behavior must be verified per module before assuming uniform behavior.

---

# 34. Database Migrations

Database schema changes should be managed through controlled migration files.

Migration history should record:

* Schema changes
* Table creation
* Column changes
* Relationship changes
* Index changes
* Renames
* Data migrations

Existing migration history should be retained.

---

# 35. Database Documentation Set

The database documentation should be divided into focused documents rather than one oversized file:

```text id="z6v1p9"
database/
├── database-design.md
├── schema.md
├── relationships.md
├── indexes.md
└── migrations.md
```

### database-design.md

High-level database architecture and entity relationships.

### schema.md

Column-level table definitions.

### relationships.md

Exact foreign keys, cardinalities, nullability and cascade behavior.

### indexes.md

Indexes and query-performance structures.

### migrations.md

Schema evolution history.

---

# 36. Entity Relationship Diagrams

A single company-wide ER diagram containing every table may become difficult to read.

Therefore diagrams should be organized by logical areas:

```text id="q8n4x7"
diagrams/
├── platform-erd.svg
├── crm-erd.svg
├── erp-erd.svg
├── purchase-erd.svg
├── p2p-erd.svg
├── store-erd.svg
└── cross-module-erd.svg
```

The diagrams should represent the actual database schema.

---

# 37. Database Change Management

Update this document when:

* A major entity is added.
* An entity is removed.
* A major relationship changes.
* Cross-module database coupling changes.
* Database ownership changes.
* A significant data-model decision is introduced.

Column-level changes should primarily be recorded in `schema.md`.

Index changes should primarily be recorded in `indexes.md`.

Migration history belongs in `migrations.md`.

---

# 38. Database Versioning

```text id="k2m7p5"
v1.0
Initial database design baseline

v1.1
Minor relationship/schema change

v1.2
Additional module entities

v2.0
Major database redesign
```

Previous approved documentation versions should be retained.

Database migration files must also remain permanently traceable.

---

# 39. Important Current Database Considerations

The current schema contains several relationships maintained primarily by application convention rather than strict foreign-key enforcement.

Examples include:

* Many user references
* Some CRM polymorphic references
* Some Vendor references
* R&D history relationships

These areas should receive additional validation when database integrity becomes a priority.

---

# 40. Related Documents

* Project Charter
* BRD
* PRD
* Scope Document
* Software Architecture Document
* HLD
* LLD
* Database Schema
* Database Relationships
* Database Indexes
* Database Migrations
* Security Documentation
* API Documentation
* Module Documentation

---

# 41. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 42. Document Status

**Document:** Database Design & Entity Relationships
**Project:** ERP-PremnathRail
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Organization:** PremnathRail
**Date:** 31 August 2026
