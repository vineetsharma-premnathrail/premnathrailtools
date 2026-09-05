# ERP-PremnathRail — Permission Matrix

**Organization:** PremnathRail
**Project:** ERP-PremnathRail
**Module:** Platform / Cross-cutting
**Document:** Permission Matrix
**Prepared by:** Vineet Sharma
**Project Lead / Product & Technical Owner:** Vineet Sharma
**Project Sponsor & Final Approver:** Madhav Arora Sir
**Date:** 31 August 2026
**Version:** 1.0
**Status:** Current

---

# 1. Purpose

This document defines the current application permission model of ERP-PremnathRail.

It records:

* User roles
* Application/module access
* Backend route protection
* ERP-level permissions
* Frontend route guards
* Administrator-only operations
* API-key access behavior
* Known permission gaps

This document describes the **currently implemented permission controls**, not a future-state authorization design.

---

# 2. Authorization Model

ERP-PremnathRail uses multiple authorization layers:

```text
User
 │
 ├── Role
 │
 ├── Assigned Applications
 │
 └── Module-specific Permissions
          │
          ▼
       Backend
          │
          ▼
      Authorized Action
```

The primary concepts are:

1. `role`
2. `assigned_apps`
3. `erp_permissions`
4. Backend authorization dependencies
5. Frontend route guards

---

# 3. User Roles

The application currently distinguishes between:

```text
admin
ordinary staff/user
api_service
```

The `admin` role receives unrestricted application-module access according to the current application-access implementation.

Ordinary users receive only their assigned applications.

API-service users are generated for API-key authentication and are scoped to the applications allowed by the API key.

---

# 4. Application Access

Each user has an:

```text
assigned_apps
```

list.

The effective application list is calculated through:

```text
User.get_apps()
```

---

# 5. Administrator Application Access

An administrator:

```text
role == "admin"
```

automatically receives all applications defined in:

```text
AVAILABLE_APPS
```

Current application set:

```text
erp
rnd
crm
purchase
p2p
store
hr
```

Therefore:

```text
Admin
  ↓
All Available Applications
```

---

# 6. Ordinary User Application Access

For non-admin users:

```text
Effective Applications
=
assigned_apps
```

An empty `assigned_apps` list means the user can authenticate but cannot access ERP business modules.

Conceptually:

```text
Login
  ↓
Authentication Successful
  ↓
assigned_apps = []
  ↓
No Business Module Access
```

---

# 7. Module-Level Authorization

The backend uses:

```text
require_app_access(app_name)
```

as the primary module-access dependency.

Example:

```text
Depends(require_app_access("erp"))
```

If the authenticated user does not have the required application, the backend returns:

```text
HTTP 403
```

---

# 8. Module Access Is Binary

At the application-access layer there is no distinction between:

```text
View
Create
Edit
Delete
Approve
```

The module-access layer answers only:

```text
Does this user have access to this application?
```

Fine-grained permissions are implemented separately only for ERP.

---

# 9. Backend Module Coverage

| Module     | Current Backend Coverage                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------- |
| ERP        | Projects, Service Requests, attachments, notifications and test email                             |
| CRM        | Activities, Dashboard, Documents, Inquiries, Notes, Organizations, Tenders and workflow resources |
| Purchase   | Purchase Requisitions and Vendor routes                                                           |
| P2P        | P2P Requests                                                                                      |
| R&D        | Entire Calculations router                                                                        |
| Store      | Locations, Stock Items and Stock Transactions                                                     |
| HR         | HR routes                                                                                         |

---

# 10. ERP Backend Access

The ERP module is protected through:

```text
require_app_access("erp")
```

ERP includes:

* Projects
* Service Requests
* Attachments
* Notifications
* Related operational endpoints

---

# 11. CRM Backend Access

CRM routes are protected through:

```text
require_app_access("crm")
```

Covered areas include:

* Activities
* Dashboard
* Documents
* Inquiries
* Notes
* Organizations
* Tenders
* Tasks
* Approvals
* Quotations
* Purchase Orders
* Competitors
* Discussions

---

# 12. Purchase Backend Access

Purchase routes use:

```text
require_app_access("purchase")
```

The Vendor routes also currently use the `purchase` application gate.

There is no separate `vendor` application in `AVAILABLE_APPS`.

Therefore:

```text
Purchase Access
      ↓
Vendor Route Access
```

---

# 13. P2P Backend Access

The P2P module currently contains an authorization inconsistency.

The initial P2P Request route uses:

```text
require_app_access("p2p")
```

However, several later P2P Request actions use:

```text
require_app_access("purchase")
```

Affected operations include actions such as:

* Approve
* Comment
* Attach
* Other sub-actions

---

# 14. P2P Permission Gap

Current behavior can therefore produce:

```text
User
 │
 ├── p2p = granted
 └── purchase = not granted
          │
          ▼
List/Create P2P Request
          ✓
          │
          ▼
Most P2P sub-actions
          ✗ 403
```

Whether this is intentional or a defect cannot be determined from the current code alone.

This requires confirmation of the intended Purchase/P2P product boundary.

---

# 15. R&D Backend Access

The R&D calculations router is protected at router level:

```text
APIRouter(
    dependencies=[
        Depends(require_app_access("rnd"))
    ]
)
```

Therefore the complete calculations router is protected by the R&D application grant.

---

# 16. Store Backend Access

Store routes require:

```text
require_app_access("store")
```

Protected functionality includes:

* Locations
* Stock Items
* Stock Transactions

---

# 17. HR Backend Access

HR routes require:

```text
require_app_access("hr")
```

The current implementation contains two HR routes.

---

# 18. ERP Fine-Grained Permissions

ERP is currently the only module with an additional action-level permission layer.

Valid ERP permissions are:

```text
project_view
project_create
project_edit
project_delete

sr_view
sr_create
sr_edit
sr_delete
```

These are stored in:

```text
User.erp_permissions
```

as a JSON list.

---

# 19. ERP Permission Evaluation

The backend evaluates ERP permissions using:

```text
has_erp_permission(user, permission)
```

Administrators automatically pass the permission check.

Ordinary users must contain the exact permission string in:

```text
erp_permissions
```

---

# 20. ERP Permission Matrix

| Permission       | Backend Enforcement    | Current Status                      |
| ---------------- | ---------------------- | ----------------------------------- |
| `project_view`   | None                   | Defined but not separately enforced |
| `project_create` | Projects route         | Enforced                            |
| `project_edit`   | Projects route         | Enforced                            |
| `project_delete` | Projects route         | Enforced                            |
| `sr_view`        | None                   | Defined but not separately enforced |
| `sr_create`      | Service Requests route | Enforced                            |
| `sr_edit`        | Service Requests route | Enforced                            |
| `sr_delete`      | Service Requests route | Enforced                            |

---

# 21. Project Permissions

## Create

```text
project_create
```

is checked when creating a Project.

## Edit

```text
project_edit
```

is checked when editing a Project.

## Delete

```text
project_delete
```

is checked when deleting a Project.

---

# 22. Service Request Permissions

## Create

```text
sr_create
```

is checked when creating a Service Request.

## Edit

```text
sr_edit
```

is checked when editing a Service Request.

## Delete

```text
sr_delete
```

is checked when deleting a Service Request.

---

# 23. Service Request Ownership Rule

The `sr_edit` and `sr_delete` checks are combined with ownership.

Conceptually:

```text
User owns Service Request
        AND
User has required permission
        ↓
Operation Allowed
```

Therefore, possessing `sr_edit` does not automatically allow a user to edit every Service Request.

The current implementation permits editing/deleting the user's own applicable Service Requests.

---

# 24. ERP View Permission Gap

The following permissions are defined:

```text
project_view
sr_view
```

but no backend route currently performs a separate:

```text
has_erp_permission(...)
```

check for them.

Read access is already controlled by:

```text
require_app_access("erp")
```

Therefore these permissions currently do not provide an independent backend authorization boundary.

---

# 25. Frontend Authorization

Frontend authorization uses:

```text
useRequireApp(appName)
```

and:

```text
useRequireErpPermission(permission, fallback)
```

These are client-side navigation guards.

Their purpose is to:

* Prevent unauthorized page navigation
* Hide inaccessible application pages
* Redirect users to permitted areas

They are **not the security boundary**.

---

# 26. Backend vs Frontend Security

The authorization model should be understood as:

```text
Frontend Guard
      ↓
User Experience
      ↓
Backend Authorization
      ↓
Actual Security Boundary
```

A user bypassing frontend navigation controls must still be rejected by backend authorization.

---

# 27. Frontend Application Guards

Current frontend application guards include:

| Application | Protected Pages                                                                  |
| ----------- | -------------------------------------------------------------------------------- |
| CRM         | CRM dashboard, activities, inquiries, notes, organizations, tenders, recycle bin |
| ERP         | ERP home, projects, service requests, recycle bin, reports                       |
| Purchase    | Purchase dashboard and P2P-request pages under Purchase                          |
| P2P         | P2P dashboard, new, list and detail                                              |
| R&D         | R&D home and calculation tools                                                   |

---

# 28. Frontend ERP Permission Guards

Currently identified granular frontend permission guards include:

| Permission Area        | Page                                 |
| ---------------------- | ------------------------------------ |
| Project create/edit    | `dashboard/erp/projects/new`         |
| Project edit           | `dashboard/erp/projects/[id]/edit`   |
| Service Request create | `dashboard/erp/service-requests/new` |

The default fallback is:

```text
/dashboard/erp
```

---

# 29. Purchase/P2P Frontend Boundary

There are currently two P2P page areas:

```text
dashboard/p2p/**
```

which uses:

```text
p2p
```

and:

```text
dashboard/purchase/p2p-requests/**
```

which uses:

```text
purchase
```

This does not fully align with the backend authorization boundary.

The Purchase/P2P split should therefore be explicitly reviewed.

---

# 30. Administrator Authorization

Administrator-only backend operations use:

```text
require_admin
```

This is separate from:

```text
require_app_access
```

Admin status is determined by:

```text
user.role == "admin"
```

There is no `"admin"` application in `AVAILABLE_APPS`.

---

# 31. Admin Capabilities

Administrator-protected functionality includes:

* User listing
* User creation
* User updates
* Application assignment
* ERP permission assignment

Conceptually:

```text
Admin
 ↓
User Management
 ↓
Assigned Apps
 ↓
Permissions
```

---

# 32. API-Key Authorization

API-key authentication creates a synthetic user:

```text
role = "api_service"
```

The API key contains:

```text
allowed_apps
```

The resulting identity passes through the same application authorization system.

```text
API Key
 ↓
Synthetic User
 ↓
allowed_apps
 ↓
require_app_access
 ↓
Application
```

---

# 33. API-Key ERP Permissions

API-key-authenticated users also pass through the same:

```text
has_erp_permission
```

mechanism where ERP granular permissions are applicable.

Therefore API access does not bypass the standard authorization architecture.

---

# 34. API-Key Security Testing

The existing security test suite verifies:

* API-key authentication
* Inactive API-key rejection
* Application-scoped API-key access

This confirms that the API-key authorization path is tested at the application level.

Whether external integrations currently use this mechanism is separate from whether the mechanism exists.

---

# 35. Service Permissions

The User model contains:

```text
service_permissions
```

However, no confirmed backend authorization enforcement point was identified for this field during the source review.

Therefore its current status is:

```text
Defined
   ↓
No confirmed enforcement
   ↓
Potential dormant permission field
```

It should not be treated as an effective security control until an enforcement point is confirmed.

---

# 36. Current Permission Architecture

The current system can be summarized as:

```text
                         USER
                           │
              ┌────────────┴────────────┐
              │                         │
             Role                 assigned_apps
              │                         │
        ┌─────┴─────┐                   │
        │           │                   │
      Admin       User                  │
        │           │                   │
        │      Limited Apps             │
        │                               │
        └──────────────┬────────────────┘
                       ↓
                Module Access
                       ↓
              ┌────────┴─────────┐
              │                  │
             ERP             Other Modules
              │                  │
       ERP Permissions      Binary Access
              │
      ┌───────┴────────┐
      │                │
 Projects          Service Requests
```

---

# 37. Current Authorization Gaps

The following items require review:

### P2P/Purchase Boundary

P2P routes do not consistently use the same application permission.

### ERP View Permissions

`project_view` and `sr_view` exist but are not separately enforced.

### Service Permissions

`service_permissions` exists without a confirmed authorization check.

### User References

The permission matrix describes access control; user-reference integrity is covered separately by database documentation.

---

# 38. Permission Change Process

Permission changes should be made through controlled changes to:

* User role
* Assigned applications
* ERP permission assignments
* Backend authorization checks
* Frontend guards where applicable

A permission change affecting security should be tested at the backend level.

---

# 39. Permission Testing

Security testing should verify:

```text
Unauthenticated User
        ↓
Rejected

Authenticated User
        ↓
No App Access
        ↓
403

Authenticated User
        ↓
App Access
        ↓
Allowed Module

Authenticated User
        ↓
App Access + Required Permission
        ↓
Allowed Action
```

For sensitive operations, both positive and negative authorization tests are required.

---

# 40. Source of Truth

For actual authorization behavior, the following are authoritative:

```text
Backend authorization dependencies
        +
Permission functions
        +
User model
        +
Frontend guards
```

Documentation should not be treated as evidence that a permission is enforced unless the corresponding implementation exists.

---

# 41. Document Update Rules

Update this Permission Matrix when:

* A new application/module is introduced.
* Application access rules change.
* A new permission is added.
* A permission is removed.
* A backend authorization check changes.
* A frontend route guard changes.
* Admin capabilities change.
* API-key authorization changes.
* A permission gap is resolved.

---

# 42. Version Control

```text
v1.0
Current authorization baseline

v1.1
Permission changes

v1.2
Additional module authorization

v2.0
Major authorization model change
```

Previous approved versions should be retained.

---

# 43. Related Documents

* Project Charter
* BRD
* PRD
* Scope Document
* Software Architecture Document
* HLD
* LLD
* Security Document
* Threat Model
* Database Schema
* Database Relationships
* Database Indexes
* Platform Module Overview

---

# 44. Approval

| Name             | Role                                     | Signature  | Date       |
| ---------------- | ---------------------------------------- | ---------- | ---------- |
| Madhav Arora Sir | Project Sponsor & Final Approver         | __________ | __________ |
| Vineet Sharma    | Project Lead / Product & Technical Owner | __________ | __________ |

---

# 45. Document Information

**Document:** Permission Matrix
**Project:** ERP-PremnathRail
**Organization:** PremnathRail
**Module:** Platform / Cross-cutting
**Version:** 1.0
**Status:** Current
**Prepared By:** Vineet Sharma
**Date:** 31 August 2026
