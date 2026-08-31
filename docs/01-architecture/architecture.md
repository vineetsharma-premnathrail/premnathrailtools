# ERP-PremnathRail — Software Architecture Document

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Document:** Software Architecture Document
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document defines the technical architecture of ERP-PremnathRail.

It describes:

* Overall system structure
* Architectural style
* Application layers
* Request flow
* Module boundaries
* Authentication and authorization
* Data storage
* External integrations
* Deployment architecture
* Scalability approach

This document explains **how the system is technically structured**. Business requirements belong to the BRD, while product capabilities belong to the PRD.

---

# 2. Architecture Principles

ERP-PremnathRail follows these principles:

1. Modular architecture
2. Clear separation of business modules
3. Centralized authorization
4. Centralized structured business data
5. Reuse of shared platform capabilities
6. Backend-controlled external integrations
7. Controlled cross-module dependencies
8. Progressive scalability
9. Security by design
10. Maintainability over unnecessary architectural complexity

---

# 3. Architectural Style

ERP-PremnathRail currently follows a **Modular Monolith** architecture.

The system is deployed as a single application while internally maintaining separate business modules.

Conceptually:

```text id="drf7s9"
                 ERP-PremnathRail
                        │
        ┌───────────────┼────────────────┐
        │               │                │
     Platform          CRM              ERP
        │               │                │
     Users           Sales          Service/Projects
     Roles
     Permissions
        │
        ├── Purchase
        ├── P2P
        ├── R&D
        ├── Design
        ├── Electrical
        ├── Store
        ├── Vendor
        └── HR
```

The modular monolith approach provides clear internal boundaries without the operational complexity of maintaining many independent services.

The architecture should allow individual modules to be extracted into separate services later if business scale or technical requirements justify it.

---

# 4. High-Level System Architecture

```text id="8r2qgv"
Users
  │
  ├── Web Browser
  │
  └── Microsoft Teams
          │
          ▼
   ERP Frontend
          │
          ▼
      Backend API
          │
   ┌──────┼───────────────┐
   │      │               │
Auth   Business Modules   Shared Services
   │      │               │
   │      ├── CRM         │
   │      ├── ERP         │
   │      ├── Purchase    │
   │      ├── P2P         │
   │      ├── R&D         │
   │      ├── Design      │
   │      ├── Electrical  │
   │      ├── Store       │
   │      ├── Vendor      │
   │      └── HR          │
   │
   ▼
PostgreSQL
   │
   └── Business Data

Backend
   │
   ├── Microsoft Graph
   │       └── SharePoint
   │
   └── Microsoft 365 Services
```

---

# 5. Request Flow

A typical request follows:

```text id="c6b7l3"
User
 ↓
Frontend
 ↓
API Request
 ↓
Security Middleware
 ↓
Authentication
 ↓
Authorization
 ↓
Route
 ↓
Business Logic
 ↓
Database / External Service
 ↓
Response
 ↓
Frontend
```

### Step 1 — Frontend

The frontend sends an HTTP request to the backend API.

### Step 2 — Middleware

The request passes through applicable security and request-processing middleware.

### Step 3 — Authentication

The backend verifies that the user has an authenticated session.

### Step 4 — Authorization

The application determines whether the user has access to the requested module and operation.

### Step 5 — Business Processing

The relevant module processes the operation.

### Step 6 — Data Access

The module accesses the database or an approved external integration.

### Step 7 — Response

The backend returns a structured response to the frontend.

---

# 6. Application Layers

The intended module structure is:

```text id="ks5mzf"
Module
├── routes/
├── schemas/
├── services/
├── repositories/
├── models/
└── tests/
```

Responsibilities:

### Routes

Handle HTTP requests and responses.

### Schemas

Define request and response data structures.

### Services

Contain business logic where the module requires a dedicated service layer.

### Repositories

Contain database-access logic where the repository pattern is used.

### Models

Represent database entities.

### Tests

Contain module-specific automated tests.

Not every existing module currently uses all layers. Existing module structure should be respected unless a deliberate refactoring decision is made.

---

# 7. Module Architecture

The current architecture contains these major modules:

| Module     | Responsibility                                                  |
| ---------- | --------------------------------------------------------------- |
| Platform   | Authentication, users, roles, permissions, audit, notifications |
| CRM        | Organizations, inquiries, tenders, quotations, activities       |
| ERP        | Projects, machines, service requests, service materials         |
| Purchase   | Service-linked purchasing                                       |
| P2P        | Standalone purchasing workflow                                  |
| R&D        | Engineering calculations                                        |
| Vendor     | Vendor master                                                   |
| Store      | Inventory                                                       |
| Design     | Engineering documents                                           |
| Electrical | Electrical work orders                                          |
| HR         | Employee directory                                              |

The module inventory should be verified against actual application routing when maintained.

---

# 8. Module Boundaries

Each module should own its business responsibility.

For example:

```text id="qef4aq"
CRM
 └── Customer / Sales Processes

ERP
 └── Project / Service Processes

Purchase
 └── Service-linked Purchasing

P2P
 └── General Purchasing

Vendor
 └── Vendor Master

Store
 └── Inventory
```

Cross-module interaction should be deliberate and limited.

---

# 9. Purchase and P2P Boundary

Two purchasing systems currently exist.

### Purchase

Service-linked purchasing:

```text id="h1ep3u"
Service Request
      ↓
Material
      ↓
Purchase Requisition
```

### P2P

General purchasing:

```text id="e3s7sq"
Department
    ↓
Purchase Request
    ↓
Approval
    ↓
RFQ
    ↓
Vendor
    ↓
PO
    ↓
Receipt
```

They should remain separate until an approved product/architecture decision determines that consolidation is beneficial.

---

# 10. Platform Architecture

The Platform module provides shared capabilities.

```text id="7y1k3f"
Platform
├── Authentication
├── Users
├── Departments
├── Teams
├── Roles
├── Permissions
├── Notifications
├── Audit
└── Administration
```

Business modules should reuse these shared capabilities rather than implementing independent versions.

---

# 11. Authentication Architecture

Microsoft Azure / Microsoft Entra ID is responsible for organizational identity authentication.

The application does not maintain an independent username/password authentication system.

Conceptually:

```text id="1nd7or"
User
 ↓
Microsoft Identity
 ↓
Authenticated Session
 ↓
ERP
```

The architecture supports both:

* Browser authentication
* Microsoft Teams embedded application authentication

---

# 12. Authorization Architecture

Authentication answers:

> **Who is the user?**

Authorization answers:

> **What can the user do?**

ERP-PremnathRail controls application authorization.

The access model is:

```text id="j0n1xm"
User
 ↓
Role
 ↓
Department / Team
 ↓
Module Access
 ↓
Permission
 ↓
Action
```

Permissions may control actions such as:

* View
* Create
* Edit
* Delete
* Approve
* Assign
* Restore

Cross-department access must be explicitly authorized.

---

# 13. Database Architecture

ERP-PremnathRail uses a centralized relational database.

Current architecture uses PostgreSQL.

Conceptually:

```text id="t7j5t5"
              PostgreSQL
                  │
       ┌──────────┼──────────┐
       │          │          │
      CRM        ERP       P2P
       │          │          │
    crm_*       erp_*     p2p_*
       │          │          │
       └──────────┼──────────┘
                  │
            Central Data
```

Each module should maintain clear ownership of its tables.

Database schema changes should be managed through controlled migrations.

---

# 14. Data Ownership

Module boundaries should be reflected in data ownership.

Example:

```text id="n2y9r8"
CRM
 └── CRM data

ERP
 └── Project / Service data

P2P
 └── P2P data

Store
 └── Inventory data

Vendor
 └── Vendor data
```

Modules should avoid directly modifying another module's internal tables unless the dependency is explicitly designed and documented.

---

# 15. Document Architecture

ERP-PremnathRail does not need to become a separate file-storage system.

The intended architecture is:

```text id="x1g8t6"
ERP Record
     │
     ▼
Document Reference
     │
     ▼
Microsoft Graph API
     │
     ▼
SharePoint
     │
     ▼
File
```

The ERP database stores business metadata and references, while SharePoint stores the actual documents.

---

# 16. Integration Architecture

Microsoft 365 integrations are handled through the backend.

```text id="v8c1s2"
ERP Frontend
      │
      ▼
ERP Backend
      │
      ├── Microsoft Graph
      │       ├── SharePoint
      │       └── Microsoft 365 services
      │
      └── Other approved APIs
```

The frontend should not directly implement business-critical Microsoft Graph operations.

Microsoft Teams client functionality may be used by the frontend to detect and operate within the Teams environment.

---

# 17. API Architecture

The backend exposes versioned APIs.

Conceptually:

```text id="x7d4zq"
Frontend
   ↓
/api/v1/
   ↓
Module Router
   ↓
Module Logic
   ↓
Database / Integration
```

API contracts should be documented separately in API documentation.

---

# 18. Security Architecture

Security responsibilities are distributed as follows:

| Area                      | Responsibility             |
| ------------------------- | -------------------------- |
| Identity                  | Microsoft Azure / Entra ID |
| Authentication            | Microsoft identity         |
| Application Authorization | ERP                        |
| Roles                     | ERP                        |
| Permissions               | ERP                        |
| Department Access         | ERP                        |
| Team Access               | ERP                        |
| Audit                     | ERP                        |
| Document Storage          | SharePoint                 |
| API Integration           | Backend                    |

Security should be applied consistently across all modules.

---

# 19. Audit Architecture

Important business and administrative activities should be recorded.

Examples:

* User changes
* Permission changes
* Record changes
* Approval actions
* Administrative actions
* Important workflow actions

Conceptually:

```text id="y6x3i2"
User Action
    ↓
ERP Operation
    ↓
Audit Record
    ↓
Audit History
```

---

# 20. Frontend Architecture

The frontend provides:

* Authentication experience
* Navigation
* Dashboards
* Module interfaces
* Forms
* Tables
* Workflows
* Notifications
* Document access
* Role-aware UI

The frontend should not be treated as the authority for security decisions. Authorization must be enforced by the backend.

---

# 21. Deployment Architecture

The current deployment model is conceptually:

```text id="7j9z4h"
Internet / Organization
          ↓
        Nginx
          ↓
   ERP Application
          ↓
      PostgreSQL
          │
          └── SharePoint / Microsoft Graph
```

The backend is containerized and deployed behind a reverse proxy.

---

# 22. Background Processing

The application currently contains scheduled background processing.

Because background jobs may be sensitive to multiple application instances, scaling the application horizontally must account for scheduler behavior.

Before moving to multiple workers/instances, scheduled jobs should be reviewed and, where necessary, moved to a distributed scheduling mechanism.

---

# 23. Scalability Strategy

The initial architecture prioritizes simplicity and maintainability.

Future scaling can occur through:

1. Application optimization
2. Database optimization
3. Caching where justified
4. Background-job separation
5. Horizontal application scaling
6. Module extraction into independent services when justified

The modular boundaries provide potential extraction points.

Microservices should only be introduced when operational or business requirements justify the additional complexity.

---

# 24. Architectural Constraints

Current constraints include:

* Modular monolith architecture
* Central PostgreSQL database
* Microsoft authentication
* SharePoint document storage
* Backend-controlled Microsoft Graph integration
* Progressive module development
* Current limited development capacity

---

# 25. Architecture Evolution

The architecture is expected to evolve as ERP-PremnathRail grows.

Possible evolution:

```text id="h9v1u7"
Current
Modular Monolith
      ↓
Higher Usage
      ↓
Optimization / Scaling
      ↓
Identify Bottleneck
      ↓
Extract Specific Module
      ↓
Independent Service
```

The system should not be converted to microservices merely because the organization is growing.

---

# 26. Architectural Documentation Boundaries

This document describes **system architecture**.

Detailed information belongs elsewhere:

| Information             | Document                 |
| ----------------------- | ------------------------ |
| Business need           | BRD                      |
| Product capabilities    | PRD                      |
| Software requirements   | SRS                      |
| Detailed implementation | LLD                      |
| Database tables/fields  | Database Design          |
| API contracts           | API Documentation        |
| UI behavior             | UI/UX Documentation      |
| Security requirements   | Security Documentation   |
| Deployment procedures   | Deployment Documentation |

This prevents architecture documentation from becoming unnecessarily large.

---

# 27. Architecture Change Management

This document should be updated when there is a significant architectural change, such as:

* New architectural style
* Major technology replacement
* Database architecture change
* New major integration
* Major authentication change
* Major authorization architecture change
* Module extraction
* Significant deployment architecture change

Minor code-level changes should not require an architecture-document update.

---

# 28. Architecture Versioning

Example:

```text id="0xw2yc"
v1.0
Initial architecture baseline

v1.1
Minor architectural update

v2.0
Major architecture change
```

Previous approved versions should be retained.

The current version represents the active architecture.

---

# 29. Architecture Verification

Architecture documentation should be periodically compared against the actual application.

Verification should include:

* Registered modules
* API routes
* Database structure
* External integrations
* Authentication flow
* Deployment configuration
* Module dependencies

The documentation should describe the **actual architecture**, not an outdated intended architecture.

---

# 30. Related Documents

* Project Charter
* BRD
* PRD
* SRS
* HLD
* LLD
* Database Design
* API Documentation
* Security Documentation
* UI/UX Documentation
* Deployment Documentation
* Module Documentation

---

# 31. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 32. Document Status

**Document:** Software Architecture Document
**Project:** ERP-PremnathRail
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Organization:** PremnathRail
**Date:** 31 August 2026
