# Admin Manual

Administrative tasks for portal admins: managing user accounts, module access, and ERP sub-permissions. For general end-user instructions, see [USER_MANUAL.md](./USER_MANUAL.md).

## Who is an admin

A user is an admin if their `role` field is `"admin"` (as opposed to the default `"user"`). This is a plain column on the `users` table (`backend/app/modules/main/models/user.py`) — there is no separate "roles" table or granular admin tiers. There is also an `is_azure_admin` boolean column present on the model, but it is not read by `get_apps()` or any permission check found in the codebase — the only field that grants admin behavior is `role == "admin"`.

## How admin's implicit all-apps access works

This is the single most important mechanic to understand. From `backend/app/modules/main/models/user.py`:

```python
AVAILABLE_APPS = {"erp", "rnd", "crm", "purchase", "p2p"}

def get_apps(self) -> list[str]:
    """Modules this user can see: admins get all of them, everyone else
    gets whatever was explicitly assigned to them."""
    if self.role == "admin":
        return sorted(AVAILABLE_APPS)
    return self.assigned_apps or []
```

- If `role == "admin"`, `get_apps()` returns **every** app in `AVAILABLE_APPS`, regardless of what is (or isn't) in that user's `assigned_apps` column.
- Otherwise, the user only gets exactly what's in their own `assigned_apps` list — an empty list means no modules at all (they'd still be able to sign in and see the bare Dashboard, but no module nav items).
- This computed list is what's returned as `apps` in the `/auth/me` response (`backend/app/modules/main/routes/auth.py`, `CurrentUserResponse`), and the frontend's `Sidebar.tsx` and `useRequireApp()` (`frontend/src/hooks/useAuth.ts`) gate everything off `user.apps`, not off `assigned_apps` directly. **Practical effect: toggling apps on/off for an admin user in the Users & Roles UI has no visible effect** — they'll have access to all five modules either way. To actually restrict someone, their `role` must be `"user"`.
- The same pattern applies to ERP sub-permissions: `hasErpPermission()` in `frontend/src/hooks/useAuth.ts` short-circuits `true` for `role === 'admin'` before ever checking `erp_permissions`, and per the model's own comment the backend mirrors this (`role == admin or perm in erp_permissions`). So an admin implicitly holds every ERP sub-permission too.

## Managing users & app access

Nav path: **Users & Roles** (sidebar, admin-only) → `/dashboard/users`. This page is guarded by `useRequireAdmin()`, which redirects any non-admin to `/dashboard`.

The page (`frontend/src/app/dashboard/users/page.tsx`) shows:

- **Stat cards:** Total Users, Active, Inactive, Admins.
- **Search box:** filter the user list by name or email.
- **"Sync from Azure AD" button:** re-pulls user profile fields (name, title, department, phone) from Azure AD for existing accounts. If it fails, the UI shows "Azure sync failed. Check that the app has directory-read permission in Azure AD" — that's a configuration issue with the Azure AD app registration, not a user-side problem.
- **Per-user row actions:**
  - **Activate / Deactivate:** toggles `is_active`. A deactivated user cannot sign in — `/auth/callback` on the backend explicitly rejects inactive users and redirects them to `/login?error=inactive`.
  - **Edit access:** opens an editor for that user's app list and, if ERP is one of their apps, their ERP sub-permissions.

### Assigning module access

In the edit-access editor, toggle any of the five modules on/off for the user:

| App id | Sidebar label |
|---|---|
| `erp` | Service Module |
| `rnd` | R&D Tools |
| `crm` | CRM Module |
| `purchase` | Purchase |
| `p2p` | Purchase Requisition |

Saving calls `usersApi.updateModuleAccess(userId, apps, erpPermissions)`, which writes the user's `assigned_apps` (and `erp_permissions`, see below). Remember: this list is only consulted for non-admin users — see the "implicit all-apps access" section above.

### ERP sub-permissions

ERP has finer-grained permissions beyond the on/off `erp` app toggle, defined in the same editor (`frontend/src/app/dashboard/users/page.tsx`):

**Project permissions:**
| Permission id | Grants |
|---|---|
| `project_create` | Create a new project |
| `project_edit` | Edit an existing project |
| `project_delete` | Delete a project |

**Service Request permissions:**
| Permission id | Grants |
|---|---|
| `sr_view` | View service requests |
| `sr_create` | Create a service request |
| `sr_edit` | Edit a service request |
| `sr_delete` | Delete a service request |

These are stored in the user's `erp_permissions` JSON list column and are meaningless unless the user also has the `erp` app assigned (a non-admin user with `sr_edit` in `erp_permissions` but no `erp` in `assigned_apps` has neither the nav item nor the permission effect, since `useRequireErpPermission()` checks `hasErpApp && hasErpPermission(...)` — both must be true). This is enforced both in the UI (buttons/nav hidden without the permission) and server-side (the backend rejects the underlying API calls too, not just the button).

## Notes on account lifecycle

- Accounts are created automatically on first successful Microsoft sign-in (`backend/app/modules/main/routes/auth.py`, `/auth/callback`) — there is no "invite a user" or manual account-creation flow in the admin UI. To onboard someone, have them sign in once, then an admin assigns their apps/permissions from Users & Roles.
- If `DOMAIN_EMAIL` is configured, sign-in is restricted to that email domain — accounts outside it are rejected at `/auth/callback` with `?error=unauthorized` before any account row is even created.
- Profile fields (name, job title, department, phone) are refreshed from the Microsoft profile on every sign-in, and can also be refreshed on demand via "Sync from Azure AD" without requiring the user to sign in again.
