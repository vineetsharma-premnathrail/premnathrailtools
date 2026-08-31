# ERP-PremnathRail — Scope Document

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Prepared by:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document defines the **current scope of ERP-PremnathRail**.

It establishes:

* What is currently included.
* What is currently excluded.
* What is planned for future expansion.
* Which modules are currently active.
* The boundaries between ERP-PremnathRail and external systems.

Unlike the BRD and PRD, this document should remain focused on **scope boundaries**, not detailed requirements or technical implementation.

The scope is a living document and should be updated when a module is added, removed, significantly expanded, or officially taken out of scope.

---

# 2. Scope Principles

ERP-PremnathRail follows these principles:

1. Build a custom ERP for PremnathRail.
2. Connect the organization's departments and business processes.
3. Maintain centralized structured business data.
4. Avoid unnecessarily duplicating existing systems.
5. Add departments and modules progressively.
6. Keep clear boundaries between ERP functionality and external systems.
7. Expand the system according to business priority and organizational readiness.

---

# 3. Current Product Scope

The current ERP scope consists of the following major areas:

```text
ERP-PremnathRail
│
├── Platform / Administration
├── CRM
├── ERP
├── R&D
├── Purchase
├── P2P
├── Design
├── Electrical
├── Store
├── Vendor
└── HR
```

These represent the current active product areas documented for ERP-PremnathRail.

---

# 4. In-Scope Modules

## 4.1 Platform / Administration

The platform provides shared ERP capabilities including:

* User management
* Department management
* Team management
* Role management
* Permission management
* Authentication integration
* Module access
* Notifications
* Audit logging
* Administrative functionality

Microsoft Azure is used for authentication, while ERP-PremnathRail controls application-level authorization.

---

## 4.2 CRM

CRM covers customer and Business Development activities.

Current scope includes:

* Organization management
* Contact management
* Inquiry management
* Tender management
* Quotation management
* Customer PO capture
* Activities
* Calls
* Meetings
* Site visits
* Minutes of Meeting
* Competitor tracking
* Cross-department tasks
* Approval gates
* Notes
* Documents
* Dashboard information
* Bulk import
* Quotation export

Primary business flow:

```text
Inquiry
   ↓
Tender
   ↓
Quotation
   ↓
Customer PO
```

---

## 4.3 ERP — Machine & Service

The ERP operational area includes:

* Machine/project registry
* Warranty information
* AMC information
* Commissioning information
* Service Requests
* Service Request lifecycle
* Materials
* Service documents
* Audit history
* Recoverable deletion
* Purchase Requisition initiation from service material requirements

Primary service flow:

```text
Service Request
      ↓
Assignment
      ↓
Scheduling
      ↓
Execution
      ↓
Materials
      ↓
Completion
      ↓
Review
      ↓
Closure
```

---

## 4.4 R&D

The R&D scope includes engineering calculation capabilities.

Current calculation areas include:

* Braking
* Hydraulic
* Load distribution
* Qmax
* Spline
* Tractive effort
* Vehicle performance

The module supports calculation history and report generation where implemented.

---

## 4.5 Purchase — Service Linked

The service-linked purchasing scope covers material requirements originating from Service Requests.

Current scope includes:

* Purchase Requisition creation
* Approval
* Rejection
* Cancellation
* Closure
* Line-item remarks
* Material information
* Photo/attachment handling

This purchasing path is distinct from the standalone P2P workflow.

---

## 4.6 P2P — Standalone Purchase

The standalone P2P process covers department-independent purchasing.

Current scope:

```text
Purchase Request
      ↓
Approval
      ↓
Buyer Assignment
      ↓
RFQ
      ↓
Vendor Selection
      ↓
Purchase Order
      ↓
Receipt
      ↓
Closure
```

It includes:

* Multi-level approval
* Buyer assignment
* RFQ
* Vendor selection
* PO processing
* Receipt tracking
* Supporting attachments
* Specification documents
* PO documents

---

## 4.7 Design

The Design module covers engineering document management.

Current scope includes:

* Engineering document upload
* Document retrieval
* Revision history
* Document status
* Review/approval workflow

SharePoint remains the underlying document-storage platform where applicable.

---

## 4.8 Electrical

The Electrical module covers work-order management.

Current scope includes:

* Work-order creation
* Work-order listing
* Work-order details
* Assignment
* Status updates
* Work-order completion

---

## 4.9 Store

The Store module covers centralized inventory information.

Current scope includes:

* Stock locations
* Stock items
* Stock transactions
* Stock movement

The objective is to reduce dependency on separate location-level spreadsheets.

---

## 4.10 Vendor

The Vendor module provides a centralized vendor master.

Current scope includes:

* Vendor creation
* Vendor listing
* Vendor details
* Vendor updates
* Vendor metadata

The vendor master should progressively become the common vendor source for applicable purchasing processes.

---

## 4.11 HR

The current HR scope is a basic employee directory.

Current scope includes:

* Employee listing
* Employee information
* Basic employee record editing

The future depth of HR functionality remains subject to business approval.

---

# 5. External Systems and Scope Boundaries

ERP-PremnathRail will integrate with existing organizational systems where appropriate rather than unnecessarily replacing them.

## Microsoft Azure

**In Scope:** Authentication and organizational identity integration.

**ERP Responsibility:** Application authorization, roles, permissions, department access, team access.

---

## SharePoint

**In Scope:** Integration with ERP records for relevant documents.

**Out of ERP Scope:** Rebuilding SharePoint as a separate document-storage system.

SharePoint remains the organization's document-storage platform.

---

## Microsoft Teams

**In Scope:** Making ERP-PremnathRail available inside the organization's Microsoft Teams environment.

Teams provides an additional access/collaboration channel.

---

# 6. Explicitly Out of Scope

The following are currently outside the ERP's direct scope.

| Item                                | Current Position                                    |
| ----------------------------------- | --------------------------------------------------- |
| Email client                        | Out of scope; Outlook remains the email environment |
| Independent document-storage system | Out of scope; SharePoint remains document storage   |
| Unapproved third-party replacements | Out of scope                                        |
| Unapproved future modules           | Out of scope until approved                         |

---

# 7. Finance / Accounting Scope

Finance requires special scope treatment.

A previous scope position considered Finance/Accounting outside ERP scope because SAP served as the system of record.

That position has subsequently changed.

A **general ledger / AP / AR capability is now considered an approved future/current product direction**, subject to detailed business and product requirements.

Therefore:

**Historical:** Finance was out of scope.

**Current direction:** Finance functionality may be developed as a dedicated ERP module.

The exact Finance scope must be defined separately before implementation.

---

# 8. HR Scope Clarification

HR is currently **in scope at a basic level** because an employee-directory capability exists.

The future scope remains undecided.

Two possible directions are:

### Option A — Lightweight HR

ERP provides:

* Employee directory
* Basic employee information

while another HR system remains authoritative for formal HR functions.

### Option B — Expanded HR

ERP progressively provides additional HR capabilities.

The final direction requires approval from **Madhav Arora Sir**.

---

# 9. Future Scope

ERP-PremnathRail is intended to expand progressively.

Potential future areas include:

* Finance / Accounts
* Production
* Quality
* Maintenance
* Operations
* Advanced Project Management
* Additional department-specific modules
* Desktop application
* Mobile application
* Additional organizational integrations

These are **future possibilities**, not automatically approved implementation commitments.

---

# 10. Department Expansion

There is no requirement to implement every department simultaneously.

New departments should be added when:

* Business need is established.
* Requirements are understood.
* Priority is confirmed.
* Resources are available.
* Sponsor/business approval is obtained.

Conceptually:

```text
Current ERP
     ↓
Department Requirement
     ↓
Business Approval
     ↓
Module Definition
     ↓
Development
     ↓
Testing
     ↓
Release
     ↓
ERP Expansion
```

---

# 11. Scope Boundaries

This document does **not** define:

* Detailed field-level requirements
* Detailed UI behavior
* Database implementation
* API specifications
* Coding standards
* Detailed security implementation
* Detailed test cases
* Deployment procedures

Those belong in the appropriate product, module, engineering, security, testing, and operations documentation.

---

# 12. Scope Change

The scope must be reviewed when:

* A new module is approved.
* A module is removed.
* A module's business responsibility significantly changes.
* An external system boundary changes.
* A previously excluded capability becomes approved.
* A future module becomes an active implementation priority.

Major scope decisions require approval from **Madhav Arora Sir**.

---

# 13. Scope Status Model

Each scope item should have one of these statuses:

| Status       | Meaning                         |
| ------------ | ------------------------------- |
| Active       | Currently part of ERP scope     |
| Planned      | Approved/expected future work   |
| Under Review | Business decision pending       |
| Out of Scope | Explicitly excluded             |
| Retired      | Previously included but removed |

This prevents planned features from being confused with currently available functionality.

---

# 14. Scope Versioning

The Scope Document is a controlled, versioned document.

Example:

```text
v1.0
Initial scope baseline

v1.1
New approved module added

v1.2
Module boundary changed

v2.0
Major scope expansion
```

Previous approved versions should be retained.

The current version represents the active scope; older versions remain available for historical traceability.

---

# 15. Scope Management Principle

The ERP-PremnathRail scope should describe **what the product is responsible for**, not simply list every feature that exists in the codebase.

A feature belongs in scope when it has a legitimate business purpose and is accepted as part of the ERP product.

Technical implementation details should remain in the appropriate engineering documentation.

---

# 16. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 17. Document Status

**Document:** ERP-PremnathRail Scope Document
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Organization:** PremnathRail
**Date:** 31 August 2026

**Update Trigger:** Update this document whenever the approved product scope, module boundaries, external-system responsibilities, or future-scope decisions materially change.
