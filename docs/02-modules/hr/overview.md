# HR Module — Overview

**Module:** HR
**Backend Location:** `backend/app/modules/hr/`
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

The HR module, as it currently exists, is a lightweight employee directory built on top of the portal's own `User` records — not a full human-resources system. It adds two things to the platform's existing user model: a fuller directory view carrying fields relevant to an HR user specifically (reporting manager, date of joining), and a way to edit those HR-specific fields. Its entire surface is two routes, in `backend/app/modules/hr/routes/hr.py`, mounted at `/hr`.

**This module does not replace ADP**, PremnathRail's actual system of record for HR and payroll. This is stated explicitly in the project's own scope documentation, and it is worth restating here for anyone reading only this file: nothing about hiring, payroll, leave, benefits, appraisals, or compliance lives in this module or anywhere else in the portal. What exists here is a convenient, portal-native employee directory, useful for things like assigning a reporting manager inside the portal's own org-chart concept, or letting other modules look someone up by name — not an HR system of record.

---

# 2. Employee Directory

`GET /hr/directory` returns every active user, ordered by name, using the same `UserResponse` shape and `to_response` helper the platform's own user administration uses. What distinguishes this from the generic `/users/directory` picker other modules use for basic lookups is that this view includes each user's `reporting_manager` and date of joining (DOJ) — fields specific to an HR-flavored view of the user list rather than the minimal picker payload other modules need.

---

# 3. Editing HR-Specific Profile Fields

`PATCH /hr/employees/{user_id}` lets an HR user update HR-owned fields on a given user's profile — most notably `reporting_manager_id`. Two integrity checks guard this specific field:

1. **Self-reference is rejected.** A user cannot be set as their own reporting manager (`400`).
2. **Circular chains are rejected.** Before accepting a new reporting manager, the route walks the proposed manager's own chain of reporting managers upward; if it ever loops back to the employee being edited, the update is rejected with `400` rather than silently creating a circular org chart that would break anything relying on walking that chain (for example, the reporting hierarchy shown elsewhere in the portal).

Any other field on the `UserHRUpdate` payload is applied directly, with no further validation beyond what the schema itself enforces.

---

# 4. Access Model

Both routes in this module require `require_app_access("hr")`, with no granular sub-permission — any user granted HR module access can view the full directory and edit any employee's HR-owned fields. There is no distinction here between, say, a read-only HR viewer and someone who can actually make changes; module access is the only gate.

---

# 5. What This Module Does Not Do

- This module is explicitly **not** a system of record for payroll, leave, benefits, appraisals, or statutory compliance — all of that remains in ADP, per the project's scope documentation.
- It does not manage onboarding or offboarding workflows, document collection, or any HR process beyond maintaining a directory view and a reporting-manager relationship.
- It has no permission model finer than whole-module access — there is no separate "view only" HR role distinct from a full edit role.

---

# 6. Related Documentation

- [Platform Module Overview](../platform/overview.md) — the underlying `User` model and directory this module builds its HR-flavored view on top of.
