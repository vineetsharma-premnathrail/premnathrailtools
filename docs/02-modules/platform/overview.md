# Platform Module — Overview

**Module:** Platform
**Backend Location:** `backend/app/modules/main/`
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

The Platform module is the foundation layer that every other module in the Premnathrail Portal depends on. It is not a business module in its own right — it does not track machines, service requests, inquiries, or purchase orders. Instead, it provides the identity, access control, and cross-cutting infrastructure that all business modules are built on top of.

Any user, in any department, reaches every other part of the application through the Platform module first: they sign in through it, their access to a given module is decided by it, and every important action they take anywhere in the system is recorded through it.

---

# 2. Purpose

The Platform module exists to answer four questions consistently across the entire application, so that no individual business module has to solve them on its own:

1. **Who is this user?** — established once, through Microsoft Single Sign-On, and trusted everywhere else.
2. **What is this user allowed to see and do?** — a single, centralized permission model that every module's routes and pages check against.
3. **What happened, and who did it?** — a shared audit trail that any module can write to.
4. **How does this user get notified or heard?** — in-app notifications and a feedback channel that work the same way regardless of which module triggered them.

---

# 3. Authentication

The Platform module owns all sign-in and session handling for the application.

**Identity provider:** Microsoft Azure AD, via Single Sign-On. The application does not maintain its own username/password system — every user signs in with their existing company Microsoft account.

**Flow supported:**
- Standard browser login (redirect to Microsoft, callback exchanges the authorization code for a Graph profile, and creates or updates the local `User` record).
- Microsoft Teams embedded sign-in (a token exchange flow tailored to Teams' iframe restrictions, so the app can be opened directly inside Teams without a separate browser login).

**Session handling:** once a user is authenticated, the application issues its own short-lived session token (a JWT), delivered to the browser as an httponly cookie. This token is never exposed in a URL and is what every subsequent API request is checked against — Microsoft's own token is not passed around the rest of the system.

**Access restriction:** sign-in additionally checks that the user's email domain is on the organization's allowed list, and that their account is marked active. A valid Microsoft login alone does not guarantee entry to the portal.

---

# 4. Authorization

Authentication proves *who* a user is; authorization — which the Platform module also owns — decides *what* they can do once inside. These are treated as two separate responsibilities, following the Project Charter's principle that Azure handles identity while the application itself controls access.

Every user carries three layers of access information:

1. **Role** — either `admin` or `user`. An admin bypasses every module- and permission-level check across the entire application.
2. **Module access** (`assigned_apps`) — the list of business modules (ERP, CRM, Purchase, P2P, R&D, Design, Electrical, HR, Store, Vendor) a user has been granted entry to. A user with no access to a module cannot open its pages or call its API routes at all.
3. **Granular permissions** — within a module a user does have access to, finer-grained permission strings (for example `project_edit`, `sr_delete`) control whether they can create, edit, or delete specific kinds of records, as opposed to only viewing them.

This access is managed centrally through the Users & Roles administration page, which only an admin can reach, and is enforced on the backend by two shared functions every module route calls: one that checks module access, and one that checks a specific granular permission. No module is expected to invent its own authorization logic.

---

# 5. Audit Logging

Every module that performs a meaningful create, update, delete, or approval action writes an entry to a single, shared audit log owned by the Platform module. This gives the organization one consistent place to answer "who did this, and when" regardless of which department or module the action happened in.

---

# 6. Notifications and Feedback

The Platform module also provides:

- **In-app notifications** — a shared mechanism any module can use to tell a specific user, or a broadcast group of users, that something needs their attention.
- **Feedback inbox** — a single channel for users to report issues or suggestions directly from within the application, independent of which module they were using at the time.

---

# 7. What This Module Does Not Do

To keep this document unambiguous, the Platform module explicitly does **not**:
- Store or process any business data belonging to a specific department (that lives in each module's own tables).
- Decide business workflow rules (for example, service request status transitions) — it only decides whether a user is *allowed* to attempt an action, not what the correct business outcome is.
- Duplicate Microsoft's own identity store — user profile data is synced from Azure AD, not independently maintained.

---

# 8. Related Documentation

- [Project Charter](../../00-overview/PROJECT_CHARTER.md) — overall authentication/authorization ownership split.
- [Security](../../04-security/) — the full permission model, permission-string reference, and threat model.
- Per-module `permissions.md` files (as they are written) — which specific permission strings each module checks.
