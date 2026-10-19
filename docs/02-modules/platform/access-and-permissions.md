# Access and permissions (end to end)

Status: written from the code on 2026-10-07 (working tree on `main`, after commit `aa9b49f`).
Scope: how a person signs in, how the portal decides which modules, tabs, actions and records they get, and where that is enforced. Every statement here points at a file. If code and this page disagree, the code is right and this page needs an update.

---

## 1. The layers at a glance

A request has to pass these checks, in this order:

| # | Layer | Where | Question it answers |
|---|---|---|---|
| 1 | Security middleware | `backend/app/middleware/owasp.py` | Is this request well formed and not abusive? Does an `/api/` call carry a credential at all? |
| 2 | Authentication | `get_current_user` in `backend/app/modules/main/routes/auth.py` | Who is this? Is the JWT valid? Is the user still `is_active`? |
| 3 | Module (app) access | `require_app_access` / `require_any_app_access` in `backend/app/core/permissions.py`, plus module-specific copies (`require_hr`, `_requester_or_purchase`) | Has this user been given the module? |
| 4 | Tab / action (Permission Matrix) | `require_tab_access` / `require_tab_action` in `core/permissions.py`, logic in `core/permission_registry.py` | Inside the module, may they see this tab and do this action? |
| 5 | Authority / role flags | `is_partner`, `is_director`, `is_*_manager`, `is_*_head`, Quality `_explicit` grants, PM `is_management` | May they approve, release or close? |
| 6 | Data scope | Store plant access `backend/app/modules/store/services/plant_access.py` (the only one in use) | Which records may they see and post against? |
| 7 | Frontend gating | `useRequireApp`, `useRequireAnyApp` (`frontend/src/hooks/useAuth.ts`), `filterTabsByAccess` (`frontend/src/lib/tabAccess.ts`) | What does the UI show? This is for convenience only. It is not a security control. |

> **ERP standard / why.** SAP, Oracle and Dynamics all use layers like these: you authenticate once, then go through authorization objects for the transaction or module, the activity (create, change, display, approve) and the organizational level (company code or plant). The server enforces every layer. The UI only hides what the server would refuse anyway. A layer that exists only in the UI is not access control.

---

## 2. Signing in: Microsoft SSO

The portal has no local passwords. `User.hashed_password` and `must_change_password` are unused columns (see the security note in `backend/app/modules/main/models/user.py`, and ADR `docs/11-decisions/0002-microsoft-sso.md`).

### 2.1 Browser flow (`/api/v1/auth/microsoft-login` → `/api/v1/auth/callback`)

1. **`GET /auth/microsoft-login`** (`auth.py`)
   - Returns 503 if `AZURE_CLIENT_ID` or `AZURE_TENANT_ID` is not set.
   - Generates a random `state` and stores it **server-side, in memory** (`_oauth_states`) with a 10-minute TTL and a cap of 500 pending states. It also stores `next_path`, which only accepts same-site relative paths, so it cannot be used as an open redirect.
   - Redirects to Microsoft through `get_auth_url()` (`backend/app/auth/microsoft.py`), using scope `User.Read` and `prompt=select_account`. The account picker always shows, so the browser never signs in silently as the last account used.
2. **`GET /auth/callback`**
   - Pops and checks `state`. A missing or expired state returns 400.
   - Exchanges the code for a token with MSAL (`exchange_code_for_token`), then reads `/me` from Graph (`get_microsoft_user_profile`).
   - **Domain allow-list.** If `DOMAIN_EMAIL` is set, any email outside that domain is sent to `/login?error=unauthorized`. *If `DOMAIN_EMAIL` is empty, every domain is allowed* (`core/config.py`). Production must set it.
   - **Just-in-time provisioning.** If no `User` row exists, one is created with `role="user"`, `is_active=True` and `assigned_apps=[]`. A new user can sign in but sees no modules until an admin assigns some.
   - **Leaver guard.** If the user's HR profile says `exited`, the account is forced to `is_active=False` and the browser is sent to `/login?error=exited`. See section 9.
   - Refreshes name, Azure id, phone and office location. Department and designation are refreshed **only if HR has not locked them** (`is_org_locked`, `hr/services/employee_sync.py`).
   - `_refresh_azure_admin()` checks whether the user is an Azure **Global Administrator** (`get_azure_admin_ids`, which uses an app-only Graph token). If so, it sets `is_azure_admin=True` and **promotes `role` to `admin`**. If Graph fails, the last known value is kept, so a failed lookup never strips access.
   - Looks up the manager on a best-effort basis (`/me/manager`), then calls `sync_user_org_links` to link the user to a Branch (from `officeLocation`) and a Department.
   - If `is_active` is false, the browser is sent to `/login?error=inactive`.
   - Issues a session (section 3). The Teams popup case instead hands back a 120-second one-time code (`/auth/teams-exchange`), because the popup's cookie jar is isolated from the main window.

### 2.2 Teams silent SSO (`POST /auth/teams-token`)

- The Teams `getAuthToken()` JWT is checked against Azure JWKS (cached for 1 hour) using RS256.
- Checks performed: `aud` ends with our client id, `tid` equals our tenant, `iss` is one of the two fixed issuers for our tenant, and the token is not a replay (`jti` cache).
- The same domain allow-list applies, and so does the exited check, which returns 403 with `exited_login_message`. Inactive users get 403.
- An On-Behalf-Of exchange then obtains a Graph token. If that fails, login still succeeds.

> **ERP standard / why.** Using the corporate identity provider as the only way in means a person disabled in Entra ID cannot get in. Passwords, MFA and conditional access stay in one place. The portal only decides *what* a signed-in person may do, never *who* they are.

---

## 3. Sessions: access token, refresh token, logout

| Cookie | Content | Lifetime | Scope |
|---|---|---|---|
| `session_token` | HS256 JWT `{sub, email, role, exp}` (`auth/jwt_handler.py`) | `ACCESS_TOKEN_EXPIRE_MINUTES` = **15 min** | all paths |
| `refresh_token` | 64-character random value. **Only its SHA-256 hash** is stored, in `user_sessions.token_hash` | `REFRESH_TOKEN_EXPIRE_DAYS` = **7 days** | `path=/api/v1/auth` only |
| `ms_access_token` | Microsoft Graph delegated token | 1 h | all paths |

All three cookies are `httponly`. When `SECURE_COOKIES=true` (production) they are also `Secure` and `SameSite=None`. In development they are `SameSite=Lax`.

- **`get_current_user`** reads `session_token` first, then falls back to `Authorization: Bearer`. It verifies the JWT and **reloads the user on every request**, returning 401 if `!is_active`. Deactivation therefore takes effect on the user's next request, even with a JWT that has not expired. This dependency never re-issues a token.
- **`POST /auth/refresh`** looks up the refresh token's hash. It rejects tokens that are revoked, expired or belong to an inactive user. It **rotates** the token: the old row gets `revoked_at` and a new row and cookie are issued, so a replayed old cookie fails. It also issues a new 15-minute access token. The frontend calls it once on a 401 and then retries the request (`frontend/src/lib/api.ts`, `withCredentials: true`).
- **`POST /auth/logout`** revokes the refresh session that matches the cookie and deletes all three cookies. **It depends on `get_current_user`**, which is gap C-11 (section 12).
- `revoke_user_sessions()` (`hr/services/exit_guard.py`) means "sign out everywhere". It is called on admin deactivation, on HR exit, and when an Azure sync deactivates a user.

> **ERP standard / why.** Short-lived access tokens plus revocable, rotating refresh tokens are the standard answer to "how do we cut someone off now". A bare JWT cannot be withdrawn before its `exp`. A `user_sessions` row can be revoked at any time.

---

## 4. Module access: `assigned_apps`, `AVAILABLE_APPS`, `get_apps()`

`backend/app/modules/main/models/user.py`:

```python
AVAILABLE_APPS = {"erp", "rnd", "crm", "p2p", "store", "purchase", "quality", "projects",
                  "accounts", "hr", "production", "design", "electrical", "hydraulic", "maintenance"}

def get_apps(self):
    if self.role == "admin" or self.is_azure_admin:
        return sorted(AVAILABLE_APPS)
    return self.assigned_apps or []
```

- `assigned_apps` is a JSON list that an admin edits in **Users & Roles → Module Access** (`PATCH /users/{id}`, `require_admin`). Keys are validated against `_assignable_app_keys(db)`, which is the `modules` DB registry (`routes/modules.py`) with `AVAILABLE_APPS` as the minimum set.
- `GET /auth/me` returns `apps = get_apps()`. The frontend sidebar, dashboard and page guards all use that list.
- `p2p` and `purchase` are separate apps. `p2p` covers raising and viewing your own PRs. `purchase` covers processing them in the buying department.
- The `modules` registry has an `is_active` flag, but `get_apps()` ignores it. Deactivating a module row hides it from the assign checklist but does not take it away from users who already have it.

### 4.1 Roles

- `role` is only `"user"` or `"admin"` (`VALID_ROLES`, `routes/users.py`). There are no other role values.
- **Admin** gets every app, passes every `can_view_tab` and `can_perform` check, gets every plant in Store, and is the only role allowed into Organization and Users (`require_admin`). An admin cannot demote or deactivate themselves.
- **Azure Global Administrator** gets admin automatically, at login and on sync. This is only ever a promotion. If someone later loses the Azure role, `is_azure_admin` becomes false but `role="admin"` stays (see gaps).
- Legacy `erp_permissions` (`has_erp_permission`, `useRequireErpPermission`) are still used for Service Module (ERP) project and service-request actions: 10 checks in `erp/routes/projects.py` and 3 in `erp/routes/service_requests.py`.

### 4.2 Authority flags (who approves)

The `User` model holds these flags: `is_department_head`, `is_project_head`, `is_plant_head`, `is_purchase_head`, `is_director`, `is_partner`, `is_finance_manager`, `is_design_manager`, `is_rnd_manager`, `is_production_manager`, `is_project_manager`, `is_store_manager`, `is_purchase_manager`.

- All of them except `is_partner` are edited in Users & Roles (`PATCH /users/{id}`). Examples of use: the P2P PO approval role sets (`P2P_PO_APPROVER_FLAGS`) and AP variance approval (`is_finance_manager`).
- **`is_partner` (decision D1, `docs/MODULE_DETAILED_PLAN.md`).** The MD role was removed, and **Partners are now the top approval and escalation level and the signatory**. The flag can be set **only** in Organization → Company Info → Partners (`PUT /organization/company/partners`, `organization/routes/company.py`). `PATCH /users` has no `is_partner` field.
  - It is read by Quality (`quality/services/access.py`: `is_partner`, `partners()`; a vendor *Block* needs a Partner), PM (`projects/workflow.py` `is_management`), P2P (`p2p_request.py`, `mis.py`), ERP projects and HR lifecycle.
  - `/auth/me` exposes `is_partner` to the frontend.

> **ERP standard / why: segregation of duties.** Approval authority is held in flags separate from module access. Holding the `purchase` app lets you *process* a PO. It does not let you *approve* one; that needs a PO-approver flag. Keeping "who can do" separate from "who can approve" is the basic SoD control auditors look for, for example in requisition-to-pay and inspection-to-release. Partners at the top, assigned only in Company Info, gives you one clearly owned and auditable list of final signatories.

---

## 5. Enforcement dependencies (`backend/app/core/permissions.py`)

| Dependency | Rule | Failure |
|---|---|---|
| `require_app_access(app)` | `app in user.get_apps()` | 403 `Access to '<app>' module required` |
| `require_any_app_access(*apps)` | any one of them | 403 `Access to one of [...] required` |
| `require_tab_access(module, subtab)` | `can_view_tab(user, module, subtab)` | 403 `Access to '<module>:<subtab>' not granted` |
| `require_tab_action(module, subtab, action)` | `can_perform(...)` | 403 with an actionable message: *"You don't have 'edit' permission on Production › Work Orders. Ask an admin to grant it in Users › Permission Matrix."* |
| `has_erp_permission(user, perm)` | admin, or `perm in erp_permissions` | (caller raises) |

The tab dependencies are documented as **additional to** `require_app_access` and do not replace it. They are usually attached at router level (`APIRouter(dependencies=[Depends(require_app_access("x"))])`) or as module constants such as `_CAN_EDIT = require_tab_action("quality", "masters", "edit")`.

Module-specific variants:
- `require_hr` / `require_hr_module` (`hr/services/access.py`) is the same check as `require_app_access("hr")`.
- `_requester_or_purchase` (`p2p/routes/p2p_requests.py`) lets in `p2p` **or** `purchase` **or** any PO-approver flag **or** anyone named as an approver on a PR. Each route then narrows what that user sees.
- `require_admin` (`main/routes/users.py`) is used by Users and the whole Organization module.

---

## 6. The Permission Matrix (`backend/app/core/permission_registry.py`)

### 6.1 What it is

- `ACTIONS = view, create, edit, delete, approve, reject, export, print, import`
- `MODULES` is a static, hand-maintained catalogue of `module_key → {label, subtabs}` that mirrors each frontend `*Nav.tsx`. It is code, not metadata; see decision *No metadata customization*.
- A grant is the string `"<module>:<subtab>:<action>"` (`permission_id`). It is stored in `User.granular_permissions` (JSON list) and written by `PUT /users/{id}/permissions` (`routes/users.py`, validated against the registry). `User.data_access_scopes` (`module → own|department|branch|company|all`) is saved by the same route.

### 6.2 "Unconfigured = allowed" (opt-in per module)

`can_view_tab` and `can_perform` use the same rule:

1. Admin → allowed.
2. The user has **no grant at all starting with `<module>:`** → **allowed**. The matrix has never been used for that user in that module, so they keep app-level access.
3. Otherwise → allowed **only if** the exact `<module>:<subtab>:view` (or `:<action>`) grant exists.

The result: when an admin ticks even one box for a user in a module, that user is locked down to exactly the ticked boxes in that module. Other modules are unaffected.

**Exception for authority actions.** Quality (`quality/services/access.py` `_explicit`), the settings framework (`can_edit_settings`) and PM management (`MANAGE_GRANT` in `projects/workflow.py`) **do not** use the opt-in fallthrough. Usage decisions, plan approval, NCR disposition, FAI approval, CAPA closure, vendor approval, settings edits and PM management all need an **explicit** grant (or admin). Otherwise any untouched user would count as a Quality head by default. Quality also has preset permission sets (`QUALITY_ROLE_PERMISSION_SETS`: inspector, engineer, head, calibration in-charge) that are applied as grants.

### 6.3 `tab_access` on the user

`GET /auth/me` returns `tab_access = restricted_subtabs(user)`: `{module_key: [viewable subtab keys]}`, **only for modules where the user has at least one grant**. A module that is not in the dict is unrestricted. Admins always get `{}`.

> **Note.** The module docstring in `permission_registry.py` ("Nothing in the app enforces `granular_permissions`/`data_access_scopes` against routes yet") and the matching comment on `User.granular_permissions` are **out of date** for `granular_permissions`. Several modules now enforce it (section 8). It is still true for `data_access_scopes`.

> **ERP standard / why: least privilege.** The opt-in default is a migration convenience, not a least-privilege design. A new user with an app gets every tab and action in it until someone restricts them. That is the reverse of SAP-style roles, where nothing is allowed until a role grants it. It is acceptable while the matrix is being rolled out, but the target is default-deny, with role templates like Quality's, so that a new joiner gets the minimum for their job.

---

## 7. Frontend gating (UI only)

| Helper | File | Behaviour |
|---|---|---|
| `useAuth()` | `frontend/src/hooks/useAuth.ts` | Loads `/auth/me` (user, `apps`, flags, `tab_access`). |
| `useRequireApp(app)` | same | Once loaded, `router.push('/dashboard')` if `app ∉ user.apps`. Returns `isAuthorized`. The app keys are a hard-coded TypeScript union. |
| `useRequireAnyApp(...apps)` | same | Same idea, any one app. Mirrors `require_any_app_access` (for example, Production supervisors raising Maintenance requests). |
| `useRequireErpPermission(perm)` | same | Direct-URL backstop for legacy `erp_permissions` create and edit pages. |
| `filterTabsByAccess(moduleKey, tabs, user)` | `frontend/src/lib/tabAccess.ts` | Hides `*Nav.tsx` tabs whose `subtabKey` is not in `user.tab_access[moduleKey]`. A tab with no `subtabKey` always shows. A module missing from `tab_access` shows every tab. |

`filterTabsByAccess` is used in: CrmNav, DesignNav, ElectricalNav, ErpNav, HrNav, HydraulicNav, MaintenanceNav, OrganizationNav, P2PNav, ProductionNav, ProjectsNav, QualityNav, RndNav. It is **not** used in the Store, Purchase or Accounts navs, which have no matrix subtabs.

Hiding a tab does not block its URL or its API. Where a module has no `require_tab_*` on the server (section 8), a user whose tab is hidden can still open the page directly or call the API.

---

## 8. Per-module enforcement map

The table below is a spot-check of `backend/app/modules/*/routes` on 2026-10-07, counted by grep. "Tab/action checks" counts `require_tab_access`, `require_tab_action` and explicit-grant authority checks. **App-only** means every route checks module access but nothing finer.

| Module (UI label) | App key(s) | Matrix subtabs (`MODULES`) | ~Endpoints | Module gate | Tab / action enforcement | Verdict |
|---|---|---|---|---|---|---|
| Organization | — (admin only) | info, branches, department, users, roles | 51 | `require_admin` on 50 | none (admin only) | Admin only; matrix entries cannot grant anything to a non-admin |
| Users / Auth (main) | — | — | 44 | `get_current_user`; `require_admin` on 22 | — | Admin for user management |
| Service Module | `erp` | dashboard, projects, service_requests, reports, recycle_bin | 47 | `require_app_access("erp")` on all | 4 `require_tab_access` (projects, service_requests, recycle_bin ×2) + 13 legacy `has_erp_permission` | Partial; actions use the legacy `erp_permissions`, not the matrix |
| CRM | `crm` | dashboard, organizations, inquiries_tenders | 79 | `require_app_access("crm")` on 76; `documents.py` 2 routes with only `get_current_user` | **0** | **App-only.** Matrix hides tabs only |
| Procurement (P2P) | `p2p`, `purchase` | purchase_requisitions, pr_approval, rfq, po_approval, grn | 55 | 38 `purchase`, 12 `_requester_or_purchase`, 1 `p2p`, 1 `erp`, 2 `_require_mis_access` | **0** matrix checks; approvals gated by approver slots and PO-approver flags | **App-only + flag SoD** |
| Store | `store` | *(none, `subtabs: {}`)* | 74 | `require_app_access("store")` on 70; `material_returns.py` 3 and `uoms.py` 1 with only `get_current_user` | **0**; plant scoping in 8 route files (section 10) | **App-only + plant scope** |
| Purchase | `purchase` | *(none)* | (within P2P) | see P2P | none | App-only |
| Accounts / Finance | `accounts` | **not in `MODULES`** | 112 | `require_app_access("accounts")` on all; `require_admin` on 2 | **0** | **App-only.** The matrix cannot express Finance at all |
| R&D | `rnd` | 16 incl. engineering tools | 54 | router-level `require_app_access("rnd")` | router-level `require_tab_access` per area (requirements, projects, prototypes, experiments, dashboard); 3 `require_admin` | Tab level on main areas; no action level |
| Maintenance | `maintenance` (some routes `maintenance` or `production`) | dashboard, project_work, assets, requests, work_orders, schedule, spares, reports | 61 | router-level + 14 `require_any_app_access` | **47** tab/action checks (incl. export, edit on work orders) | **Enforced** |
| Production | `production` (1 route `production` or `erp`) | 9 | 75 | `require_app_access("production")` | **29** (create, edit, delete, approve, print on rrv_builds and work_orders; shop_floor edit; planning/workstations view) | **Enforced** |
| Design | `design` | 10 incl. settings | 136 | router-level `require_app_access("design")` | **11**, mostly view checks per router (documents, boms, library, …) + role logic per decision | Mostly tab level; few actions |
| Electrical | `electrical` | 7 | 68 | router-level | **17** (`_CAN_CREATE`, `_CAN_EDIT`, `_CAN_DELETE` on jobs; drawings approve; testing/troubleshooting view) | **Enforced** |
| Hydraulic & Pneumatic | `hydraulic` | 11 | 75 | router-level on all 12 routers | **41** | **Enforced** |
| Quality | `quality` | 18 incl. settings | 143 | router-level `require_app_access("quality")` | 19 `require_tab_action` + `_explicit` authority checks (approve, disposition, FAI, CAPA close, settings) | **Enforced**, with explicit authority |
| Project Management | `projects` | 9 | 50 | 21 routes `require_app_access("projects")`; **27 routes in `work.py` with only `get_current_user`** (by design: department users work from their own module) | **0** `require_tab_*`; management actions use `is_management` (admin, Partner, Director or explicit `projects:all_projects:create`) | App-only + explicit management authority |
| HR & Administration | `hr` | 13 | 145 | 83 `require_hr`; **72 with only `get_current_user`** (My HR self-service, approvals by `can_decide`) | **0** `require_tab_*`; approvals via `ensure_can_decide` (reporting manager / HR) | **App-only + approver logic** |

Shared settings framework routes (`make_settings_router`) use `require_app_access(module)` for read, and admin or an explicit `<module>:settings:edit` for write (section 11).

---

## 9. Leavers: HR exit guard (`backend/app/modules/hr/services/exit_guard.py`)

HR owns employment status (decision *HR module scope*). A person's Entra account is often left enabled during handover, so the portal checks its own record:

- `get_exit_info` / `is_exited` read `HrEmployeeProfile.employment_status == "exited"`.
- **Login.** `/auth/callback` forces `is_active=False` and redirects `?error=exited`. `/auth/teams-token` returns 403 with `exited_login_message` ("…ask HR to complete a joining event in HR > Lifecycle").
- **Azure sync** (`POST /users/sync-azure`). It never re-activates an exited user. Users who have left the tenant (or no longer pass the domain and shared-mailbox filter) are deactivated **and their sessions revoked**.
- **Admin activate** (`PATCH /users/{id}/activate`) returns 409 for an exited user. The only way back is a new HR joining event.
- **Admin deactivate** sets `is_active=False` and calls `revoke_user_sessions()`.
- **HR lifecycle exit** (`hr/services/lifecycle.py` ~l.876) revokes sessions.
- Because `get_current_user` checks `is_active` on every request, a deactivated user's existing 15-minute JWT stops working on their next call.

> **ERP standard / why.** Joiner-mover-leaver control is a standard audit item: access must end on the leaving date and must not quietly come back. Tying portal access to the HR system of record, not only to the IdP, closes the "Entra still enabled during handover" hole.

---

## 10. Data access scopes and plant scoping

- `User.data_access_scopes` (`own | department | branch | company | all` per module) **is stored but no code reads it**. No route filters records by it.
- The one data-level scope in use is **Store plant access** (`store/services/plant_access.py`). It is switched on in Store → Settings → Plant Access (`StoreSetting` key `STORE_SETTING_PLANT_ACCESS`), and it works like SAP plant-level authorization on goods movements:
  1. admin or Azure admin → every plant
  2. setting OFF → every plant
  3. per-user override `all_plants` → every plant
  4. per-user override `branch_ids` → those plants
  5. otherwise → `User.branch_id` (synced from Azure `officeLocation`)
  6. no plant → nothing (the settings page flags these users)

  `visible_location_ids` / `filter_by_location` narrow list queries. `ensure_location_allowed` returns 403 on detail views and on every stock posting, with a message explaining how to get access. Used in: locations, material_issues, material_returns, stock, stock_adjustments, stock_import, stock_reservations, stock_transfers.
- Other modules apply record-level rules inside their own logic. Examples: P2P approvers see only PRs they are named on; HR self-service sees only your own records; PM department work sees only your department's tasks. None of this goes through a shared scope mechanism.

> **ERP standard / why.** Organizational-level authorization (company, plant, department) answers *which* records, as opposed to *which functions*. Without it, a store keeper at plant A can post stock at plant B. Store is now covered. The other modules still need a single shared mechanism; see C-06.

---

## 11. Shared module settings framework (`backend/app/core/settings_framework.py`)

- Each module declares its admin-tunable *values* in code (`ModuleSettingsDef` / `SettingSpec`, typed and validated). Keys and types are code, in line with *No metadata customization*.
- A DB row (`module_settings`) exists only while a value differs from the default. Each save or reset writes an `AuditLog`. A spec can be per plant: lookup goes branch row, then company-wide row, then code default.
- **Access.** `make_settings_router(module)` reads with `require_app_access(module)`. Writes need **admin or an explicit `<module>:settings:edit` grant** (`can_edit_settings`). The opt-in fallthrough deliberately does not apply here.
- **Status.** No module calls `register_module_settings` or `make_settings_router` yet; only `tests/test_settings_framework.py` does. Quality, Design and Store still have their own settings routes. Number series and master lists are still TODO (§27).

---

## 12. Security middleware (`backend/app/middleware/owasp.py`) and CSRF

`OWASPMiddleware` is the outermost of the app's own middleware (`main.py`). It is followed by AuditContext, Logging, TrustedHost and CORS (`ALLOWED_ORIGINS`).

- **A01.** Any `/api/` path outside `PUBLIC_PATHS` with no bearer header and no `session_token` cookie gets 401 here, before routing. This is only a check that *some* credential is present; validation happens in `get_current_user`. Mass 404s count as path scanning.
- **A03.** Regex checks for injection in the URL and query string, in some headers, and in JSON bodies up to 64 KB.
- **A04.** Method allow-list. JSON bodies capped at 512 KB, multipart at 10 GB. Bulk DELETE is blocked (ID-list query strings, and DELETE on collection paths).
- **A05/A02.** HSTS, `nosniff`, a strict CSP (`default-src 'none'` on the API), `no-store` caching, COOP, and server fingerprint headers stripped.
- **A07.** Per-IP rate limits by bucket: auth 5/min, sso 600/min, delete 10/min, write 40/min, default 200/min. Ten violations within the window trigger a 10-minute IP ban. **A request carrying a portal JWT for the company domain is exempt** (`_is_company_user`, expiry ignored), because the whole office shares one public IP. Sign-in and refresh paths are never banned. `X-Forwarded-For` is trusted only from `TRUSTED_PROXIES`.
- **A08.** Content-Type allow-list on mutating requests.
- **A10.** Blocks private or loopback URLs in query parameters and headers.
- **CSRF.** **There is no CSRF control.** There is no Origin/Referer check and no custom-header requirement. The JSON Content-Type allow-list includes `text/plain`, `application/x-www-form-urlencoded` and `multipart/form-data`, which are all types a browser can send cross-site without a preflight. With `SameSite=None` cookies in production, a bodiless cross-site POST (approve, sync, restore) would carry the session. This is gap C-07.

---

## 13. Removed: module visibility lock (`core/module_visibility.py`, deleted)

Between 2026-10-01 and the current working tree, a hard-coded lock hid Quality, Production, Maintenance, Design, Electrical, Hydraulic, Projects, Accounts and HR from **everyone, admins included**, except one allow-listed email. That email was also always treated as admin (commits `eed23fa`, `6f811c0`). It was enforced through a global dependency, `module_visibility_gate`, wired in `main.py`, which returned 403 on every route in those packages.

**The file is deleted in the working tree** (staged `D`). `main.py` and the frontend no longer reference it; a grep for `module_visibility` or `can_see_restricted` finds nothing. Access to those modules now follows the normal `assigned_apps` / `get_apps()` rules again. Users' `assigned_apps` were never changed by the lock, so the access they had before it came back unchanged.

---

## 14. Known gaps

Cross-referenced to `docs/erp-review/05-summary-and-roadmap.md`.

### C-06: The Permission Matrix only hides nav tabs; `data_access_scopes` is never enforced. **Partly fixed**

- Fixed: Maintenance, Production, Electrical, Hydraulic and Quality enforce tab and action checks on the server. R&D, Design and ERP enforce at view level.
- **Still app-only:** CRM, P2P/Procurement, Store, Accounts, Projects and HR (0 `require_tab_*` each). In these modules a matrix restriction is cosmetic.
- **Not expressible:** `store` and `purchase` have empty `subtabs`. `accounts` is **missing from `MODULES`** although it is in `AVAILABLE_APPS`, so Finance access is all-or-nothing, and SoD inside Finance (posting vs approving vs reporting) cannot be configured.
- `data_access_scopes` is saved and never read. Only Store has data scoping, through its own setting.
- The default is opt-in ("unconfigured = allowed"), not default-deny.
- The docstrings in `permission_registry.py` and `User.granular_permissions` are out of date.

### C-07: CSRF on cookie auth. **Open**

No Origin check and no required custom header (for example `X-Requested-With`). `SameSite=None` in production, and form-encodable Content-Types are allowed. Fix as the review recommends: an Origin/Referer allow-list for unsafe methods in `OWASPMiddleware`, plus a required custom header sent by `lib/api.ts`.

### C-10: Leaver access. **Partly fixed**

Done: deactivation revokes sessions; exited users are blocked at login (both flows), on sync and on activate; HR exit revokes sessions.

Still open:
1. **There is no scheduled Azure sync.** The APScheduler jobs in `main.py` are reminders and the PM scheduler only. Tenant removals reach the portal only when an admin clicks Sync.
2. **Sync re-activates locally deactivated users who are not exited.** `sync_azure_users` sets `target.is_active = True` for everyone still in the tenant, so an admin's manual deactivation is undone on the next sync unless HR has marked the person exited.

### C-11: Logout once the access token has expired. **Open**

`POST /auth/logout` depends on `get_current_user`. After 15 idle minutes it returns 401 *before* revoking the refresh session or clearing cookies. The middleware lists `/auth/logout` as public, but the route itself does not. On a shared PC the 7-day refresh cookie survives "logout", and the next person can refresh into the session. Fix: make logout work from the refresh cookie alone, with no `get_current_user`.

### Other gaps found while writing this page

- **Azure admin is a one-way promotion.** Losing Global Administrator clears `is_azure_admin` but leaves `role="admin"`. This needs a review of admins, or a demote that is not applied to manually granted admins.
- **Mixed admin checks.** Some code treats `is_azure_admin` as admin (`get_apps`, Store `is_unrestricted_user`, PM `is_admin`). Most uses `role == "admin"` only. They agree today only because of the auto-promotion.
- **Empty `DOMAIN_EMAIL` allows any Microsoft account** in the tenant app's audience to sign in, getting a user with no apps. Production config must set it.
- **The OAuth state, Teams codes and replay cache live in process memory.** This breaks with more than one worker or replica (a callback landing on a different worker gets "Invalid or expired state"), and the data is lost on restart.
- **`get_apps()` ignores `Module.is_active`.** Deactivating a module in the registry does not withdraw it from users.
- **Routes with only `get_current_user` in otherwise app-gated modules:** CRM `documents.py` (2), Store `material_returns.py` (3) and `uoms.py` (1), PM `work.py` (27, by design), HR self-service (72, by design). The two CRM and four Store routes should be checked to confirm they are intended to be open to any signed-in user.
- **The settings framework is not adopted yet.** Each module still has its own settings authorization.
- **Legacy `erp_permissions`** still run Service Module actions in parallel with the matrix. Two systems for one module make access reviews harder.
- **Frontend app-key union in `useRequireApp`** is hard-coded and needs a change whenever a module is added.

> **ERP standard / why these matter.** Auditors (ISO 27001 A.5.15–5.18, SOX ITGC-style access reviews) look at four things: (1) least privilege by default, (2) SoD enforced on the server, (3) timely removal of leavers, (4) sessions that really end. C-06 affects 1 and 2. C-10 affects 3. C-07 and C-11 affect 4.
