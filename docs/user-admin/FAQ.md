# Frequently Asked Questions

These answers are grounded in the actual portal code (`backend/app/modules/main/`, `frontend/src/hooks/useAuth.ts`, `frontend/src/components/Sidebar.tsx`). For step-by-step usage, see [USER_MANUAL.md](./USER_MANUAL.md); for admin actions, [ADMIN_MANUAL.md](./ADMIN_MANUAL.md). For server/environment problems, see [../troubleshooting/TROUBLESHOOTING.md](../troubleshooting/TROUBLESHOOTING.md) and [../troubleshooting/FRONTEND_TROUBLESHOOTING.md](../troubleshooting/FRONTEND_TROUBLESHOOTING.md).

### Why can't I see a module in the sidebar?

`Sidebar.tsx` only shows a module's nav item if `user.apps` includes that app's id (e.g. `erp`, `crm`). That list comes from `User.get_apps()` on the backend, which for a normal (`role: "user"`) account returns exactly whatever is in their `assigned_apps` column — nothing more. If a module is missing, it simply hasn't been assigned to you yet. Ask an administrator to add it via Users & Roles (see [ADMIN_MANUAL.md](./ADMIN_MANUAL.md#managing-users--app-access)).

### Why can I see the module but not the "Create"/"Edit"/"Delete" button I need?

For the Service Module specifically, those actions are gated by individual ERP sub-permissions (`project_create`, `project_edit`, `project_delete`, `sr_view`, `sr_create`, `sr_edit`, `sr_delete`), separate from just having `erp` access. Having the `erp` app assigned only gets you into the module — each action button additionally checks whether the specific permission is in your `erp_permissions` list. Ask an admin to grant the specific permission you need.

### I'm an admin — why did toggling a module off for myself not remove it from my sidebar?

By design. `get_apps()` returns **all** apps for any user with `role == "admin"`, ignoring `assigned_apps` entirely. The app-toggle checkboxes in Users & Roles have no effect on an admin account's actual access — only changing their `role` away from `admin` would restrict them. See [ADMIN_MANUAL.md](./ADMIN_MANUAL.md#how-admins-implicit-all-apps-access-works).

### Why do I have every ERP sub-permission even though none are checked for me in Users & Roles?

Same reason as above: `hasErpPermission()` on the frontend and the equivalent backend check both short-circuit to "allowed" for `role == "admin"` before even looking at the `erp_permissions` list.

### I was signed in and now I'm logged out — why?

Your session lives in an httponly cookie (`session_token`) issued at sign-in with a 24-hour lifetime (`max_age=86400` in `backend/app/modules/main/routes/auth.py`). Once it expires, `/auth/me` returns unauthorized and the frontend (`useAuth()` in `frontend/src/hooks/useAuth.ts`) redirects you back to `/login`. Simply sign in again — there's no separate "remember me" setting.

### Why was I redirected to the login page with "Your Microsoft account's email domain is not authorized for this portal"?

The backend checks your Microsoft account's email domain against a configured allowed domain (`DOMAIN_EMAIL`) at `/auth/callback` and `/auth/teams-token`, before your account row is even created or updated. This isn't a portal permission issue — it means the Microsoft account you signed in with is outside the company's configured domain. Make sure you're using your company Microsoft account, not a personal one.

### Why does it say "Your account has been deactivated. Contact an administrator."?

An admin has set your account's `is_active` flag to false from Users & Roles (the Activate/Deactivate toggle). This is checked explicitly in `/auth/callback`, so a deactivated account cannot complete sign-in at all. Ask an administrator to reactivate you.

### Does the portal have its own password?

No. Authentication is Microsoft SSO only — there's no portal-specific password to reset or forget. (The `User` model does have a dormant `hashed_password` column inherited from an older schema, but per the model's own code comments it is not wired into any active login path.)

### Why did "Sync from Azure AD" fail?

The error message shown ("Azure sync failed. Check that the app has directory-read permission in Azure AD") points to the portal's Azure AD app registration lacking directory-read permission — this is an Azure/IT configuration issue, not something fixable from inside the portal UI. Escalate to IT/Azure admin.

### I'm in Microsoft Teams — why did it sign me in without asking, or why did it ask me to tap a button?

Inside a Teams tab, the login page first tries silent SSO (`teams.authentication.getAuthToken()`) automatically. If that succeeds, you're taken straight to the dashboard. If it fails for any reason (e.g. consent not yet granted, token issue), the page falls back to showing "Sign-in required — tap below to continue," which opens a sign-in popup instead. Both are normal, expected behavior, not a bug.

### Why can't I take a photo using the camera in the Teams mobile/desktop app?

Camera/media access inside Teams requires the Teams app package's manifest to declare that permission. This was added on 2026-08-05 (see [RELEASE_NOTES.md](./RELEASE_NOTES.md)) — if your organization's Teams app install predates that, you (or your admin) need to reinstall the updated Teams app package for camera capture to work there.

### What's the difference between "Purchase" and "Purchase Requisition" in the sidebar — do I need both?

No — they're separate modules for separate workflows. "Purchase" (`purchase` app) is the procurement pipeline tied to materials on a Service Request. "Purchase Requisition" (`p2p` app) lets any department raise a requisition directly, with no Service Request involved. You only need whichever one matches how you'll be using it; see [MODULE_GUIDES.md](./MODULE_GUIDES.md) for the full distinction.

### Something on the app itself looks broken/crashed, or the dev server won't start — where do I look?

That's covered by the existing troubleshooting guides, not this document: [../troubleshooting/TROUBLESHOOTING.md](../troubleshooting/TROUBLESHOOTING.md) (backend/server issues) and [../troubleshooting/FRONTEND_TROUBLESHOOTING.md](../troubleshooting/FRONTEND_TROUBLESHOOTING.md) (frontend/Next.js issues).
