# Premnathrail Portal — Admin Manual

**Module:** User & Admin Documentation
**Audience:** Portal administrators
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

This manual covers administrative tasks in the Premnathrail Portal: managing user accounts, module access, ERP sub-permissions, and approval roles. For general end-user instructions, see `user-manual.md`.

Every fact in this document is grounded in the current codebase — primarily:

* `backend/app/modules/main/models/user.py`
* `backend/app/modules/main/routes/users.py`
* `backend/app/modules/main/models/module.py`
* `frontend/src/app/dashboard/users/page.tsx`

Fields that exist on the `User` model but are not wired into active access decisions are explicitly identified.

---

# 2. Who Is an Admin

A user is an administrator when:

```python
role == "admin"
```

The default role is `"user"`.

There is no separate roles table or granular administrator hierarchy.

The `User` model also contains `is_azure_admin`, but this field is not used by `get_apps()` or any active permission check.

Therefore, the only field that grants administrator behavior is:

```text
role = "admin"
```

---

# 3. Admin's Implicit All-Modules Access

`User.get_apps()` calculates the effective application list:

```python
AVAILABLE_APPS = {
    "erp",
    "rnd",
    "crm",
    "purchase",
    "p2p",
    "store",
    "hr",
    "design",
    "electrical",
}

def get_apps(self) -> list[str]:
    if self.role == "admin":
        return sorted(AVAILABLE_APPS)

    return self.assigned_apps or []
```

For administrators:

* All modules are automatically available.
* `assigned_apps` does not restrict administrator access.
* Removing modules from an administrator's assigned-app list has no visible effect.
* To restrict a user to selected modules, change their role to `"user"` first.

For non-admin users:

* Access comes from `assigned_apps`.
* An empty list means no application modules are available.
* The user can still sign in and see the basic Dashboard.

The effective `apps` list is returned by `/auth/me`.

The frontend uses this effective list for navigation and module-access checks.

ERP permissions behave similarly: administrators automatically pass every ERP permission check regardless of their `erp_permissions` value.

---

# 4. Module Registry

The database-backed `Module` table stores:

* `key`
* `label`
* `icon`
* `description`
* `is_active`
* `sort_order`

The registry controls display metadata for the module selector.

It is **not** a second authorization system.

The actual authorization list remains `AVAILABLE_APPS` in `User.get_apps()`.

Therefore:

* Changing a label or icon is a database change.
* Adding a genuinely new assignable application also requires a corresponding code change to `AVAILABLE_APPS`.

Authenticated users can read the registry.

Only administrators can create or update module records.

---

# 5. Managing Users & Module Access

**Navigation:** `Users & Roles` → `/dashboard/users`

The page is protected by `useRequireAdmin()`.

Non-admin users are redirected to `/dashboard`.

The page provides:

* Total Users
* Active Users
* Inactive Users
* Administrators
* User search by name or email
* Sync from Azure AD
* Activate/deactivate actions
* Module Access editing

## 5.1 Assigning Module Access

The Module Access editor currently contains:

| App ID       | Sidebar Label  |
| ------------ | -------------- |
| `erp`        | Service Module |
| `rnd`        | R&D Tools      |
| `crm`        | CRM Module     |
| `purchase`   | Purchase       |
| `p2p`        | P2P            |
| `store`      | Store          |
| `hr`         | HR             |
| `design`     | Design         |
| `electrical` | Electrical     |

Saving the editor updates:

```text
assigned_apps
```

along with permissions and approval-role flags.

The module list only restricts non-admin users.

### Vendor Access

There is no separate `vendor` module ID in the user-access system.

Vendor records are accessed through:

```text
/dashboard/purchase/vendors
```

and require `purchase` module access.

---

# 5.2 Approval Roles

The administrator can assign six approval roles:

| Role            | User Field           | Behavior                                   |
| --------------- | -------------------- | ------------------------------------------ |
| Department Head | `is_department_head` | Routes P2P requests based on department    |
| Project Head    | `is_project_head`    | Organization-wide approval role            |
| Plant Head      | `is_plant_head`      | Organization-wide approval role            |
| Purchase Head   | `is_purchase_head`   | Required Purchase Order approval after RFQ |
| Director        | `is_director`        | Required Purchase Order approval after RFQ |
| MD              | `is_md`              | Required Purchase Order approval after RFQ |

`Department Head` is available in the UI only when the user has a department assigned.

Department matching uses exact string equality. There is no department table or foreign-key relationship.

For a particular P2P request, the requester can additionally select Department Head, Project Head, or Plant Head.

A P2P request reaches approved status only after every assigned approval role signs off.

A resulting Purchase Order additionally requires:

1. Purchase Head approval
2. Director approval
3. MD approval

---

# 5.3 ERP Sub-Permissions

ERP provides granular permissions in addition to the `erp` module assignment.

## Project Permissions

| Permission       | Grants          | Server-Side Enforcement |
| ---------------- | --------------- | ----------------------- |
| `project_view`   | View projects   | **No**                  |
| `project_create` | Create projects | **Yes**                 |
| `project_edit`   | Edit projects   | **Yes**                 |
| `project_delete` | Delete projects | **Yes**                 |

`project_view` is displayed in the UI but is not currently checked by backend routes. Project viewing is currently controlled by ERP module access.

## Service Request Permissions

| Permission  | Grants                  | Server-Side Enforcement |
| ----------- | ----------------------- | ----------------------- |
| `sr_view`   | View Service Requests   | **No**                  |
| `sr_create` | Create Service Requests | **Yes**                 |
| `sr_edit`   | Edit Service Requests   | **Yes**                 |
| `sr_delete` | Delete Service Requests | **Yes**                 |

`sr_view` has the same limitation as `project_view`.

The permissions are stored in:

```text
erp_permissions
```

as a JSON list.

They only have meaning when the user also has the `erp` application assigned.

The backend validates permission values against:

```text
VALID_ERP_PERMISSIONS
```

The currently accepted values are exactly:

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

Any other value is rejected with HTTP 400.

---

# 5.4 P2P Permission Checkboxes — Known Gap

The Users & Roles interface currently displays P2P permission checkboxes:

```text
pr_create
approval_view
approval_action
rfq_view
rfq_action
grn_view
grn_action
```

However, these values are not included in the backend's `VALID_ERP_PERMISSIONS` allow-list.

Therefore, selecting any of these permissions and saving the user currently results in:

```text
400 — Invalid permission(s)
```

These permissions should not currently be used.

Furthermore, P2P, Purchase, RFQ, and GRN routes do not currently enforce granular permission strings.

Access is controlled through the corresponding:

```text
p2p
purchase
```

module assignments.

---

# 6. Onboarding and Account Lifecycle

Accounts are created automatically after the user's first successful Microsoft sign-in.

There is no manual invitation or account-creation workflow in the administrator UI.

Recommended lifecycle:

1. User signs in through Microsoft.
2. The account is created.
3. Administrator opens `Users & Roles`.
4. Administrator assigns modules.
5. Administrator assigns approval roles where required.
6. Administrator assigns ERP permissions where required.

If `DOMAIN_EMAIL` is configured, users outside the configured email domain are rejected before an account is created.

Profile information such as:

* Name
* Job title
* Department
* Phone

is refreshed from Microsoft during sign-in.

Administrators can also use **Sync from Azure AD**.

The synchronization excludes shared/generic mailboxes such as:

```text
accounts@
info@
```

and accounts outside the configured domain.

HR-owned fields such as reporting manager and date of joining are managed through the HR module rather than Users & Roles.

---

# 7. Dormant Fields — Do Not Rely On These

The following `User` fields exist but are not currently connected to active functionality:

| Field                           | Current State                          |
| ------------------------------- | -------------------------------------- |
| `is_azure_admin`                | Not used for authorization             |
| `service_permissions`           | Declared but not referenced elsewhere  |
| `hashed_password`               | Legacy field; no active password login |
| `must_change_password`          | Legacy field; no active password login |
| `azure_display_name`            | Not surfaced in admin UI               |
| `profile_photo_url`             | Not surfaced in admin UI               |
| `dismissed_announcements`       | Not surfaced in admin UI               |
| `encrypted_graph_refresh_token` | Not surfaced in admin UI               |

The portal currently uses Microsoft SSO rather than an active password-based login flow.

---

# 8. Related Documentation

* `user-manual.md` — end-user instructions for the portal.
* `faq.md` — common user-facing access questions.
* `docs/releases/` — shipped-version documentation.
* `docs/04-security/` — permission model and security documentation.
