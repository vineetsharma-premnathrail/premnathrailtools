# Phase 4 — Security Risk Report

This report checks the Premnathrail Portal against the OWASP Top 10 (2021) and against ERP-specific business-logic risks. It is a read-only review of the working tree on 2026-09-29, including the uncommitted Permission Matrix work. **No exploit was executed.** Every finding comes from reading the code, and each cites `file:line`. "(inferred)" marks a conclusion reached by reading code that wasn't run, or one that depends on production settings the repo doesn't contain. Earlier-phase IDs are cross-referenced (`P1-…`, `P2-…`, `P3-…`, `F0-…`).

Conventions:
- BE = `backend/app/`, FE = `frontend/src/`.
- Personas: **[SEC]** Security Expert · **[BA]** ERP Business Analyst · **[ARCH]** Software Architect · **[USER]** End User.
- Severity:
  - **Critical**: an authenticated low-privilege user can take over the system or read its secrets.
  - **High**: bypass of a financial or approval control, or cross-user data tampering.
  - **Medium**: a weakness that needs a specific condition, or has limited blast radius.
  - **Low**: hardening or defence-in-depth.
- Effort: **S** < 1 day · **M** 1–3 days · **L** > 3 days.

---

## 1. Summary

| Severity | Count |
|---|---|
| Critical | 1 |
| High | 11 |
| Medium | 16 |
| Low | 11 |
| **Total** | **39** |

### What is already done well (verified)

These are real strengths. They are listed so no one "fixes" them by accident.

- **No SQL injection surface was found.** There are no `text()` calls built by f-string or `%`, and every query goes through the ORM. The 62 `ilike` filters use bound parameters.
- **No shell-command injection.** Every `subprocess.run` takes a list of arguments with no `shell=True` (`services/pdf_service.py:62`, `rnd/tools/*/reports/pdf_builder.py`).
- **Refresh tokens are handled correctly.** They are opaque, stored as a sha256 hash, rotated on every use, and kept in an httponly cookie scoped to `/api/v1/auth` (`auth/jwt_handler.py:9-19`, `main/routes/auth.py:91-126,459-498`).
- **The user is re-read and `is_active` re-checked on every request.** The JWT `role` claim is never trusted (`auth.py:157-160`).
- **Upload validation has a denylist and magic-byte checks.** SVG, HTML, XML and JS are refused, and the byte signature must match for PDF, Office and image files (`utils/sharepoint.py:135-176`). Downloads are proxied through the backend, and the raw SharePoint URL is never exposed.
- **P2P request detail and attachments are scoped by owner** (`p2p_requests.py:440-441,1121-1122`). Notifications are scoped by `user_id` (`main/routes/notifications.py:54`).
- **Security headers are set:**
  - `nosniff`, HSTS with preload, `Referrer-Policy`, `Permissions-Policy` and COOP;
  - `frame-ancestors 'none'`;
  - a strict CSP on API responses (`middleware/owasp.py:431-447`).
- **The global exception handler returns only the exception type and a reference number** (`middleware/error_handler.py:46-58`). Numbering series take advisory locks (Phase 2 §1.6).
- **Emails:** table rows are HTML-escaped (`utils/email.py:106,329-332`).
- **Secrets:** `.env`, `.env.*` and `db_backups/` are git-ignored. No secret file is tracked (`git ls-files`).

### Findings by severity

| ID | Sev | Persona | OWASP | Title | Main file:line | Effort |
|---|---|---|---|---|---|---|
| S-01 | **Critical** | [SEC] | A03 Injection | LaTeX injection in the Spline PDF report can read server files, including `.env` and `SECRET_KEY`, which leads to forged admin tokens | `rnd/tools/spline/api.py:25-37`; `services/pdf_service.py:61-72` | S |
| S-02 | High | [SEC][BA] | A01 / A04 | PR requester can self-approve; the heads are optional on the backend | `p2p/routes/p2p_requests.py:286-296,189-194` | S |
| S-03 | High | [SEC][BA] | A01 / A04 | Both P2P approval chains can be skipped by PATCHing `status`; an ad-hoc PO needs no approval | `p2p_requests.py:477-505`; `purchase_orders.py:55,127-160` | S |
| S-04 | High | [BA][SEC] | A04 | POs are approved with no value; the three-way match then accepts any invoice amount | `p2p/routes/rfq.py:614-620,643`; `accounts/service.py:292-308` | M |
| S-05 | High | [SEC] | A04 | Finance posting, payments and reversals need only the `accounts` app, with no segregation of duties | `accounts/routes/payments.py:49`; `vendor_invoices.py:130`; `journal_entries.py:106` | M |
| S-06 | High | [SEC] | A01 | The Permission Matrix is enforced only in the frontend; the APIs behind hidden tabs still answer | `core/permissions.py:36-48` (4 routes); `lib/tabAccess.ts:11-22` | L |
| S-07 | High | [SEC] | A01 (CSRF) | Cross-site request forgery on bodiless POSTs (approve, approve-po, Azure sync, restore) under `SameSite=None` cookies | `main/routes/auth.py:91-111`; `p2p_requests.py:512-515,564-567`; `users.py:462-466` | M |
| S-08 | High | [SEC] | A01 (IDOR) | Any ERP user can delete any service-request material photo | `erp/routes/service_requests.py:880-896` | S |
| S-09 | High | [SEC][BA] | A04 | Store: adjustments can be self-approved, manual stock entry is unrestricted, and returns can be uncapped | `store/routes/stock_adjustments.py:73-74,95-121`; `stock.py:91-125`; `material_returns.py:97,152` | M |
| S-10 | High | [SEC] | A07 | Leavers keep access: no scheduled sync, sync re-activates users, and deactivation doesn't revoke sessions | `users.py:440,503`; `auth.py:459-498` | M |
| S-11 | High | [SEC] | A07 | Logout silently fails after the 15-minute token expires, so the session survives on shared PCs | `auth.py:501-502`; FE `lib/api.ts:54,80-86`; `store/authStore.ts:69-71` | S |
| S-12 | High | [SEC][BA] | A04 / A09 | Quality, Organization and Store keep no audit trail, and Quality/Organization records are hard-deleted | grep: 0 audit writes; `quality/routes/*.py` (11 × `db.delete`) | M |
| S-13 | Medium | [SEC] | A04 / A05 | Rate limiting and IP bans probably see every user as `127.0.0.1` (Next.js proxy); depending on settings they are shared across the company or disabled | `docker-entrypoint.sh:8`; FE `next.config.*:36-38`; `owasp.py:163-172,206-212` | S |
| S-14 | Medium | [SEC] | A01 | CRM documents shared through a Technical Offer Request can be read by **any** logged-in user by sequential id | `crm/routes/documents.py:136-162` | S |
| S-15 | Medium | [SEC][BA] | A04 | Project Management: anyone with the app can decide any approval (including their own), delete any project and edit budgets, and no decider is recorded | `projects/routes/approvals.py:109-140`; `project.py:190-200` | M |
| S-16 | Medium | [SEC] | A07 | OAuth `state` is held in server memory and not bound to the browser (login CSRF); no PKCE or nonce; the legacy `?token=` login stores a bearer token in localStorage | `auth.py:164-192`; FE `app/login/page.tsx:36-39` | M |
| S-17 | Medium | [SEC] | A07 | Accounts are linked by case-sensitive email, not the immutable `azure_id` (account takeover through a reused mailbox, split identities) | `auth.py:217,372`; `users.py:495` | S |
| S-18 | Medium | [SEC] | A07 / A01 | Azure sync promotes tenant Global Admins to portal admin and never demotes; there is no role UI and no audit | `users.py:504-506,516` | S |
| S-19 | Medium | [SEC] | A09 | Changes to access (apps, flags, role, activate, sync, login/logout) aren't audited; the matrix audit stores no values | `users.py:216-225,368-459,462-550` | S |
| S-20 | Medium | [SEC] | A08 / A04 | Upload type check can be bypassed: any extension (`.exe`, `.bat`, `.hta`) is accepted when the client claims `image/*` or `video/*` | `utils/sharepoint.py:150-155,117-119` | S |
| S-21 | Medium | [SEC] | A03 | HTML injection into customer and vendor emails through unescaped greetings and titles | `utils/email.py:136,149,354,387,435,483` | S |
| S-22 | Medium | [SEC] | A05 | Fail-open defaults: `SECURE_COOKIES=False`, a placeholder `SECRET_KEY` accepted outside `environment=production`, and an empty `DOMAIN_EMAIL` allows every tenant account | `core/config.py:53,58,61,92-101` | S |
| S-23 | Medium | [SEC] | A05 | The OpenAPI schema, `/docs` and `/redoc` are public in every environment, listing all 478 endpoints | `main.py:182`; `owasp.py:123-128` | S |
| S-24 | Medium | [SEC] | A04 | JWT `sub` is an integer user id and the `email` claim is never checked, so a token issued before a restore that renumbers users maps to a different user | `auth.py:157-158,263,386,495` | S |
| S-25 | Medium | [BA][SEC] | A04 | A requester can cancel after the PO is approved; a rejected or cancelled PR leaves the PO live and invoiceable | `p2p_requests.py:639-641`; `rfq.py:782`; `accounts/service.py:308` | S |
| S-26 | Medium | [SEC][ARCH] | A04 | Race conditions double-post stock (GRN inspect) and drop concurrent approvals | `goods_receipts.py:332-333,370`; `p2p_requests.py:519,571` | S |
| S-27 | Medium | [SEC] | A01 | ERP private project documents: delete doesn't check visibility, and service-request attachments have no privacy check | `erp/routes/projects.py:464-477`; `service_requests.py:587,615,836,860` | S |
| S-28 | Medium | [SEC] | A04 | The app sends email **as the clicking user**, which needs tenant-wide `Mail.Send` rights | `utils/email.py:525-528` | M |
| S-29 | Low | [SEC] | A09 | Audit-log IP is taken from `X-Forwarded-For` with no trusted-proxy check, so it can be spoofed | `core/audit_context.py:46-49` | S |
| S-30 | Low | [SEC] | A01 | The OWASP middleware's "auth pre-check" accepts any `Bearer x` header (misleading defence in depth) | `middleware/owasp.py:275-292` | S |
| S-31 | Low | [SEC] | A01 | `/rnd/history` has no `rnd` app gate | `rnd/routes/history.py:19,153,188` | S |
| S-32 | Low | [SEC] | A01 | `/users/directory` gives every user the whole staff list (email, department, designation); `/presence/{type}/{id}` exposes who is viewing any record | `users.py:123-135`; `presence.py:42` | S |
| S-33 | Low | [SEC] | A05 | Error text leaks: R&D tools return raw Python exceptions as a 500; Azure and Graph error bodies are passed to the client | `rnd/tools/load_distribution/api.py:29,50`; `tractive_effort/api.py:22,37`; `vehicle_performance/api.py:33,59`; `users.py:474`; `service_requests.py:1143`; `utils/sharepoint.py:250` | S |
| S-34 | Low | [SEC] | A05 | Request body limit of 10 GB and file limit of 2 GB, with no per-user quota (disk and SharePoint exhaustion) | `owasp.py:62`; `utils/sharepoint.py:28` | S |
| S-35 | Low | [SEC] | A07 | Share-link tokens and session tokens use the same key and have no `typ` claim; presenting a share token as a session gives a 500 | `auth/jwt_handler.py:22-37,40-66`; `auth.py:157-158` | S |
| S-36 | Low | [SEC] | A04 | ERP service requests in the Recycle Bin can still be modified | `service_requests.py:652,687,722,748,781,894,1062` | S |
| S-37 | Low | [SEC] | A07 | Logout's `delete_cookie` omits `samesite`/`secure`, so cookies may survive inside the Teams iframe | `auth.py:514-516` | S |
| S-38 | Low | [SEC] | A04 | CRM: any CRM user can send a Technical Offer Request email for any inquiry or tender, as themselves | `crm/routes/inquiries.py:281-291`; `tenders.py:278-288` | S |
| S-39 | Low | [SEC] | A05 | Debug `print()` in the Spline report endpoint; in-memory login state breaks with more than one worker | `rnd/tools/spline/api.py:27-39`; `auth.py:35-50` | S |

---

## 2. Critical and High findings: detail

### S-01 · Critical · LaTeX injection in the Spline PDF report → server file read → forged admin session
- **Where:**
  - `POST /api/v1/rnd/tools/spline/report` (`rnd/tools/spline/api.py:25-37`) passes `data.dict()` **unescaped** to `PdfService().create_pdf("spline_template.tex", …)`.
  - `services/pdf_service.py:61-72` compiles the result with `pdflatex`, falling back to `xelatex` and then `lualatex`. It uses **no `-no-shell-escape` and no `openin_any=p`**.
  - The template renders about 14 free-text fields: `doc_no`, `made_by`, `checked_by`, `approved_by`, `material_type`, `loco_weight` and more (`utils/templates/spline_template.tex`; all declared `str` in `spline/schemas.py:4-16`).
- **Why this one is different:** the hydraulic and braking reports escape their input and harden the compiler (`hydraulic/api.py:130`, `braking/service.py:310`, `-no-shell-escape` plus `openin_any=p` in `*/reports/pdf_builder.py`). Even the Spline tool's own hardened builder (`spline/reports/pdf_builder.py:204,223-227`) is bypassed by this endpoint.
- **Reproduce** (conceptual; not run): as any user with the `rnd` app, send the report request with `doc_no = "\input{/app/backend/.env}"`, or `\verbatiminput` on the same file, then open the PDF.
- **Impact:**
  - TeX Live's default `openin_any=a` allows reading any file the process can read.
  - `.env` holds `SECRET_KEY`, which signs every session JWT. With it, an attacker can mint a token for any user id, including an admin. `.env` also holds the Azure client secret (tenant-wide Graph application rights) and the database password.
  - If `pdflatex` can be made to fail, the `lualatex` fallback runs `\directlua` (`io.open`/`os.*`), which is a path to writing files or running code (inferred).
- **Fix:**
  1. In `spline/api.py`, call `spline/reports/pdf_builder.py`, which already escapes, instead of `PdfService`. Otherwise, pass every string field through `escape_latex` from `rnd/tools/latex_utils.py`.
  2. Harden `PdfService._run`: add `-no-shell-escape`, `env={**os.environ, "openin_any": "p", "openout_any": "p"}`, and **remove the `xelatex`/`lualatex` fallback**.
  3. Rotate `SECRET_KEY`, the Azure client secret and the DB password once the fix ships.
- **Effort:** S.

### S-02 · High · PR self-approval; heads optional on the backend (P1-P2P-5, P2-P2P-15)
- **Where:**
  - `_validate_head` accepts **any active user**, including the requester, for Department, Project and Plant Head (`p2p_requests.py:286-296`).
  - The schema makes all three optional (`p2p/schemas/p2p_request.py:87-92`). "All three required" exists only in the frontend (`FE app/dashboard/p2p/new/page.tsx:115-117`).
  - `_check_approve_access` approves every slot the caller holds in a single call (`p2p_requests.py:189-194`).
  - With no heads set, **any purchase user** can approve (`:183-186`). The ERP "Raise PR" path sets no heads (`erp/routes/service_requests.py:921-941`).
- **Reproduce:** `POST /p2p/requests` with `approver_id`, `project_head_id` and `plant_head_id` all set to the caller's own id, then `POST /p2p/requests/{id}/approve`. The PR moves to `approved`.
- **Impact:** the requisition control, and so budget ownership, is defeated.
- **Fix:** in `create_p2p_request`:
  1. Make the three ids required in `P2PRequestCreate`.
  2. Reject `head_id == user.id`.
  3. Require the matching flag (`is_department_head`/`is_project_head`/`is_plant_head`).

  In `_check_approve_access`, refuse when `pr.requested_by_id == user.id`, and let one call satisfy **one** slot only. Apply the same rules in `_create_pr_for_materials` (ERP).
- **Effort:** S.

### S-03 · High · Approval chains can be skipped (P1-P2P-15, P2-P2P-16/17)
- **Where:**
  - `PATCH /p2p/requests/{id}` applies any field by `setattr`, **including `status`**, to any value in `P2P_REQUEST_STATUSES` (`p2p_requests.py:477-505`). It also accepts `approver_id`/`approver_name` without calling `_validate_head` (P3-INT-1).
  - `PATCH /p2p/purchase-orders/{id}` sets any PO `status` and writes no audit row (`purchase_orders.py:127-160`).
  - `POST /p2p/purchase-orders` creates an ad-hoc PO outside the approval flow (`:55`).
  - The GRN gate checks only the PR's status (`goods_receipts.py:240-246`).
- **Reproduce:** as a purchase user, `PATCH /p2p/requests/{id}` with `{"status":"po_approved"}`. The GRN is then allowed, and no Director or MD ever signed.
- **Impact:** the Purchase Head → Director → MD control is optional.
- **Fix:**
  1. Remove `status`, `approver_*`, `project_head_*` and `plant_head_*` from `P2PRequestUpdate` and `PurchaseOrderUpdate`, so status changes only through the dedicated transition endpoints.
  2. Make `create_po` require an approved PR, or delete it (the UI doesn't use it).
  3. Have the GRN gate check the PO's approval stamps, not a status string.
- **Effort:** S.

### S-04 · High · POs are approved with no value; the three-way match accepts any invoice (P1-P2P-3, P2-P2P-27)
- **Where:**
  - "Attach PO" sends only the vendor name and PO number (`FE rfq/[id]/page.tsx:154-157`).
  - The PO lines are copied **without price** (`rfq.py:614-620`), so `total_value` stays null (`:643`). The update schema has no price fields (`schemas/purchase_order.py:41-44`).
  - The match treats a null PO amount as zero variance and falls back to PO quantity when there is no GRN (`accounts/service.py:292-296`). It doesn't check the PO status (`:308`) or the cumulative amount already invoiced.
- **Reproduce:** raise a PO through the RFQ screen and approve it as all three roles. Then record a vendor invoice of any amount against it. `matching_status` is "matched".
- **Impact:** the approval signs a blank cheque, and Finance can pay an unapproved amount.
- **Fix:**
  1. Require the unit price and tax on PO lines (the draft endpoint and the schema), and block `submit_po_draft` while `total_value` is null.
  2. In `accounts/service.py`, match against `SUM(GRN accepted qty × PO unit price)`, reject when the PO isn't approved or no GRN exists, and cap the cumulative invoiced amount at the PO value.
- **Effort:** M.

### S-05 · High · Finance: no segregation of duties (P1-FIN, P0 router report)
- **Where:** the following need only `require_app_access("accounts")`, with no role or maker-checker rule:
  - posting vendor invoices (`vendor_invoices.py:130`);
  - recording payments (`payments.py:49`);
  - reversing journal entries (`journal_entries.py:106`);
  - posting and collecting AR (`ar_transactions.py:86,105`);
  - completing a bank reconciliation (`bank_reconciliations.py:137`);
  - deleting GL, bank and vendor masters.

  Only period close and variance approval check `is_finance_manager` (`period_close.py:20-22`, `vendor_invoices.py:24-26`).
- **Reproduce:** a single accounts user creates a vendor, records an invoice, posts it and pays it.
- **Impact:** a single user can commit and conceal payment fraud.
- **Fix:**
  1. Add a `require_finance_role(...)` dependency. Posting, payment and reversal require `is_finance_manager` or a new `is_accountant` flag.
  2. Enforce maker ≠ checker by comparing `created_by_id != user.id` on post and pay.
  3. Audit master deletes.
- **Effort:** M.

### S-06 · High · Permission Matrix enforced only in the frontend (F0-6, X1-5)
- **Where:**
  - `require_tab_access` (`core/permissions.py:36-48`, uncommitted) is used on 4 ERP **list** routes only: `erp/routes/projects.py:50,232` and `service_requests.py:228,308`.
  - Detail, child, attachment and report routes aren't covered, and neither is any other module.
  - Pages never check `tab_access`. `filterTabsByAccess` only hides nav tabs (`FE lib/tabAccess.ts:11-22`).
  - `data_access_scopes` is never read (`main/models/user.py:100`).
  - `can_view_tab` fails open: removing a module's last grant makes the module unrestricted (`permission_registry.py:106-117`).
- **Reproduce:** grant a user the `quality` app but only the `ncr` tab. `GET /api/v1/quality/capa` still returns every CAPA, and `/dashboard/quality/capa` still opens by URL.
- **Impact:** admins believe they have restricted access when they haven't.
- **Fix:**
  1. Add `Depends(require_tab_access(module, subtab))` at router level in each module's route files, mapping each router to its registry subtab.
  2. Add the same check to page guards (a `useRequireTab(module, subtab)` hook).
  3. Make "no grants" mean "no restriction" only when the module was never configured. Store an explicit `matrix_enabled` per module.
  4. Either implement `data_access_scopes` as a query filter or remove it from the UI.
  5. Until the backend enforces it, label the matrix in the UI as navigation-only.
- **Effort:** L.

### S-07 · High · CSRF on bodiless state-changing POSTs
- **Where:**
  - Production needs `SameSite=None; Secure` cookies for Teams (`core/config.py:55-58`; `auth.py:91-111`).
  - The session is authenticated by cookie first (`auth.py:129-148`).
  - The OWASP middleware has no `Origin`/`Referer` check (`owasp.py`, no match for "origin"). CORS doesn't block simple form POSTs.
  - Several sensitive POSTs need no JSON body (FastAPI 0.115 uses the default when the body is empty):
    - `/p2p/requests/{id}/approve` and `/approve-po` (`p2p_requests.py:512-515,564-567`);
    - `/users/sync-azure` (`users.py:462-466`);
    - `/erp/service-requests/{id}/restore` (`service_requests.py:479-484`);
    - PR close.
- **Reproduce** (inferred): a page on any site submits `<form method="POST" action="https://erp.premnathrailtools.cloud/api/v1/p2p/requests/123/approve">` while a Director is logged in. The browser attaches the `SameSite=None` session cookie, and the PR is approved.
- **Impact:** approvals and admin actions can be triggered from outside.
- **Fix:**
  1. In `OWASPMiddleware`, reject unsafe methods (POST, PUT, PATCH, DELETE) whose `Origin` (or `Referer` when `Origin` is absent) isn't in `settings.allowed_origins_list`.
  2. Also require a custom header such as `X-Requested-With`, which the frontend already sends (it is in the CORS allow-list), on cookie-authenticated unsafe requests.
  3. Give every action endpoint a required body so form posts fail with a 422.
- **Effort:** M.

### S-08 · High · Cross-request material photo delete (P1-ERP-47)
- **Where:** `DELETE /erp/service-requests/{sr_id}/materials/{mat_id}/attachments/{attachment_id}` (`service_requests.py:880-896`):
  - it loads the attachment by `mat_id` only;
  - it never checks that the material belongs to `sr_id`;
  - it runs the permission check only `if sr` exists.
- **Reproduce:** call it with a non-existent `sr_id` (for example 999999) and any `mat_id`/`attachment_id`. The photo and its SharePoint file are deleted.
- **Impact:** any ERP user can destroy evidence photos on any service request.
- **Fix:**
  - Load the material with `ServiceMaterial.id == mat_id, ServiceMaterial.service_request_id == sr_id, is_deleted == False` and return 404 otherwise.
  - Load the SR with `is_deleted == False` and return 404 if it is missing, **never skip the check**.
  - Write an audit row.
  - Review the sibling routes at `:639-664` and `:767-824` for the same pattern.
- **Effort:** S.

### S-09 · High · Store: self-approved adjustments, unrestricted manual stock, uncapped returns (P1-STO-22/34/38)
- **Where:**
  - The adjustment `approved_by_id` is any existing user, including the creator (`stock_adjustments.py:73-74`), and it posts immediately (`:95-121`).
  - Manual stock entry accepts any movement type, quantity and date with a free-text reference (`stock.py:25,91-125`).
  - A return with no `source_issue_id` has no quantity cap (`material_returns.py:97,152-158`).
  - All of this needs only the `store` app, and none of it is audited.
- **Reproduce:** as any store user, create an adjustment with yourself as approver, or post a manual `receipt` of 1,000 units.
- **Impact:** stock can be inflated or written off to hide theft, with no trail.
- **Fix:**
  1. Split adjustments into draft → approve. Approval requires a new `is_store_manager` flag and `approved_by_id != created_by_id`, and posts only on approval.
  2. Restrict `POST /store/stock` to admins, or remove it.
  3. Require `source_issue_id` for good-condition returns, or require manager approval.
  4. Write audit rows for every Store route.
- **Effort:** M.

### S-10 · High · Leavers keep access (P2-USR-15/16)
- **Where:**
  - No Azure sync runs on a schedule (`main.py:332-350`).
  - Refresh checks only the local `is_active` (`auth.py:459-498`), so a user disabled in Azure keeps refreshing for 7-day windows indefinitely.
  - Sync sets `is_active=True` for everyone Azure lists, **undoing admin deactivations** (`users.py:503`).
  - Deactivation doesn't revoke `user_sessions` (`users.py:440`), so reactivating a user revives every old session.
- **Reproduce:** disable a user in Azure AD. They keep using the portal until an admin clicks Sync.
- **Impact:** former staff keep access to purchasing, finance and CRM data.
- **Fix:**
  1. Add an APScheduler job that runs the sync nightly.
  2. In sync, never flip a user to active when they were deactivated locally (store `deactivated_by_admin`).
  3. On deactivate, `UPDATE user_sessions SET revoked_at=now() WHERE user_id=…`.
  4. Optionally re-validate against Graph on refresh, at most once per day per user.
- **Effort:** M.

### S-11 · High · Logout fails after token expiry (P2-USR-19)
- **Where:**
  - `POST /auth/logout` depends on `get_current_user` (`auth.py:501-502`), so it returns 401 once the 15-minute access token has expired.
  - The frontend skips refresh for this call and swallows the error (`FE lib/api.ts:54,80-86`; `store/authStore.ts:69-71`).
  - The refresh session isn't revoked and the cookies aren't cleared. The next visit to `/login` refreshes silently.
- **Reproduce:** log in, stay idle for 16 minutes, click Logout, then open `/login`. You are signed straight back in.
- **Impact:** a shared shop-floor or office PC stays signed in as the previous user.
- **Fix:**
  - Make `/auth/logout` work without an access token. Revoke by the `refresh_token` cookie hash, clear all cookies (passing the same `samesite`/`secure`/`path` values used when setting them), and always return 200.
  - Remove `/api/v1/auth/logout` from the OWASP public-path list only if it is kept authenticated.
- **Effort:** S.

### S-12 · High · No audit trail and hard deletes in Quality, Organization and Store (P3-STOR-43/47/51)
- **Where:**
  - A grep for `AuditLog(`/`_write_audit(` finds **0** hits in `modules/quality`, `modules/organization`, `modules/store` and `modules/rnd`.
  - Quality has 11 `db.delete` calls (NCR `ncr.py:142`, CAPA `capa.py:125`, complaints `complaints.py:131`, …).
  - Organization has 10 (`department.py:182`, `branch.py:136`, `cost_center.py:94`, …).
- **Reproduce:** delete an NCR. No record of it, or of who deleted it, remains.
- **Impact:** repudiation. Quality evidence (ISO 9001 / ISO 22163) and changes to approval authority (department heads) can't be reconstructed.
- **Fix:**
  1. Add a shared `write_audit(db, entity_type, entity_id, action, user, field=None, old=None, new=None)` helper in `core/`, called from every mutating route in these four modules.
  2. Convert Quality and Organization deletes to soft delete (`SoftDeleteMixin`, plus a `deleted_by_id` column).
  3. Block deleting records that are referenced, with a message that names what references them.
- **Effort:** M.

---

## 3. Medium and Low findings: detail

| ID | Reproduce | Impact | Concrete fix | Effort |
|---|---|---|---|---|
| S-13 | Production runs uvicorn on `127.0.0.1:8000` behind the Next.js rewrite (`docker-entrypoint.sh:8`; `next.config` `/api/:path*` → `127.0.0.1:8000`), so the backend's peer IP is always `127.0.0.1`. If `TRUSTED_PROXIES` doesn't include `127.0.0.1`, every user shares one bucket (auth limit 5/min, `owasp.py:47-52`). A few failed logins then ban the whole company for 600 s. If `TRUSTED_LOCAL_DEV=true` (it is in the local `.env`), all limits and bans are off (`owasp.py:206-212`). The production values aren't in the repo (inferred). | Login denial of service for everyone, or no brute-force protection at all | Set `TRUSTED_PROXIES=127.0.0.1` in production so the client IP comes from `X-Forwarded-For` set by Traefik/Coolify. Make the Next.js proxy forward the original XFF. Add a startup assertion that refuses to boot with `environment=production` and `TRUSTED_LOCAL_DEV=true`. | S |
| S-14 | While logged in as any user without the `crm` app, `GET /crm/documents/{n}/content` for `n` = 1…N returns every document with `shared_via_tor=true` (`documents.py:161`). | Technical offers and customer drawings leak across departments | Grant access only when the caller is a TOR recipient: store recipient user ids on the TOR share and check `user.id in recipients`. Otherwise require `crm`. | S |
| S-15 | Any `projects` user sends `PATCH /projects/{id}/approvals/{aid}` `{"status":"approved"}`, or `DELETE /projects/{id}`. | Project approvals and budgets are meaningless | In `approvals.py`, require `user.id == approval.approver_id` and `!= requested_by_id`, and add a `decided_by_id` column. Restrict project delete and budget edit to `project_manager_id`/`sponsor_id`/admin. | M |
| S-16 | A victim is sent to `/auth/callback?code=<attacker code>&state=<attacker state>`, because the state is valid server-wide and not tied to the victim's browser (`auth.py:174-192`). The victim is then logged in as the attacker (login CSRF). `/login?token=…` stores any token in localStorage (`login/page.tsx:36-39`). | Session fixation; token theft through XSS | Store `state` and a PKCE `code_verifier` in a short-lived signed httponly cookie and verify both on callback. Delete the `?token=` path. Move state, Teams codes and the replay cache to the DB or Redis (this also fixes multi-worker login). | M |
| S-17 | Azure renames `a.b@` to `a.c@`, or a mailbox is reassigned to a new employee. The login matches by email (`auth.py:217,372`), so the new person inherits the old account's apps, flags and grants. | Privilege inheritance, split identities | Match on `azure_id` (Graph `id`) first and fall back to `lower(email)` only when `azure_id` is null. Keep the email in sync from Graph. | S |
| S-18 | Make someone a Global Admin in Azure, then run Sync: they become portal admin and stay admin after the Azure role is removed (`users.py:504-506`). | Uncontrolled admin sprawl | Store `role_source` (`azure`/`manual`) and demote users whose admin role came from Azure when Azure no longer lists them. Add a role editor with a confirmation dialog, and audit it. | S |
| S-19 | Change a user's apps or flags in `users/[id]`. No audit row is written (`users.py:368-459`), and the matrix change stores `old_value=None, new_value=None` (`:219-225`). | Access changes can't be investigated | Write one audit row per changed field with old and new JSON values. Audit sync (a summary with counts and user ids), login and logout. | S |
| S-20 | Upload `tool.exe` with `Content-Type: image/png`. The allowlist passes because of the `image/` prefix (`sharepoint.py:150-155`), and the magic check returns `True` for unknown extensions (`:117-119`). | The portal can be used to plant malware for colleagues to download | Require **both** an allowed extension **and** a matching content type (AND, not OR). Reject extensions outside `ALLOWED_EXTENSIONS`. Keep the magic check. | S |
| S-21 | Set a service request's reporter name to `<a href=https://evil>Click to pay</a>` and close the request. The client email contains a live link sent from the company mailbox (`email.py:136,149`). The PO number title is also unescaped (`:354,387,435,483`), and the PO number can be typed in by hand. | Phishing from a trusted sender | Wrap every interpolated value in `escape()`, the same helper `_sr_email_table_row` uses (`:106`). Consider a Jinja2 template with `autoescape=True` for all mail bodies. | S |
| S-22 | Deploy without setting `SECURE_COOKIES`, `DOMAIN_EMAIL` or `environment=production`: cookies go over HTTP, guest accounts can log in, and the placeholder `SECRET_KEY="..."` is accepted (`config.py:53,58,61,92-101`). | Session theft; weak signing key | Invert the defaults: secure cookies on, require `DOMAIN_EMAIL`, and refuse to start with a weak `SECRET_KEY` unless `environment=development` is set explicitly. | S |
| S-23 | Open `https://<host>/docs` without logging in. | Full API map for attackers | Construct `FastAPI(docs_url=None, redoc_url=None, openapi_url=None)` unless `settings.environment == "development"`. Remove the three paths from `PUBLIC_PATHS`. | S |
| S-24 | Restore a dump in which user ids changed. Tokens issued before the restore (valid for up to 15 minutes) resolve by id to other users (`auth.py:157-158`). | Wrong-user sessions after an operations event | In `get_current_user`, also require `payload["email"].lower() == user.email.lower()`. Add "revoke all `user_sessions`" to the restore runbook. | S |
| S-25 | The requester cancels at `po_approved` (`p2p_requests.py:639-641`), or the PR is rejected after the PO is raised. The PO stays `issued` (`rfq.py:782`) and remains invoiceable (`accounts/service.py:308`). | Payments against cancelled purchases | Block cancelling after `po_raised` unless the Purchase Head approves. Cascade cancellation to the PO. Refuse invoices on cancelled POs. | S |
| S-26 | Double-click "Complete Inspection" on a GRN: stock is posted twice (`goods_receipts.py:332-333,370`). Two approvers acting at once can leave a PR stuck (`p2p_requests.py:519,571`). | Inflated stock; stuck approvals | Load the GRN and the PR with `with_for_update()` in `inspect`, `approve` and `approve-po` (`_get_pr_or_404(db, id, for_update=True)` already exists). Re-check the status after locking. | S |
| S-27 | Any ERP user downloads any service-request attachment (`service_requests.py:587,615,836,860`), or deletes a private project document they can't see (`projects.py:464-477`). | Confidential client documents exposed or destroyed | Apply `_can_view_attachment` (`projects.py:295`) before delete. Add an `is_private` flag and a check for SR attachments, or document that SR attachments are intentionally visible to all ERP users. | S |
| S-28 | The R&D email is sent from `actor_email` (`email.py:525-528`), which needs a Graph **application** `Mail.Send` permission covering every mailbox (inferred; not verified in Azure). | Tenant-wide send-as: one bug means spoofing anyone | Send from one service mailbox, and restrict the app registration with an Exchange Application Access Policy to that mailbox. | M |
| S-29 | Send `X-Forwarded-For: 1.2.3.4`: the audit row records `1.2.3.4` (`audit_context.py:46-49`). | Forged forensics | Reuse `owasp._client_ip()` (`owasp.py:163-172`) in `AuditContextMiddleware`. | S |
| S-30 | `Authorization: Bearer x` gets past the OWASP 401 pre-check (`owasp.py:275-292`). Today, the route dependencies still enforce auth. | False sense of a second layer; a future route without `get_current_user` would be public | Either decode the JWT in the middleware or rename and document it as a noise filter. Add a test asserting every non-public route has an auth dependency. | S |
| S-31 | A user with no `rnd` app calls `POST /rnd/history/save` and `GET /list` (`history.py:153,188`). | Minor: the data is scoped to the caller | Add `dependencies=[Depends(require_app_access("rnd"))]` to the history router. | S |
| S-32 | Any user calls `GET /users/directory` (`users.py:123-135`), or `GET /presence/erp_project/{id}` (`presence.py:42`). | Staff enumeration for phishing; exposure of who is viewing a record | Return only `id` and `name` to non-admins, and emails only where a picker needs them. Gate presence on the same permission as the resource. | S |
| S-33 | Send bad input to R&D load-distribution: the response is a 500 with the Python exception text (`load_distribution/api.py:29`). An Azure failure returns the AADSTS text (`users.py:474`), and a SharePoint failure returns the Graph body (`sharepoint.py:250`). | Internal details and tenant info disclosed | Catch `ValueError` and return a 400 with a friendly message. Log the rest server-side and return a reference id through the global handler. Summarise Azure and Graph errors in plain language. | S |
| S-34 | POST a 9 GB multipart body (`owasp.py:62`), or upload 2 GB files repeatedly (`sharepoint.py:28`). | Disk, memory and SharePoint quota exhaustion | Lower `MAX_BODY_BYTES` to about 250 MB, set a per-type file limit (for example 50 MB for documents and 500 MB for video), and add per-user daily upload quotas. | S |
| S-35 | Use a document-share JWT as the `session_token` cookie: `int(None)` raises and returns a 500 (`auth.py:157-158`). | Error noise, and a token-confusion class of bug | Add `"typ":"access"` and `"typ":"doc_share"` claims and check them on decode. Use a separate key for share tokens. | S |
| S-36 | Delete an SR, then `POST /erp/service-requests/{id}/materials` still works (`service_requests.py:687`). | Data changes in the recycle bin | Add `ServiceRequest.is_deleted == False` to the loaders at the listed lines. | S |
| S-37 | Log out inside Teams. `delete_cookie` is called without `samesite`/`secure` (`auth.py:514-516`), so under `SameSite=None; Secure` the browser may not clear the original cookie. | Session persists in Teams | Pass the same attributes used in `_set_auth_cookies` (`auth.py:91-111`). | S |
| S-38 | Any CRM user calls `POST /crm/inquiries/{id}/technical-offer-request` for someone else's inquiry (`inquiries.py:281-291`). | Unwanted R&D emails sent in a colleague's name | Require `_can_modify(inquiry, user)` or the owner role. | S |
| S-39 | The Spline report prints debug output to stdout (`spline/api.py:27-39`). OAuth state and Teams codes are kept in process memory (`auth.py:35-50`), so logins fail with `--workers > 1` or after a restart mid-login. | Log noise; a scale-out blocker | Remove the prints. Move the state to the DB or Redis (same fix as S-16). | S |

---

## 4. OWASP Top 10 (2021) coverage

| OWASP | Findings | Status |
|---|---|---|
| A01 Broken Access Control | S-02, S-03, S-06, S-07, S-08, S-14, S-27, S-30, S-31, S-32, S-36 | **Weakest area.** Module gates work, but tab, record and ownership gates are mostly missing. |
| A02 Cryptographic Failures | S-22 (cookies over HTTP by default), S-35 | HS256 with a 32+ character key is enforced only in production. |
| A03 Injection | S-01 (LaTeX), S-21 (HTML email) | No SQL or OS command injection found. |
| A04 Insecure Design | S-04, S-05, S-09, S-12, S-15, S-24, S-25, S-26, S-28 | The ERP business-logic controls (SoD, maker-checker, value matching) are missing. |
| A05 Security Misconfiguration | S-13, S-22, S-23, S-33, S-34, S-39 | Mostly fail-open defaults. |
| A06 Vulnerable Components | not assessed (no dependency scan run in read-only mode) | Run `pip-audit` and `npm audit` in CI. |
| A07 Identification and Auth Failures | S-10, S-11, S-16, S-17, S-18, S-37 | Joiner/mover/leaver handling is the gap. Token handling itself is good. |
| A08 Software and Data Integrity | S-20 | Upload type bypass. |
| A09 Logging and Monitoring Failures | S-12, S-19, S-29 | The audit trail is absent in 4 modules and spoofable. |
| A10 SSRF | none found | Outbound calls go only to fixed Graph and Microsoft endpoints. The OWASP middleware blocks metadata hosts (`owasp.py:221`). |

---

## 5. Top 10 fixes, in order

| # | Fix | Closes | Where to change | Effort |
|---|---|---|---|---|
| 1 | Escape the Spline report inputs, harden `PdfService` (`-no-shell-escape`, `openin_any=p`, no `lualatex` fallback), then **rotate `SECRET_KEY`, the Azure client secret and the DB password** | S-01 | `rnd/tools/spline/api.py:25-37`; `services/pdf_service.py:61-72` | S |
| 2 | Remove `status`/approver fields from the PR and PO PATCH schemas; forbid self-approval; require all three heads (each with the matching flag) on the backend; one slot per approve call | S-02, S-03 | `p2p/schemas/p2p_request.py:87-110`; `schemas/purchase_order.py`; `p2p_requests.py:183-194,286-296,477-505`; `purchase_orders.py:127-160` | S |
| 3 | Add an Origin/Referer check for unsafe methods in `OWASPMiddleware`, and require a custom header on cookie-authenticated requests | S-07 | `middleware/owasp.py` (next to the A01 pre-check, `:274`) | S |
| 4 | Make logout work without an access token; revoke sessions on deactivate; stop sync from re-activating users; schedule a nightly Azure sync | S-10, S-11, S-37 | `main/routes/auth.py:501-520`; `users.py:440,503`; `main.py:332-350` | M |
| 5 | Require PO prices and block submit without a value; fix the three-way match (GRN-based quantity, approved-PO check, cumulative cap) | S-04, S-25 | `rfq.py:614-643,762-796`; `accounts/service.py:288-310` | M |
| 6 | Fix the material-photo IDOR and the missing `is_deleted` filters in the ERP SR routes | S-08, S-36, S-27 | `erp/routes/service_requests.py:639-1062`; `projects.py:464-477` | S |
| 7 | Add finance maker-checker rules and role gates for post, pay and reverse | S-05 | `accounts/routes/{vendor_invoices,payments,journal_entries,ar_transactions,bank_reconciliations}.py` | M |
| 8 | Store controls: adjustment approval workflow with approver ≠ creator, restrict manual stock entry, cap returns, add row locks on GRN inspect and reservations | S-09, S-26 | `store/routes/stock_adjustments.py`, `stock.py`, `material_returns.py`, `stock_reservations.py`; `p2p/routes/goods_receipts.py:332` | M |
| 9 | Add a shared audit helper; audit every mutation in Quality, Organization, Store and user admin; convert Quality and Organization deletes to soft delete | S-12, S-19, S-29 | new `core/audit.py`; `modules/{quality,organization,store}/routes/*`; `main/routes/users.py` | M |
| 10 | Enforce the Permission Matrix on the backend (router-level `require_tab_access`) and in page guards; fix the fail-open rule; hide `data_access_scopes` until it is implemented | S-06 | `core/permissions.py`; every `modules/*/routes/*.py`; FE `hooks/useAuth.ts` | L |

Quick configuration changes to make alongside these, with no code change needed:
- Set `TRUSTED_PROXIES=127.0.0.1`, `SECURE_COOKIES=true`, `DOMAIN_EMAIL=@premnathrail.com` and `environment=production`.
- Make sure `TRUSTED_LOCAL_DEV` is **not** set in production (S-13, S-22).
- Disable `/docs` in production (S-23).
