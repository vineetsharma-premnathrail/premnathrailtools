# ERP-PremnathRail — Project Charter

**Organization:** PremnathRail
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026
**Project Start Date:** 24 February 2026
**Version:** 1.0
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Application Ownership:** Vineet Sharma

---

# 1. Introduction

ERP-PremnathRail is a strategic initiative to design and develop a **custom enterprise resource planning (ERP) platform** for PremnathRail.

The objective is to establish one interconnected system for managing the organization's business operations, departments, teams, projects, workflows, documents, and information.

The ERP will be developed specifically around the organization's operational requirements rather than adopting an existing third-party ERP product.

The project is being undertaken under the direction of **Madhav Arora Sir**, who will serve as the Project Sponsor and Final Approver. **Vineet Sharma** will lead the project and will be responsible for application development, technical decisions, software requirements, architecture, security implementation, and overall application creation.

The application will initially be developed as a **web application**. Desktop and mobile applications may be developed in the future based on organizational requirements and project priorities.

---

# 2. Business Need and Purpose

PremnathRail requires a centralized system capable of connecting the organization's departments and business operations.

Currently, departments may maintain information using separate Excel files, documents, and other disconnected methods. This can make it difficult to maintain a complete view of projects, processes, documents, responsibilities, and organizational activities.

ERP-PremnathRail will provide a centralized platform to:

* Connect departments and teams.
* Centralize business information.
* Track projects and business activities.
* Standardize workflows.
* Improve information visibility.
* Reduce duplicate data.
* Improve management decision-making.
* Provide controlled cross-department information access.
* Maintain centralized documents and records.
* Create a reliable organizational data foundation.

The long-term objective is to provide management with a **complete and connected view of the organization's business operations**.

---

# 3. Project Vision

The vision of ERP-PremnathRail is to create a single, scalable, secure, and interconnected business platform through which the organization can manage its complete operational lifecycle.

The system should allow information to move between departments according to defined business workflows and authorization rules while maintaining centralized data and accountability.

---

# 4. Project Objectives

The primary objectives are to:

1. Develop a custom ERP platform for PremnathRail.
2. Connect all departments and teams through a centralized system.
3. Support the organization's complete business operations.
4. Provide centralized project and activity tracking.
5. Establish a centralized database and business information repository.
6. Reduce dependency on disconnected Excel files and manual records.
7. Standardize business workflows and approval processes.
8. Enable authorized cross-department information sharing.
9. Provide centralized document management through SharePoint integration.
10. Provide secure authentication and application-level authorization.
11. Maintain audit records for important system activities.
12. Provide management with better operational visibility and reporting.
13. Build the system progressively according to business priorities.
14. Establish a scalable technical foundation for future desktop and mobile applications.

---

# 5. Project Scope

## 5.1 In Scope

ERP-PremnathRail will include:

* Department management
* Team management
* User management
* Role and permission management
* Business process management
* Project tracking
* Task and activity tracking
* Workflow and approval management
* Centralized business database
* Reporting and management visibility
* Document management
* SharePoint integration
* Audit logging
* Cross-department information access based on authorization
* Application administration
* Security controls
* Web application development

The ERP will eventually be designed to support **all organizational departments**.

---

# 6. Department Rollout Approach

The ERP will be implemented progressively rather than attempting to implement every department simultaneously.

Departments and modules will be created and rolled out **one by one**, in the order determined by business priority, readiness, requirements, and project direction at the time — not against a fixed, pre-committed sequence.

Potential departments may include Service & Commissioning, Business Development (BD), Finance, HR, Procurement, Inventory, Operations, Management, and other required business functions.

No fixed implementation dates or ordering are defined at this stage.

---

# 7. User and Organization Model

The expected ERP user base is **fewer than 150 users** initially.

The system will support:

* Organization
* Departments
* Teams
* Users
* Roles
* Responsibilities
* Permissions
* Workflows

Teams will be created and managed within the ERP.

### Team Administration

**Madhav Arora Sir** will have authority to create and establish teams at the organizational level.

ERP administrators will have appropriate administrative capabilities, including management of departments, users, access, and permissions as delegated.

Department heads may receive specific administrative capabilities according to their assigned authorization.

---

# 8. Authentication and Authorization

ERP-PremnathRail will use **Microsoft Azure-based authentication** for identity and login.

### Azure Responsibility

Azure will be used for:

* User authentication
* Identity verification
* Login
* User identity management

### ERP Responsibility

The ERP application will control:

* Roles
* Permissions
* Department access
* Team access
* Feature access
* Business-level authorization
* Cross-department data access

Therefore, **authentication and authorization are treated as separate responsibilities**.

---

# 9. Cross-Department Access

The ERP will support controlled cross-department information access.

Users will not automatically receive access to all organizational information.

Access to information from another department will depend on the user's assigned role, permissions, business responsibility, and authorization.

This approach will allow departments to collaborate while maintaining appropriate information boundaries.

---

# 10. Document Management

ERP-PremnathRail will support centralized document management.

The organization currently uses **SharePoint** for file and document storage. The ERP will therefore integrate with SharePoint rather than unnecessarily duplicating the organization's existing document-storage infrastructure.

The ERP may provide capabilities such as:

* Document upload
* Document linking
* Document access
* Document categorization
* Department/project document association
* Controlled document visibility

The ERP will remain the primary business application while SharePoint can serve as the underlying document-storage platform.

---

# 11. Centralized Data Architecture

A **centralized database** is a fundamental requirement of ERP-PremnathRail.

The objective is to establish a common source of structured organizational data so that authorized departments and processes can work with consistent information.

The centralized data model should support:

* Users
* Departments
* Teams
* Projects
* Customers
* Vendors
* Products/services
* Transactions
* Tasks
* Workflows
* Approvals
* Documents
* Audit records
* Other business entities defined during requirements analysis

---

# 12. Existing Data Migration

The ERP is a new system and is not replacing an existing ERP application.

Existing information may currently exist in:

* Excel files
* Department-specific spreadsheets
* Documents
* Existing business records

Relevant existing information will be assessed, cleaned, structured, and migrated where required.

Data migration will be performed according to the requirements of each department and the agreed migration scope.

---

# 13. Microsoft Teams Integration

The organization will use **Microsoft Teams** as an organizational collaboration environment.

ERP-PremnathRail may be made available through Microsoft Teams by adding the ERP application to the organization's Teams environment.

The ERP itself remains the primary business application, while Teams can provide an additional organizational access and collaboration channel.

---

# 14. Platform Strategy

### Initial Platform

**Web Application**

The first implementation will focus on a secure, scalable web application.

### Future Platforms

Depending on business requirements, the organization may later develop:

* Desktop application
* Mobile application
* Additional application integrations

These platforms are currently considered **future scope** and are not part of the initial web implementation.

---

# 15. Development Approach

ERP-PremnathRail will follow a **progressive and iterative development approach**.

The project will move through activities such as:

**Requirement Analysis → Process Design → Architecture → Development → Testing → User Feedback → Deployment → Enhancement**

The project will not use rigid fixed deadlines at the current stage because development capacity, requirements, and implementation priorities may evolve.

Future development resources and team structure will be determined according to organizational requirements and project needs.

---

# 16. Project Governance

### Project Sponsor & Final Approver

**Madhav Arora Sir**

Responsibilities include:

* Strategic direction
* Major scope decisions
* Business priorities
* Major production decisions
* Final approvals
* Organizational escalation decisions

### Project Lead / Product & Technical Owner / Application Owner

**Vineet Sharma**

Responsibilities include:

* Application development
* Technical architecture
* Technical decisions
* Software requirements
* Application design
* Security implementation
* Application authorization
* Database design
* Integration decisions
* Development coordination
* Technical implementation
* Audit and application controls

---

# 17. Security Ownership

ERP application security and authorization will be owned by **Vineet Sharma** during the current project structure.

Security responsibilities include:

* Application authorization
* Role-based access control
* Permission management
* Department-level access
* Cross-department access control
* Administrative access control
* Audit logging
* Secure application design

Azure will provide the authentication layer, while application-level authorization will remain under ERP control.

---

# 18. Audit and Accountability

ERP-PremnathRail will maintain audit information for important system activities.

Depending on the implemented module, audit records may include:

* User actions
* Login-related application events
* Data creation
* Data modification
* Data deletion
* Approvals
* Permission changes
* Administrative actions
* Workflow actions

The objective is to provide traceability and accountability for important business and system activities.

---

# 19. Key Deliverables

The project will progressively deliver:

1. Project requirements
2. Business process documentation
3. ERP product requirements
4. System architecture
5. Database architecture
6. UI/UX design
7. Web application
8. Department modules
9. User and role management
10. Permission system
11. Workflow system
12. SharePoint integration
13. Microsoft Teams application integration
14. Reporting capabilities
15. Audit logging
16. Testing documentation
17. User acceptance testing
18. Deployment documentation
19. User documentation
20. Continuous application enhancements

---

# 20. Assumptions

The project assumes that:

* Business stakeholders will provide required business information.
* Departments will participate in requirement discussions.
* Existing Excel files and documents will be made available when required.
* Users will participate in testing and feedback.
* Required Azure and Microsoft resources will be available.
* SharePoint access and integration requirements will be available.
* Business priorities may change as the ERP develops.
* Future development resources may change according to project requirements.

---

# 21. Constraints

Current constraints include:

* Initial development is being led by a single project lead.
* A dedicated development team has not yet been established.
* Requirements will evolve during implementation.
* No fixed final go-live date is established.
* Department rollout will depend on readiness and priority.
* Technical capacity may limit the speed of development during the initial stage.

These constraints will be reviewed as the project progresses.

---

# 22. High-Level Risks

| Risk                                 | Impact                          | Mitigation                                   |
| ------------------------------------ | -------------------------------- | -------------------------------------------- |
| Changing requirements                | Rework and scope expansion      | Requirement documentation and change control |
| Single-person development dependency | Development capacity risk       | Progressive resource planning                |
| Poor existing data quality           | Incorrect migration/results     | Data validation and cleansing                |
| Low user adoption                    | Reduced ERP effectiveness       | User involvement and training                |
| Incorrect authorization              | Unauthorized information access | RBAC and permission testing                  |
| Integration issues                   | Workflow disruption             | Early integration testing                    |
| Excessive scope                      | Delayed implementation          | Phased department rollout                    |
| Lack of process standardization      | Inconsistent ERP workflows      | Department process mapping                   |

---

# 23. Success Criteria

ERP-PremnathRail will be considered successful when:

* The agreed initial business processes are operational.
* Each rolled-out department's processes are successfully implemented on the established ERP foundation.
* Departments can operate through interconnected workflows.
* Users can securely authenticate through Azure.
* ERP authorization correctly controls application access.
* Centralized business data is available.
* Authorized cross-department access works correctly.
* SharePoint document integration works as required.
* Important system activities are auditable.
* Users can perform their assigned business processes effectively.
* Management can obtain meaningful operational visibility from the system.

---

# 24. Out of Scope for Initial Implementation

The following are not part of the initial implementation:

* Native mobile application
* Native Windows desktop application
* Unapproved departments/modules
* Unapproved third-party ERP functionality
* Business processes not yet analyzed or approved

Future scope may be added through the project's change and approval process.

---

# 25. Change Management

Changes to approved requirements, scope, workflows, modules, integrations, or architecture will be evaluated based on:

* Business value
* Technical feasibility
* Security impact
* Dependencies
* Development effort
* Operational impact
* Project priority

Major scope or production decisions require approval from **Madhav Arora Sir**.

---

# 26. Communication and Reporting

Project communication will include, where required:

* Requirement discussions
* Development reviews
* Progress updates
* Issue tracking
* Risk tracking
* Technical discussions
* User feedback
* Approval discussions
* Deployment reviews

Major decisions should be documented to maintain project traceability.

---

# 27. Project Lifecycle

The high-level ERP lifecycle will follow:

**Business Requirements**
↓
**Process Analysis**
↓
**Product Requirements**
↓
**System Architecture**
↓
**Database & Application Design**
↓
**Development**
↓
**Testing**
↓
**User Acceptance**
↓
**Deployment**
↓
**Continuous Improvement**

---

# 28. Approval and Sign-Off

| Name             | Role                                     | Approval           |
| ---------------- | ----------------------------------------- | ------------------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________________ |
| Department Head / Madhav Arora Sir | Business Representative       | __________________ |

**Project Approval Date:** 24 February 2026

**Document Version:** 1.0

---

# 29. Document Status

**Status:** Initial Project Charter
**Version:** 1.0
**Prepared By:** Vineet Sharma
**Organization:** PremnathRail
**Date:** 29 August 2026
