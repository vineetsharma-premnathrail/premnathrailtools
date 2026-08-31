# ERP-PremnathRail — Business Requirements Document (BRD)

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Document:** Business Requirements Document
**Prepared by:** Vineet Sharma
**Business Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document defines the **business requirements of ERP-PremnathRail**.

The BRD describes the business problems, organizational needs, business processes, business rules, stakeholder needs, scope, and expected business outcomes.

It intentionally remains at the **business level**. Detailed screens, APIs, database structures, technologies, and implementation decisions belong in the PRD, SRS, architecture, and module documentation.

---

# 2. Business Context

PremnathRail requires a centralized internal ERP platform to connect its departments and business operations.

The organization currently has business information distributed across departmental Excel files, documents, and other records. This creates a need for a centralized system that can provide better visibility, controlled access, standardized workflows, and connected business processes.

ERP-PremnathRail is being developed as a **new custom ERP**, rather than replacing an existing ERP product.

The objective is not to duplicate systems that already perform specialized functions. Existing organizational platforms such as Microsoft Azure, SharePoint, Microsoft Teams, and other approved systems should be integrated where appropriate.

---

# 3. Business Vision

The organization needs a single interconnected business platform where authorized employees can access the information and workflows required for their responsibilities.

The long-term vision is:

```text
Departments
     ↓
Teams
     ↓
Projects & Business Activities
     ↓
Workflows
     ↓
Approvals
     ↓
Documents & Records
     ↓
Management Visibility
```

The ERP will be expanded progressively as business priorities and organizational requirements become clear.

---

# 4. Business Objectives

### BR-O-01 — Centralization

Create a centralized business information system.

### BR-O-02 — Department Connectivity

Connect organizational departments and teams through controlled business workflows.

### BR-O-03 — Operational Visibility

Provide management and authorized employees with a complete view of relevant business activities.

### BR-O-04 — Process Standardization

Reduce inconsistent manual processes by introducing standardized workflows.

### BR-O-05 — Data Reliability

Reduce duplicate and disconnected business records.

### BR-O-06 — Controlled Access

Ensure employees can access information according to their responsibilities.

### BR-O-07 — Document Accessibility

Allow relevant business records to connect with organizational documents stored in SharePoint.

### BR-O-08 — Progressive Expansion

Allow additional departments and business processes to be added without rebuilding the entire ERP.

---

# 5. Business Problem

The organization needs to reduce dependency on disconnected:

* Excel spreadsheets
* Department files
* Email-based coordination
* Manual tracking
* Repeated data entry
* Separate records

The ERP should provide a connected business environment in which information can move between departments while remaining controlled and traceable.

---

# 6. Business Scope

ERP-PremnathRail is intended to eventually support **all major departments and business functions of PremnathRail**.

Implementation will be progressive rather than based on one fixed implementation date.

Current and emerging business areas include:

* CRM / Business Development
* Service & Commissioning
* Projects
* Purchase
* P2P
* Vendor Management
* Design
* Electrical
* Store / Inventory
* R&D
* HR
* Finance / Accounts
* Other future organizational functions

Each department will receive detailed requirements when that department is formally taken into the implementation scope.

---

# 7. Current Business Requirements

## BR-01 — Service Request Tracking

Every field-service issue associated with a client machine should be trackable from creation through resolution.

The business requires:

* Status tracking
* Responsibility tracking
* Material tracking
* Related documents
* Auditability
* Closure tracking

**Priority:** Critical

---

## BR-02 — Service Material to Purchase

Materials required for service work should be capable of moving into a purchasing process without unnecessary duplicate entry.

Required business flow:

```text
Service Request
      ↓
Material Requirement
      ↓
Purchase Requisition
      ↓
Approval
      ↓
Purchase
      ↓
Receipt
```

**Priority:** Critical

---

## BR-03 — Business Development Lifecycle

Business Development users need to track customer opportunities from initial inquiry through commercial progression.

Expected lifecycle:

```text
Inquiry
 ↓
Tender
 ↓
Quotation
 ↓
Customer PO
```

Relevant activities and approvals should remain traceable.

**Priority:** Critical

---

## BR-04 — Engineering Calculations

Engineering users need to perform approved engineering calculations and generate usable reports without repeatedly depending on manual spreadsheet calculations.

**Priority:** High

---

## BR-05 — Controlled Access

Access to ERP information must reflect organizational responsibilities.

The business requires:

* Module-level access
* Role-based access
* Department access
* Team access
* Action-level permissions where required
* Authorized cross-department access

**Priority:** Critical

---

## BR-06 — Recoverable Deletion

Important business records should not be accidentally lost through permanent deletion.

The business requires a recoverable deletion process where applicable:

```text
Active
  ↓
Deleted
  ↓
Recycle Bin
  ↓
Restore / Permanent Removal
```

**Priority:** High

---

## BR-07 — Microsoft Authentication

Employees should use their existing organizational Microsoft identity to authenticate with the ERP.

The organization should not need to maintain a separate ERP password system.

**Priority:** Critical

---

## BR-08 — Engineering Document Control

Engineering documents should be managed with:

* Revision history
* Review status
* Approval status
* Document association

**Priority:** High

---

## BR-09 — Electrical Work Management

Electrical work should be trackable through a controlled work-order process.

Required business capabilities include:

* Work-order creation
* Assignment
* Status tracking
* Completion

**Priority:** High

---

## BR-10 — Centralized Stock Management

Stock should be tracked centrally instead of relying on independent location spreadsheets.

The business requires visibility of:

* Stock locations
* Stock items
* Stock movements
* Transactions

**Priority:** High

---

## BR-11 — Centralized Vendor Information

Vendor information should be maintained as structured business data rather than repeatedly entered as free text.

**Priority:** High

---

## BR-12 — Employee Directory

Employees require access to a basic internal employee directory.

The depth of future HR functionality remains subject to business confirmation.

**Priority:** Medium

---

# 8. Business Processes

## 8.1 Service & Commissioning

The Service & Commissioning process should provide controlled lifecycle management.

Example:

```text
Service Request
 ↓
Acknowledgement
 ↓
Assignment
 ↓
Scheduling
 ↓
Work
 ↓
Parts / Materials
 ↓
Completion
 ↓
Review
 ↓
Closure
```

Actual workflow stages will be confirmed with the department.

---

## 8.2 CRM / Business Development

```text
Inquiry
 ↓
Tender
 ↓
Quotation
 ↓
Customer PO
 ↓
Project / Operational Handover
```

The exact handover between CRM and project/service processes requires business validation.

---

## 8.3 Purchase — Service Linked

```text
Service Requirement
 ↓
Material Requirement
 ↓
Purchase Requisition
 ↓
Approval
 ↓
Purchase
 ↓
Receipt
 ↓
Closure
```

---

## 8.4 Purchase — P2P

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
PO
 ↓
Receipt
 ↓
Closure
```

The organization currently has both service-linked and standalone purchasing processes. Their future standardization requires a business decision.

---

## 8.5 Engineering Documents

```text
Document Creation
 ↓
Upload
 ↓
Revision
 ↓
Review
 ↓
Approval
 ↓
Controlled Use
```

---

## 8.6 Electrical Work

```text
Work Order
 ↓
Assignment
 ↓
Execution
 ↓
Status Updates
 ↓
Completion
```

---

## 8.7 Store

```text
Stock Item
 ↓
Location
 ↓
Transaction
 ↓
Movement
 ↓
Updated Stock
```

---

# 9. Stakeholder Needs

| Stakeholder     | Business Need                                               |
| --------------- | ----------------------------------------------------------- |
| Management      | Overall business visibility and decision-making information |
| Administrator   | Manage users, access and organizational structure           |
| Department Head | Control department operations and approvals                 |
| Team Lead       | Manage team activities and assignments                      |
| Service Team    | Manage service and commissioning activities                 |
| BD Team         | Manage inquiries, tenders and quotations                    |
| Purchase Team   | Manage requisitions, vendors, purchasing and receipts       |
| R&D Team        | Perform engineering calculations and reports                |
| Design Team     | Manage engineering documents and revisions                  |
| Electrical Team | Manage electrical work orders                               |
| Store Team      | Manage stock and movements                                  |
| HR              | Maintain basic employee information                         |
| Employees       | Access information and perform assigned work                |

---

# 10. Business Rules

### BR-RULE-01 — Authentication

Microsoft Azure is used for user authentication.

ERP-PremnathRail controls application-level authorization.

### BR-RULE-02 — Authorization

Users should only receive access required for their responsibilities.

### BR-RULE-03 — Cross-Department Access

Cross-department information may be accessed when explicitly authorized.

### BR-RULE-04 — Central Data

Structured ERP business data should be maintained in a central database.

### BR-RULE-05 — Document Storage

SharePoint remains the organization's document-storage platform.

ERP records should reference and provide controlled access to relevant documents.

### BR-RULE-06 — Auditability

Important business actions, approvals, and administrative activities should be traceable.

### BR-RULE-07 — Recoverable Deletion

Where deletion is supported, important business records should use recoverable deletion rather than accidental permanent loss.

### BR-RULE-08 — Progressive Implementation

Departments will be implemented progressively according to business priority and readiness.

---

# 11. Data Requirements

The ERP requires centralized structured business information.

Major business data areas include:

* Users
* Departments
* Teams
* Customers
* Vendors
* Projects
* Service Requests
* Tasks
* Activities
* Purchase Requests
* Stock
* Engineering records
* Documents
* Approvals
* Audit records

The detailed database structure belongs in the Database Design documentation.

---

# 12. Existing Data

Existing departmental information may exist in:

* Excel files
* Documents
* Department records
* Other existing business sources

Relevant information may be migrated into ERP-PremnathRail.

The business migration process should be:

```text
Identify
 ↓
Collect
 ↓
Review
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

---

# 13. External Systems

ERP-PremnathRail should integrate with existing organizational platforms where appropriate.

### Microsoft Azure

**Purpose:** Authentication / organizational identity.

### SharePoint

**Purpose:** Document storage.

### Microsoft Teams

**Purpose:** Organizational access to the ERP application and collaboration environment.

Other systems may be integrated when a validated business requirement exists.

---

# 14. Business Access Model

The conceptual business access model is:

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
```

Access should be granted according to job responsibilities rather than simply giving users broad system access.

---

# 15. Business Reporting Needs

Management requires meaningful visibility into business operations.

Potential reporting areas include:

* Projects
* Service activities
* Business development
* Purchasing
* Inventory
* Engineering
* Department activity
* Approvals
* Pending work
* Operational KPIs

Specific reports will be defined during module-level requirements analysis.

---

# 16. Business Document Requirements

The ERP should allow relevant documents to be connected with business records.

Examples:

```text
Customer
   └── Documents

Project
   └── Documents

Service Request
   └── Documents

Purchase
   └── Documents

Engineering Record
   └── Documents
```

SharePoint remains the document-storage layer.

---

# 17. Business Constraints

Current constraints include:

* Initial development is being led by Vineet Sharma.
* A dedicated development team has not yet been established.
* Requirements will evolve as departments are analyzed.
* No fixed final go-live date has been established.
* Implementation will be progressive.
* Development capacity may affect implementation speed.
* The initial user population is expected to remain below 150 users.

---

# 18. Business Assumptions

The project assumes that:

1. Department representatives will provide process information.
2. Relevant existing data will be made available.
3. Business users will participate in validation and testing.
4. Management will provide required business decisions.
5. Required Microsoft organizational services will remain available.
6. Business processes may be standardized where necessary.
7. New departments will be introduced according to business priority.

---

# 19. Business Risks

| Risk                                 | Business Impact           |
| ------------------------------------ | ------------------------- |
| Changing requirements                | Rework and delays         |
| Poor legacy data                     | Incorrect ERP information |
| Low adoption                         | Reduced business value    |
| Excessive scope                      | Slow implementation       |
| Incorrect access                     | Information exposure      |
| Lack of process standardization      | Inconsistent operations   |
| Single-person development dependency | Limited delivery capacity |
| Duplicate business processes         | Increased complexity      |

---

# 20. Open Business Questions

The following require business confirmation before related decisions become permanent requirements.

### 20.1 HR Scope

Should HR remain primarily an employee directory, or should it become a broader HR capability?

### 20.2 CRM → Project Handover

When an Inquiry/Tender becomes a customer PO, should the process automatically create/link an ERP Project?

### 20.3 Purchase Standardization

Should service-linked purchasing eventually use the same standardized P2P process as standalone purchasing?

### 20.4 Future Departments

Which department should be prioritized after the currently approved/implemented business areas?

These questions should be resolved through the appropriate business approval process.

---

# 21. Business-Level Non-Goals

The ERP should not unnecessarily duplicate systems that already serve an organizational purpose.

Examples:

* Azure should remain the authentication platform.
* SharePoint should remain the document-storage platform.
* Microsoft Teams should remain an organizational collaboration/access environment.

If an existing system is proposed for replacement, that should become a separate approved business decision.

---

# 22. Success Criteria

ERP-PremnathRail should demonstrate the following business outcomes:

* Centralized business information
* Connected departments
* Reduced duplicate data entry
* Improved project visibility
* Improved service tracking
* Better purchasing visibility
* Better inventory visibility
* Better engineering workflow visibility
* Controlled cross-department access
* Improved management reporting
* Better document accessibility
* Traceable business activities

---

# 23. Requirement Traceability

Business requirements will flow into subsequent product and engineering documentation:

```text
Business Need
     ↓
BRD
     ↓
PRD
     ↓
SRS
     ↓
Module Requirements
     ↓
Design
     ↓
Development
     ↓
Testing
     ↓
Business Acceptance
```

This ensures that implemented functionality can be traced back to an approved business need.

---

# 24. Requirement Change Management

This BRD should be updated when:

* A new business requirement is formally confirmed.
* An existing business requirement changes.
* A requirement is removed.
* A major business process changes.
* A major scope decision is approved.
* An open business question is resolved.

Minor technical implementation changes should **not** automatically require a BRD update.

---

# 25. Version Control

The BRD is a controlled document.

Example:

```text
v1.0 → Initial approved baseline
v1.1 → Minor business requirement changes
v1.2 → Additional approved requirements
v2.0 → Major business/scope change
```

Previous approved versions should be retained.

The current version becomes the active reference, while previous versions remain available for historical traceability.

---

# 26. Approval

| Name             | Role                                     | Approval   | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Business Sponsor & Final Approver        | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 27. Document Status

**Document:** Business Requirements Document
**Project:** ERP-PremnathRail
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Organization:** PremnathRail
**Date:** 31 August 2026
