# ERP-PremnathRail — Low-Level Design (LLD)

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Document:** Low-Level Design
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document defines the **implementation-level design** of ERP-PremnathRail.

The Architecture Document defines the overall architecture, while the HLD defines major system components. This LLD goes one level deeper and describes how individual modules, layers, data models, APIs, workflows, and internal responsibilities are implemented.

The LLD is primarily intended for developers maintaining or extending the application.

---

# 2. Implementation Architecture

The backend modules follow a layered pattern where appropriate:

```text id="c8n3v4"
Module
│
├── routes/
│      HTTP/API handling
│
├── schemas/
│      Request/Response validation
│
├── services/
│      Business logic
│
├── repositories/
│      Database queries
│
├── models/
│      Database entities
│
└── tests/
       Automated tests
```

Not every current module requires all five layers. The structure should reflect actual module complexity.

---

# 3. Layer Responsibilities

## 3.1 Routes

Routes handle:

* HTTP requests
* Authentication dependency
* Authorization checks
* Request parsing
* Calling business logic
* Response serialization
* HTTP-level error handling

Routes should not contain unnecessary business logic.

---

## 3.2 Schemas

Schemas define:

* Request models
* Update models
* Response models
* Validation rules
* Nested response structures

Pydantic schemas should not contain database queries.

---

## 3.3 Services

Services contain:

* Business rules
* Workflow rules
* Business validation
* Multi-step operations
* Cross-repository orchestration
* Audit operations where applicable

Services should not depend on HTTP-specific behavior.

---

## 3.4 Repositories

Repositories contain:

* Database queries
* ORM operations
* Filtering
* Sorting
* Record retrieval
* Persistence operations

Repositories should not contain business workflow decisions.

---

## 3.5 Models

Models define:

* Database tables
* Columns
* Relationships
* Foreign keys
* Enumerations
* Persistence structure

Models should remain focused on data representation.

---

# 4. Current Module Implementation

The current application contains these modules:

| Module     | Models | Schemas | Repositories | Services | Routes |
| ---------- | -----: | ------: | -----------: | -------: | -----: |
| Platform   |      ✓ |       ✓ |            ✓ |        ✓ |      ✓ |
| CRM        |      ✓ |       ✓ |            ✓ |        ✓ |      ✓ |
| ERP        |      ✓ |       ✓ |            — |        — |      ✓ |
| Purchase   |      ✓ |       ✓ |            — |        — |      ✓ |
| P2P        |      ✓ |       ✓ |            — |        — |      ✓ |
| R&D        |      ✓ |       ✓ |            ✓ |        ✓ |      ✓ |
| Vendor     |      ✓ |       ✓ |            — |        — |      ✓ |
| Store      |      ✓ |       ✓ |            — |        — |      ✓ |
| Design     |      ✓ |       ✓ |            — |        — |      ✓ |
| Electrical |      ✓ |       ✓ |            — |        — |      ✓ |
| HR         |      — |       — |            — |        — |      ✓ |

The absence of a layer does not automatically represent a defect. Module structure should be expanded when complexity justifies it.

---

# 5. ERP Module — Service Request

The Service Request is a major operational workflow.

## 5.1 Data Model

Conceptually:

```text id="qg8x8v"
ServiceRequest
├── id
├── project_id
├── status
├── priority
├── deleted_at
├── created_at
└── updated_at
```

A Service Request can contain multiple Service Materials.

---

# 6. Service Request State Machine

The Service Request lifecycle is:

```text id="6p3qz0"
open
 ↓
acknowledged
 ↓
assigned
 ↓
scheduled
 ↓
in_progress
 ↓
pending_parts
 ↓
on_hold
 ↓
work_completed
 ↓
review
 ↓
closed
```

Cancellation may be available from the applicable states.

The exact allowed transitions should be enforced by business logic.

---

# 7. Service Request API Pattern

Conceptually:

```text id="f4t6b1"
POST   /api/v1/service-requests
GET    /api/v1/service-requests
GET    /api/v1/service-requests/{id}
PUT    /api/v1/service-requests/{id}
DELETE /api/v1/service-requests/{id}
```

Additional action endpoints may handle:

* Assignment
* Scheduling
* Status changes
* Material operations
* Purchase requisition creation
* Receiving

Exact API contracts belong in the API documentation.

---

# 8. Service Request → Purchase Requisition

A Service Request may generate a purchase requisition from its material requirements.

```text id="2q6n4m"
Service Request
      ↓
Service Materials
      ↓
Raise PR
      ↓
Purchase Requisition
      ↓
Purchase Processing
```

The operation must maintain the relationship between the original Service Material and the resulting Purchase Requisition item.

---

# 9. CRM Module — Inquiry to Quotation

CRM uses the full layered architecture.

```text id="qv8e0y"
Route
  ↓
Service
  ↓
Repository
  ↓
Model
  ↓
PostgreSQL
```

The service layer controls business rules such as valid Inquiry stage transitions.

---

# 10. CRM Workflow

Conceptually:

```text id="j0i4z2"
Inquiry
 ↓
Tender
 ↓
Quotation
 ↓
Customer PO
```

Stage transitions should be validated before modification.

Important workflow events should be recorded in the audit history.

---

# 11. Database Implementation

ERP-PremnathRail uses PostgreSQL as its relational database.

Module ownership should remain clear.

Example:

```text id="f5x2l1"
crm_*
erp_*
p2p_*
rnd_*
purchase_*
```

Database schema evolution should use controlled migration files.

---

# 12. Database Relationships

Typical relationship:

```text id="q2l7ad"
Department
    ↓
Team
    ↓
User
    ↓
Project
    ↓
Service Request
    ↓
Service Material
```

Other modules may connect through defined relationships rather than uncontrolled database access.

---

# 13. Document Attachment Implementation

Files are stored in SharePoint.

The ERP database stores metadata/reference information.

```text id="a9g1km"
ERP Record
     ↓
Attachment Metadata
     ↓
SharePoint Reference
     ↓
SharePoint File
```

The application should not store large document files directly inside PostgreSQL unless a future architectural decision explicitly requires it.

---

# 14. Authentication Implementation

Authentication uses Microsoft Entra ID.

The high-level flow is:

```text id="z8p0rj"
Browser
 ↓
Microsoft Login
 ↓
Entra ID
 ↓
Callback
 ↓
ERP Session
 ↓
Authenticated User
```

The application does not maintain local user passwords.

---

# 15. Session Handling

The authenticated session is represented through a secure HTTP-only session mechanism.

The frontend should not directly access the raw session credential.

The frontend instead retrieves the current authenticated-user information from the backend.

---

# 16. Authorization Implementation

Authorization is enforced at the backend.

Conceptually:

```text id="9g8m8k"
Authenticated User
       ↓
Application Access
       ↓
Module Permission
       ↓
Action Permission
       ↓
Business Operation
```

Example:

```text
p2p
p2p.create
p2p.edit
p2p.approve
p2p.delete
```

Actual permission names should be maintained in the security/permission documentation.

---

# 17. Audit Implementation

Important successful mutations should create audit records.

Example:

```text id="m5p1s9"
User
 ↓
Update Project
 ↓
Business Operation
 ↓
AuditLog
```

Audit information should identify the user, action, record and relevant change information.

---

# 18. Soft Delete

Where supported, deletion should use a logical deletion mechanism.

Conceptually:

```text id="m8r7w0"
Record
 ↓
deleted_at = timestamp
 ↓
Hidden from normal queries
 ↓
Recycle Bin
 ↓
Restore / Permanent Delete
```

Implementation must be verified module-by-module before assuming every module supports the same behavior.

---

# 19. Cross-Module Interaction

Cross-module dependencies should be explicit.

Example:

```text id="7f5q7w"
ERP
 │
 └── Service Material
          ↓
      Purchase
          ↓
   Purchase Requisition
```

Direct access to another module's internal data should be limited to explicitly defined integration points.

---

# 20. Purchase / ERP Coupling

The ERP Service Request can create a Purchase Requisition.

The implementation maintains the connection between:

```text id="u3q1j8"
ERP.ServiceMaterial
        ↕
PurchaseRequisitionItem
```

This allows procurement progress to remain visible from the originating service process.

---

# 21. P2P Independence

The P2P module is independent from ERP Service Requests.

```text id="f2z4e8"
Department
   ↓
P2P Request
   ↓
RFQ
   ↓
Vendor
   ↓
PO
```

P2P should not depend on ERP Service Request tables for normal operation.

---

# 22. API and Frontend Separation

The frontend should communicate through the shared API client.

Conceptually:

```text id="8d5n4f"
UI Component
     ↓
API Client
     ↓
Backend Endpoint
     ↓
Module
```

Direct ad-hoc backend requests should be avoided when a shared API abstraction exists.

---

# 23. Validation

Validation occurs at multiple levels.

```text id="2f9k1w"
Frontend Validation
        ↓
API Schema Validation
        ↓
Authorization
        ↓
Business Validation
        ↓
Database Constraints
```

Frontend validation improves user experience but does not replace backend validation.

---

# 24. Error Handling

Errors should be handled at the appropriate layer.

```text id="7p8r4n"
Database / Business Error
        ↓
Service / Route Handling
        ↓
Structured API Error
        ↓
Frontend Message
```

Internal implementation details and sensitive information should not be exposed to end users.

---

# 25. Testing Structure

Each module should have tests appropriate to its complexity.

Potential levels:

* Unit tests
* API tests
* Integration tests
* Workflow tests
* Permission tests
* Database tests

Critical business workflows should receive priority.

---

# 26. Module Development Rule

When adding a new module:

```text id="w7m1n9"
1. Define requirement
2. Define module boundary
3. Define data ownership
4. Define APIs
5. Define permissions
6. Implement
7. Test
8. Document
```

The module should reuse shared platform capabilities.

---

# 27. Module Internal Structure

For a complex module:

```text id="x5h2j0"
module/
├── models/
├── schemas/
├── repositories/
├── services/
├── routes/
├── tests/
└── reports/
```

For a small module, unnecessary layers should not be introduced solely for structural consistency.

---

# 28. Security Rules for Development

Developers must ensure:

* Authentication is required.
* Authorization is enforced server-side.
* Permissions are checked before sensitive operations.
* Secrets are not stored in source code.
* External credentials remain backend-side.
* User input is validated.
* Sensitive errors are not exposed.
* Important mutations are audited.

---

# 29. Integration Rules

External integrations should be isolated from business modules where practical.

For Microsoft 365:

```text id="t7c9x2"
ERP Module
    ↓
Backend Integration Layer
    ↓
Microsoft Graph
    ↓
Microsoft 365
```

The frontend should not hold server-side Graph credentials.

---

# 30. Development Workflow

Recommended implementation sequence:

```text id="q7s4b0"
Requirement
 ↓
Design
 ↓
Database/API Design
 ↓
Implementation
 ↓
Testing
 ↓
Review
 ↓
Deployment
 ↓
Documentation Update
```

A significant implementation change should result in the relevant technical documentation being updated.

---

# 31. Current Technical Gaps

The current implementation does not use exactly the same internal structure in every module.

Known patterns include:

* Full layering in Platform, CRM and R&D.
* Flat route-oriented implementation in ERP, Purchase, P2P, Vendor, Store, Design and Electrical.
* Minimal route-only implementation in HR.

These differences should not automatically be treated as defects.

Refactoring should be driven by maintainability, complexity, testing requirements, or performance—not by directory symmetry alone.

---

# 32. Technical Change Management

Update the LLD when:

* A module's internal architecture changes.
* A major data model changes.
* API implementation changes significantly.
* Business logic moves between layers.
* A new internal service/repository layer is introduced.
* Cross-module coupling changes.
* Authentication/session implementation changes.

Minor code edits do not require an LLD revision.

---

# 33. Version Control

```text id="e4k9v1"
v1.0
Initial implementation baseline

v1.1
Minor implementation changes

v1.2
Additional module implementation

v2.0
Major architectural/implementation change
```

Previous approved versions should be retained.

---

# 34. Related Documents

* Project Charter
* BRD
* PRD
* Scope Document
* Software Architecture Document
* HLD
* Database Design
* API Documentation
* Security Documentation
* Integration Documentation
* Testing Documentation
* Deployment Documentation
* Module Documentation

---

# 35. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 36. Document Status

**Document:** Low-Level Design
**Project:** ERP-PremnathRail
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Organization:** PremnathRail
**Date:** 31 August 2026
