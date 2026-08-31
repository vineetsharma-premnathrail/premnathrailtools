# ERP-PremnathRail — Product Requirements Document (PRD)

**Organization:** PremnathRail
**Product:** ERP-PremnathRail
**Prepared by:** Vineet Sharma
**Date:** 31 August 2026
**Version:** 1.0
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Expected Users:** <150
**Initial Platform:** Web Application

---

# 1. Purpose

This PRD defines **what ERP-PremnathRail should provide as a product**.

The BRD defines the organization's business needs. This PRD converts those needs into product capabilities, modules, users, workflows, and expected outcomes.

It is the product-level reference for subsequent software requirements, design, development, testing, and deployment.

---

# 2. Product Vision

ERP-PremnathRail will be a **single interconnected internal business platform** for PremnathRail.

The platform will connect departments, teams, projects, workflows, business records, and documents while providing controlled access to information.

The product will progressively expand as additional departments and business requirements are approved.

The ERP will not unnecessarily duplicate systems that already perform a required organizational function. For example, **SharePoint remains the document-storage platform**, while ERP-PremnathRail provides the business context and controlled access to relevant documents.

---

# 3. Product Goals

1. Centralize business operations in one ERP platform.
2. Connect departments and teams through interconnected workflows.
3. Provide end-to-end visibility of projects and business activities.
4. Replace fragmented spreadsheet-based workflows where ERP functionality is approved.
5. Maintain a centralized structured business database.
6. Provide controlled cross-department access.
7. Provide role-based application functionality.
8. Integrate with SharePoint for document storage.
9. Provide Microsoft Teams access to the ERP application.
10. Maintain auditability of important business activities.
11. Support progressive addition of new departments and modules.
12. Establish a scalable foundation for future desktop and mobile applications.

---

# 4. Target Users

| User                         | Primary Responsibilities                                     |
| ---------------------------- | ------------------------------------------------------------ |
| Management                   | Organizational visibility, approvals, decisions, reporting   |
| Administrator                | User, department, team, role and permission management       |
| Department Head              | Department operations, users, workflows and approvals        |
| Team Lead                    | Team activities, assignments and progress                    |
| Employee                     | Execute assigned business activities                         |
| Service & Commissioning User | Service, commissioning and project-related activities        |
| Business Development User    | Customer, inquiry, tender and quotation activities           |
| Purchase User                | Requisitions, vendors, RFQs, purchase and receipt activities |
| Engineering User             | Engineering calculations and technical work                  |
| Design User                  | Engineering documents and revision workflows                 |
| Electrical User              | Electrical work orders                                       |
| Store User                   | Inventory and stock transactions                             |
| HR User                      | Employee information and directory                           |

---

# 5. Organizational Product Structure

ERP-PremnathRail will use the following conceptual structure:

```text
Organization
    ↓
Department
    ↓
Team
    ↓
User
    ↓
Role
    ↓
Permission
    ↓
Business Data / Workflow
```

This structure will support organization management, access control, reporting, and workflow assignment.

---

# 6. Platform Strategy

## 6.1 Initial Platform

The first implementation will be a **web application**.

## 6.2 Microsoft Teams

The ERP application will also be made available through the organization's **Microsoft Teams environment**.

Teams will provide an additional access/collaboration channel; ERP-PremnathRail remains the primary business application.

## 6.3 Future Platforms

Future development may include:

* Desktop application
* Mobile application
* Additional integrations

These are future product directions and are not part of the initial web implementation.

---

# 7. Authentication and Authorization

## Authentication

Microsoft Azure will be used for:

* User authentication
* Identity verification
* Login
* Microsoft identity integration

## Authorization

ERP-PremnathRail will control:

* Roles
* Permissions
* Department access
* Team access
* Feature access
* Business-data access
* Cross-department access

Authentication and authorization are therefore separate product responsibilities.

---

# 8. Core Product Architecture

At a product level:

```text
Users
  │
  ▼
Azure Authentication
  │
  ▼
ERP-PremnathRail Web Application
  │
  ├── Platform
  ├── CRM
  ├── ERP
  ├── Purchase / P2P
  ├── Vendor
  ├── Service & Commissioning
  ├── Design
  ├── Electrical
  ├── Store
  ├── R&D
  ├── HR
  └── Future Modules
          │
          ▼
   Central Business Database
          │
          ├── SharePoint
          └── External Integrations
```

---

# 9. Platform Module

The Platform module provides capabilities shared by the rest of the ERP.

## Required capabilities

* Authentication integration
* User directory
* User management
* Department management
* Team management
* Role management
* Permission management
* Module access
* Notifications
* Audit logging
* Feedback management
* Administrative controls

The platform should provide common capabilities once and allow business modules to reuse them.

---

# 10. CRM Module

CRM will support business-development and customer-related workflows.

## Core capabilities

* Organization management
* Contact management
* Inquiry management
* Tender management
* Quotation management
* Customer PO tracking
* Activities
* Calls
* Meetings
* Site visits
* Minutes of Meeting
* Competitor tracking
* Cross-department tasks
* Approval gates
* Bulk import
* Recycle bin
* Reporting
* Quotation export

### Primary workflow

```text
Inquiry
   ↓
Tender
   ↓
Quotation
   ↓
Customer PO
```

Each important stage should be traceable.

---

# 11. ERP — Machine & Service Module

The ERP module will provide operational management for machines/projects and service activities.

## Core capabilities

* Machine/project registry
* Warranty tracking
* AMC tracking
* Commissioning dates
* Service Requests
* Service Request status lifecycle
* Material tracking
* Service-related documents
* Audit trail
* Recycle bin
* Purchase Requisition creation from service materials

The Service Request should provide visibility into the complete service lifecycle.

---

# 12. Purchase Module

The product currently supports two purchase paths.

## 12.1 Service-Linked Purchase

A Purchase Requisition can be raised from the material requirements of an existing Service Request.

Capabilities include:

* Approval
* Rejection
* Cancellation
* Closure
* Line-item remarks
* Photo gallery

## 12.2 Standalone P2P

The standalone purchasing workflow supports:

```text
Request
 ↓
Approval
 ↓
Buyer Assignment
 ↓
RFQ
 ↓
Vendor Selection
 ↓
PO
 ↓
Receipt
 ↓
Close
```

It supports:

* Multi-level approvals
* Vendor master
* RFQ
* PO tracking
* Receipt tracking
* Typed attachments

The product will deliberately treat convergence of these two purchase paths as a product decision rather than assuming they should automatically be merged.

---

# 13. Vendor Module

The Vendor module will provide a centralized vendor master.

Capabilities:

* Create vendor
* View vendor
* Update vendor
* List vendors
* Vendor metadata
* Vendor lookup for P2P

---

# 14. R&D Module

The R&D module will provide engineering calculation capabilities.

Current calculator areas include:

* Braking
* Hydraulic
* Load distribution
* Qmax
* Spline
* Tractive effort
* Vehicle performance

Capabilities include:

* Run calculation
* Save calculation
* View calculation history
* Rename calculation
* Delete calculation
* Generate PDF/DOCX reports
* Administrative history visibility

---

# 15. Design Module

The Design module will manage engineering documentation.

Capabilities:

* Engineering document upload
* Document revision history
* Document retrieval
* Review workflow
* Approval workflow
* Document status

SharePoint remains the underlying document-storage platform where applicable.

---

# 16. Electrical Module

The Electrical module will manage electrical work orders.

Capabilities:

* Create work order
* List work orders
* View work-order details
* Assign responsible person
* Update work-order status
* Track work-order lifecycle

---

# 17. Store Module

The Store module will manage inventory-related information.

Capabilities:

* Stock locations
* Stock items
* Stock transactions
* Movement between locations
* Inventory visibility

---

# 18. HR Module

The initial HR capability will provide a basic employee directory.

Capabilities:

* Employee listing
* Employee information
* Basic employee record editing

The future depth of the HR module remains subject to business confirmation.

---

# 19. Document Management

ERP-PremnathRail will integrate with SharePoint rather than becoming a separate document-storage platform.

The ERP should allow business records to reference relevant documents such as:

* Project documents
* Service documents
* Engineering documents
* Purchase documents
* Customer documents
* Department documents

Document visibility must follow ERP authorization and applicable SharePoint access controls.

---

# 20. Workflow & Approval

The product should support reusable workflow and approval capabilities.

A typical workflow may be:

```text
Create
  ↓
Submit
  ↓
Review
  ↓
Approve / Reject
  ↓
Process
  ↓
Complete
```

Different modules may define different workflow stages.

---

# 21. Cross-Department Collaboration

ERP-PremnathRail must support controlled information flow between departments.

Example:

```text
Business Development
        ↓
Customer / Project
        ↓
Service & Commissioning
        ↓
Purchase
        ↓
Store
        ↓
Finance / Management
```

The actual workflow will be defined by approved business processes.

A user can access another department's information only when authorized.

---

# 22. Search

The platform should provide centralized search across authorized business information.

Potential search areas:

* Projects
* Customers
* Vendors
* Users
* Departments
* Teams
* Tasks
* Documents
* Business records

Search results must respect authorization.

---

# 23. Notifications

The platform should provide notifications for relevant business events.

Examples:

* Task assignment
* Approval request
* Approval decision
* Workflow status change
* Project update
* Important administrative event

Notification behavior will be defined at module level.

---

# 24. Dashboard & Reporting

Dashboards should change according to the user's role and responsibilities.

### Management

* Business overview
* Project visibility
* Department status
* Pending approvals
* Important KPIs

### Department

* Department activities
* Pending tasks
* Department workflows
* Relevant reports

### Individual User

* Assigned tasks
* Pending approvals
* Recent activities
* Relevant notifications

---

# 25. Audit & Accountability

The platform should maintain an audit trail for important actions.

Audit records may include:

* User
* Action
* Record
* Timestamp
* Previous value
* New value
* Approval activity
* Permission changes
* Administrative actions

Destructive business actions should use controlled deletion/recovery mechanisms where applicable.

---

# 26. Recycle Bin

Important modules should support recoverable deletion rather than immediate permanent deletion.

Expected behavior:

```text
Active Record
     ↓
Delete
     ↓
Recycle Bin
     ↓
Restore OR Permanent Delete
```

Permanent deletion should be restricted to authorized users where applicable.

---

# 27. Data Migration

ERP-PremnathRail is a new ERP system.

Existing data may exist in:

* Excel
* Department spreadsheets
* Documents
* Existing business records

Migration should follow:

```text
Identify
 ↓
Collect
 ↓
Clean
 ↓
Map
 ↓
Validate
 ↓
Migrate
 ↓
Verify
```

Migration requirements will be defined separately for each department.

---

# 28. Current Product Status

The PRD should distinguish between **implemented**, **planned**, and **future** functionality.

At the current documentation baseline, the major implemented product areas include:

* Platform/Admin
* CRM
* ERP/Machine & Service
* R&D
* Purchase
* P2P
* Design
* Electrical
* Store
* Vendor
* HR

Any repository structure that is not actually connected to the running application should not automatically be treated as a live product feature.

---

# 29. Product Scope Expansion

The ERP will expand progressively.

Potential future modules include:

* Finance / Accounts
* Production
* Quality
* Maintenance
* Operations
* Project Management
* Additional organizational functions

A new module should receive its own module-level requirements before development begins.

---

# 30. Non-Goals

ERP-PremnathRail will not unnecessarily duplicate systems already serving their intended organizational purpose.

Examples:

* SharePoint remains the document-storage system.
* Microsoft Azure remains the authentication system.
* Microsoft Teams provides an additional application-access/collaboration environment.

Any replacement of an existing organizational system requires separate business approval.

---

# 31. Product Constraints

Current constraints include:

* Initial development is led by Vineet Sharma.
* A dedicated development team is not currently established.
* Requirements will evolve as departments are analyzed.
* No fixed final go-live date has been established.
* Department rollout is progressive.
* Technical capacity can affect development speed.

---

# 32. Product Risks

| Risk                                         | Product Impact                   |
| -------------------------------------------- | -------------------------------- |
| Scope grows faster than development capacity | Delayed delivery                 |
| Requirements change frequently               | Rework                           |
| Poor legacy data                             | Incorrect information            |
| Complex permissions                          | Unauthorized access              |
| Low user adoption                            | Reduced product value            |
| Multiple purchase paths                      | Product/process duplication      |
| Growing module count                         | Increased maintenance complexity |
| Single-person dependency                     | Development bottleneck           |

---

# 33. Product Success Metrics

The following are **initial directional targets**, not established historical measurements:

* Target user adoption: **80%**
* Target productivity improvement: approximately **1 hour/user/week**
* Target user satisfaction: **>4/5**
* Target system availability: **>99.5%**
* Target page-load performance: **<2 seconds**

These metrics should be recalibrated once real production usage data becomes available.

---

# 34. Product Lifecycle

ERP-PremnathRail will follow:

```text
Business Need
     ↓
Requirement
     ↓
Product Definition
     ↓
Design
     ↓
Development
     ↓
Testing
     ↓
User Acceptance
     ↓
Release
     ↓
Production
     ↓
Feedback
     ↓
Enhancement
```

The product is expected to evolve continuously.

---

# 35. Requirement & Change Management

The PRD should be updated when there is a meaningful product-level change, such as:

* New module
* Major feature
* Feature removal
* Major workflow change
* Product scope change
* Major integration change
* Resolution of an important product decision

Small implementation details should remain in the relevant module or technical documentation rather than unnecessarily changing the PRD.

---

# 36. Documentation Relationship

The documentation hierarchy is:

```text
Project Charter
      ↓
BRD
      ↓
PRD
      ↓
SRS
      ↓
Architecture / Design
      ↓
Module Documentation
      ↓
Development
      ↓
Testing
      ↓
Deployment
      ↓
Operations
```

The PRD is therefore the **product-level source of truth**, while detailed module and engineering documents provide deeper implementation information.

---

# 37. Document Versioning

**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Approved By:** Madhav Arora Sir

The PRD should use version control.

Example:

```text
v1.0 → Initial approved product baseline
v1.1 → Minor product changes
v1.2 → Additional minor changes
v2.0 → Major product/scope change
```

Previous approved versions should be retained for historical traceability.

---

# 38. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 39. Document Status

**Document:** Product Requirements Document
**Project:** ERP-PremnathRail
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Organization:** PremnathRail
**Date:** 31 August 2026
