# ERP-PremnathRail — High-Level Design (HLD)

**Organization:** PremnathRail  
**Project:** ERP-PremnathRail  
**Document:** High-Level Design  
**Prepared by:** Vineet Sharma  
**Project Lead / Product & Technical Owner:** Vineet Sharma  
**Project Sponsor & Final Approver:** Madhav Arora Sir  
**Date:** 31 August 2026  
**Version:** 1.0  
**Status:** Current  

---

# 1. Purpose

This document defines the **high-level technical design** of ERP-PremnathRail.

The Architecture Document explains the overall architectural approach. This HLD defines the major application components, their responsibilities, communication paths, data flow, integrations, and deployment structure.

Detailed implementation belongs in the LLD and module-level technical documentation.

---

# 2. System Overview

ERP-PremnathRail is a centralized business application consisting of:

```text id="e7t7kg"
Users
  │
  ├── Web Browser
  └── Microsoft Teams
          │
          ▼
   ERP-PremnathRail
          │
    ┌─────┼──────────────┐
    │     │              │
 Frontend Backend      Database
    │     │              │
    │     ├── Graph API  │
    │     │      │       │
    │     │  SharePoint  │
    │     │              │
    └─────┴──────────────┘
```

---

# 3. Major Components

## 3.1 Frontend

The frontend provides the user interface.

Responsibilities:

- Login experience
- Dashboard
- Navigation
- Forms
- Tables
- Module interfaces
- Workflows
- Notifications
- Document access
- Role-aware UI
- Teams embedded experience

The frontend communicates with the ERP backend through APIs.

---

# 4. Backend

The backend is the central application layer.

Responsibilities:

- API endpoints
- Authentication integration
- Authorization
- Business logic
- Validation
- Database operations
- External-system integration
- Audit logging
- Notifications
- Background processing

The backend is the primary control point for business operations.

---

# 5. Backend Module Components

The backend contains the following major modules:

```text id="qu4wgy"
backend
│
├── Platform
├── CRM
├── ERP
├── Purchase
├── P2P
├── R&D
├── Vendor
├── Store
├── HR
├── Design
└── Electrical
```

---

# 6. Platform Component

The Platform component provides shared functionality.

```text id="g6w7qh"
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

Business modules consume these shared capabilities.

---

# 7. CRM Component

CRM provides:

- Organizations
- Contacts
- Inquiries
- Tenders
- Quotations
- Customer PO information
- Activities
- Tasks
- Approvals
- Notes
- Documents
- Dashboard/reporting

High-level flow:

```text id="8ptq7j"
Inquiry
 ↓
Tender
 ↓
Quotation
 ↓
Customer PO
```

---

# 8. ERP Component

ERP provides:

- Projects
- Machine registry
- Service Requests
- Service Materials
- Warranty
- AMC
- Commissioning
- Service documents
- Service-related purchasing initiation

High-level flow:

```text id="v2ngmy"
Project / Machine
      ↓
Service Request
      ↓
Materials
      ↓
Purchase Requirement
      ↓
Service Completion
```

---

# 9. Purchase Component

Purchase handles service-linked purchasing.

```text id="8j7x1j"
ERP Service Request
       ↓
Service Material
       ↓
Purchase Requisition
       ↓
Approval
       ↓
PO
       ↓
Receipt
       ↓
Closure
```

Purchase remains logically connected to ERP because the requirement originates from the Service Request.

---

# 10. P2P Component

P2P provides independent purchasing for departments.

```text id="x3x4z4"
Department
    ↓
Purchase Request
    ↓
Approval
    ↓
Buyer
    ↓
RFQ
    ↓
Vendor
    ↓
PO
    ↓
Receipt
```

P2P does not depend on an ERP Service Request.

---

# 11. R&D Component

R&D provides engineering calculation functionality.

Current areas include:

- Braking
- Hydraulic
- Load distribution
- Qmax
- Spline
- Tractive effort
- Vehicle performance

The module also supports calculation history and applicable report generation.

---

# 12. Vendor Component

Vendor provides the centralized vendor master.

It supplies vendor information to purchasing-related workflows.

```text id="td4ez9"
Vendor Master
     │
     ├── Purchase
     └── P2P
```

---

# 13. Store Component

Store manages:

- Locations
- Stock items
- Stock transactions
- Stock movement

It provides centralized inventory visibility.

---

# 14. Design Component

Design manages engineering documents.

High-level flow:

```text id="xm1y7g"
Engineering Document
        ↓
Upload
        ↓
Revision
        ↓
Review
        ↓
Approval
```

Actual document files are stored in SharePoint where applicable.

---

# 15. Electrical Component

Electrical manages electrical work orders.

```text id="v6w8gc"
Work Order
    ↓
Assignment
    ↓
Execution
    ↓
Status Update
    ↓
Completion
```

---

# 16. HR Component

The current HR component provides basic employee-directory functionality.

Future HR functionality can be added through progressive scope expansion.

---

# 17. Authentication Component

Authentication uses Microsoft Azure / Microsoft Entra ID.

High-level flow:

```text id="4q0q7s"
User
 ↓
Microsoft Entra ID
 ↓
Authentication
 ↓
ERP Session
 ↓
ERP Application
```

The ERP does not maintain a separate user-password authentication system.

---

# 18. Authorization Component

Authorization is controlled by ERP-PremnathRail.

```text id="8n4g1a"
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

Examples:

- View
- Create
- Edit
- Delete
- Approve
- Assign
- Restore

Cross-department access is granted only when authorized.

---

# 19. Database Component

The ERP uses a centralized PostgreSQL database.

```text id="4x1x5s"
             PostgreSQL
                  │
      ┌───────────┼───────────┐
      │           │           │
     CRM         ERP         P2P
      │           │           │
   CRM Data    ERP Data    P2P Data
      │           │           │
      └───────────┼───────────┘
                  │
            Central Database
```

Schema changes are managed through controlled database migrations.

---

# 20. Document Storage Component

ERP business data and document files are separated.

```text id="p6v9qj"
ERP Record
     ↓
Document Reference
     ↓
Backend
     ↓
Microsoft Graph
     ↓
SharePoint
     ↓
Actual File
```

The database stores document metadata/reference information rather than the file itself.

---

# 21. Microsoft Graph Integration

Microsoft Graph provides backend integration with Microsoft 365 services.

Primary uses include:

- SharePoint file operations
- Document access
- Notification/email operations where approved

The frontend does not directly access Graph for business-critical data operations.

---

# 22. Microsoft Teams Integration

ERP-PremnathRail will be available inside the organization's Microsoft Teams environment.

Conceptually:

```text id="q8e4uy"
Microsoft Teams
      ↓
ERP Application
      ↓
ERP Backend
```

Teams provides an additional application-access environment.

The frontend may use the Teams SDK to identify and operate correctly within a Teams tab.

---

# 23. API Layer

Frontend communication follows:

```text id="z8i7at"
Frontend
   ↓
HTTPS
   ↓
/api/v1/
   ↓
Backend Router
   ↓
Module
   ↓
Business Logic
   ↓
Database / Integration
```

API contracts should be documented separately.

---

# 24. Security Boundary

The backend is the main security enforcement boundary.

```text id="m1ot1r"
User
 ↓
Authentication
 ↓
Backend
 ├── Authorization
 ├── Validation
 ├── Business Rules
 └── Audit
      ↓
Database / External Systems
```

Frontend visibility controls must not be treated as sufficient security controls.

---

# 25. Data Flow — P2P Request

```text id="ksk3c6"
User
 ↓
Frontend
 ↓
P2P API
 ↓
Authorization
 ↓
P2P Business Logic
 ↓
PostgreSQL
 ↓
Response
 ↓
Frontend
```

For attachments:

```text id="ys6xgn"
File
 ↓
Frontend
 ↓
Backend
 ↓
Microsoft Graph
 ↓
SharePoint
```

---

# 26. Data Flow — Service Purchase

```text id="8x6uyh"
Service Request
      ↓
Service Materials
      ↓
Raise Purchase Requisition
      ↓
Purchase Module
      ↓
Approval
      ↓
PO
      ↓
Receipt
      ↓
Status reflected back to Service Material
```

This maintains visibility between the service requirement and purchasing progress.

---

# 27. Data Flow — Microsoft Login

```text id="y17ztt"
User
 ↓
ERP Login
 ↓
Microsoft Entra ID
 ↓
Authentication
 ↓
ERP Session
 ↓
Dashboard
```

The user's Microsoft password is handled by Microsoft, not by ERP-PremnathRail.

---

# 28. Deployment Components

The high-level deployment structure is:

```text id="qmtq1n"
Internet / Organization
          ↓
       Reverse Proxy
          ↓
     ERP Application
          ↓
      PostgreSQL
          │
          └── Microsoft 365 Services
```

The application may be containerized and deployed through the organization's approved infrastructure.

Exact infrastructure configuration belongs in Deployment and Infrastructure documentation.

---

# 29. Scalability

The initial design prioritizes maintainability and controlled complexity.

Scaling can occur through:

- Application optimization
- Database optimization
- Caching where justified
- Background processing improvements
- Horizontal application scaling
- Independent scaling/extraction of high-load modules

The system should not introduce distributed architecture until actual business or technical requirements justify it.

---

# 30. Component Dependencies

High-level dependencies are:

```text id="wqg9ae"
Frontend
   ↓
Backend
   ↓
┌───────────────┬────────────────┐
│               │                │
Database      Graph API       Auth
│               │                │
PostgreSQL   SharePoint     Entra ID
```

Business modules should avoid unnecessary direct dependencies on other modules.

---

# 31. Error & Failure Handling

At a high level:

```text id="y1x3a5"
Request
 ↓
Validation
 ↓
Processing
 ↓
Success ──→ Response
    │
    └── Failure
          ↓
       Error Handling
          ↓
       Logged Event
          ↓
       Safe Response
```

Sensitive internal implementation details should not be exposed to users through API error responses.

---

# 32. High-Level Non-Functional Requirements

The system should provide:

### Security
Controlled authentication, authorization, and auditability.

### Performance
Responsive interaction appropriate for organizational workloads.

### Availability
Reliable access to critical business functions.

### Scalability
Ability to support organizational growth.

### Maintainability
Clear module boundaries and reusable platform services.

### Reliability
Controlled handling of failures and data operations.

### Auditability
Traceability of important actions and approvals.

---

# 33. Design Constraints

Current constraints include:

- Modular monolith
- Centralized PostgreSQL database
- Azure/Entra authentication
- ERP-managed authorization
- SharePoint document storage
- Microsoft Teams application access
- Backend-controlled Graph integration
- Progressive module development

---

# 34. HLD Boundaries

This HLD does not define:

- Individual database columns
- Detailed class structures
- Detailed API request/response schemas
- Individual UI components
- Detailed security policies
- Deployment commands
- Detailed test cases

Those belong to lower-level or specialized documentation.

---

# 35. Architecture Evolution

The HLD should evolve with the product.

```text id="kn2f85"
Current
Modular Monolith
       ↓
Growing Usage
       ↓
Identify Bottleneck
       ↓
Optimize
       ↓
Scale
       ↓
Extract Module Only If Justified
```

Architecture changes should be documented before implementation of major changes.

---

# 36. Related Documents

- Project Charter
- BRD
- PRD
- Scope Document
- Software Architecture Document
- SRS
- LLD
- Database Design
- API Documentation
- Security Documentation
- Integration Documentation
- Deployment Documentation
- Module Documentation

---

# 37. Version Control

**v1.0** — Initial HLD baseline.

Future versions should record:

- Version
- Date
- Change summary
- Author
- Approval/status

Previous approved versions should be retained.

---

# 38. Approval

| Name | Role | Signature | Date |
|---|---|---|---|
| Madhav Arora Sir | Project Sponsor & Final Approver | __________ | __________ |
| Vineet Sharma | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 39. Document Status

**Document:** High-Level Design  
**Project:** ERP-PremnathRail  
**Version:** 1.0  
**Status:** Current  
**Prepared By:** Vineet Sharma  
**Organization:** PremnathRail  
**Date:** 31 August 2026