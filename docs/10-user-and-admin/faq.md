# Premnathrail Portal — Frequently Asked Questions

**Module:** User & Admin Documentation
**Audience:** All portal staff
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

These answers are grounded in the actual portal code — primarily `backend/app/modules/main/`, `frontend/src/hooks/useAuth.ts`, and `frontend/src/components/Sidebar.tsx` — rather than general assumptions about how the portal "should" behave.

For step-by-step usage instructions, see `user-manual.md`; for administrator actions, see `admin-manual.md`.

---

# 2. Why Can't I See a Module in the Sidebar?

`Sidebar.tsx` only shows a module's navigation item if `user.apps` includes that module's ID, such as `erp`, `crm`, `store`, `hr`, `design`, or `electrical`.

For a normal (`role: "user"`) account, this list comes directly from the user's `assigned_apps` value.

If a module is missing, ask an administrator to assign it from **Users & Roles**.

---

# 3. Why Can I See the Module But Not the Create/Edit/Delete Button I Need?

This currently applies specifically to the **Service Module (ERP)**.

These actions require individual ERP permissions:

* `project_create`
* `project_edit`
* `project_delete`
* `sr_create`
* `sr_edit`
* `sr_delete`

Having the `erp` module assigned only provides access to the module itself.

The other modules currently do not have this same granular sub-permission system. Their access is controlled by module assignment.

---

# 4. I'm an Admin — Why Did Toggling a Module Off For Myself Not Remove It From My Sidebar?

This is by design.

`User.get_apps()` returns all available modules whenever:

```python
role == "admin"
```

Therefore, `assigned_apps` does not restrict an administrator.

To restrict access, the user's role must first be changed from `admin` to `user`.

---

# 5. Why Do I Have Every ERP Sub-Permission Even Though None Are Checked For Me?

Administrators automatically pass ERP permission checks.

Both frontend and backend permission checks allow administrators before examining the `erp_permissions` list.

---

# 6. I Checked a P2P Permission Box in Users & Roles and Saving Failed — Why?

The P2P permission checkboxes currently shown in the interface are:

* `pr_create`
* `approval_view`
* `approval_action`
* `rfq_view`
* `rfq_action`
* `grn_view`
* `grn_action`

These permissions are not currently accepted by the backend permission allow-list.

Consequently, saving them can fail with HTTP 400.

This is a known implementation gap. P2P/Purchase/RFQ/GRN routes currently use module access rather than these granular permission IDs.

---

# 7. I Was Signed In and Now I'm Logged Out — Why?

The session uses an HTTP-only cookie with a 24-hour lifetime.

After expiration, `/auth/me` returns unauthorized and the frontend redirects to `/login`.

Sign in again.

---

# 8. Why Was I Redirected to Login With an Unauthorized Email-Domain Message?

The backend checks the Microsoft account's email domain during authentication.

If the account is outside the configured company domain, authentication is rejected before the user account is created or updated.

Use your company Microsoft account rather than a personal Microsoft account.

---

# 9. Why Does It Say "Your Account Has Been Deactivated. Contact an Administrator"?

An administrator has set your `is_active` value to `false`.

Deactivated accounts cannot complete sign-in.

Contact an administrator to reactivate the account.

---

# 10. Does the Portal Have Its Own Password?

No.

The portal uses Microsoft SSO rather than a portal-specific password.

The `User` model contains legacy password-related fields, but they are not part of the active login flow.

---

# 11. Why Did "Sync from Azure AD" Fail?

The portal's error message indicates that the Azure AD application may not have the required directory-read permissions.

This requires Azure/IT administration rather than a change inside the portal.

---

# 12. I'm in Microsoft Teams — Why Did It Sign Me In Automatically, or Why Did It Ask Me to Tap a Button?

Inside Microsoft Teams, the login page first attempts silent SSO.

If silent SSO succeeds, you are taken directly to the Dashboard.

If it fails, the page falls back to a manual sign-in popup.

Both behaviors are expected.

---

# 13. Why Can't I Take a Photo Using the Camera in Teams?

Camera and media permissions are declared through the Teams app package manifest.

If the installed Teams package predates the update that added those permissions, reinstall the updated Teams app package.

---

# 14. What's the Difference Between "Purchase" and "P2P"?

They are separate modules for different workflows.

**Purchase** (`purchase`) handles procurement originating from ERP Service Request materials.

**P2P** (`p2p`) allows departments to raise Purchase Requisitions directly without an ERP Service Request and routes them through the applicable approval chain.

You only need the module relevant to your workflow.

---

# 15. Where Do Vendor Records Live?

Vendor management is not a separately assignable module.

Vendor records are accessed through:

```text
/dashboard/purchase/vendors
```

and require `purchase` module access.

---

# 16. Something Looks Broken, or the Development Server Won't Start. Where Do I Look?

Application and server troubleshooting is covered by the operations documentation under:

```text
docs/09-operations/
```

For development setup and configuration issues, also refer to the Setup & Development documentation.
