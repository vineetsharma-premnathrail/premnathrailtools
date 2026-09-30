# Phase 1 — Inputs and Views

This phase reviews every screen, module by module. For each screen it covers:
- **Access**: who can view and who can act, as the code enforces it on the frontend and the backend.
- **Inputs**: each field, comparing frontend validation with backend validation.
- **Views**: lists, filters, pagination, badges, exports and prints, plus loading and empty states.
- **Findings**: each tagged with the persona that raised it.

It is a read-only review of the working tree on 2026-09-29, and it includes the uncommitted Permission Matrix work.

Conventions:
- FE = `frontend/src/`, BE = `backend/app/`. `file:line` refs are relative to those roots.
- "(inferred)" means read from the code, not executed.
- Personas: **[BA]** ERP Business Analyst · **[ARCH]** Software Architect · **[SEC]** Security Expert · **[USER]** End User.
- Finding IDs: `P1-<MODULE>-<n>`. Module codes are ORG, ERP, CRM, P2P, STO (Store), QA, PM, RND and FIN. Quality also has repeated-pattern IDs `PAT-A`…`PAT-I`.

| Module | Screens reviewed | Findings |
|---|---|---|
| Organization, Users admin, app shell | 21 | 79 |
| Service Module / ERP | 11 | 68 |
| CRM | 18 | 68 |
| Procurement / P2P + GRN | 13 | 34 |
| Store & Inventory (excluding GRN) | 17 | 44 |
| Quality | 36 pages in 12 groups | 42 + 9 patterns |
| Project Management | 24 (6 pages + 18 workspace tabs) | 50 |
| R&D Tools | 10 | 42 |
| Finance & Accounting | 21 sections on 6 routes | 41 |
| **Total** | **~170 screens/sections** | **~470** |

---

## 1. Cross-cutting results

### 1.1 Project UI standards compliance

| Standard | Result | Evidence |
|---|---|---|
| No `window.alert/confirm/prompt` (use ConfirmDialog/PromptDialog/MessageDialog) | **1 violation app-wide** | `app/dashboard/organization/plants/page.tsx:66` (`window.confirm` on branch delete). Grep of all FE `.ts/.tsx` found nothing else. |
| Destructive actions must be confirmed | **About 15 deletes and removes have no confirmation at all** | CRM: document delete (`components/crm/InquiryDetailPanel.tsx:1172`, `TenderDetailPanel.tsx:440`), product, category and payment-term delete (`crm/products/page.tsx:162`, `product-categories/page.tsx:127`, `payment-terms/page.tsx:133`). ERP: document, attachment, photo and material deletes (P1-ERP-17, P1-ERP-44). Store: bin remove (`store/locations/page.tsx:291`). Organization: department member remove (`organization/department/page.tsx:440`). GRN: "Complete Inspection", which can't be undone (`store/grn/[id]/page.tsx:231`). ERP: SR status → closed, which emails the client (P1-ERP-36). |
| Back button = `secondaryBtnStyle` pill "← Back", top-right of the header row | **6 non-standard and several missing** | ERP: 4 inline "‹ Back" buttons (`erp/projects/new/page.tsx:25-30`, `projects/[id]/edit/page.tsx:40-45`, `service-requests/new/page.tsx:25-30`, `service-requests/[id]/edit/page.tsx:46-51`). CRM: 2 in the wrong row (`InquiryDetailPanel.tsx:199-201`, `TenderDetailPanel.tsx:170-172`). Missing on: `organization/info/edit`, CRM products/categories/payment-terms/bulk-import/technical-offer, R&D braking/qmax (breadcrumb text only), and most error states (ERP detail/edit, `plants/[id]`, `users/[id]`). Wrong target: `users/[id]/page.tsx:117`; `p2p/new/page.tsx:171` (`router.back()`); `p2p/[id]/page.tsx:277` (always `/dashboard/p2p`). |
| Module sub-nav above the page header | **Compliant on all normal renders** | Exceptions: loading and error states drop the nav (`p2p/[id]/page.tsx:206-208`, `p2p/rfq/[id]/page.tsx:180-182`, `rfq/new/page.tsx:90`, the ERP detail/edit error states, `users/[id]`). `/dashboard/users*` has no sub-nav. Finance pages have no header block. |
| Real error message (reason + how to fix) | **Widespread violations** | 27 loads use `.catch(() => setError('Failed to load …'))` and discard the server reason. By area: Store 8, R&D 7, Organization 5, ERP 2, CRM 2, Users 1, P2P 1, plus `components/erp/ServiceRequestForm.tsx:126`. About 20 more catch blocks read only `err.response.data.detail`, so on a 422 they show just "Validation error": the BE puts field errors in `errors[]` (`middleware/error_handler.py:69-79`), and only `lib/validation.ts:49-71` reads that. Silent swallows: Projects 11 `.catch(() => {})`, R&D 7 history auto-saves, Finance about 15 loads shown as empty states, and the Department member actions. Screens that stay on "Loading…" after an error: ERP Materials tab, CRM dashboard, CRM timelines, 5 Store detail pages, and Quality detail pages, which render blank (PAT-A). |

### 1.2 Systemic defects seen in several modules

| # | Persona | Pattern | Where | Impact |
|---|---|---|---|---|
| X1-1 | [BA] | **Edit can't clear a field.** Forms strip empty values before PATCH, and the BE uses `exclude_unset`, so clearing a field keeps the old value while the UI reports success. | ERP `ProjectForm.tsx:244-246` (P1-ERP-24); CRM `OrganizationForm.tsx:273-275`, `InquiryForm.tsx:322-324`, `TenderForm.tsx:221-223`, `ActivityForm.tsx:192-194` (P1-CRM-11); Store item edit `store/items/[id]/page.tsx:88-100` (P1-STO-7); Quality PAT-B (`inspection-plans/[id]:89-90`, `ncr/[id]:106`) | Stale data you can't remove (warranty, emails, links). Users believe they changed it. |
| X1-2 | [BA] | **Hard list caps and no paging.** The FE never pages, so totals and pickers are silently truncated. | `GET /users` limit 100, filtered after the limit (`modules/main/routes/users.py:111-118`; FE `lib/api.ts:120-122`) (P1-ORG-41); CRM lists capped at 200 (`crm/routes/organizations.py:54-55`, `inquiries.py:76`, `tenders.py:82`, `activities.py:112`) (P1-CRM-6); ERP Reports on 50 SRs (`erp/reports/page.tsx:57` vs `service_requests.py:225`) (P1-ERP-60); Store ledger 500 (`store/routes/stock.py:87`); Audit log module filter applied after the SQL limit (`organization/routes/audit_log.py:69-71`) | User #101 can't be managed. Organizations past #200 can't be chosen on an inquiry. ERP reports are wrong. |
| X1-3 | [BA] | **Create-then-attach isn't atomic.** The parent record is created, then child and file calls follow. A failure shows "Cannot save", but the parent already exists, so a retry hits a 409 or creates a duplicate. | ERP project/SR create (`erp/projects/new/page.tsx:37-42`, `service-requests/new/page.tsx:36-40`) (P1-ERP-09/31); CRM org + contacts (`OrganizationForm.tsx:276-297`) (P1-CRM-10); P2P PR attachments swallowed (`p2p/new/page.tsx:146`); Quality documents uploaded to SharePoint before validation | Duplicate records and orphaned SharePoint files. |
| X1-4 | [BA]/[SEC] | **Status is a free dropdown with no state machine.** Any status can be set from any status, and the backend accepts it. | ERP SR (`service-requests/[id]/page.tsx:205,270-279`; `service_requests.py:363-384`); Quality NCR/CAPA (`ncr/[id]:175-183`, `ncr.py:119-132`); CRM stage via an unvalidated PATCH (`InquiryDetailPanel.tsx:298` → `inquiries.py:185-195`); P2P purchase PATCH sets any PR status (`p2p_requests.py:477-505`) and any PO status (`purchase_orders.py:127-160`) | Approvals can be skipped and records closed with open children. Reports can't be trusted. |
| X1-5 | [SEC] | **Permission Matrix only hides nav tabs.** No page checks `tab_access`. The BE enforces it only on 4 ERP list routes. | `lib/tabAccess.ts:11-22`; `core/permissions.py:36-48`; ERP `projects.py:50,232`, `service_requests.py:228,308` | Hidden screens still open by URL, and every API still answers. See Phase 4. |
| X1-6 | [USER] | **Records linked by typing raw DB ids or free text.** | Quality NCR/Inspection/Customer Org/Vendor ID fields (`quality/rejections/new:91-98`, `capa/new:104-107`, `complaints/new:98-99`, `supplier-quality/new:89-90`) (P1-QA-29); CRM owners as free text (P1-CRM-26); PO vendor as free text (P1-P2P-11) | Users can't know the ids, and links break or stay empty. |
| X1-7 | [USER] | **Screens that can't be reached from the UI.** | `/crm/products`, `/crm/product-categories`, `/crm/payment-terms` (no link anywhere); `/crm/followups` (dashboard cards and notification bell only); 6 ERP endpoints with no UI; RFQ quotation entry and comparison (BE only, `rfq.py:355-561`); tender award/LOI fields (`crm/schemas/tender.py:33-40`); project status (P1-PM-12) | Features that were built but can't be used. |
| X1-8 | [BA] | **No exports or prints** where the business expects them. | No PR/PO print, no issue slip or transfer challan (P1-STO-32), no inspection report or NCR/CAPA PDF, no ERP export, no audit-log export. Only CRM quotation PDF, MoM export and R&D reports exist. | Paper processes (gate pass, PO to vendor, QA sign-off) happen outside the system. |

### 1.3 Blocking bugs (the screen can't complete its main job)

| ID | Persona | Screen | Defect | Evidence |
|---|---|---|---|---|
| P1-QA-37 | [USER]/[BA] | Quality → Supplier Scorecard → New | Every save fails with "Vendor Name: Field required". The form has no Vendor Name field. | FE `quality/supplier-quality/new/page.tsx:45-54`; BE `quality/schemas/supplier_quality.py:7` |
| P1-ERP-55 | [BA] | ERP → Service Request → Edit | Editing fails with a 422 whenever Expected Attend or Expected Close is empty, because the form sends `''` for a `date \| None` field. | `components/erp/ServiceRequestForm.tsx:173-180`; `erp/schemas/service_request.py:114-115` |
| P1-FIN-1 / P1-ORG-54 | [USER] | Finance → Ledger / AR-AP | A non-admin Finance Manager never sees Close Period, Approve Variance or Post, because `/auth/me` omits `is_finance_manager`. | `main/schemas/auth.py:10-30`; `finance/ledger/page.tsx:42`; `finance/ar-ap/page.tsx:49,361` |
| P1-FIN-5 | [BA] | Finance → AR invoice with a discount | The invoice can never be posted: its journal doesn't balance. It then blocks month close, and there is no cancel. | `accounts/service.py:486,520-529,611-615` |
| P1-FIN-7 | [USER] | Finance → Banking | Banks created in the UI have no GL account field, so payments are impossible. The error message points to a field that doesn't exist. | `finance/masters/page.tsx:211,281-296`; `accounts/service.py:419-420` |
| P1-P2P-30 | [USER] | Store → GRN | GRN pages are gated on the `store` app, but every GRN API needs `purchase`, so store-only users get a 403. | `goods_receipts.py:167-326` |
| P1-P2P-1 | [USER] | P2P approvals | A head picked without the `p2p` app gets the notification, but is redirected off every P2P page and gets a 403 on approve. | `users.py:131`; `useAuth.ts:66-75`; `p2p_requests.py:108` |
| P1-STO-41 | [BA] | Store → Reservations → Fulfil | The dialog says "issue first". Issues can only draw on unreserved stock, so the issue fails until the reservation is released. | `store/reservations/page.tsx:139`; `store/services/stock_ledger.py:19,70-76` |
| P1-PM-12 | [USER] | Projects | Project status can't be changed anywhere, so the dashboard's Active, On Hold and Completed counts are always 0. | `projects/routes/project.py:125`; `DetailsScopeTab.tsx:116-180` |

### 1.4 Security issues surfaced during screen review (handed to Phase 4)

These were found while reviewing screens. They are listed here so the evidence travels with the screen. Severity is assigned in Phase 4.

| ID | Finding | Evidence (checked in code) |
|---|---|---|
| P1-ERP-47 | Material photo delete never checks that the material belongs to the SR in the URL, and the permission check is skipped entirely when that SR id doesn't exist (`if sr and …`). Any ERP user can delete any material photo. | `erp/routes/service_requests.py:880-896` |
| P1-RND-3 | Spline PDF report passes unescaped user input into a LaTeX template compiled by pdflatex (possible file read, e.g. `\input{…}`). Hydraulic and braking escape; spline doesn't. It also has debug `print()`s. | `rnd/tools/spline/api.py:25-37` vs `hydraulic/api.py:130`, `braking/service.py:310` |
| P1-CRM-67 | Any logged-in user (no `crm` app needed) can read any document flagged `shared_via_tor` by guessing sequential ids. | `crm/routes/documents.py:136-162` |
| P1-STO-38 | Stock adjustment "approver" is any existing user, including the creator. It posts to stock immediately, with no pending step. | `store/routes/stock_adjustments.py:73-74,95-121` |
| P1-STO-34 | A material return with no source issue has no quantity cap. "Good" lines create on-hand stock from nothing. | `store/routes/material_returns.py:97,152-158` |
| P1-STO-22 | Manual stock entry lets any store user post receipts, issues and damage with no document or approver. | `store/routes/stock.py:25,91-125` |
| P1-P2P-5 | A requester can name themselves as all three heads and self-approve. | `p2p_requests.py:189-194,286-296` |
| P1-P2P-15 | The purchase team can PATCH a PR to `po_approved` (skipping Director/MD), force a PO to `fulfilled`, and a requester can cancel after PO approval. | `p2p_requests.py:477-505,641`; `purchase_orders.py:127-160` |
| P1-PM-1/41 | Any `projects` user can delete any project, edit budgets, and decide any approval, including one they requested themselves. No `decided_by` is stored. | `projects/routes/project.py:190-200`; `budget.py:88-136`; `approvals.py:109-140` |
| P1-ORG-47/53 | Azure sync runs with no confirmation. It deactivates missing users and promotes but never demotes admins. Module-access, flag and activation changes aren't audited. | `users/page.tsx:76-89`; `users.py:368-459,505-506,544-546` |
| P1-FIN-12/13 | Three-way match uses PO qty when there is no GRN, has no cumulative-invoiced cap, and compares a pre-GST invoice with a tax-inclusive PO. | `accounts/service.py:292-296` |

### 1.5 Workflow gaps noticed here (handed to Phase 2)

- **P1-P2P-27:** `submit_po_draft`, the path the UI actually uses to send a PO for approval, notifies no one (`p2p/routes/rfq.py:763-798`). Only the unused `create_po` notifies approvers (`p2p_requests.py:1006-1021`).
- **P1-P2P-3:** "Attach PO" sends only the vendor name and PO number, and PO lines are copied without prices, so approvers approve a PO with no value (`rfq/[id]/page.tsx:154-157`; `rfq.py:614-620`).
- **P1-ERP-38:** "Raise PR" from an SR has no modal, hard-codes priority, and skips the Project and Plant Head approvals (`service-requests/[id]/page.tsx:470`; `service_requests.py:909-941`).
- **P1-STO-31/37:** Issues, returns, transfers and adjustments post on create and can never be cancelled or reversed. Transfers have no in-transit state.
- **P1-QA-5/8/10/14/15/18:** Inspection status on create is discarded. Plans don't seed checklist items. Inspections aren't linked to GRN or PO.
- **P1-CRM-31:** Three conflicting stage lists (FE vs BE), and the validated stage endpoint is never called.
- **P1-ERP-64:** Recycle Bin promises a 10-day auto-purge, but no purge job exists.

---

## 2. Screen-by-screen detail

Sections 2.1–2.7 below are the full per-screen reviews. Each lists Access, an Inputs table, Views and Findings.


---

## 2.1 Organization module, User admin, App shell

Scope read: FE `frontend/src` = **FE**, BE `backend/app` = **BE**. All paths below are relative to those roots. Line numbers are from the current working tree (includes the uncommitted changes to `tabAccess.ts`, `OrganizationNav.tsx`, `audit-logs/page.tsx`, `users/[id]/page.tsx`, `auth.py`, `users.py`, `permissions.py`, `permission_registry.py`).

### Cross-cutting facts (apply to every screen below)

- **FE admin gate**: every Organization screen and both `/dashboard/users*` screens use `useRequireAdmin()` (FE `hooks/useAuth.ts:50-62`). It checks `user.role === 'admin'` and sends everyone else to `/dashboard`. While it redirects, the page renders `null`, so a non-admin sees a blank screen for a moment.
- **BE admin gate**: `require_admin` (BE `modules/main/routes/users.py:89-93`) returns 403 "Admin privileges required". Every organization route (`company.py`, `branch.py`, `department.py`, `cost_center.py`, `audit_log.py`) and every `/users/*` route except `/users/directory` depends on it.
- **Sub-nav**: `OrganizationNav` (FE `components/organization/OrganizationNav.tsx:40-82`) filters tabs with `filterTabsByAccess` (FE `lib/tabAccess.ts:11-22`). The Audit Logs tab has no `subtabKey` (`OrganizationNav.tsx:15`), so it always shows. Organization is admin-only, and admins get `tab_access={}` (BE `core/permission_registry.py:120-123`), so in practice the filter never removes an Organization tab.
- **422 error shape**: the BE turns every Pydantic 422 into `{"detail": "Validation error", "errors": [...]}` (BE `middleware/error_handler.py:69-79`). `extractErrorMessages` (FE `lib/validation.ts:49-71`) reads `errors` first. But about 20 catch blocks in scope use the ad-hoc pattern `err.response.data.detail || 'Failed to …'`. On a 422 those show only **"Validation error"** and never name the field. Sites: `organization/info/edit/page.tsx:141,597,726,852,974`; `organization/plants/page.tsx:71`; `components/organization/PlantForm.tsx:91`; `organization/plants/[id]/edit/page.tsx:112,373,492,623,637,747,761,864`; `organization/department/page.tsx:135`; `users/[id]/page.tsx:244,510,685`.
- **Dialogs**: `ConfirmDialog`, `PromptDialog` and `MessageDialog` live in `components/erp/`, not `components/shared/` (`components/shared` only has `FileUploadField.tsx` and `ui.tsx`; `components/admin/` is empty). `ConfirmDialog` has no busy/disabled prop (`components/erp/ConfirmDialog.tsx:5-22`), so a double click on Confirm can fire an async delete twice (inferred).
- **Browser dialogs in scope: 1**, at `organization/plants/page.tsx:66` (`window.confirm`). App-wide grep finds the same single hit.
- **Back buttons in scope: 4**, all standard (`secondaryBtnStyle`, "← Back", top-right of the header row): `PlantForm.tsx:105`, `plants/[id]/page.tsx:108`, `plants/[id]/edit/page.tsx:131`, `users/[id]/page.tsx:117`. **Non-standard styling: 0.** **Missing where a sub-page needs one: 1** (`organization/info/edit`, breadcrumb only). There are also **2** error-state dead ends with no Back (`plants/[id]/page.tsx:77-88`, `users/[id]/page.tsx:93-99`), and **1** Back that goes to the wrong place (`users/[id]/page.tsx:117` → `/dashboard/users` instead of `/dashboard/organization/roles`).
- **Nav above header**: every `organization/**` page renders `<OrganizationNav />` before its header, which is compliant. `/dashboard/users` and `/dashboard/users/[id]` render **no sub-nav at all**.
- **Generic load errors (no real reason)**: `organization/info/page.tsx:72`, `info/edit/page.tsx:95,112`, `plants/[id]/page.tsx:67`, `plants/[id]/edit/page.tsx:96`, `organization/users/page.tsx:36`, `audit-logs/page.tsx:68`, `users/page.tsx:38-40`, `users/[id]/page.tsx:83`.
- **Silently swallowed errors**: `department/page.tsx:91,149-151,160-162,171-173,188-190`; `PlantForm.tsx:59-60`; `users/page.tsx:54`; `info/edit/page.tsx:75-84` (no `.catch`); `plants/[id]/edit/page.tsx:69-80` (no `.catch`); `components/erp/NotificationBell.tsx:38-46,49,72-83,85-89,91-97`; `components/FeedbackBell.tsx:17,38-49,51-57`; `store/authStore.ts:69-71` (logout, `console.error` only).

---

#### /dashboard/organization — redirect stub  (FE `app/dashboard/organization/page.tsx`)
- **Access**: no gate of its own. It does `router.replace('/dashboard/organization/department')` (`:9-11`), and the target page's `useRequireAdmin` then applies.
- **Inputs**: none.
- **Views**: renders `null`.
- **Findings**
  - **P1-ORG-1 [USER]** The landing page is Department, the 3rd tab, not Info, the 1st tab (`page.tsx:10` vs `OrganizationNav.tsx:10-12`). The Home card says "Branch and department masters, plus user roles" (`dashboard/page.tsx:211`), which matches neither the tab order nor the landing tab.

#### /dashboard/organization/info — Company master, read-only view  (FE `app/dashboard/organization/info/page.tsx`)
- **Access**: FE `useRequireAdmin` (`:39`). BE `GET /organization/company` plus `/addresses`, `/contacts`, `/financial-years`, `/documents`, all `require_admin` (BE `modules/organization/routes/company.py:36-44,88-91,137-140,186-189,237-240`).
- **Inputs**: none (read-only). Buttons: "Edit" / "Set Up Company Info" (`:92-105`).
- **Views**: 9 in-page tabs (`:24`). Basic, Legal and Tax are label/value grids. Address, Contacts, FY and Documents are card lists with PRIMARY / INACTIVE / FY-status badges (`:190-191,257-258,281-285`). Loading state yes (`:121-122`). Empty states yes: not-set-up (`:123-127`) and per list (`:182-183,248-249,273-274,332-333`). No export or print. Dates show as raw ISO strings (`:170,220,222,240,287`).
- **Findings**
  - **P1-ORG-2 [USER]** "Default Plant" and "Default Warehouse" show `#<id>`, not a name (`:363-364`), even though the edit page has the lists. "Plant" wording conflicts with "Branch" everywhere else.
  - **P1-ORG-3 [USER]** "Company Logo" shows the URL as text; there is no image preview (`:299`).
  - **P1-ORG-4 [SEC]** The document "Open" link goes straight to SharePoint `webUrl` (`:349`). It bypasses the admin-gated proxy `GET /organization/company/documents/{id}/content` (BE `company.py:293-307`). Access then depends on SharePoint ACLs rather than the portal's Confidentiality field. The same pattern appears at `info/edit/page.tsx:1057`, `plants/[id]/page.tsx:301` and `users/[id]/page.tsx:748`.
  - **P1-ORG-5 [USER]** If any of the 4 child list calls fails, the whole page shows the generic "Failed to load company info." (`:67-73`). The real status or detail is thrown away.

#### /dashboard/organization/info/edit — Company master create/edit  (FE `app/dashboard/organization/info/edit/page.tsx`)
- **Access**: FE `useRequireAdmin` (`:60`). BE `POST /organization/company` (create once, `company.py:47-67`), `PATCH` (`:70-81`), child CRUD (`:94-230`) and doc upload/delete (`:243-323`), all `require_admin`. Loading also calls `organizationApi.listBranches` (BE `branch.py:66-72`) and `storeApi.listLocations` (store module, inferred app-gated; admin passes).
- **Inputs — Basic / Legal / Tax / Branding / Defaults (single PATCH/POST body `CompanyUpdate`, BE `schemas/company.py:5-69`)**

| field | control | required? | FE validation | BE validation | mismatch / notes |
|---|---|---|---|---|---|
| Company Name | text `:213` | * | non-blank `:123-126` | create only: non-blank `company.py:59-60`; PATCH none (`schemas/company.py:7`) | PATCH can null or blank it via API |
| Legal Name | text `:217` | labelled * | none | none (`:8`) | **label says required, nothing enforces it** |
| Short Name | text `:223` | no | none | none | |
| Code | text, forced upper `:227` | * | non-blank `:127-130` | create only `company.py:61-62`; PATCH none | |
| Company Type / Industry / Business Nature | text `:233,237,243` | no | none | none | free text, no list |
| Website | text `:247` | no | none | none | `isValidWebsite` exists (`lib/validation.ts:28`) but is not used |
| Description | textarea `:252` | no | none | none | |
| Date of Incorporation | date `:257` | no | none | `date` | |
| Country | text `:261` | labelled * | none | none | **label/enforcement mismatch** |
| Default Currency | text `:267` | labelled * | none | none | **mismatch**; free text, no ISO list |
| Default Language | text `:271` | no | none | none | |
| Time Zone | text `:275` | labelled * | none | none | **mismatch**; free text, not an IANA list |
| Legal Entity Type / Legal Status | text `:291,295` | no | none | none | |
| CIN / PAN / TAN | text `:301,305,309` | no | none | none | no format check |
| GSTIN | text `:315` | no | none | none | `isValidGST` exists but is not used |
| Udyam / IEC / MSME / PF / ESIC nos. | text `:319-339` | no | none | none | |
| Other Registration Type/Number/Date/Issuing Authority/Expiry | text/date `:347-367` | no | none | none | expiry < registration date not checked |
| Legal Representative | text `:371` | no | none | none | |
| Authorized / Paid-up Capital | number `:377,381` | no | none | float | negative allowed; paid-up > authorized allowed |
| GST Registration Type, Default Tax Region, Tax Deductibility, Tax Registration Status | text `:394-408` | no | none | none | free text where a fixed list is expected |
| Tax Effective Date | date `:413` | no | none | date | |
| TDS / TCS Applicable | checkbox `:417,421` | no | — | bool | |
| Company Logo URL | text `:442` | no | none | none | no upload; not URL-validated |
| Primary/Secondary/Accent Color | color + text `:448-463` | no | none | none | free-text hex; invalid text makes the color swatch fall back silently |
| Header / Footer / Watermark / Email Signature | textarea/text `:469-481` | no | none | none | |
| Default Tax | text `:496` | no | none | none | |
| Default Plant | select (branches) `:500` | no | — | int, no existence check | |
| Default Warehouse | select (store locations) `:509` | no | — | int, no existence check | not filtered by the chosen Default Plant |
| Default Cost Center / Profit Center | text `:516,521` | no | none | none | **free text**, although Cost Centers are a master (`cost_center.py`) |

- **Inputs — Address sub-form** (`:632-657`; BE `CompanyAddressCreate/Update` `schemas/company.py:140-165`; routes `company.py:94-130`)

| field | control | req | FE | BE | notes |
|---|---|---|---|---|---|
| Address Type | text `:633` | no | — | none | |
| Landmark | text `:634` | no | — | none | |
| Address Line 1 | text `:636` | * | non-blank `:588` | `str` required `:142` | OK |
| Address Line 2, Country, State/UT, City, District | text `:639-644` | no | — | none | the same fields are labelled * on the Branch address form (see P1-ORG-30) |
| PIN Code | text `:645` | no | none | none | `isValidPinCode` exists but is not used |
| Primary / Active | checkbox `:648,651` | — | — | bool; primary is exclusive `company.py:97-98,113-114` | |

- **Inputs — Contact sub-form** (`:761-782`; BE `CompanyContactCreate` `schemas/company.py:188-199`)

| field | control | req | FE | BE | notes |
|---|---|---|---|---|---|
| Contact Type | text `:762` | no | — | none | |
| Contact Person | text `:763` | * | non-blank `:717` | `str` required | OK |
| Designation, Department | text `:764-765` | no | — | none | |
| Mobile, Phone | text `:766-767` | no | none | none | `PhoneField` exists app-wide but is not used |
| Email, Alternate Email | text (not `type=email`) `:768-769` | no | none | none | `isValidEmail` is not used |
| Communication Preference | text `:770` | no | — | none | free text |
| Primary / Active | checkbox `:773,776` | — | — | primary exclusive | |

- **Inputs — Financial Year sub-form** (`:887-911`; BE `CompanyFinancialYearCreate` `schemas/company.py:236-244`; routes `company.py:192-230`)

| field | control | req | FE | BE | notes |
|---|---|---|---|---|---|
| FY Name | text `:888` | * | `:842` | required | no uniqueness check |
| Start / End Date | date `:889-890` | * | presence `:842` | required; end ≥ start `company.py:195-196,211-214` | FE doesn't pre-check order; overlapping FYs allowed |
| Fiscal Year Code | text `:891` | no | — | none | |
| Status | select open/locked/closed `:893` | — | — | `str`, **no enum** | API accepts any string |
| Lock Date | date `:899` | no | — | none | not checked to fall inside the FY |
| Period Closing Rule | text `:901` | no | — | none | free text |
| Reset number series | checkbox `:905` | — | — | bool | effect not explained (inferred: nothing reads it) |

- **Inputs — Document upload** (`:1006-1037`; BE Form params `company.py:243-258`)

| field | control | req | FE | BE | notes |
|---|---|---|---|---|---|
| Document File | `FileUploadField` `:1009` | * | presence `:964` | `File(...)`; **no size/type limit** | |
| Document Type | select `:1013` | * | — | `Form(...)` | |
| Document Name | text `:1017` | * | `:965` | `Form(...)` | |
| Document No., Issue/Expiry Date, Issuing Authority, Confidentiality, Tags, Description, Remarks | `:1018-1032` | no | none | optional | expiry < issue not checked; no expiry reminder |

- **Views**: 9 tabs (`:44`). List tabs have card lists with Edit/Delete (`:676-679` etc.) and a `ConfirmDialog` for deletes (`:624-630,753-759,879-885,998-1004`). Loading state `:166-167`. Empty lists `:659-660,784-785,913-914,1039-1040`. The first-time banner `:198-205` blocks list tabs until the first save (`:281-283,429-435,486-488`).
- **Findings**
  - **P1-ORG-6 [BA]** Four fields are labelled required (*) that neither FE (`:123-130`) nor BE (`company.py:59-62`, `schemas/company.py:8,17-20`) enforces: Legal Name `:216`, Country `:260`, Default Currency `:266`, Time Zone `:274`.
  - **P1-ORG-7 [USER]** Save/Cancel are hidden on the Address, Contacts, FY and Documents tabs (`:526`). Those tabs have no Back button either; the only exits are the breadcrumb `:154` and the Org nav. Standard Back button missing on this sub-page.
  - **P1-ORG-8 [USER]** Unsaved Basic/Legal/Tax edits are lost without warning when you leave via breadcrumb or nav (no dirty check anywhere in the file).
  - **P1-ORG-9 [USER]** The copy "Legal documents … are managed from the Company Documents tab on the Info page" (`:384`, and similarly `:425`) is wrong. Documents are managed on **this** page's Documents tab; the Info page tab is read-only (`info/page.tsx:329-356`).
  - **P1-ORG-10 [USER]** Six save/upload handlers use `detail || 'Failed to …'` (`:141,597,726,852,974`). On 422 they show only "Validation error".
  - **P1-ORG-11 [USER]** A failure loading branches or warehouses is reported as "Failed to load company info." (`:95`). The wrong object is blamed and the real reason is dropped.
  - **P1-ORG-12 [ARCH]** `loadLists()` has no `.catch` (`:75-84`). If the refresh after a successful save fails, the list silently goes stale and the promise rejection is unhandled.
  - **P1-ORG-13 [BA]** Default Cost Center and Default Profit Center are free text (`:516,521`), while a Cost Center master exists (BE `cost_center.py`). Nothing links the two.
  - **P1-ORG-14 [ARCH]** Deleting a document swallows a SharePoint delete failure (`company.py:316-320`, `except HTTPException: pass`). The DB row goes and the file is orphaned. Same at `branch.py:332-336` and `users.py:358-362`.
  - **P1-ORG-15 [SEC]** Document upload has no size or MIME limit (BE `company.py:243-290`; same `branch.py:259-309`, `users.py:277-325`).

#### /dashboard/organization/plants — Branch list  (FE `app/dashboard/organization/plants/page.tsx`)
- **Access**: FE `useRequireAdmin` `:16`. BE `GET/PATCH/DELETE /organization/branches[/{id}]` `require_admin` (`branch.py:66-137`).
- **Inputs**: search box `:104-110` (client-side, 6 fields `:40-52`). Row actions: View / Edit / Activate-Deactivate / Delete (`:161-176`).
- **Views**: table of 10 columns (`:128`) with a status badge (`:153-155`). Client search. **No pagination, no sort, no export.** Loading `:136`. Empty "No branches found." `:137-139`. Dates use `toLocaleDateString()` with no locale (`:157-158`), while other pages use `en-IN`.
- **Findings**
  - **P1-ORG-16 [USER]** **`window.confirm`** for Delete (`:66`). It must use `ConfirmDialog`.
  - **P1-ORG-17 [USER]** Activate/Deactivate fires straight away with no confirmation (`:54-62`). The toggle only flips active↔inactive, so a branch in `closed` or `under_maintenance` jumps straight to `active` (`:57`).
  - **P1-ORG-18 [USER][ARCH]** The BE delete guard only counts `User.branch_id` and departments (`branch.py:127-135`). Addresses, documents, user assignments, cost centers, store locations, projects and `companies.default_plant_id` all hold FKs to `branches` (e.g. `models/branch_user_assignment.py:18`, `store/models/location.py:12`, `projects/models/project.py:30`, `company.py:72`). Those hit the generic FK translation "This record is still linked to other records…" (`core/db_errors.py` FK branch, ~`:162-172`), which never says *which* records.
  - **P1-ORG-19 [USER]** BE messages say "Plant" (`branch.py:62,83,112,135`) while the UI says "Branch".
  - **P1-ORG-20 [USER]** The Delete error uses `detail ||` (`:71-72`).
  - **P1-ORG-21 [BA]** Auto-provisioning re-creates a deleted branch, or creates a duplicate of a renamed one, on the next login or Azure sync. `_get_or_create_branch` matches `Branch.name` against the user's Azure `office_location` (BE `organization/services/provisioning.py:35-44`, called from `auth.py:257` and `users.py:541`). Renaming or deleting a branch in this UI is therefore not durable.

#### /dashboard/organization/plants/new — Add Branch  (FE `.../plants/new/page.tsx` + `components/organization/PlantForm.tsx`)
- **Access**: FE `useRequireAdmin` `new/page.tsx:14`. BE `POST /organization/branches` `require_admin` (`branch.py:75-88`). The form also calls `GET /organization/company` (admin) and `GET /users/directory` (any user, `users.py:123-138`).
- **Inputs** (`PlantForm.tsx`; BE `BranchCreate` `schemas/branch.py:7-27`)

| field | control | req | FE validation | BE validation | mismatch / notes |
|---|---|---|---|---|---|
| Branch Name | text `:116` | * | non-blank `:70-73` | `str` required | no uniqueness (provisioning matches by name, P1-ORG-21) |
| Branch Code | text `:120` | * | non-blank `:74-77` | required; unique, case-sensitive `branch.py:82-83` | **not upper-cased here but upper-cased on Edit** (`edit/page.tsx:167`), so "unit 3" and "UNIT 3" can coexist |
| Company | select (1 option) `:126-129` | * | `:78-81` | `int \| None` optional `:10` | **FE-required, BE-optional**; empty list if company not set up |
| Branch Type | text `:133` | * | `:82-85` | optional `:11` | FE-required on create only; free text |
| Branch Status | select 5 values `:139-143` | * | — | `_validate_status` `branch.py:30-32` | OK |
| Branch Head / Branch Manager | select (directory) `:147-150,156-159` | no | — | int, no existence check | plain `<select>` over every user, not the project's SearchableSelect (inferred convention) |
| Established Date / Active From | date `:163,173` | no | — | date | Active From < Established not checked |
| Industry / Function | text `:169` | no | — | none | |
| Description / Remarks | textarea `:178,182` | no | — | none | |

- **Views**: tab strip with only "Basic" enabled (`new/page.tsx:22-41`); inline error block (`PlantForm.tsx:186-190`); after save, redirects to the edit page (`new/page.tsx:61`).
- **Findings**
  - **P1-ORG-22 [USER]** The disabled tab buttons have `onClick` (`new/page.tsx:29-30`), but disabled buttons never fire clicks. The explanation "Save this branch first…" (`:43-47`) therefore **can never appear**, and the tabs look broken.
  - **P1-ORG-23 [USER]** If company info isn't set up, `getCompanyInfo` fails and the error is swallowed (`PlantForm.tsx:59`). The Company dropdown is empty and submit shows "Company is required" (`:78-81`), with no hint that Organization > Info must be set up first. This is a dead end.
  - **P1-ORG-24 [USER]** The `detail ||` catch (`PlantForm.tsx:90-92`) shows "Validation error" on 422.
  - **P1-ORG-25 [ARCH]** `PlantForm` adds its own `padding: '20px 24px'` (`:99`), as do the detail and edit pages (`[id]/page.tsx:96`, `edit/page.tsx:123`). Other Org pages have none, so branch pages sit indented differently from their siblings.

#### /dashboard/organization/plants/[id] — Branch detail  (FE `.../plants/[id]/page.tsx`)
- **Access**: FE `useRequireAdmin` `:38`. BE 7 calls: `GET branches/{id}`, `/addresses`, `/user-assignments`, `/documents` (`branch.py:91-98,144-147,199-203,253-256`), `GET /organization/departments?branch_id` (`department.py:36-46`), `GET /organization/cost-centers?branch_id` (`cost_center.py:33-43`), and store `listLocations` (inferred store gate).
- **Inputs**: none.
- **Views**: header with status badge, Back and Edit (`:97-117`); 8 read-only tabs (`:24`) with empty states (`:156-157,196-197,221-222,239-240,262-263,285-286`); DEFAULT badges on warehouses and cost centers (`:247,270`).
- **Findings**
  - **P1-ORG-26 [USER]** There is no loading state; the page renders `null` until all 7 calls resolve (`:90`).
  - **P1-ORG-27 [USER]** If any one of the 7 calls fails, the page is replaced by the generic "Failed to load branch." (`:67`) with **no Back button** (`:77-88`). That is a dead end apart from the Org nav.

#### /dashboard/organization/plants/[id]/edit — Branch edit with child masters  (FE `.../plants/[id]/edit/page.tsx`)
- **Access**: FE `useRequireAdmin` `:51`. BE `PATCH branches/{id}` (`branch.py:101-117`); addresses, assignments and documents CRUD (`branch.py:150-339`); cost centers CRUD (`cost_center.py:46-96`); store locations CRUD (store module, inferred).
- **Inputs — Basic + Operational (PATCH `BranchUpdate` `schemas/branch.py:30-50`)**

| field | control | req | FE | BE | notes |
|---|---|---|---|---|---|
| Branch Name | text `:163` | * | `:104` | optional on PATCH | |
| Branch Code | text, upper `:167` | * | `:105` | unique, case-sensitive `branch.py:110-112` | differs from create (P1-ORG-22 table) |
| Branch Type | text `:173` | labelled * | **none** | optional | **label mismatch** (create enforces it, edit doesn't) |
| Branch Status | select `:177` | * | — | enum `branch.py:108` | |
| Head / Manager | select `:185,192` | no | — | int | |
| Established Date, Industry, Description, Active From, Remarks | `:201-218` | no | — | — | |
| Working Calendar | text `:231` | labelled * | **none** | optional | **label mismatch**; free text |
| Working Days / Hours / Time Zone / Currency / Default Profit Center | text `:235-271` | no | — | none | free text |
| Default Warehouse | select (this branch's warehouses) `:251` | no | — | int, no ownership check | |
| Default Cost Center | select (this branch's CCs) `:258` | no | — | int, no ownership check | |

- **Inputs — Address** (`:402-417`; BE `BranchAddressCreate` `schemas/branch.py:86-97`): Address Type*, Country*, State/UT*, City* and PIN Code* are **labelled required** (`:403,407-409,411`), but FE only checks Line 1 (`:364`) and BE makes all of them optional. PIN code is not validated.
- **Inputs — Branch User** (`:520-557`; BE `BranchUserAssignmentCreate` `schemas/branch.py:134-146`)

| field | control | req | FE | BE | notes |
|---|---|---|---|---|---|
| User | select `:522` | * | `:476` | `user_id` required | the same user can be added to the same branch twice (no check `branch.py:206-217`) |
| Employee ID | text `:528` | no | — | none | |
| Department | select (branch depts) `:529` | no | — | int, not checked to belong to the branch | |
| Designation / Role | text `:535-536` | no | — | none | "Role" is free text and easily confused with portal Role (admin/user) |
| Access Level | select view/edit/admin `:537-544` | no | — | `str`, no enum | **stored but never enforced anywhere** (grep: only schemas/models use `access_level`) |
| Effective From/To | date `:545-546` | no | — | date | To < From not checked (FE or BE) |
| Status | select `:547` | — | — | `str` no enum | |
| Primary Branch | checkbox `:554` | — | — | exclusive per user `branch.py:209-212` | |

- **Inputs — Warehouse** (`:654-675`; store module): Name*/Code* checked (`:613`). **Warehouse Type is labelled * but not checked** (`:656` vs `:613`). Status has 3 values (`:668-672`) while branch status has 5.
- **Inputs — Cost Center** (`:778-808`; BE `CostCenterCreate` `schemas/cost_center.py:5-19`): Code*/Name* checked (`:730`); code is unique and case-sensitive (`cost_center.py:52-53`). Parent CC excludes only itself (`:795`), not its descendants, and BE has no cycle check (`cost_center.py:61-78`), so an A→B→A loop is possible. Effective To < From is not checked. `annual_budget`, `budget_period` and `gl_account_id` exist in the BE schema but not in the UI (fields only reachable via API; inferred used by Finance masters).
- **Inputs — Document** (`:891-912`): same as the company doc form, plus Version and a free-text Status (`:902-903`).
- **Views**: 8 tabs (`:47`); Save/Cancel only on Basic and Operational (`:305`); Back present (`:131`); loading `:136-137`; each sub-editor has a card list with Edit/Delete plus a `ConfirmDialog`.
- **Findings**
  - **P1-ORG-28 [BA]** Four labels promise "required" but nothing enforces them: Branch Type `:172`, Working Calendar `:230`, Warehouse Type `:656`, and the five address fields `:403-411`.
  - **P1-ORG-29 [USER]** Eight catch blocks use `detail ||` (`:112,373,492,623,637,747,761,864`).
  - **P1-ORG-30 [BA]** The Branch address form marks Country/State/City/PIN required, but the Company address form (`info/edit/page.tsx:641-645`) marks the same fields optional. The rules are inconsistent.
  - **P1-ORG-31 [SEC][BA]** "Access Level: View/Edit/Admin" (`:537-544`) and Permission Matrix "Data Access Scope" (`users/[id]/page.tsx:538-545`) are stored but **never enforced**. BE `core/permission_registry.py:6` says so, and grep finds no reader. Admins will believe they have restricted access when they haven't.
  - **P1-ORG-32 [ARCH]** A branch user assignment does not update `User.branch_id`. Meanwhile `department.py:119-120` and provisioning (`provisioning.py:108-110`) write `User.branch_id` directly. The result is two independent sources of truth for "user's branch". `users/[id]` shows `User.branch_name` (`:189`) next to an assignments list that can disagree with it.
  - **P1-ORG-33 [ARCH]** `loadLists` has no `.catch` (`:69-80`). A refresh failure after a save is silent.

#### /dashboard/organization/department — Department master + members  (FE `app/dashboard/organization/department/page.tsx`)
- **Access**: FE `useRequireAdmin` `:20`. BE `GET/POST /organization/departments`, `GET/POST/DELETE …/{id}/members` (`department.py:36-144`), all `require_admin`. `GET /users/directory` is any user.
- **Inputs — Add Department modal** (`:236-333`; BE `DepartmentCreate` `schemas/department.py:18-23`)

| field | control | req | FE | BE | notes |
|---|---|---|---|---|---|
| Name | text `:249` | * | non-blank `:118-121` | `str` required, no min_length; stored **untrimmed** from raw payload (`department.py:59`, only the code uses `.strip()` `:58`) | the same name in the same branch is allowed (no uniqueness check) |
| Branch | select `:254` | no | — | int, no existence check | |
| Head of Department (multi) | search + chips `:263-301` | no | — | ids not checked for existence | chip "×" is a `<span>` with no keyboard access (`:277`) |

- **Inputs — Add member** (inline search `:451-476`) calls `POST …/members {user_id}` (`department.py:101-124`).
- **Views**: table Name / Code / Branch / Head (`:340`) with a branch filter in the column header (portal dropdown `:346-384`); expandable rows showing the member tree (`:420-478`); client-side filter; no search box, sort, pagination or export. Loading `:393`. Empty `:394-396`.
- **Findings**
  - **P1-ORG-34 [BA]** There is **no edit or delete UI**, although BE has `PATCH` and `DELETE` (`department.py:147-183`). Heads can only be set at creation time; a wrong department cannot be fixed or removed from the portal.
  - **P1-ORG-35 [USER]** Member add, member remove and member-list load **swallow every error** (`:149-151,160-162,171-173,188-190`; directory `:91`). A failed add or remove just "doesn't happen". A failed member load shows "No users linked…", which is a false empty state.
  - **P1-ORG-36 [USER]** "Remove" member runs immediately with no `ConfirmDialog` (`:440`), and it clears the user's department field in the BE (`department.py:143`).
  - **P1-ORG-37 [BA]** Membership changes don't last. `add_department_member` writes `User.department` and `User.branch_id` (`department.py:118-120`). The next Microsoft sign-in overwrites `user.department` from Azure (`auth.py:231`), and Azure sync does too when Azure has a value (`users.py:499`). Provisioning then re-links the branch (`provisioning.py:108-110`).
  - **P1-ORG-38 [USER]** The empty state "No departments yet — sign in or run Azure sync…" (`:395`) also shows when the branch filter simply matches nothing. That is misleading.
  - **P1-ORG-39 [USER]** The "Code" column always equals the name (code = name, `department.py:55-58`), so it adds no information.
  - **P1-ORG-40 [USER]** The create error uses `detail ||` (`:135-136`).

#### /dashboard/organization/users — Users, read-only  (FE `app/dashboard/organization/users/page.tsx`)
- **Access**: FE `useRequireAdmin` `:21`. BE `GET /users` `require_admin` (`users.py:109-120`); `GET /modules` any user (`modules.py:14-25`).
- **Inputs**: search `:70-76` (name/email, client-side).
- **Views**: 8-column table (`:83`); approval-role chips (`:122-133`); status badge (`:136-138`). Loading `:89`. Empty `:90-92`. No pagination, sort or export. Rows are not clickable.
- **Findings**
  - **P1-ORG-41 [SEC][BA]** **Only the first 100 users are ever listed.** BE `list_users` defaults to `limit=100` and filters *after* the limit (`users.py:111-119`), and `usersApi.list()` sends no params (FE `lib/api.ts:120-122`). Once the Azure sync brings in the tenant, users past #100 alphabetically are invisible here and on Role & Permissions. Stats are wrong and search misses them.
  - **P1-ORG-42 [BA]** The Approval Roles column omits **Finance Manager** (`:11-15`), although it can be granted (`users/[id]/page.tsx:415-418`).
  - **P1-ORG-43 [USER]** This view is read-only and rows don't link to the editor, so changing a user means switching tabs and searching again (extra clicks).
  - **P1-ORG-44 [USER]** Load failure shows a generic message (`:36`).

#### /dashboard/organization/roles — Role & Permissions  (FE `app/dashboard/organization/roles/page.tsx` → embeds `app/dashboard/users/page.tsx`)
- **Access**: same as `/dashboard/users` below.
- **Findings**
  - **P1-ORG-45 [USER]** The tab is labelled "Role & Permissions" (`OrganizationNav.tsx:14`), but the embedded page's H1 is "Users & Roles" with no "Organization" eyebrow (`users/page.tsx:97`). It also carries a FeedbackBell in its header (`users/page.tsx:102`) that no other Org tab has.
  - **P1-ORG-46 [USER]** Opening a user from here goes to `/dashboard/users/[id]`, which has no Org nav. Its Back returns to `/dashboard/users` (`users/[id]/page.tsx:117`), not to `/dashboard/organization/roles`, so the Organization context is lost.

#### /dashboard/users — Users & Roles list  (FE `app/dashboard/users/page.tsx`)
- **Access**: FE `useRequireAdmin` `:16`. BE `GET /users` and `POST /users/sync-azure` `require_admin` (`users.py:109-120,462-550`).
- **Inputs**: search `:140-154`, status tabs `:122-136`, "Sync from Azure AD" button `:155-172`, row click / Edit `:224,313-329`.
- **Views**: 4 stat cards (`:114-119`); 9-column table (`:181`); status badge; loading `:205-211`; empty `:212-218`. No sort, pagination, export, or role/module filter. **No sub-nav** on this route.
- **Findings**
  - **P1-ORG-47 [SEC]** "Sync from Azure AD" runs with **no confirmation** (`:76-89`). The sync mass-deactivates every Azure-linked user missing from the Graph result (`users.py:544-546`) and auto-promotes Azure admins to portal `admin` without ever demoting them (`users.py:505-506,516`). A partial Graph response would deactivate real users (inferred risk; paging not verified).
  - **P1-ORG-48 [BA]** The sync response returns **all** users, unfiltered and unlimited (`users.py:549-550`), while `GET /users` returns ≤100 filtered users (`:118-119`). The table changes content after a sync and changes back on reload; shared mailboxes flash into view.
  - **P1-ORG-49 [USER]** Load failure shows the generic "Failed to load users." (`:38-40`). A modules-list failure is swallowed (`:54`), and chips then show raw keys (`:291`).
  - **P1-ORG-50 [SEC]** Role (`admin`/`user`) cannot be changed from the UI anywhere. `updateRole` exists in `lib/api.ts` but is unused, and the BE supports it (`users.py:380-385`). An Azure-promoted admin can't be demoted from the portal.

#### /dashboard/users/[id] — User detail: Details, Assignments, User Permissions (approval flags), Permission Matrix, History, Login History, Activity, Documents  (FE `app/dashboard/users/[id]/page.tsx`)
- **Access**: FE `useRequireAdmin` `:45`. BE (all `require_admin`): `GET /users/{id}` `:154-163`; `/assignments` `:166-185`; `/sessions` `:244-252`; `/activity` `:255-263`; `/documents` `:266-365`; `/permissions/registry` `:141-151`; `/permission-history` `:231-241`; `PATCH /users/{id}` `:368-425`; `PATCH /{id}/permissions` `:188-228`; `/deactivate` and `/activate` `:428-459` (self-deactivate blocked `:435-436`, FE disables it `:175`); branch assignment CRUD (`branch.py:206-246`).
- **Inputs — Assignments** (`:275-313`): same fields as the Branch User form, with Branch* instead of User* (`:276-281`, check `:228`); branch is locked on edit (`:277`); the department list is filtered by branch (`:263`). The same BE gaps apply (duplicates allowed, To<From not checked, Access Level unenforced).
- **Inputs — User Permissions** (`:384-462`; BE `UserUpdate` `schemas/user.py:11-23`, route checks `users.py:387-418`)

| field | control | req | FE | BE | notes |
|---|---|---|---|---|---|
| Module Access | checkboxes from `/modules` `:391-396` | no | disabled for admin | keys ⊆ registry ∪ AVAILABLE_APPS `users.py:387-391` | OK |
| Approval Roles: Purchase Head / Director / MD / Finance Manager | checkboxes `:403-418` | no | — | bool | shown regardless of module access, and the page never explains what each flag unlocks |
| ERP Permissions (8) | checkboxes, shown only if `erp` ticked `:422-439` | no | — | ⊆ `VALID_GRANULAR_PERMISSIONS` `users.py:393-397` | stale `erp_permissions` stay saved when `erp` is unticked (the list is still sent `:375`) |
| Procurement Permissions (7) | checkboxes, shown only if `p2p` ticked `:441-458` | no | — | same set | BE comment: "Nothing reads them yet" (`users.py:59-63`); the UI gives no hint of that |

- **Inputs — Permission Matrix** (`:519-587`; BE `UserPermissionsUpdate` `schemas/user.py:68-70`, route checks `users.py:199-213`): per module a Data Access Scope select (`:538-545`, enum-checked `:208-213`), and per subtab × action a checkbox (`:566-573`, id-checked `:199-207`). Clicking a row label toggles the whole row (`:564`), but that's only hinted by a dotted underline.
- **Views**: 8 tabs (`:42`); header with status badge and Back (`:107-118`); read-only lists for Permission History (`:591-607`), Login History (`:613-632`) and Activity (`:634-653`), each with an empty state. **No loading state** (`:101` returns `null`). Lists are capped at 200/100/200 by BE (`users.py:241,252,263`) with no pagination or "showing N of M".
- **Findings**
  - **P1-ORG-51 [SEC][BA]** The Matrix copy is **false**: "nothing outside this admin screen reads these grants yet" (`:526`). Grants now gate ERP routes via `require_tab_access` (BE `core/permissions.py:36-48`, used in `erp/routes/projects.py:50,232` and `service_requests.py:228,308`) and hide nav tabs via `tab_access` (`auth.py:455` → `lib/tabAccess.ts`).
  - **P1-ORG-52 [SEC][BA]** The matrix has an opt-in cliff. Ticking **any single cell** in a module restricts the user to only those subtabs where `:view` is ticked (BE `permission_registry.py:106-117,120-134`). For example, granting only "Projects → Edit" removes every ERP tab, Projects included, and 403s the ERP list endpoints. The UI warns about none of this.
  - **P1-ORG-53 [SEC]** Changes to module access, ERP/P2P permissions, approval flags, and activate/deactivate are **not audited**. `update_user` and `(de)activate` write no `AuditLog` (`users.py:368-459`); only the matrix does (`:219-225`). "Permission History" therefore shows matrix changes only, which is misleading for a permissions audit trail.
  - **P1-ORG-54 [BA]** A Finance Manager flag set here **never takes effect in the FE**. `/auth/me`'s `CurrentUserResponse` has no `is_finance_manager` (BE `schemas/auth.py:10-30`, `auth.py:436-456`), but Finance pages gate on `user?.is_finance_manager` (FE `finance/ledger/page.tsx:42`, `finance/ar-ap/page.tsx:49`). The BE does honour it (`accounts/routes/period_close.py:21`), so non-admin finance managers get buttons hidden that they are entitled to.
  - **P1-ORG-55 [USER]** Deactivate/Activate User runs with no `ConfirmDialog` (`:156-167,173-179`).
  - **P1-ORG-56 [USER]** Save Permissions and Save Matrix give **no success feedback** (`:375-376,507-508`). They just reload silently, so the admin can't tell the save worked.
  - **P1-ORG-57 [USER]** A single failure among the 10 parallel loads (`:65-76`) replaces the page with a bare red box "Failed to load user." (`:83,93-99`). There is no nav, no Back and no reason. This is a dead end.
  - **P1-ORG-58 [USER]** The Matrix tab renders nothing if the registry fetch returned nothing (`:139` `registry &&`), with no message.
  - **P1-ORG-59 [USER]** Three catch blocks use `detail ||` (`:244,510,685`).
  - **P1-ORG-60 [BA]** `is_department_head`, `is_project_head` and `is_plant_head` are settable via the BE (`users.py:399-406`) and exposed in the directory (`:135`), but there is no UI to set them, and P2P pickers ignore them (`p2p/new/page.tsx:95-98`). They are dead flags.

#### /dashboard/organization/audit-logs — Audit Logs  (FE `app/dashboard/organization/audit-logs/page.tsx`)
- **Access**: FE `useRequireAdmin` `:46`. BE `GET /organization/audit-logs` and `/dashboard` `require_admin` (`audit_log.py:40-77,80-116`).
- **Inputs**: Module select `:135-138` (6 values `:28-30`), Action select `:139-142` (11 hard-coded values `:141`), Search summary `:143`, Search button `:144`. The selects auto-reload (`:72-75`); the text search only runs on submit.
- **Views**: stat cards (`:96-115`), activity-by-module chips (`:118-129`), a card list with IP / UA / session / API-source meta (`:152-175`). Loading `:147-148`. Empty `:149-150`. **No pagination** (fixed BE limit 200 `audit_log.py:49`), **no date or user filter** (the BE supports `date_from`, `date_to` and `performed_by_id`, `:44-47`), **no export**, and `old_value`/`new_value`/`field_name` are never shown (in the schema at `schemas/audit_log.py:12-14`).
- **Findings**
  - **P1-ORG-61 [BA]** The trail shows *that* something changed but never *what*: before/after values and field names are omitted from the card (`:152-175`). There is no export for auditors and no date range.
  - **P1-ORG-62 [ARCH]** The module filter is applied **after** `LIMIT limit*3` in Python (`audit_log.py:69-71`), so filtered results are silently incomplete. The dashboard's `by_module` ignores the stored `module_key` column and infers only from `entity_type` (`:95-99`), so its counts disagree with the filtered list.
  - **P1-ORG-63 [USER]** The Action dropdown lists near-duplicates in raw lowercase ("create"/"created", "update"/"updated", …) (`:141`). The module list lacks store, quality, projects, finance and others (`:28-30`), which fall into "Other".
  - **P1-ORG-64 [USER]** Load failure shows the generic "Failed to load audit logs." (`:68`).

#### /login — Microsoft / Teams sign-in  (FE `app/login/page.tsx`)
- **Access**: public. BE `GET /auth/microsoft-login` (`auth.py:164-183`), `GET /auth/callback` (`:186-285`), `POST /auth/teams-token` (`:288-414`), `POST /auth/teams-exchange` (`:417-430`), `GET /auth/me` (`:433-456`).
- **Inputs**: a single "Sign in with Microsoft" button (`:212-248`). No form fields.
- **Views**: error banner for `?error=unauthorized|inactive` (`:11-14,195-204`), a Teams message (`:206-210`), busy spinner (`:235-236`).
- **Findings**
  - **P1-ORG-65 [USER][SEC]** Failures inside the OAuth callback don't come back to `/login`. An expired or reused state returns 400 JSON (`auth.py:191-192`), and token-exchange or Graph errors return 400/500 JSON (`:200-201,284-285`). The browser is left on a raw JSON page on the API domain; only domain and inactive errors redirect (`:215,261`).
  - **P1-ORG-66 [USER]** When the Teams popup is cancelled or `notifyFailure('missing_code')` fires (`auth/teams-success/page.tsx:34`), the catch at `login/page.tsx:102-103` runs `extractErrorMessages` on an error that has no `response`. It shows **"Couldn't reach the server. Nothing was saved — check your internet connection…"** (`lib/validation.ts:54-58`), which is the wrong reason.
  - **P1-ORG-67 [SEC]** `POST /auth/teams-token` echoes the library error to an unauthenticated caller: `"Invalid Teams token: {last_error}"` (`auth.py:361`).
  - **P1-ORG-68 [ARCH]** Teams SSO creates users without department, designation or office and never calls `sync_user_org_links` (`auth.py:372-381`), unlike the browser callback (`:217-258`).

#### /auth/teams-success — Teams popup hand-off  (FE `app/auth/teams-success/page.tsx`)
- **Access**: public. No BE call; passes `?code` back to the Teams parent (`:27-39`).
- **Views**: a single status message (`:43-47`).
- **Findings**: see P1-ORG-66. Outside Teams the page says "This page must be opened from inside Microsoft Teams." (`:37`), which is fine.

#### /dashboard — Home  (FE `app/dashboard/page.tsx`)
- **Access**: `useAuth` via the layout; any signed-in user.
- **Views**: greeting, and a module-card grid filtered by `user.apps`, plus an admin-only Organization card (`:233-236,261-265`).
- **Findings**
  - **P1-ORG-69 [USER]** There is **no empty state**. A non-admin with no assigned apps sees "YOUR APPLICATIONS" above an empty grid (`:245-265`), with no advice to contact an admin.
  - **P1-ORG-70 [ARCH]** The card list is hard-coded (`:100-205`) instead of coming from the `/modules` registry that drives the assignment checklist. A module added to the registry shows in User Permissions but gets no Home card or Sidebar link (`Sidebar.tsx:158-167`).
  - **P1-ORG-71 [USER]** There is no notification bell on Home, Organization or R&D. `NotificationBell` is mounted only in the CRM, ERP, Finance, P2P, Projects, Quality and Store navs (grep). Admins' "New feedback received" notifications (`feedback.py:39-48`) are invisible while they work in Organization.

#### App shell — `dashboard/layout.tsx` + `components/Sidebar.tsx`
- **Access**: `useAuth()` (`layout.tsx:18`) shows a spinner while loading (`:26-28`) and renders `null` with no user (`:30-32`) until the redirect to `/login` (`hooks/useAuth.ts:30-34`).
- **Views**: sidebar links gated by `user.apps` or admin (`Sidebar.tsx:157-167`); footer with FeedbackButton and UpdatesButton (`:342-343`); user card menu with Sign out (`:451`).
- **Findings**
  - **P1-ORG-72 [SEC]** Logout errors are swallowed (`store/authStore.ts:69-71`, `console.error`). BE `/auth/logout` requires a valid access token (`auth.py:502`), so once the 15-minute token expires, logout 401s (unless the interceptor refreshes first; inferred). The refresh session then may **not be revoked**, while the UI shows signed out.

#### Notification bell + preferences  (FE `components/erp/NotificationBell.tsx`; BE `modules/main/routes/notifications.py`)
- **Access**: any signed-in user. BE `get_current_user`, scoped to `user.id` (`notifications.py:18-84`).
- **Inputs**: On/Off preference toggle (`:169-187`) → `PATCH /notifications/preferences {enabled: bool}` (BE `:14-15,74-84`).
- **Views**: 30 newest (BE `:32`), no "view all"; unread badge capped at 9+ (`:140`); loading `:197-198`; empty `:199-200`; "turned off" notice `:191-195`.
- **Findings**
  - **P1-ORG-73 [USER]** Every action swallows its errors. The preference toggle has `try/finally` with no catch (`:38-46`), and count, list, mark-all and mark-one have no catch or show nothing (`:49,72-83,85-89,91-97`). A failed toggle leaves the button saying the old state with no reason given.
  - **P1-ORG-74 [USER]** The toggle is labelled just "On"/"Off" (`:186`), which is ambiguous between current state and action. It has no confirmation, although it also stops Teams pushes (`:193`).
  - **P1-ORG-75 [USER]** Notifications of type `feedback`, P2P, store and so on have no link target. `ENTITY_LINK` covers only ERP and CRM (`:9-16`), so clicking them is a dead end.
  - **P1-ORG-76 [ARCH]** `PATCH /notifications/{id}/read` returns 200 "Marked as read" even when the id doesn't exist or isn't the user's (`notifications.py:54-59`).

#### Feedback button (all users) + Feedback bell (admin)  (FE `components/FeedbackButton.tsx`, `components/FeedbackBell.tsx`; BE `modules/main/routes/feedback.py`, `schemas/feedback.py`)
- **Access**: submit is any user (`feedback.py:28-51`); list, count and read are `require_admin` (`:54-96`).
- **Inputs**

| field | control | req | FE | BE | notes |
|---|---|---|---|---|---|
| Message | textarea, maxLength 4000 `FeedbackButton.tsx:162-178` | * | non-blank, submit disabled `:47,183` | `Field(min_length=1,max_length=4000)` + strip/blank check (`schemas/feedback.py:7-15`) | aligned; errors via `extractErrorMessages` (`:55`), which is correct |

- **Views**: success message (`:153-156`); admin bell lists 100 entries (BE `feedback.py:71-78`) with loading and empty states (`FeedbackBell.tsx:139-142`).
- **Findings**
  - **P1-ORG-77 [USER]** FeedbackBell swallows its errors (`:17,38-49,51-57`) and is mounted **only** in the Users & Roles header (`users/page.tsx:102`). It has no "mark all read", and entries can't be answered or linked back to the user.

#### "What's New" (UpdatesButton)  (FE `components/UpdatesButton.tsx`)
- **Access**: any user. Static `CHANGELOG`, no BE.
- **Views**: list with an empty state (`:172-173`) and an unseen dot tracked in `localStorage` (`:18-22,46-49`).
- **Findings**
  - **P1-ORG-78 [ARCH]** `localStorage` reads and writes are not wrapped in try/catch (`:20,47`). A private or blocked-storage browser would throw inside an effect or click handler (inferred).

#### Presence (BE only, used by ERP detail pages)  (BE `modules/main/routes/presence.py`)
- **P1-ORG-79 [ARCH]** The store is an in-process dict (`:13`). It is inconsistent across workers or instances, keys are never removed (memory grows with every SR or project viewed), and `resource_type` is an unchecked free string (`:27-29`). Any signed-in user can list who is viewing any resource id (`:42-50`), with no module-access check.

#### /dashboard/organization/cost-centers — not present
- No such FE route exists (the Org nav has no Cost Center tab, `OrganizationNav.tsx:9-16`). Cost centers are managed only inside Branch Edit → "Branch Cost Centers" (`plants/[id]/edit/page.tsx:301`) and by Finance masters (`finance/masters/page.tsx`, per grep). BE `/organization/cost-centers` is admin-only (`cost_center.py:33-96`). As a result, cost centers with `branch_id = null` can't be reached from Organization at all (inferred).

---

### Counts
- Screens / surfaces covered: **21** (15 routes: org landing, info, info/edit, plants, plants/new, plants/[id], plants/[id]/edit, department, org users, roles, audit-logs, /dashboard/users, /dashboard/users/[id], /login, /auth/teams-success, plus Home; and 5 shell components: layout+Sidebar, NotificationBell, FeedbackButton+Bell, UpdatesButton, Presence BE), plus a note that no cost-centers route exists.
- `window.alert/confirm/prompt` or bare `alert(/confirm(/prompt(` in scope: **1** (`organization/plants/page.tsx:66`); app-wide: **1**.
- Back buttons: **4** present, **0** non-standard in style. **1** missing on a sub-page (`info/edit`), **2** error-state dead ends without Back, **1** Back pointing to the wrong parent (`users/[id]:117`).
- Sub-nav placement: compliant on all `organization/**` pages; **absent** on `/dashboard/users` and `/dashboard/users/[id]`.
- `detail || 'Failed…'` 422-blind catch sites: **20**. Generic load-error sites: **10**. Silent/swallowed catch sites: **~20**.


---

## 2.2 Service Module (ERP) screen-by-screen review

Scope: FE `frontend/src/app/dashboard/erp/**`, `frontend/src/components/erp/**`; BE `backend/app/modules/erp/routes/{projects,service_requests}.py`, `backend/app/modules/erp/schemas/**`, `backend/app/modules/erp/reports/`. Includes the uncommitted `require_tab_access` changes (working tree, not HEAD).
Paths below are shortened: **FE** = `frontend/src`, **BE** = `backend/app`. `projects.py` = `BE/modules/erp/routes/projects.py`, `sr.py` = `BE/modules/erp/routes/service_requests.py`, `sch/project.py` / `sch/sr.py` = `BE/modules/erp/schemas/…`.

### Cross-cutting access model (applies to every screen)

- **FE page gate**: `useRequireApp('erp')` (FE/hooks/useAuth.ts:66-78) sends you to `/dashboard` if `erp` isn't in `user.apps`. Create/edit pages use `useRequireErpPermission(perm, fallback)` (useAuth.ts:84-97). **No page checks `user.tab_access`.** Tab filtering only happens in `ErpNav` (FE/components/erp/ErpNav.tsx:38 → FE/lib/tabAccess.ts:11-23), so it only hides nav links. Typing a hidden route's URL still opens it.
- **BE gates**: every ERP endpoint has `require_app_access("erp")` (BE/core/permissions.py:8-19). The uncommitted `require_tab_access` (permissions.py:36-48, registry `can_view_tab` permission_registry.py:106-116) is attached to only **4 list endpoints**:
  - `GET /erp/projects` (projects.py:50)
  - `GET /erp/projects/recycle-bin/list` (projects.py:232)
  - `GET /erp/service-requests` (sr.py:228)
  - `GET /erp/service-requests/recycle-bin` (sr.py:308)

  Detail, create, update, delete, filter-options, audit and attachment endpoints are not tab-gated. There is no `dashboard` or `reports` tab gate on the BE.
- **Action permissions**: `has_erp_permission(user, perm)` (permissions.py:51-57). Admins always pass; other users need the permission string in `user.erp_permissions`.
  - Projects use `project_create`, `project_edit` and `project_delete`. Restoring a project also uses `project_delete`.
  - Service requests use `_can_edit` and `_can_delete` (sr.py:202-215). These pass only for an admin, or for the **SR creator** holding `sr_edit` / `sr_delete`. The FE copies this rule inline (list page:74-75, detail:75-76, edit:30).
- **Edit-lock**: `is_locked`, `locked_by_id` and `lock_reason` exist on the model (BE/modules/erp/models/service_request.py:97-100), but the model's own comment says "nothing sets is_locked=True yet".
  - BE: only `PATCH /{sr_id}` checks it (sr.py:360-361, returns 423 "Service request is locked" with no who or why).
  - FE: only the stepper and the Status/Priority selects honour it (detail:132, 272, 284).
  - `locked_by_id` and `lock_reason` are not in `ServiceRequestResponse` (sch/sr.py:172 has only `is_locked`).
- **Browser dialogs**: 0 uses of `window.alert/confirm/prompt` or bare `alert(`/`confirm(`/`prompt(` in ERP FE (grep over app/dashboard/erp + components/erp). Deletes use `components/erp/ConfirmDialog`, and errors use `MessageDialog` or inline text.
- **Sub-nav placement**: every screen renders `<ErpNav />` as its first child, above the header (compliant). The loading and error early-returns on 4 detail/edit pages render a bare `<p>` with no nav and no Back button. See P1-ERP-30.
- **Stale report artefact**: `BE/modules/erp/reports/` holds only `__pycache__/project_documents_docx.cpython-314.pyc`. There is no `.py` source and no route imports it (grep for `project_documents` finds nothing in BE/FE). `schemas/__pycache__/project_document…pyc` is also orphaned. There is no ERP export endpoint at all.

---

#### /dashboard/erp — Service dashboard (FE/app/dashboard/erp/page.tsx)

- **Access**
  - FE: `useRequireApp('erp')` (page.tsx:43). No `dashboard` tab check.
  - BE: it calls `GET /erp/projects?limit=5000` (tab-gated `projects`, projects.py:50) and `GET /erp/service-requests?limit=1000` (tab-gated `service_requests`, sr.py:228).
  - Result: a user granted only `erp:dashboard:view` in the matrix gets 403 on both calls. The page shows zero stats and "No service requests yet." with no error (page.tsx:51-56 has no `.catch`).
- **Inputs**: none.
- **Views**
  - 4 stat cards (page.tsx:116-121): Total Projects, Total Service Requests, Monthly SRs, Total Active Tickets. "Active" means `status !== 'closed'`, so `cancelled` counts as active (page.tsx:70).
  - "Project Deployment Status" bar chart (page.tsx:124-130) and "Active Tickets Breakdown" donut (page.tsx:132-138), each with an empty state.
  - "Recent Service Tickets" table: 8 rows sorted by `created_at` desc (page.tsx:97-100). Columns at page.tsx:151: SR Number, Serial No., Model, Machine Type, Client, Site, Issue Summary, Priority, Status, Age, Warranty, Actions. Loading and empty rows at 157-158.
  - "Machine Assets" table: the first 8 rows **by serial number**, not by recency (page.tsx:101-104). Columns at 205. Loading and empty rows at 211-212.
  - No filters, search, pagination, export or print. Rows click through to the detail page. The "View" cell is a non-interactive span (page.tsx:184, 236).
- **Findings**
  - P1-ERP-01 [USER] Dashboard load has no error handling (page.tsx:51-56). On 403 (tab matrix), 5xx or network failure the page silently shows zeros and "No service requests yet." (158). That is a false empty state, and nothing explains the reason or the fix.
  - P1-ERP-02 [BA] "Total Service Requests" and "Monthly SRs" are computed client-side from a list capped at `limit: 1000` (page.tsx:51). After 1000 SRs the numbers are wrong with no indication. The BE caps at `le=1000` (sr.py:225).
  - P1-ERP-03 [USER] The "Machine Assets" section is fed by a memo named `recentProjects`, but it is really the first 8 serial numbers alphabetically (page.tsx:101-104). The label implies recency. "Total Active Tickets" also counts `cancelled` (page.tsx:70, 91).
  - P1-ERP-04 [ARCH] The dashboard (and the list pages) download up to 5000 projects and 1000 SRs just to compute counts. `list_projects` loads **all** rows into Python to natural-sort them before slicing (projects.py:68-70). There is no aggregate or count endpoint.

#### /dashboard/erp/projects — Projects Asset Register (FE/app/dashboard/erp/projects/page.tsx)

- **Access**
  - FE: `useRequireApp('erp')` (47). "+ Add New Project" needs `project_create` (48, 142). The per-row "Edit" link needs `project_edit` (49, 265).
  - BE: `GET /erp/projects` (app + tab `projects`, projects.py:49-50). `GET /erp/projects/filter-options` has app access only, no tab gate (projects.py:73-77). Also `GET /erp/service-requests?limit=1000` (tab `service_requests`).
- **Inputs (filters)**

| field | control | req | FE validation | BE validation | notes |
|---|---|---|---|---|---|
| Search Registry | text, debounced 300 ms (99-101) | no | none | `ilike` on serial/model/client_company (projects.py:61-67) | Placeholder says "Serial, model name…" but it also matches client company. |
| Machine Status | select, draft→Apply (186-193) | no | hard-coded 8 options (22-31) | exact match (55-56) | `filter-options.statuses` is fetched but ignored. |
| Application Type | select (196-203) | no | hard-coded 5 options (33-39) | exact match (57-58) | Custom "Other" values (ProjectForm:236-237) can never be filtered. `filter-options.application_types` is ignored. |
| Client Company | select from `filter-options.client_companies` (207-212) | no | none | exact match (59-60) | filter-options failure is swallowed (92 `.catch(() => {})`). |

- **Views**
  - 4 stat cards (171-176). They count the **filtered** set but are labelled "Total …".
  - Table columns (227): Serial No., Model, Machine Type, Application Type, Client, Site, Year of Mfg., Dispatch Date, Commissioning Date, Status, SRs, Warranty, Actions.
  - Pagination is client-side with PAGE_SIZE 20 (20, 128-129, 276-302), over `limit: 5000` from the server (76). Sort is fixed natural serial sort on the BE (69). No sort UI, no export, no print.
  - Loading and empty rows at 235-240. Load errors open a MessageDialog with Reload (161-169), using `extractErrorMessages` (84).
  - Status is plain text (260). `replace('_',' ')` replaces only the first underscore, so "manufacturing under_progress" and "work in_progress" render wrongly.
- **Findings**
  - P1-ERP-05 [BA] Search is live-debounced but the dropdown filters need an "Apply Filters" click (104-109). Mixed behaviour. Also, typing in search reloads with the **applied** filters, not the draft, which is confusing after changing a dropdown without applying.
  - P1-ERP-06 [USER] Status label rendering: `p.status.replace('_', ' ')` (260) mangles multi-underscore statuses. The same bug appears at dashboard page.tsx:180/231, project detail Maintenance tab 275, and SR status in several places.
  - P1-ERP-07 [BA] Custom application types entered via "Other" can't be filtered (hard-coded option list 33-39, while the BE already returns real distinct values at projects.py:82).
  - P1-ERP-08 [ARCH] SR counts per machine ("SRs" column, 123-127, 261) come from the first 1000 SRs only, so they undercount past 1000.

#### /dashboard/erp/projects/new — Add New Project (FE/app/dashboard/erp/projects/new/page.tsx + FE/components/erp/ProjectForm.tsx)

- **Access**
  - FE: `useRequireErpPermission('project_create', '/dashboard/erp/projects')` (new/page.tsx:10).
  - BE: `POST /erp/projects` requires `has_erp_permission(user,'project_create')` (projects.py:97-98).
  - Attachments upload through `POST /erp/projects/{id}/attachments`, which requires `project_edit` (projects.py:380-381). **A user with `project_create` but not `project_edit` gets the project created and then a 403 on the file upload.**
  - Neither call is tab-gated.
- **Inputs** (ProjectForm, 5 tabs: ProjectForm.tsx:53)

| field | control | req | FE validation (ProjectForm.tsx) | BE validation | mismatch / notes |
|---|---|---|---|---|---|
| serial_number | text (295) | **yes** | `trim()` non-empty (191-195) | `str` required (sch/project.py:31). Unique check `==` (projects.py:99-101), DB String(100) unique | Sent untrimmed. Case-sensitive uniqueness. The 409 also fires for **soft-deleted** machines without saying it is in the Recycle Bin (projects.py:99 has no `is_deleted` filter). |
| model_name | text (296) | no | — | optional (33), String(200) | no maxLength |
| machine_type | select Road Rail/Rail Bound/Accessories/Other (297-302) + custom text when Other (304-308) | custom text required if Other | 196-200 | optional str (32), String(100) | No BE enum. |
| engine_number / chassis_number | text (309-310) | no | — | optional (34-35), String(100) | — |
| year_of_manufacture | YearField YYYY-YY auto-format (312, YearField.tsx) | no | `isFinancialYearValid` (216-220) | `validate_financial_year_format` (sch/project.py:87) | FE/BE aligned. "Year of Manufacture" asks for a *financial year*; label vs format mismatch (USER). |
| status | select, 8 options (313-317) | defaults `active` | — | free `str = "active"` (37), no enum | BE accepts any string. |
| application_type | select + custom when Other (318-329) | custom required if Other | 201-205 | optional str (36) | — |
| notes ("Production Notes & Core Details") | textarea (331-333) | no | — | Text | — |
| is_export | Checkbox (341-353) | no | toggling clears state or resets country | bool (60) | — |
| site_name / site_location | text (356-357) | no | — | String(255) | — |
| site_state (non-export) | select of 36 states/UTs (365-370) | no | — | String(100) | — |
| site_country (export) | text (361-363) | no | — | String(100), default India | Checking "Export" leaves the country as "India" until the user edits it. |
| site_pincode | text "6-digit PIN code" (372) | no | **none** | **none**, String(10) | No numeric or 6-digit check on either side. |
| zone | text (374) | no | — | String(100) | — |
| client_company | text (378) | **yes (FE)** | `trim()` (206-210) | **optional** (sch/project.py:45) | FE-only required rule. Direct API calls can omit it. |
| client_name / client_designation | text (379-380) | no | — | String(255)/(100) | — |
| client_email | ValidatedInput (381) | no | `isValidEmail` (221-225) | `validate_email_format` (84) | aligned |
| client_phone / client_phone_alt | PhoneField (383-384) | no | 7–15 digits (PhoneField.tsx:7-10; ProjectForm 211-215) | **none**, String(50) | BE has no phone check. |
| client_gst | ValidatedInput, upper-cased (386) | no | `isValidGST` (226-230) | `validate_gst_format` (86) | aligned |
| client_address | textarea (387-389) | no | — | Text | — |
| operator_name/phone/email/qualification | (393-398) | no | phone and email as above | email validated (85), phone not | — |
| specifications / installed_options / software_version / tech_notes | (405-414) | no | — | Text / String(50) for software_version | — |
| po_number | text (422) | no | — | String(100) | — |
| po_date, delivery_date ("Dispatch Date"), commissioning_date, handover_date | DateField (423-426) | no | DateField has no min/max (DateField.tsx:12) | `date \| None` | **No ordering checks** (PO ≤ dispatch ≤ commissioning ≤ handover) on either side. |
| Warranty Status | select none/active (431-435) | — | UI-only; derived on edit from `warranty_start_date` (163) | — | — |
| warranty_start_date / warranty_end_date | DateField (438-439) | no | none, end may precede start | `date` | no ordering check |
| warranty_override ("Warranty Terms & Scope", placeholder "Clauses, limit conditions") | text (443) | no | none | optional, **DB String(50)** (models/project.py:60) | The label invites long text but the column holds 50 chars. The error only surfaces as a translated DB error after submit (middleware/error_handler.py:28-36). The model also has an unused `warranty_terms` Text column (sch/project.py:82). |
| extended_warranty + extended_warranty_end | Checkbox + DateField (446-453) | no | — | bool/date | — |
| amc_status | select None/Active/Expired (455-457) | no | — | String(50) | — |
| amc_end_date | DateField, shown only when amc_status set (459-461) | no | — | date | — |
| Documents: files | hidden `<input type=file multiple>`, **no `accept`** (483), drag-drop (469-491) | no | **none** | BE `_validate_uploaded_file`: extension/content-type allowlist + magic bytes + **2 GB** (BE/utils/sharepoint.py:28-34, 134-179) | Help text says "**max 10GB each**" (468), the BE limit is 2 GB. The FE request timeout is 120 s (FE/lib/api.ts upload helpers), so large files will time out long before 2 GB. Chips show PDF/DOCX/XLSX/JPG/PNG/MP4 only (487). |
| Share options (Private + users/departments/designations) | SharePicker, shown only after files are queued (502-517) | no | — | `is_private` Form bool + CSV strings (projects.py:373-376). CSV split `_split_csv` (277-284) | Department or designation names containing commas break the CSV split. |

- **Views**: 5-tab form with Previous/Next (521-530). Errors show in a MessageDialog "Cannot Save Machine/Project" (289). Validation errors jump to the relevant tab.
- **Findings**
  - P1-ERP-09 [BA] **Create-then-upload is not atomic** (new/page.tsx:37-42). The project is created (38), then attachments upload (40).
    - If the upload fails (403 for a create-only user, a type or magic-byte rejection, or the 120 s timeout), the form shows "Cannot Save Machine/Project" and stays on the form.
    - The machine already exists, so pressing Save again returns 409 "A machine with this serial number already exists". This is a dead end, and the user doesn't know the first save worked.
  - P1-ERP-10 [BA] "Client Company *" is required on the FE only (ProjectForm.tsx:206-210 vs sch/project.py:45).
  - P1-ERP-11 [USER] The file-size help text says "max 10GB each" (ProjectForm.tsx:468). The BE enforces 2 GB (sharepoint.py:28) and the client times out at 120 s.
  - P1-ERP-12 [BA] No Pydantic `max_length` on any ERP string field (sch/project.py:30-87) and no FE `maxLength`. Overflows (e.g. `warranty_override` 50, `site_pincode` 10, `software_version` 50) are caught only by the DB. The error is translated, but only after a full submit.
  - P1-ERP-13 [BA] No date-order validation (PO/dispatch/commissioning/handover; warranty start ≤ end; extended end ≥ warranty end; AMC end) on the FE (ProjectForm.tsx:189-230) or the BE (sch/project.py).
  - P1-ERP-14 [ARCH] `upload_project_attachments` has no per-file try/except (projects.py:400-401), unlike the SR upload (sr.py:553-568).
    - If file #3 fails, files #1-2 are already stored in SharePoint while the DB transaction is never committed. Result: orphan files and a single error.
  - P1-ERP-15 [USER] Non-standard Back button: inline style with the "‹ Back" glyph (new/page.tsx:25-30), not the shared `secondaryBtnStyle` "← Back".

#### /dashboard/erp/projects/[id] — Machine detail (FE/app/dashboard/erp/projects/[id]/page.tsx)

- **Access**
  - FE: `useRequireApp('erp')` (20).
  - Buttons: "+ New Service Request" needs `sr_create` (21, 96). "Edit Project" needs `project_edit` (22, 104). "Delete" needs `project_delete` (23, 112).
  - Documents tab: upload needs `project_edit` (345, 384) and per-document Delete needs `project_delete` (411).
  - BE:
    - `GET /erp/projects/{id}` has app access only (projects.py:121-130).
    - `DELETE /{id}` needs `project_delete` (173-174).
    - Attachment list/preview/content filter by `_can_view_attachment`. That check passes for admin, public docs, the uploader, a shared user, a shared department or a shared designation (295-304, used at 316, 331, 356).
    - Upload needs `project_edit` (380). Attachment delete needs `project_delete` (471) **with no `_can_view_attachment` check**.
    - `GET /{id}/audit` has app access only (247-251).
    - The Maintenance tab calls `GET /erp/service-requests?project_id=` (tab `service_requests`).
- **Inputs**
  - Delete confirm: ConfirmDialog (159-165).
  - Documents upload: hidden file input without `accept` (360), staged via FileUploadPreview (385-391), `confirmUpload` (307-321). **No privacy or share controls here.** `uploadProjectAttachments(projectId, staged)` is called with no options (312), so every upload from this screen is public.
  - FE size/type checks: none. BE: sharepoint.py allowlist, 2 GB.
- **Views**
  - Header: status badge that is green only for `active` and red for every other status incl. standby/under_service (86). Active Tickets / Warranty cards (118-129).
  - Tabs (17): Overview (170-221), Technical Specs (223-241), Maintenance History (243-284; columns SR Number, Issue, Priority, Status, Created at 260), Documents (286-423; loading/empty 396-399), Audit Trail (425-449; loading/empty 433-434).
  - Documents list shows filename only. There is no private/shared badge, no uploader or date, no preview for Office files (the `/preview` endpoint exists at projects.py:319 but `previewProjectAttachment` is never called), and no share editing (`updateProjectAttachmentPermissions` in FE/lib/api.ts:583 is unused anywhere).
- **Findings**
  - P1-ERP-16 [USER] `handleDelete` has no try/catch (67-71). A failed delete (403/404/5xx) is an unhandled rejection: the dialog closes and nothing is shown.
  - P1-ERP-17 [USER] Document Delete (411-414) runs immediately with no ConfirmDialog. It is a **hard** delete of the DB row plus the SharePoint file (projects.py:479-486) with no recycle bin. A SharePoint delete failure is silently swallowed (projects.py:480-483), leaving an orphan file.
  - P1-ERP-18 [SEC] Private documents:
    - (a) `DELETE /attachments/{id}` doesn't call `_can_view_attachment` (projects.py:464-477). A `project_delete` holder can delete a private document they are not allowed to see, by id (ints are enumerable).
    - (b) The detail-page upload path cannot set privacy (312).
    - (c) Privacy can't be viewed or changed after upload anywhere in the UI, even though the BE PATCH exists (projects.py:434-461).
  - P1-ERP-19 [USER] Swallowed or misleading loads:
    - Maintenance History (248), Active Tickets count (54-56), Documents list (296) and Audit (430) all have no `.catch`.
    - On 403 (e.g. tab matrix lacks `service_requests`) the Maintenance tab says "No service requests raised for this machine yet." (252), which is false.
    - The Documents list says "No documents uploaded." (399).
  - P1-ERP-20 [USER] Upload and delete errors use `err?.response?.data?.detail || 'Upload failed.' / 'Failed to delete document.'` (316, 328) instead of `extractErrorMessages`.
    - Timeouts and network drops show the generic fallback.
    - A 422 shows only "Validation error" because the API puts field errors in `errors` (FE/lib/validation.ts:61-65).
  - P1-ERP-21 [USER] Clicking a document runs `openAttachmentBlob` (406) with no catch (FE/hooks/useAttachmentBlobUrl.ts:46-63). A 403, 503 "SharePoint site is not configured" or 404 does nothing visible.
    - The whole file is also buffered in browser memory; for MP4s up to 2 GB this is unusable.
    - The BE `/content` endpoint likewise loads the whole file into RAM (projects.py:361-366).
  - P1-ERP-22 [BA] Extra clicks: "+ New Service Request" (96-103) links to `/service-requests/new` without the machine id, so the user must search for and re-pick the machine they were just viewing.
  - P1-ERP-23 [USER] The Maintenance History list is capped at the BE default `limit=50` (sr.py:225; the call at 248 passes no limit), with no pagination or indication. The Active Tickets count at 54 has the same cap.
  - Back button: compliant (shared `secondaryBtnStyle`, "← Back", top-right in the header row: 93-95).

#### /dashboard/erp/projects/[id]/edit — Edit Project (FE/app/dashboard/erp/projects/[id]/edit/page.tsx + ProjectForm)

- **Access**
  - FE: `useRequireErpPermission('project_edit', …)` (edit/page.tsx:15).
  - BE: `PATCH /erp/projects/{id}` needs `project_edit` (projects.py:140-141). Upload needs `project_edit`.
- **Inputs**: same as the Add New Project table. BE schema is `ProjectUpdate` (sch/project.py:90-148), applied with `exclude_unset` (projects.py:146).
- **Findings**
  - P1-ERP-24 [BA] **Fields can't be cleared on edit.** ProjectForm deletes every `''` key from the payload (ProjectForm.tsx:244-246), and the PATCH uses `exclude_unset=True` (projects.py:146), so an emptied field is simply not sent and keeps its old value. Cases that silently fail:
    - Changing Warranty Status to "No Warranty" (241-242 set `''`, which is then dropped).
    - Unticking Extended Warranty leaves the old `extended_warranty_end` (240).
    - Clearing email, phone, GST or a date.

    The user sees a successful save and a redirect, but the old data persists.
  - P1-ERP-25 [BA] Partial save on upload failure (edit/page.tsx:53-58, same pattern as P1-ERP-09). The PATCH commits, the upload fails, the user stays on the form, and the error title says "Cannot Save" even though the fields were saved.
  - P1-ERP-26 [USER] Load failure maps every error to the text "Machine not found." (edit/page.tsx:23), including 403 and 5xx. That is a swallowed real reason.
  - P1-ERP-27 [USER] Non-standard Back button: inline style, "‹ Back" (edit/page.tsx:40-45).
  - Audit: "updated" entries list up to 5 field names (projects.py:152-157) but not old/new values, unlike SR audits.

#### /dashboard/erp/service-requests — Service Request Registry (FE/app/dashboard/erp/service-requests/page.tsx)

- **Access**
  - FE: `useRequireApp('erp')` (70). "+ New Service Request" needs `sr_create` (71, 157). The per-row Edit link follows the `_can_edit` mirror (74-75, 273).
  - BE: `GET /erp/service-requests` (app + tab `service_requests`, sr.py:227-228) and `GET /erp/projects?limit=5000` (tab `projects`). **A user granted `service_requests` but not `projects` gets 403 on the projects call, so the whole page errors** (the Promise.all at 92-100 fails as one).
- **Inputs (filters)**

| field | control | FE | BE | notes |
|---|---|---|---|---|
| Search | text, debounced 300 ms (187-192, 116-124) | none | `ilike` on request_number, issue_title, issue_description, issue_category, Project.serial_number, **Project.client_name** (sr.py:234-243) | The table shows `client_company` (249), but search matches the contact person `client_name`, so searching the visible client company finds nothing. |
| Status | select, 11 statuses (193-198) | immediate reload | exact match (244-245) | — |
| Priority | select (199-205) | immediate | exact match | — |
| Overdue Only | checkbox (206-209) | **client-side** filter (135-141) | — | Treats `cancelled` as overdue-eligible (only `closed` is excluded, 138). |
| Clear | button (210) | resets state | — | — |

- **Views**
  - Columns (218): SR Number, Machine Serial, Client & Site, Issue Summary, Priority, Status (colored pill 258-262), Opening Date, Closing Date, Age, Warranty, Actions.
  - Pagination is client-side with PAGE_SIZE 20 (56, 143-144, 285-311) over `limit: 1000`. Sort fixed to `created_at desc` (sr.py:251). No sort UI, no export or print.
  - Loading and empty rows at 226-231. MessageDialog with Reload on error (176-184).
- **Findings**
  - P1-ERP-28 [BA] Search matches `Project.client_name`, not the `client_company` shown in the grid (sr.py:242 vs page.tsx:249).
  - P1-ERP-29 [USER] Header "{srs.length} Service Requests Found" (155) ignores the Overdue filter and the 1000 cap, so it disagrees with the pager count (288).
  - Filters apply immediately here but need "Apply" on the Projects page (inconsistent; see P1-ERP-05).

#### /dashboard/erp/service-requests/new — Create Service Request (FE/app/dashboard/erp/service-requests/new/page.tsx + FE/components/erp/ServiceRequestForm.tsx)

- **Access**
  - FE: `useRequireErpPermission('sr_create', …)` (new/page.tsx:10).
  - BE: `POST /erp/service-requests` needs `sr_create` (sr.py:262-263) and checks the project exists and is not deleted (264-266).
  - Attachment upload needs `_can_edit` (sr.py:543-544). The creator without `sr_edit` gets 403 on the upload right after a successful create.
  - The machine picker loads `GET /erp/projects?limit=5000` (ServiceRequestForm.tsx:126), which is tab-gated `projects`.
- **Inputs**

| field | control | req | FE validation (ServiceRequestForm.tsx) | BE validation (sch/sr.py ServiceRequestCreate 84-102 + sr.py) | notes |
|---|---|---|---|---|---|
| project_id "Asset / Vehicle *" | SearchableSelect (204-212) | yes | non-empty (134-137) | `int` required (85). Existence and not-deleted checked (sr.py:264-266) | If the projects list fails, the error is "Failed to load machines" (126), shown in a dialog titled "Cannot Save Service Request" (192). The picker is empty with no retry. |
| Request Date | DateField value=today, `onChange={() => {}}` (215-217) | — | — | not sent | Looks editable but ignores input. `opened_at` is server time (sr.py:272). |
| issue_title | text (220-222) | yes | `trim()` (138-141) | `str` required, **no min_length** (86) | The BE accepts `""`. |
| issue_description | textarea (223-225) | **yes (FE)** | `trim()` (142-145) | **optional** (87) | FE-only required rule. |
| issue_category | select, 7 fixed values (228-235) | no | — | free str, String(100) | no enum |
| failure_mode | text (236-238) | no | — | String(200) | — |
| sub_category | text (241-243) | no | — | String(100) | — |
| site_location "Site / Location" | text (244-246) | no | — | **no column**. Appended to the description as "\n\nLocation: …" (164-165) | On edit it is not pre-filled (79 always `''`), and any value re-appends another "Location:" line (duplication). |
| reported_by_name "Company / Client Name" | text (252-254) | no | — | String(255) | Label says company, but the email template and BE field name treat it as a person name (`reported_by_name`). |
| reported_by_phone | PhoneField (255-257) | no | 7–15 digits (150-153) | **none**, String(50) | — |
| reported_by_email | ValidatedInput (258-260) | no | `isValidEmail` (154-157) | `validate_email_format` (102) | Used for client emails (sr.py:168). |
| Attachments | hidden file input, **no accept** (283-289), drag-drop | no | none | sharepoint.py allowlist + 2 GB; per-file failures returned in `failed[]` (sr.py:552-584) | The FE ignores `failed[]` (new/page.tsx:39-40), so partial failures are silent. |
| priority | radio cards (315-341) | yes | non-empty (146-149) | `str = "medium"`, **no enum** (89) | Arbitrary strings accepted via API. |
| assigned_to_name "Assign To Engineer" | disabled text = creator's name (123, 344-346) | — | — | free str | There is no way to assign another engineer. `assigned_service_person_id` is never set. |
| expected_date_to_attend / expected_completion_date | DateField (347-352) | no | none | `date \| None` (92, 95) | No "attend ≤ close" or "not in past" check. |
| status "Initial Status" | select, 11 statuses (353-357) | default open | — | free `str = "open"` (100) | A user can create an SR directly as `closed`. That skips the `closed_at` stamp and the close email (both only happen in PATCH, sr.py:377-379, 436-437). |
| service_report_notes "Notes" | textarea (358-360) | no | — | Text | — |

- **Findings**
  - P1-ERP-31 [BA] **Duplicate SRs on retry**. The SR is created (new/page.tsx:37), then the upload fails (39) and the form shows "Cannot Save Service Request". `submittingRef` resets (ServiceRequestForm.tsx:184), so a second click creates a second SR with a new number (no uniqueness guard).
  - P1-ERP-32 [BA] Creating with Initial Status = Closed or Cancelled is allowed (353-357). `closed_at` stays null, the "closed" client email never fires, and Reports' Avg Resolution ignores the SR (reports/page.tsx:74-81).
  - P1-ERP-33 [BA] FE/BE required-field mismatch: description is FE-only required, and the BE accepts an empty title and any priority/status string (sch/sr.py:86-100).
  - P1-ERP-34 [USER] The "Request Date" field looks editable but discards input (ServiceRequestForm.tsx:216).
  - P1-ERP-35 [USER] Non-standard Back button: inline style, "‹ Back" (new/page.tsx:25-30).

#### /dashboard/erp/service-requests/[id] — SR detail (FE/app/dashboard/erp/service-requests/[id]/page.tsx)

- **Access**
  - FE: `useRequireApp('erp')` (40). Edit and Delete follow `_can_edit`/`_can_delete` mirrors (75-76, 116, 124). All tab actions pass `canEdit`/`canDelete` (156-160).
  - BE:
    - `GET /{id}` has app access only (sr.py:332-343). `PATCH` needs `_can_edit` plus not locked (358-361). `DELETE` needs `_can_delete` (451-452).
    - Materials: add/patch/receive/raise-PR need `_can_edit` (690, 726, 1063, 992). Delete material needs `_can_delete` (752).
    - Attachments: upload needs `_can_edit` (543). Delete needs `_can_delete` (653). Content/preview have **app access only, no ownership or privacy check** (587-636).
    - Material photos: upload needs `_can_edit` and images only (786, 791-793). Delete needs `_can_delete` **on the URL's sr_id** (894-896). Content/preview have app access only (836-877).
    - The linked project is fetched via `GET /erp/projects/{id}`; its errors are swallowed (59).
- **Inputs**
  - Workflow stepper: click any step, then a ConfirmDialog (132, 187-248, 170-182).
  - Overview "Status" select (270-279) and "Priority" select (282-291) PATCH **immediately on change** with no confirmation.
  - RCA tab: Root Cause / Corrective Action / Preventive Recommendation textareas (356-382), "Save RCA" (385-387). BE `root_cause`, `resolution_description`, `preventive_actions` are free Text (sch/sr.py:117-119).
  - Materials tab add form (519-525):

| field | control | req | FE validation | BE (ServiceMaterialCreate sch/sr.py:19-28; sr.py:680-711) | notes |
|---|---|---|---|---|---|
| material_name | text (520) | yes | `trim()`, **silent return if empty** (439) | `str` required, no min_length (20), String(255) | No message when empty. |
| part_number | text (521) | no | — | String(100) | — |
| quantity "Qty" | number min=0 step=.01 (522) | — | `Number(q) \|\| 1` (446): 0 becomes 1 silently, negatives pass | `float = 1`, **no >0 check** (26) | Negative or zero quantities are accepted by the BE. |
| remarks "Remarks" | text (523) → sent as `description` (445) | no | — | `description` String(500). The separate `reason` field (25) is never used | Label/field mismatch. |
| unit | not offered | — | — | defaults `pcs` (27) | Every material is "pcs". |
| estimated_budget, model_number, reason | not offered | — | — | optional | `estimated_budget` drives `total_material_cost` (sr.py:113-116), so it is always 0. |

  - Receive: number input min 0, max qty (584-593), and "Mark" (594-600). FE clamps (486). BE rejects negative and clamps to quantity (sr.py:1065-1068).
  - **Raise Purchase Requisition**: a single button (507-514) that immediately POSTs `{ priority: 'medium' }` (470). **There is no Raise-PR modal**: no confirmation and no inputs. The BE payload supports `required_by_date`, `reason`, `category_code`, `requirement_type`, `approver_id` and `approver_name` (sr.py:46-56), validated at 982-987, but the UI collects none of them.
  - Material photos: camera or file with `accept="image/*"` (701), staged, then upload (645-659). BE accepts `image/*` only (791-793). The hint says "(JPG/PNG)" (703), but the BE also accepts GIF/BMP and the FE accepts any image/*.
  - Attachments tab: file input without accept (807), staged (831-837). Same BE rules as SR create.
- **Views**
  - Header with request number and title (108-111).
  - Workflow stepper of 10 steps, with a Cancelled banner (187-248).
  - Overview cards (250-324). RCA (326-394).
  - Materials table (533): Material, Photos, Part No., Qty, Status (Issued/Returned/Pending badge 396-400), PR (linked badge to `/dashboard/p2p/{pr_id}`, 402-411, 571-576), Received, remove. Loading/empty at 539-540.
  - Attachments list (841-859) with empty state 842. Audit Trail (880-904) with loading/empty 888-889.
  - No billing/costs view: `service_cost`, `transport_cost`, `accommodation_cost`, `miscellaneous_cost`, `tax_percentage`, `payment_status`, `invoice_number`, `actual_date_attended` and `actual_completion_date` exist in `ServiceRequestUpdate` (sch/sr.py:105-134) but no FE screen reads or writes them (grep).
  - No print or export of the SR or a service report.
- **Findings**
  - P1-ERP-36 [BA] **Status transitions are unrestricted**. The FE allows any step to any step through the stepper (205, `clickable = canModify && !active`) and the dropdown (276-278). The BE accepts any string with no transition map (sr.py:363-384).
    - Closed SRs can be reopened (closed_at cleared at 380-382).
    - "Closed" can be set with unreceived materials or an empty RCA.
    - The Overview dropdown closes an SR **without confirmation** (273), and closing triggers the client + team email (sr.py:436-437).
  - P1-ERP-37 [USER] The status confirm text is Hinglish: "Status ko update karna chahte hain?" (177). It is inconsistent with the rest of the English UI, and the stepper and dropdown behave differently (confirm vs none).
  - P1-ERP-38 [BA] **Raise PR has no modal and hard-codes priority `medium`** (470). There is no confirmation for an action that creates a P2P request, notifies the buyer and emails Purchase (sr.py:957-963, 1021-1033).
    - It also bypasses the policy from HEAD commit c765df7 that Department, Project and Plant Head are **required** on PRs. `_create_p2p_request_for_sr` sets only `approver_id` from the payload, which the UI never sends (sr.py:934-935), and never sets `project_head_id`/`plant_head_id`.
    - Compare P2P create (BE/modules/p2p/routes/p2p_requests.py:310-317). ERP-raised PRs fall into the "no heads assigned, purchase-team-wide" approval path (p2p_requests.py:182-186).
    - `category_code` defaults to "OTH" (sr.py:921).
  - P1-ERP-39 [BA] Raise PR is allowed on closed or cancelled SRs. No status check in raise-PR (sr.py:989-993) or on the FE (507-514).
  - P1-ERP-40 [USER] Dead end on PR badge: the PR link goes to `/dashboard/p2p/{id}` (572), which is gated by `useRequireApp('p2p')` (FE/app/dashboard/p2p/[id]/page.tsx:72). ERP-only users are bounced to `/dashboard` with no explanation.
  - P1-ERP-41 [USER] **Materials tab load has no try/catch and no `finally`** (424-428). Any error leaves "Loading…" forever (539) plus an unhandled rejection.
  - P1-ERP-42 [USER] `saveReceive` has no catch (484-496). A 403, 400 or 5xx failure does nothing visible and the input keeps its value.
  - P1-ERP-43 [USER] Generic error strings that bypass `extractErrorMessages`, so network errors and timeouts show only the fallback and 422s show "Validation error":
    - 'Failed to add material.' (451)
    - 'Failed to remove material.' (461)
    - 'Failed to raise purchase requisition — refreshing…' (477)
    - 'Upload failed.' (654, 763)
    - 'Failed to delete photo.' (666)
    - 'Failed to delete attachment.' (775)
  - P1-ERP-44 [USER] Irreversible deletes with no ConfirmDialog:
    - Material "Remove" (610). Soft-deleted but not restorable anywhere (sr.py:756).
    - Photo ✕ (726-732). Hard delete plus SharePoint (sr.py:898-905).
    - Attachment Delete (855). Hard delete (sr.py:656-663).
  - P1-ERP-45 [BA] Materials can't be edited. `updateMaterial` (FE/lib/api.ts:652) and `PATCH /materials/{id}` (sr.py:714-738) are unused by the UI, so fixing a typo or quantity means delete and re-add, and a line already linked to a PR can't be corrected. Material `status` (issued/returned) has no UI; it only auto-flips to `issued` on full receipt (sr.py:1078).
  - P1-ERP-46 [BA] The FE only allows receiving when `pr_id` is set (544). The BE allows `receive` on any material (sr.py:1042-1068). Receipt is also not tied to P2P GRN quantities, so ERP and P2P "received" can diverge; the code comment at sr.py:1050-1056 acknowledges this.
  - P1-ERP-47 [SEC] Cross-SR photo delete.
    - `delete_material_attachment` filters the photo by `mat_id` only (sr.py:888-890) and authorises against the URL's `sr_id` (894-896). It never checks that `mat_id` belongs to `sr_id`.
    - A user who owns *any* SR (with `sr_delete`) can delete photos on another user's material via `/service-requests/{ownSr}/materials/{otherMat}/attachments/{id}`.
    - The photo content/preview endpoints have the same missing check (844-846, 868-870) and also don't check whether the SR is deleted.
  - P1-ERP-48 [SEC] SR attachments and material photos have no view-authorisation beyond ERP app access (sr.py:587-636, 836-877). Any ERP user, including one without the `service_requests` tab, can download any SR file by id. This is inconsistent with the privacy model on project documents.
  - P1-ERP-49 [SEC] `POST /{sr_id}/resend-client-email` needs only ERP app access (sr.py:1111-1129), not `_can_edit`, so any ERP user can re-send client emails for any SR. `POST /test-email` (1132-1159) is open to any ERP user and returns raw Graph error text (`resp.text[:500]`) with HTTP 200. Neither has a UI (grep).
  - P1-ERP-50 [BA] The edit-lock is half-wired:
    - RCA textareas ignore `is_locked` (360, 369, 378).
    - Materials, receive, raise-PR, attachments and photos ignore it on both FE and BE (sr.py:680-1106).
    - The 423 text "Service request is locked" (sr.py:361) gives no who, why or how to fix (`locked_by_id`/`lock_reason` are not exposed, sch/sr.py:172).
  - P1-ERP-51 [BA] Materials and attachments can be added to a soft-deleted SR: `add_material` and `update_material` don't filter `is_deleted` (sr.py:687, 725), nor does raise-PR's `materials` query. Only upload_attachments checks it (538-540).
  - P1-ERP-52 [BA] Billing is dead:
    - Material `estimated_budget` is never captured (P1-ERP-45 table), and the SR cost fields have no UI.
    - `total_bill` is therefore always tax on 0. Reports "Total Billed" and "Cost Breakdown" are always ₹0 (reports/page.tsx:71, 119-129).
  - P1-ERP-53 [USER] If the linked machine was deleted or can't be loaded, "Asset Context" shows "Machine: Not provided" (298) with no reason (59 `.catch(() => {})`).
  - P1-ERP-54 [USER] Back button: "← Back", top-right, but it uses a **local copy** of `secondaryBtnStyle` (113, 918-928; border `rgba(0,0,0,0.1)` vs shared `BORDERS.default`), not the shared import. It is a partial deviation.
  - Audit: SR PATCH logs field-level old/new values (sr.py:366-384). Material add/delete and PR-raise are logged. Attachment delete and photo delete are **not** audited (sr.py:639-664, 880-906). Project attachment delete isn't audited either (projects.py:464-487).

#### /dashboard/erp/service-requests/[id]/edit — Edit SR (FE/app/dashboard/erp/service-requests/[id]/edit/page.tsx + ServiceRequestForm lockProject)

- **Access**
  - FE: `useRequireApp('erp')` (edit/page.tsx:12) plus an inline `_can_edit` mirror (30). Unauthorised users get `router.push` **during render** (31-34), a render side effect.
  - BE: `PATCH` needs `_can_edit` and not locked (sr.py:358-361) with `ServiceRequestUpdate` (sch/sr.py:105-134). Upload needs `_can_edit`.
- **Inputs**: same as the create table, except the machine is locked (ServiceRequestForm.tsx:199-202), `project_id` is removed (edit/page.tsx:60), and the form keeps `''` values on edit (ServiceRequestForm.tsx:173-180).
- **Findings**
  - P1-ERP-55 [BA] **Saving an SR with an empty Expected Attend or Expected Close date always fails with 422.**
    - On edit the form sends `''` for empty fields (ServiceRequestForm.tsx:173-180), which is intentional so that clearing works.
    - But `expected_date_to_attend` and `expected_completion_date` are `date | None` (sch/sr.py:114-115). Pydantic 2.12.5 (backend/requirements.txt:3) rejects `''` for `date` ("Input should be a valid date or datetime, input is too short", verified locally).
    - Any SR created without both dates therefore can't be edited through this form, and a date can't be cleared.
    - The user sees a field error but not why an untouched empty date is "invalid".
  - P1-ERP-56 [BA] Editing silently rewrites `assigned_to_name` to the editor's name when it was empty (ServiceRequestForm.tsx:123 `initial?.assigned_to_name || user?.name`). An admin editing someone's SR can take the assignment.
  - P1-ERP-57 [BA] "Site / Location" isn't pre-filled on edit (ServiceRequestForm.tsx:79). Re-entering it appends a second "Location:" block to the description (164-165).
  - P1-ERP-58 [USER] The "Request Date" field on edit shows *today*, not the SR's creation date (113, 215-217). The "Initial Status" label (353) is used on edit too.
  - P1-ERP-59 [USER] Load errors all read "Service request not found." (edit/page.tsx:23), which swallows 403 and 5xx. Non-standard Back button: inline "‹ Back" (46-51).

#### /dashboard/erp/reports — Reports (FE/app/dashboard/erp/reports/page.tsx)

- **Access**
  - FE: `useRequireApp('erp')` (52). No `reports` tab check.
  - BE: only `GET /erp/service-requests` (tab `service_requests`). A user granted `reports` but not `service_requests` gets 403, which is swallowed (57, no catch), and "No data yet." (152).
- **Inputs**: none (no date range, machine, client or status filters).
- **Views**
  - KPI tiles (155-162): Total Requests, This Month, Open, Closed, Avg Resolution, Total Billed.
  - Charts: Status doughnut, Priority bar, Last-6-months bar, Top Issue Categories, Cost Breakdown doughnut (164-220).
  - "Status Detail" grid (222-231). Loading/empty at 149-152.
  - **No export (CSV/Excel/PDF) and no print.** The only report artefact is an orphaned `.pyc` (see cross-cutting).
- **Findings**
  - P1-ERP-60 [BA] **All report figures cover only the 50 most recent SRs.** `erpApi.listServiceRequests()` is called with no params (57), and the BE default is `limit=50` (sr.py:225). "Total Requests" can never exceed 50, and Avg Resolution, monthly trend and cost breakdown are all truncated with no indication.
  - P1-ERP-61 [BA] "Open" uses a fixed 7-status set (27) that excludes `work_completed` and `review`, so Open + Closed doesn't add up to the total and the two uncounted statuses aren't labelled.
  - P1-ERP-62 [BA] "Total Billed" and "Cost Breakdown" are always 0 (see P1-ERP-52). The "Status Detail" section duplicates the Status doughnut.
  - P1-ERP-63 [USER] Load failure is swallowed (57) and shown as "No data yet." (152).

#### /dashboard/erp/recycle-bin — Recycle Bin (FE/app/dashboard/erp/recycle-bin/page.tsx)

- **Access**
  - FE: `useRequireApp('erp')` (31). Restore buttons: projects need `project_delete` (32, 100). SRs need `sr_delete` (33, 116).
  - BE:
    - `GET /erp/projects/recycle-bin/list` and `GET /erp/service-requests/recycle-bin` need app + tab `recycle_bin` (projects.py:231-232, sr.py:307-308).
    - Project restore needs `project_delete` (projects.py:212-213).
    - SR restore needs `_can_delete`, i.e. **creator + `sr_delete`** or admin (sr.py:488-489).
- **Inputs**: Restore buttons only (136-143), with no confirmation (fine for a non-destructive action).
- **Views**
  - Two sections: Deleted Projects (serial · model · client · deleted date) and Deleted Service Requests (request number · raw `issue_description` · days left · deleted date) (90-120). Empty state "Nothing here." (92, 108). Loading at 86-87.
  - No search or pagination; lists are unbounded (projects.py:234, sr.py:311). No "delete permanently" action.
- **Findings**
  - P1-ERP-64 [BA] The subtitle says "Deleted items are auto-purged after 10 days" (82), and the delete notifications repeat it (projects.py:198, sr.py:470). **No purge job exists** (grep for purge/RECYCLE_DAYS in BE finds only the SR list's display countdown, sr.py:310-319). Items stay forever, and `days_remaining` bottoms out at 0 (sr.py:319). Projects show no days remaining at all.
  - P1-ERP-65 [BA] Restore buttons show for any `sr_delete` holder (33), but the BE allows only the SR's creator (sr.py:488). Non-creators always get 403 "Only the creator (with delete permission) can restore…"; the FE should use the same `_can_delete` mirror as the detail page.
  - P1-ERP-66 [BA] Project restore also restores **every** deleted SR of that machine, including ones deleted individually before the machine was deleted (projects.py:219-221).
    - Conversely, restoring an SR whose machine is still deleted succeeds (sr.py:479-494 has no project check). The SR comes back pointing at a deleted machine: it is hidden from dashboard counts, and detail shows "Machine: Not provided".
  - P1-ERP-67 [USER] The error dialog title is always "Restore Failed" (84), even when the *load* failed (47). The SR secondary line shows the raw multi-line `issue_description` (114) rather than the title.
  - P1-ERP-68 [SEC] Project attachment list/content/preview endpoints don't check `Project.is_deleted` (projects.py:313-316, 326-328, 351-353), so documents of a machine in the Recycle Bin stay downloadable by id. The SR attachment endpoints do exclude deleted SRs (sr.py:600, 628), but the material-photo endpoints don't (sr.py:844-846). (inferred impact)

### Cross-screen finding

- P1-ERP-30 [USER] Loading and error early-returns render a bare `<p>` with no `<ErpNav />`, no header and no Back button. A 404, 403 or 5xx leaves the user stranded on a line of red text:
  - projects/[id]/page.tsx:74-75
  - projects/[id]/edit/page.tsx:27-28
  - service-requests/[id]/page.tsx:100-101
  - service-requests/[id]/edit/page.tsx:27-28

  The edit pages also collapse every error into "… not found." (P1-ERP-26, P1-ERP-59).

---

### Shared component notes

- `FE/components/erp/ErpNav.tsx`: tabs carry `subtabKey` matching the registry (permission_registry.py:25-33). Nav-only filtering is correct and renders above the header everywhere.
- `FE/components/erp/SharePicker.tsx`: used only in ProjectForm (ProjectForm.tsx:504-515). When private is ticked with no one selected, visibility falls to uploader + admins (projects.py:295-304), and the UI doesn't say so (inferred from SharePicker.tsx:136).
- `FE/components/erp/PromptDialog.tsx`, `ErrorRecoveryDialog.tsx`: not used anywhere in ERP (grep). The standard dialogs are available but ERP relies on inline red text for most action errors.

### Summary counts

- Screens covered: 11 (dashboard; projects list/new/detail/edit; SR list/new/detail/edit; reports; recycle-bin), plus the Materials, Raise-PR and attachments/photos sub-flows, and 6 BE endpoints with no UI (`PATCH attachments/permissions`, both `/preview` endpoints for project and material, `PATCH materials/{id}`, `resend-client-email`, `test-email`).
- `window.alert/confirm/prompt` or bare `alert(`/`confirm(`/`prompt(`: **0**.
- Back buttons:
  - **4 non-standard**: inline style with the "‹ Back" glyph at projects/new:25-30, projects/[id]/edit:40-45, service-requests/new:25-30, service-requests/[id]/edit:46-51.
  - **1 partial**: service-requests/[id]:113 uses a local style copy.
  - **1 compliant**: projects/[id]:93.
  - The loading and error early-return states on 4 pages have no Back button and no nav at all (P1-ERP-30: projects/[id]:74-75, projects/[id]/edit:27-28, service-requests/[id]:100-101, service-requests/[id]/edit:27-28).
- Sub-nav above header: compliant on all rendered screens.


---

## 2.3 CRM module screen review

Scope: `frontend/src/app/dashboard/crm/**`, `frontend/src/components/crm/**`, `backend/app/modules/crm/{routes,schemas,services,reports}`.
Path prefixes below: **FE** = `frontend/src/`, **BE** = `backend/app/modules/crm/` (unless a full `backend/app/...` path is given).
Snapshot note: `FE/lib/tabAccess.ts` and the `CrmNav` tab-access filter are uncommitted working-tree changes at review time.

### 0. Cross-cutting facts (apply to every CRM screen)

**Access model as enforced**
- FE page gate: every CRM page except the technical-offer viewer calls `useRequireApp('crm')` (FE/hooks/useAuth.ts:66-78). That redirects to `/dashboard` when `user.apps` lacks `crm`. There is no page-level tab check.
- FE tab filter: `CrmNav` hides tabs through `filterTabsByAccess('crm', …)` (FE/components/crm/CrmNav.tsx:42, FE/lib/tabAccess.ts). Tab keys are `dashboard`, `organizations` and `inquiries_tenders` (backend/app/core/permission_registry.py:35-41). This is display-only.
- BE gate: every CRM route uses `require_app_access("crm")` (backend/app/core/permissions.py:8-19). `require_tab_access` exists (permissions.py:36-45) but no CRM route uses it; only ERP projects/service_requests do.
- Record-level `_can_modify` = admin or `created_by_id == user.id`. It is defined in organizations.py:29, inquiries.py:53, tenders.py:59, workflow.py:20, documents.py:22, activities.py:23, products.py:15, product_categories.py:14 and payment_terms.py:14. The FE mirrors it in OrganizationDetailPanel.tsx:59, InquiryDetailPanel.tsx:73 and TenderDetailPanel.tsx:71.
- Admin-only on BE: org duplicates report (organizations.py:98-99), bulk import (bulk_import.py:71-73, 214) and quotation delete (workflow.py:209-210).

**Owners stored as free-text strings, not user FKs**
- `Inquiry.bd_owner` String(150) (models/inquiry.py:35), `Inquiry.sales_engineer` (36), `Inquiry.followup_assigned_to` (64), `Tender.bd_owner` (models/tender.py:40) and `Activity.assigned_to` (models/activity.py:23).

**Window dialogs:** there are 0 `window.alert/confirm/prompt` calls and 0 bare `alert(/confirm(/prompt(` calls in CRM scope (grep over `app/dashboard/crm` and `components/crm`). Confirms use `ConfirmDialog` and messages use `MessageDialog`. The gap is the other way round: several destructive actions have no confirm at all (see findings).

**Back buttons (6 total):**
- Standard (secondaryBtnStyle, "← Back", top-right in the header row): OrganizationForm.tsx:327-329, OrganizationDetailPanel.tsx:83-85, inquiries/new/page.tsx:33-35 and followups/page.tsx:76.
- Non-standard: InquiryDetailPanel.tsx:199-201 and TenderDetailPanel.tsx:170-172. Both sit in the second row next to StageProgress, not in the header row (header rows are 155-179 and 134-150), and both disappear in edit mode.
- **Non-standard count = 2.** Pages with no Back at all: organizations/[id]/edit error state, products, product-categories, payment-terms, bulk-import and technical-offer/[id].

**Sub-nav placement:** `<CrmNav />` renders above the page header on every CRM page (for example page.tsx:29-30, organizations/page.tsx:421-422, inquiries/page.tsx:429-430). This is compliant. The exceptions are products/categories/payment-terms: they wrap CrmNav in a `maxWidth:1000-1100, padding 24px 20px` container (products/page.tsx:84, product-categories/page.tsx:75, payment-terms/page.tsx:76), so the nav is inset and misaligned compared with other CRM pages. technical-offer/[id] has no CrmNav by design.

**Payload blank-stripping blocks clearing fields on edit.** OrganizationForm.tsx:273-275, InquiryForm.tsx:322-324, TenderForm.tsx:221-223 and ActivityForm.tsx:192-194 delete every `''` key before PATCH. BE updates use `model_dump(exclude_unset=True)` (organizations.py:256, inquiries.py:185, tenders.py update, activities.py update). A user who empties Website, Delivery Location, a date and so on sees "saved", but the old value persists.

**List caps.** Every list endpoint defaults to `limit=200`: organizations.py:54-55, inquiries.py:76, tenders.py:82, activities.py:112. No FE caller passes `skip`/`limit`, so all lists and pickers silently truncate at 200.

---

### 1. `/dashboard/crm` — CRM Dashboard (FE/app/dashboard/crm/page.tsx)

- **Access**
  - View: FE `useRequireApp('crm')` (page.tsx:15). BE `GET /crm/dashboard` requires `require_app_access("crm")` (routes/dashboard.py:17-21).
  - There are no actions on this page. The tab-access "dashboard" subtab is not checked on this page (FE only hides the nav tab).
- **Inputs**: none.
- **Views**
  - 7 stat cards (page.tsx:39-47), each a link: Organizations, Inquiries, Tenders, Open/Overdue/Today follow-ups (→ `/followups?bucket=`), and Pending Tenders (→ `/tenders?status=Active`, line 46).
  - Recent lists (5 each): orgs, inquiries (with status badge `inquiryStatusColor`, line 70), tenders (plain status text, line 82) and follow-ups (lines 89-106).
  - Loading state `Loading…` (line 35-36). Per-list empty state "No records yet." (line 149-150).
  - BE counts are at dashboard.py:24-44.
- **Findings**
  - P1-CRM-1 [USER] **Dashboard stuck on "Loading…" forever on any API error.** `crmApi.getDashboard().then(setData).finally(...)` has no catch (page.tsx:22), and the render condition is `loading || !data` (page.tsx:35). A 403/500/network error never shows a reason.
  - P1-CRM-2 [BA] **"Pending Tenders" card filter is dead.**
    - It links to `/dashboard/crm/tenders?status=Active` (page.tsx:46). The redirect stub drops `status` (tenders/page.tsx:11-12), and the combined list has no status filter.
    - The count uses `status NOT IN (Closed – Ordered, Closed – Not Ordered, Tender Cancelled)` (dashboard.py:36-39), so the user cannot see the tenders behind the number.
  - P1-CRM-3 [BA] **"Today's Follow-ups" count ≠ list.**
    - The dashboard counts `status == "Open" AND next_followup == today` (dashboard.py:32-34).
    - The list for `bucket=today` uses `due_today`, which filters only `next_followup == today` with no status filter (activities.py:121-122). The list can show more rows than the card.
  - P1-CRM-4 [ARCH] **Two URL schemes for the same detail view.**
    - The dashboard links to `/organizations/{id}` (page.tsx:56), `/inquiries/{id}` (68) and `/tenders/{id}` (80).
    - The lists open `?id=` in-page (organizations/page.tsx:124, inquiries/page.tsx:231).
    - Result: two different pages render the same panel, with different `onDeleted` targets (tenders/[id]/page.tsx:19 → `/dashboard/crm/tenders` redirect stub).
  - P1-CRM-5 [SEC] **Tab-access matrix is FE-only for CRM.** CrmNav hides tabs (CrmNav.tsx:42), but no CRM page or BE route checks `require_tab_access` (permissions.py:36-45 is unused in CRM). A user denied `organizations` can still open `/dashboard/crm/organizations` by URL (or via these dashboard cards) and call every `/crm/organizations` API.

---

### 2. `/dashboard/crm/organizations` — Organization list + in-page detail (FE/app/dashboard/crm/organizations/page.tsx)

- **Access**
  - View: FE `useRequireApp('crm')` (44). BE `GET /crm/organizations` requires crm access (organizations.py:50-57).
  - The admin-only duplicates banner is gated on FE by `isAdmin` (53, 103-109, 216) and on BE by the 403 at organizations.py:98-99.
  - With `?id=` the page renders `OrganizationDetailPanel` (see §5).
- **Inputs**

| field | control | req | FE validation | BE validation | notes |
|---|---|---|---|---|---|
| Search | text, 300 ms debounce (111-116) | no | none | ilike over name/type/parent/zone/division/address/country/state/city/pin/website/created_at/creator (organizations.py:62-75) | Placeholder says "name, type, zone, city, state…" (286). The BE also matches address, website and created_at cast. |
| Column filters Type/Zone/City/State/Created By | header `<select>` (301-317) | no | options are derived from the loaded rows (147-159) | none | client-side only |

- **Views**
  - Columns: Name + org_code, Type, Railway Zone, City, State, Created Date, Created By (161-169, 355-380).
  - Sort: Name and Created (127-138).
  - Pin-to-top is stored in localStorage (63-79).
  - Client-side pagination, `PAGE_SIZE = 16` (18, 197-198).
  - Count "N Organizations Found" (214).
  - Loading row (350), empty row "No organizations found." (351), load error via `ErrorRecoveryDialog` with the real reason (271-276).
  - No export and no print.
- **Findings**
  - P1-CRM-6 [BA] **Silent truncation at 200 organizations.**
    - The BE default `limit=200` (organizations.py:54-55) is never overridden by the FE (85-87).
    - The count (214), the pagination (391) and the filter option lists (147-159) all describe only the newest 200.
    - The same capped list feeds the org pickers in InquiryForm (InquiryForm.tsx:196) and TenderForm (TenderForm.tsx:124). **Organizations older than the newest 200 cannot be selected when creating an Inquiry/Tender**, and the Inquiries list shows "Not provided" as their org name (inquiries/page.tsx:92, 383).
  - P1-CRM-7 [USER] The duplicates report fetch swallows errors: `.catch(() => setDuplicateGroups([]))` (107). An admin cannot tell "no duplicates" from "report failed".
  - P1-CRM-8 [USER] The duplicate-groups modal is a hand-rolled overlay (231-269), not the shared dialog component. It says "merge/delete manually via each organization's detail page", but no merge function exists anywhere in CRM (dead end).
  - P1-CRM-9 [ARCH] `togglePin` calls `localStorage.setItem` outside try/catch (76). It throws in private or blocked-storage mode, while the read is wrapped (63-70).

---

### 3. `/dashboard/crm/organizations/new` — Add Organization (FE/app/dashboard/crm/organizations/new/page.tsx → FE/components/crm/OrganizationForm.tsx)

- **Access**
  - View: FE `useRequireApp('crm')` (new/page.tsx:10).
  - Act: BE `POST /crm/organizations` is open to any CRM user (organizations.py:148-193). Contacts go through `POST /{org_id}/contacts`, also any CRM user (organizations.py:347-362).
- **Inputs** (OrganizationForm.tsx; BE schema BE/schemas/organization.py)

| field | control | req | FE validation | BE validation | mismatch / notes |
|---|---|---|---|---|---|
| Organization Name | text (336-338) | Y | non-blank (211-214) | `name: str` (schema 78). Create checks for a case-insensitive clash → 409 (routes 154-158). | BE accepts whitespace-only names. **No clash check on update** (routes 228-264), so a rename can duplicate an existing name. No as-you-type check although `GET /search-name` exists (routes 136-145, FE api.ts:228 unused). |
| Organization Type | select + "Other" free text (341-349) | Y | required, Other needs text (215-222) | validator requires non-blank (schema 104-109) | Update schema has no org_type validator (schema 114). |
| Parent Organization | free text (352) | N | none | str | Free text, not a link to another org. |
| Railway Zone | select + Other (358-370), shown only for Railway/Govt Dept (constants.ts:34-35) | N | none | str | Switching type clears the zone to `''` (164-173), but `''` is stripped (273-275), so the **old zone persists on edit**. |
| Division / Workshop | text (372) | N | none | str | same clearing bug |
| Address | textarea (376) | N | none | Text | |
| Country | select + Other (379-386) | N | none | str, default India | |
| State / UT | **free text** (389) | N | none | str | `INDIA_STATES` exists (constants.ts:39-46) but is unused. The GST state code is not cross-checked. |
| City | text (392) | N | none | str | |
| PIN Code | text, maxLength 6 (395) | N | **none** (`isValidPinCode` exists at FE/lib/validation.ts:33-36 but is unused) | none (schema 87) | Non-numeric PINs can be saved. |
| Official Phone | PhoneField (403-405) | N | `isPhoneValid` (223-226) | **no format check** (schema 89) | Validated on FE only. |
| + Additional phones | PhoneField list (409-421) | N | valid when non-empty (239-242); dup highlight (145) | dedupe only, no format (schema 21-33) | |
| Official Email | email (424-437) | N | `isValidEmail` (235-238) | `validate_email_format` (schema 99); uniqueness 409 (routes 165-170, 248-254) | |
| + Additional emails | email list (439-457) | N | valid + dup (243-246) | format + dedupe (schema 6-18, 101) | |
| GST Number | text, uppercased, maxLength 15 (460-471) | N | GSTIN regex (227-230; FE/lib/validation.ts:12) | same regex (backend/app/core/validators.py:7, 19-25); uniqueness among live rows (routes 159-164, 241-247) | DB `unique=True` also covers soft-deleted rows (models/organization.py:30). See P1-CRM-12. **No PAN field exists** in the form or model. |
| Website | text (474-484) | N | `isValidWebsite` (231-234) | **none** (schema 93) | FE-only. |
| Contact rows: Name* / Designation / Department / Mobile / Email (+ additional mobiles/emails) | card list (490-576) | Name* | email (247-254), additional mobiles (255-258), cross-form duplicate highlight (145-150, 259-262) | `OrgContactCreate`: email format, additional email/mobile dedupe (schema 36-47). Primary mobile/email duplicates within the org → 409 (routes 33-47). | **Primary contact mobile is never format-checked** (neither FE nor BE). A row with mobile/email but no name is **silently skipped** (284). |

- **Views**
  - Breadcrumb + title + standard Back (322-330).
  - Single-tab bar constant `TABS=['Information Details']` (75), which never renders tabs. This is dead UI state.
  - Success and error are shown through `MessageDialog` with real BE messages (300-301, 315-321).
- **Findings**
  - P1-CRM-10 [BA] **Save is non-atomic.**
    - The org is POSTed first (276). Contacts are then deleted, updated or created one call at a time (279-297).
    - If any contact call fails (for example a 409 duplicate mobile), the dialog says "Failed to Save" (301), but the org already exists.
    - Pressing Save again POSTs the org again and gets 409 "An organization with this name already exists" (routes 154-158). The user is stuck and cannot see that the org was actually created.
  - P1-CRM-11 [USER] **Edits cannot clear fields.** `''` keys are deleted (273-275) and the BE uses `exclude_unset` (routes 256-259), so cleared Website/Address/GST/Zone values reappear.
  - P1-CRM-12 [ARCH] **Wrong or crashing message on GST reuse.**
    - `gst_number` is DB-unique including soft-deleted orgs (models/organization.py:30), but the pre-checks filter `is_deleted == False` (routes 159-164, 241-247).
    - Create maps the IntegrityError to "An organization with this name already exists" (routes 176-178), which is the wrong reason.
    - Update has no IntegrityError handler (routes 256-264), so it returns a 500.
  - P1-CRM-13 [USER] Contact list load has no catch (155-158). On failure `contactsLoading` stays true, the Save button stays disabled forever (583), and no reason is shown.
  - P1-CRM-14 [USER] Validation messages are vague and don't say what is wrong. "Please enter a valid phone number before saving." (224) does not say which of 3+ phone fields. "Please enter a valid email for each contact" (248, 252) does not name the contact.

---

### 4. `/dashboard/crm/organizations/[id]/edit` — Edit Organization (FE/app/dashboard/crm/organizations/[id]/edit/page.tsx)

- **Access**
  - FE `useRequireApp('crm')` only (12). **There is no FE `_can_modify` check.** Any CRM user can open and fill the form.
  - BE PATCH returns 403 "Only the creator or an admin can edit this organization." (organizations.py:238-239). Contact PATCH/DELETE return 403 (routes 376-377, 396-397).
- **Inputs**: same as §3 (OrganizationForm with `initial`).
- **Views**
  - `if (!org) return null` (39): a blank page while loading, with no Loading state.
  - Error state: a red box with CrmNav only, no Back (28-36).
- **Findings**
  - P1-CRM-15 [USER] A non-creator can open `/edit` by URL, spend time editing, and only learn at Save that they lack rights. Some contact calls may also have partly run before the 403 (non-atomic, P1-CRM-10).
  - P1-CRM-16 [USER] Load error is generic: `.catch(() => setError('Failed to load organization.'))` (22) discards the BE reason (404 vs 403 vs network). There is no Back link or retry.

---

### 5. `/dashboard/crm/organizations/[id]` and `/organizations?id=` — Organization detail (FE/components/crm/OrganizationDetailPanel.tsx)

- **Access**
  - View: crm app. BE `GET /{id}/detail` (organizations.py:208-225).
  - Edit/Delete buttons require `canModify` (59, 86-87). BE: delete 403 (279-280). The delete cascades to inquiries, tenders, follow-ups and docs (services/cascade.py:43-79).
  - Contacts tab add/edit is gated by `canModify` (256, 335). BE contact create has **no** ownership check (routes 347-362); update/delete use the contact's own creator (376, 396).
  - The "+ Add Inquiry" / "+ Add Tender" buttons are gated by the **org's** creator (408, 474). BE create_inquiry/create_tender have **no** org ownership check (inquiries.py:113-125, tenders.py:117-130).
- **Inputs**

| form | field | control | req | FE validation | BE validation | notes |
|---|---|---|---|---|---|---|
| Contact add/edit (260-283) | Name | text | Y | non-blank (233) | `name: str` | Same-name contact → ConfirmDialog (247-250, 368-374). Its message says "same name, mobile, or email" (371), but it is only reached for a name match. |
| | Mobile | **plain `<input>`** (265-269) | N | dup-against-org only (209); **no phone format** | none | Differs from OrganizationForm's PhoneField. |
| | Email | plain input (273-277) | N | `isValidEmail` (234-237), dup (210) | format (schema 45) + dup 409 (routes 43-46) | |
| | Designation / Department | text | N | none | str | Additional mobiles/emails are not editable here. |

- **Views**
  - Header: type · org_code, name, and Back/Edit/Delete top-right (77-89).
  - Pill tabs with counts: Overview, Contacts, Inquiries, Tenders, Audit Trail (17, 91-124).
  - Overview cards (144-171).
  - Contacts list with linked inquiry/tender chips (288-366).
  - Inquiries table: ID, Product, Contact, Status (grey pill), Priority, Follow-up (436-451).
  - Tenders table: ID, Tender No., Name, Status, Submission (502-521).
  - Audit list (532-553).
  - Loading "Loading…" (71, 404, 470, 537). Empty states at 289, 429, 495 and 538.
  - No pagination, export or print.
- **Findings**
  - P1-CRM-17 [USER] **Failed loads look like empty data.**
    - Inquiries (401), Tenders (467) and Audit (535) use `.then(...).finally(...)` with no catch. A failure renders "No inquiries for this organization." / "No audit history yet."
    - Contacts-tab chip loads also swallow errors (188-189).
  - P1-CRM-18 [USER] Generic dialog title "Something Went Wrong" (139). Load failure renders a bare red `<p>` with no Back (72).
  - P1-CRM-19 [SEC/BA] Inconsistent ownership rules.
    - The FE hides "+ Add Inquiry/Tender/Contact" from non-creators of the org.
    - The same user can create them from `/inquiries/new`, or from the inline "+ Add New Contact" in the Inquiry/Tender/Activity forms, because the BE has no such rule (organizations.py:347-362, inquiries.py:113-125).
    - Decide one rule and enforce it on the BE.
  - P1-CRM-20 [USER] Dates are shown raw ISO: `next_followup_date` (449), `submission_date` (520).
  - P1-CRM-21 [USER] Contacts can't be deleted from the detail page. Deletion is only possible via Edit Org → "Remove" (OrganizationForm.tsx:566-568), which **hard-deletes** (organizations.py:398).

---

### 6. `/dashboard/crm/inquiries` — Inquiries & Tenders combined list + in-page detail (FE/app/dashboard/crm/inquiries/page.tsx)

- **Access**: FE crm app (50). BE list endpoints for inquiries (inquiries.py:70-110), tenders (tenders.py:76-115) and orgs are all crm-only. `?id=&type=` renders InquiryDetailPanel/TenderDetailPanel (437-446).
- **Inputs**

| field | control | FE | BE | notes |
|---|---|---|---|---|
| Search | text, 300 ms debounce (110-116, 268-278) | none | inquiries: ilike over id/product/bd_owner/sales_engineer/zone/division/lead_source/status/stage/category/location/desc/followup_assigned_to/priority/org name (inquiries.py:85-98). Tenders search at tenders.py:92-100. | Placeholder "ID, organization, product, owner, zone, stage…" (273). |
| Type filter Inquiry/Tender | header select (297-310) | client | – | |
| Stage / Created By filter | header select (312-327) | client, options from loaded rows (167-178) | – | |

- **Views**
  - Columns: Type badge, ID (+pin), Organization, Product (tender → `tender_category`), Stage (plain text), Value/Priority (mixed), Created Date, Created By (198-207, 366-389).
  - **No Status column.**
  - Sort: ID and Created (185-196).
  - Client pagination with 16 per page (17, 234-235).
  - Loading (361), empty (362).
  - Error dialog with a "Reload" action that does `window.location.reload()` (255-264). That is a page reload, not a browser dialog.
- **Findings**
  - P1-CRM-22 [USER] **Generic swallowed error.** `catch { setError('Failed to load inquiries & tenders.') }` (98-99) discards the BE/network reason and gives no fix. `extractErrorMessages` is used elsewhere but not here.
  - P1-CRM-23 [BA] **Truncation.** Inquiries and tenders are each capped at 200 (inquiries.py:76, tenders.py:82), and the org name map is capped at 200 (92). The combined "N Records Found" (251) is wrong past 200 each, and org names become "Not provided".
  - P1-CRM-24 [USER] Status (the field users edit on the detail page) is not listed or filterable, and `inquiryStatusColor`/`tenderStatusColor` badges are unused here. "Value / Priority" mixes a currency value (tender) and a priority (inquiry) in one column (157, 141, 204).

---

### 7. `/dashboard/crm/inquiries/new` — New Record (Inquiry | Tender toggle) (FE/app/dashboard/crm/inquiries/new/page.tsx)

- **Access**
  - FE crm app (15).
  - BE `POST /crm/inquiries` (inquiries.py:113-157) and `POST /crm/tenders` (tenders.py:117-166) are open to any CRM user. They check the org exists and that the contact belongs to the org (inquiries.py:119-125, tenders.py:122-129).
- **Views**: breadcrumb, title "New Record", standard Back (26-36), segmented Inquiry/Tender toggle (38-60). The toggle loses entered form data when switched (it remounts the form, 63-81).
- **Inputs, Inquiry form** (FE/components/crm/InquiryForm.tsx; BE BE/schemas/inquiry.py:18-48)

| field | control | req | FE validation | BE validation | mismatch / notes |
|---|---|---|---|---|---|
| Inquiry Number | disabled, "preview" (346-352) | – | – | server `next_sequential_id` (inquiries.py:57-59) | The preview is `count(all inquiries in first 200)+1` (221-231). It **will not match** the real ID (the date prefix is per-day, the count is global and capped at 200). |
| Inquiry Date | disabled (355-361) | – | – | server `created_at` | |
| Lead Source | select LEAD_SOURCES (364-369) | Y | required (275-278) | `lead_source: str` required (schema 23), no enum | |
| Priority | select (372-376) | Y | required (279-282) | str, default Medium, no enum | |
| Status | select INQUIRY_STATUSES (379-383) | Y | required (283-286) | str, no enum (schema 26) | "Closed - Ordered" can be chosen at creation. |
| BD Owner | admin: SearchableSelect of `u.name` (386-393); others: disabled own name (394-396) | N | none | `bd_owner: str` (schema 24) | **Free-text name.** Non-admins are "locked" only in the UI; the BE accepts any string. The directory load error is swallowed (85). |
| Current Status | textarea (400-402) | N | none | str | |
| Client Company | SearchableSelect orgs (407-415) | Y | required (271-274) | `org_id: int` required; existence (inquiries.py:119-121) | Options capped at 200 (P1-CRM-6). |
| Contact Person | select + "+ Add New Contact" (416-422) | Y | required, must save the new contact first (291-294) | `org_contact_id: int` required (schema 20), belongs-to-org (122-125) | Tender contact is optional. See P1-CRM-35. |
| New contact Name/Designation/Mobile(+)/Email(+) | inline card (433-475) | Name | name, email, phone, additional phones/emails (152-168) | OrgContactCreate (org schema 36-47) | Same-name match silently **links to the existing contact** (145-148, 173-174), discarding the typed mobile/email. |
| Category | ComboBox with create-new (489-499) | N | none | str | Typing a new value **creates a global catalog row** (205-211) without confirm, with no try/catch. |
| Product | ComboBox with create-new (502-515) | Y | non-blank (287-290), dup combo (300-303) | **optional** (schema 29) | FE/BE mismatch. |
| Quantity | number (518) | N | **no min**; negatives are accepted | `float | None`, no bound (schema 32) | |
| Required Delivery Date | DateField (521) | N | no past-date check | date | |
| Delivery Location / Inspection / Warranty | text (524-531) | N | none | str | |
| Product Specification | textarea (533) | N | none | str | |
| Additional products | rows (535-579) | – | product required per filled row (295-299) | list, full-replace on update (inquiries.py:199-202) | **No "+ Add product" button is rendered.** `emptyExtraProduct` (104) is never used, so new inquiries cannot have additional lines. Only bulk-import rows can create them. |
| Requirement Description / Project Details | textarea (581-582) | N | none | str | |
| (hidden) railway_zone / division | not rendered; copied from the org (245-246) | – | – | str | The user cannot see or correct them. |

- **Inputs, Tender form** (FE/components/crm/TenderForm.tsx; BE BE/schemas/tender.py:5-40)

| field | control | req | FE | BE | notes |
|---|---|---|---|---|---|
| Internal Tender ID | preview (243-246) | – | count-based preview (126-136) | server | Same wrong-preview issue as the inquiry. |
| Lead Source | select (258-263) | Y | required (178-181) | required str | |
| Priority | select (266-270) | Y | required (182-185) | str | |
| BD Owner | disabled own name, **even for admin** (273-275) | – | – | str | Inconsistent with the Inquiry admin picker. |
| Organization | SearchableSelect (299-307) | Y | required (162-165) | org_id required | capped list |
| Contact Person | select + new (308-328) | **N** | new-contact name (186-189); **email/mobile not validated before submit** (ValidatedInput only styles, 325) | optional (schema 7) | Same-name silent re-use (195-198). |
| Tender Number | text (334) | Y | required (166-169) | **optional** (schema 8). Uniqueness is scoped to `railway_zone`+`division` (tenders.py:131-139) and runs on create only. | The 409 message mentions zone/division, which the form never shows. |
| Tender Name | text (337) | Y | required (170-173) | optional | mismatch |
| Authority / Category | text (340, 362) | N | none | str | |
| Portal | select + Other (343-351) | N | none | str | |
| Type | select (354-359) | N | none | str | |
| Tender Value | number (365) | N | no min | float, no bound | |
| Currency | select INR/USD/EUR (368-372) | N | – | str default INR | |
| Status | select TENDER_STATUSES (375-379) | N | default "Requirement Received" (67) | default **"Active"** (schema 16), no enum | "Active" is not in the FE list, yet the dashboard deep-link uses it. |
| Current Status | textarea (383-385) | N | – | str | |
| 8 milestone dates | DateField (389-414) | Submission* | submission required (174-177); **no ordering check** (publish ≤ submission ≤ opening…) | date | |
| (never rendered) participate, decision_by/date, reason_no_participate, awarded_to, loi_number, contract_value, loss_reason, workshop | form state only (45-52) | – | – | schema 33-40 | **Dead fields.** They cannot be entered or viewed in the UI (the TenderDetailPanel InfoTab doesn't show them either). |

- **Findings**
  - P1-CRM-25 [BA] **Additional products feature is unreachable in the UI.** There is no add-row control (InquiryForm.tsx:104 unused; 535-579 render only existing rows).
  - P1-CRM-26 [ARCH/SEC] **BD Owner is a free-text name** (InquiryForm.tsx:78, 313, 391; TenderForm.tsx:107, 214).
    - The BE trusts whatever string it receives (schema inquiry.py:24, tender.py:21), so a non-admin can set any owner via the API.
    - A user rename orphans ownership.
    - `sales_engineer` and `followup_assigned_to` are likewise strings, and they are never exposed in the UI.
  - P1-CRM-27 [USER] **The "possible duplicate" warning for tenders is always wrong.** It treats tenders as open unless their status is `Won/Lost/Cancelled` (InquiryForm.tsx:255), but none of those values exist in `TENDER_STATUSES` (constants.ts:96-108). Every tender counts as "open".
  - P1-CRM-28 [USER] Catalog creation from the form (`createCategory`/`createProduct`) has no try/catch (InquiryForm.tsx:205-219), and ComboBox fires `onCreateNew` without awaiting (ui.tsx:316-317, 375). A failure is an unhandled rejection with no message.
  - P1-CRM-29 [USER] Base data loads have no catch: `listOrganizations().then(setOrganizations)` (InquiryForm.tsx:196; TenderForm.tsx:124), `listOrgContacts` (InquiryForm.tsx:240; TenderForm.tsx:144). On failure the pickers are just empty.
  - P1-CRM-30 [BA] The FE requires fields the BE doesn't (product, tender number, tender name) and not vice versa. No enum validation exists on the BE for status/priority/stage/lead_source/currency (schemas inquiry.py:18-81, tender.py:5-40), so API or bulk data can hold arbitrary values that the FE selects can't display.

---

### 8. `/dashboard/crm/inquiries/[id]` and `/inquiries?id=&type=inquiry` — Inquiry detail (FE/components/crm/InquiryDetailPanel.tsx)

- **Access**
  - View: crm app.
  - Edit, Delete, stage click, and status/priority inline selects require `canModify` (73, 185-196, 217-218, 363-378). BE PATCH/DELETE return 403 (inquiries.py:182-183, 234-235).
  - **"Send Technical Offer Request" is shown to everyone** (202-216). The BE has no ownership check (inquiries.py:281-291).
  - Quotation create/revise/customer-response require the FE `canModify` of the **inquiry** (702, 885, 959). BE create has **no ownership check** (workflow.py:54-58). BE revise checks the **quotation's** creator (workflow.py:88-89).
  - Documents: upload requires `canModify` (1177). Delete is shown only to **admins** (1099-1100, 1172). The BE allows uploader-or-admin (documents.py:184-185), and BE upload has **no** permission check on the parent record (documents.py:47-61).
  - Follow-ups: Add, Edit, Change Status and Export are shown to everyone (1245-1247, 1320-1325). Delete is shown to creator/admin (1326). BE edit/delete/photos are creator/admin (activities.py:174-175, 194-195, 271-272, 301-302).
- **Header / stage**
  - Universal id · date · status · priority · stage (157-167).
  - `StageProgress` with click-to-jump to **any** stage (ui.tsx:211-221), confirmed via ConfirmDialog (292-300), which PATCHes `current_stage` (298).
- **Tabs**: Info, Quotations, Documents, Follow Ups, Timeline (22). The Info tab has a revision selector (251-253).

#### 8a. Info tab (305-415)
- Views: Current Status, Organization + Contact, Lead Info (inline Status/Priority selects for modifiers), Product Requirement with revision diff highlight (SpecInfoRow), Additional Products. The revision summary uses `dangerouslySetInnerHTML` with `escapeHtml` applied (323, 1412-1430), which is OK.

#### 8b. Quotations tab (440-971) — create form, list, revise

| field | control | req | FE validation (validate() 613-645) | BE (BE/schemas/workflow.py; routes/workflow.py) | mismatch / notes |
|---|---|---|---|---|---|
| Quotation Type | select Domestic/Export (716-722) | Y | required | str default Domestic, no enum (schema L31) | |
| GST Type | select (723-730) | – | – | str, no enum | |
| Date of Quote | DateField (731-734) | Y | required (617) | optional date (schema L33) | |
| Technical Offer No./Date | text/date (735-736), prefilled from the inquiry (448-449) | N | none | str/date | |
| Customer/Client | text (740-743), prefilled org name | Y | non-blank (615) | **optional** (schema L36) | mismatch |
| Contact Name/Email/Phone | text (744-746) | N | **none**. Email and phone are unvalidated. | none (schema L37-39) | |
| Line items: Item (ComboBox, create-new product), Model No., Qty, Price/unit, GST % | grid (749-787) | ≥1 row | per filled row: name, qty>0, price>0, GST% required if domestic (621-632); dup name+model (487-495) | **no bounds** (schema L7-14). The server recomputes subtotal/total (workflow.py:69-75), which is good. | The BE accepts qty ≤ 0, negative price, and GST 500%. |
| Delivery Time | text (799-802) | Y | regex needs a unit (422, 634-635) | str, no check | Revise path skips the regex (1060). |
| Quote Validity Date | DateField (803-806) | Y | required (637); **not compared with the quote date** | date | |
| Discount + %/flat | number + select (807-815) | N | **no bounds** | float + free str (schema L46-47) | 150% gives a negative grand total. |
| Quote Conditions | select + custom textarea (816-828) | Y | required (639-640) | str | |
| Payment Terms | ComboBox with create-new (829-840) | Y | required (642) | str (free text copy) | Typing a new value creates a global PaymentTerm (526-532) with no try/catch. |
| Notes | textarea (841) | N | – | str | |

- **List (849-967):** quot number · type, revision selector, client · delivery · customer-response select, validity/submitted dates (raw ISO, 895), discount, conditions, contact, item table with Grand Total, payment and notes, then "Download PDF" (956-958) and "Revise" (959-963).
- **Revise form (979-1070):** unit prices, payment terms, validity and delivery time only. The BE bumps `-rN` (workflow.py:112-115).
- **PDF:** `GET …/quotations/{id}/pdf` (workflow.py:153-201) via reports/quotation_pdf.py. Download errors show the real reason (557-558, 968).

#### 8c. Documents tab (1081-1188)
- Two panels, Client and Internal. Each has a category select (DOC_CATEGORIES, default "Other", 1119) and a multi-file input (1183) with an uploading overlay (1142-1148).
- Clicking a file opens a blob in a new tab (1157-1169). Empty state "None" (1151).
- FE has no type or size restriction (1183). BE applies an extension/MIME allowlist + magic bytes + 2 GB limit (backend/app/utils/sharepoint.py:28-58, 107-177).

#### 8d. Follow Ups tab (1190-1345) — see ActivityForm (§10) for inputs
- List shows type · assigned_to (tooltip labelled **"Contact Person"**, 1281) · created time, contact details, MoM items or remarks/due/action plan, and photos.
- Buttons: View, Edit, Change Status, Export MoM (docx), Delete.
- "Export Meeting MOM" opens MomExportDialog (§11). Empty state "No follow-ups logged." (1275).

#### 8e. Timeline tab (1460-1549)
- Merges audit (created/deleted), spec revisions, stage logs, follow-ups and quotations, sorted by date. Loading and empty states at 1526-1527.

- **Findings**
  - P1-CRM-31 [ARCH/BA] **Three contradictory inquiry stage lists.**
    - FE `INQ_STAGES` = Requirement Received…Closed – Not Ordered (constants.ts:77-84).
    - BE `INQ_STAGES` = "Customer Requirement, Design, R&D, Costing, … Service" (inquiries.py:33-37).
    - Separately, `INQUIRY_STATUSES` (constants.ts:57-64) uses "Closed - Ordered" with a hyphen, while the stages use an en-dash "Closed – Not Ordered".
    - The FE moves stages through the unvalidated PATCH (298 → inquiries.py:185-195). The validated `POST /{id}/stages` (inquiries.py:420-443) would reject every FE stage and is unused (FE/lib/api.ts:315).
    - Tenders have the same split: FE 7 stages (constants.ts:86-94) vs BE 12 (tenders.py:34-38).
    - Users also maintain Status *and* Stage as two overlapping progressions.
  - P1-CRM-32 [SEC/BA] **Any CRM user can email R&D a Technical Offer Request for any inquiry.** The button is unconditionally visible (202-216) and the BE does no `_can_modify` (inquiries.py:288-291). The "missing requirement details" guard is FE-only (121-133) and the tender panel lacks it entirely (TenderDetailPanel.tsx:174). On email failure the BE still commits an orphan TOR document (inquiries.py:366-368), so each retry adds another.
  - P1-CRM-33 [USER] **Quotation Save has no in-flight guard.** The button is not disabled and has no saving state (843; `save` at 654-695). A double-click creates two quotations with consecutive numbers.
  - P1-CRM-34 [BA] **Grand Total differs between list and PDF.** The list sums item totals and ignores discount (933-936). The create form (791-795) and the PDF (reports/quotation_pdf.py:411-414) subtract the discount. The list also has no currency symbol.
  - P1-CRM-35 [BA] **Customer Response has a duplicate "Awaiting" option.**
    - The select renders `<option value="">— Awaiting —</option>` plus `CUSTOMER_RESPONSES`, which itself starts with the literal `'— Awaiting —'` (888-892; constants.ts:132).
    - The BE default is the literal `"— Awaiting —"` (schemas/workflow.py:45). Two options look identical and store different values.
    - The change handler has no try/catch (477-480), so a 403 (quotation created by someone else, workflow.py:88-89) fails silently.
  - P1-CRM-36 [USER] **Silent failures in this panel:**
    - Product and Payment-Term creation from the quote form have no try/catch (508-532). `productError` is declared but never set (460, 712).
    - `listQuotations` has no catch (468).
    - Document delete has no catch (1088-1091).
    - Follow-up Change Status (1234) and Delete (1236-1241) have no catch.
    - Timeline `Promise.all` has no catch (1464-1523), so it shows "Loading…" forever.
    - Org/contact loads swallow errors (52, 56), so the Organization card shows "Not provided".
  - P1-CRM-37 [USER] **Follow-up Edit and Change Status are offered to everyone**, but the BE is creator/admin only (activities.py:174-175). A non-creator's Change Status silently does nothing (P1-CRM-36). Edit opens the form and fails only at save.
  - P1-CRM-38 [USER] **Document Delete is immediate, with no ConfirmDialog** (1172 → 1088-1091). It also removes the SharePoint file; the BE ignores SharePoint delete failure (documents.py:187-191). Only admins see the button, although the BE also lets the uploader delete (documents.py:184).
  - P1-CRM-39 [USER] **Wrong dialog titles.**
    - The MoM export failure is titled "Cannot Save Follow Up" (1249); the tender panel correctly says "Cannot Export MoM" (TenderDetailPanel.tsx:518).
    - "Upload Failed" is reused for "Unable to open document" (1098, 1165).
    - "Something Went Wrong" is the title for update/delete errors (182).
  - P1-CRM-40 [USER] **Upload type rules are invisible until failure.** There is no `accept` or size hint (1183). The BE message "File type not allowed for X" (utils/sharepoint.py:148) does not list the allowed types. In a multi-file upload, a mid-loop failure leaves the earlier files in SharePoint with no DB rows (documents.py:77-99).
  - P1-CRM-41 [USER] Back is placed in the stage row, not the header row, and is hidden while editing (199-201 vs header 155-179). This deviates from the standard.
  - P1-CRM-42 [BA] A quotation cannot be deleted in the UI. BE admin-only hard delete exists (workflow.py:204-213; FE/lib/api.ts:454 unused).

---

### 9. `/dashboard/crm/tenders`, `/tenders/new`, `/tenders/[id]` — Tender redirect stubs + Tender detail (FE/app/dashboard/crm/tenders/*.tsx, FE/components/crm/TenderDetailPanel.tsx)

- **Access**
  - `tenders/page.tsx` and `tenders/new/page.tsx` have **no auth gate**. They only redirect (tenders/page.tsx:6-16, new/page.tsx:6-14), and the target page gates.
  - `tenders/[id]` gates on crm (tenders/[id]/page.tsx:9).
  - Detail permissions mirror the inquiry panel: `canModify` (71) for Edit, Delete and stage; the status inline select (284-289); Docs upload (445); Docs delete admin-only (367-368, 440). TOR is shown to all (173-181).
- **Views**
  - Header: universal id + coloured status badge (136-140), title.
  - Tabs: Info (Tender Details / Organization / Contact cards, 270-314), Dates table (316-347, raw ISO dates at 340), Documents, Follow Ups, Timeline.
  - No quotations for tenders.
- **Findings**
  - P1-CRM-43 [BA] The redirect stub forwards only `id` (tenders/page.tsx:11-12). Every other query param is lost (`status=Active` from the dashboard, P1-CRM-2).
  - P1-CRM-44 [BA] **Tender decision/award/loss data is captured nowhere.** participate, decision_by/date, reason_no_participate, awarded_to, loi_number, contract_value and loss_reason exist in the schema (schemas/tender.py:33-40) and in TenderForm state (TenderForm.tsx:45-52), but they are never rendered in the form or the InfoTab. The final "Awarded / Lost" stage therefore has no data behind it.
  - P1-CRM-45 [USER] The upload error is shown twice: a MessageDialog (366) plus an inline red paragraph (454).
  - P1-CRM-46 [USER] The Timeline `Promise.all` has no catch (705-751), so it shows "Loading…" forever. Change Status/Delete follow-up have no catch (503, 505-510). Back is misplaced (170-172), as in P1-CRM-41.

---

### 10. Follow-up form (Activity / MoM) — used in Inquiry & Tender "Follow Ups" tabs (FE/components/crm/ActivityForm.tsx)

- **Access**: see §8 access. BE create is open to any CRM user and doesn't check the parent record (activities.py:149-161). Update, photos and delete are creator/admin.
- **Inputs** (BE BE/schemas/activity.py:34-63)

| field | control | req | FE validation | BE validation | notes |
|---|---|---|---|---|---|
| Subject | text (230-232) | N | none | str | |
| Contact Person(s) | multi-select dropdown + inline "+ Add New Contact" (234-316) | N | new contact: name + mobile required in `saveNewContact` (87-94). In the submit path only the name is required (157-160). | `contact_ids: list[int]`, not verified against the org | Same-name silent re-use (98-100, 166-169). Phone format is never validated (`isPhoneValid` is not imported). |
| Activity Type | select (319-323) | – | default first value | str, no enum | |
| Next Follow-up Date | DateField (326) | N | no past/min check | date | |
| Status | select Open/Closed/Hold (329-333) | – | – | str default Open, no enum | |
| Attachment (photos) | camera + file `accept="image/*"` (337-360) | N | image accept only; no size limit | image/* content-type (activities.py:199-201) + SharePoint allowlist | Partial failures are silently dropped when ≥1 succeeds (activities.py:210-229). |
| Observation / Remarks | RichTextEditor (363-365) | N | none | str (HTML) | |
| Action Plan | RichTextEditor (366-368) | N | none | str | |
| (not rendered) activity_date | defaults to today (38) | – | – | date | It can never be back-dated for a past call or meeting. |
| (not rendered) assigned_to | defaults to `user.name` (40, 139-144) | – | – | str(150) | **Free-text owner, set to the creator's name.** It is displayed as "Assigned To" (followups/page.tsx:130) and as the tooltip "Contact Person" (InquiryDetailPanel.tsx:1281, TenderDetailPanel.tsx:551). |
| (not rendered) mom_items | – | – | – | list[MomItem] (schema 25-31, 49) | Displayed in lists (InquiryDetailPanel.tsx:1294-1304) but not editable anywhere in the UI. |

- **Findings**
  - P1-CRM-47 [BA] **A completely empty follow-up can be saved.** It needs no subject, remarks, type, date or contact (handleSubmit 151-201; BE all optional). It then counts in the dashboard "Open Follow-ups".
  - P1-CRM-48 [USER] **Mislabelled owner.** `assigned_to` silently equals the creator's name and cannot be changed, yet the UI labels it "Contact Person" in one place and "Assigned To" in another.
  - P1-CRM-49 [BA] **Save + photo upload is non-atomic.** The panel creates the activity, then uploads photos (InquiryDetailPanel.tsx:1264-1271; TenderDetailPanel.tsx:533-540). A photo failure shows "Cannot Save" (224), yet the activity exists; a retry creates a duplicate.
  - P1-CRM-50 [USER] `deleteExistingPhoto` is try/finally with no catch (211-220). `listOrgContacts` has no catch (123).

---

### 11. Export Meeting MOM dialog (FE/components/crm/MomExportDialog.tsx) and per-activity "Export MoM"

- **Access**
  - Any CRM user. BE: inquiry routes at inquiries.py:498-540, tender routes at tenders.py:487-527, per-activity route at activities.py:309+.
  - The BE does not check that `client_contact_ids` belong to the org (inquiries.py:463-466).
- **Inputs**
  - Subject: text (122-124), required by FE (84) but **not marked "*"**; BE `subject: str` (activity.py:99).
  - Meeting Date: **native `<input type="date">`** (126), unlike the DateField used everywhere else in CRM.
  - PEW Attendees (directory chips). The directory error is swallowed into "No users found." (73, 133).
  - Client Attendees chips, and Follow-ups to include (checkboxes, all preselected, 70).
- **Views**: Word/PDF buttons with exporting state (160-167). Errors show the real reason (105-106).
- **Findings**
  - P1-CRM-51 [USER] Required-field marking is missing, and the date control is non-standard (122, 126). A directory load failure looks like "No users found." (73).

---

### 12. Technical Offer Request picker (FE/components/crm/TechnicalOfferPickerDialog.tsx)

- **Inputs**: optional checkbox selection of Client docs (62-71).
- **Findings**
  - P1-CRM-52 [USER] A document load failure is swallowed into "No client documents uploaded yet." (33, 59-60). The buttons are custom-styled instead of primary/secondaryBtnStyle (75-90).

---

### 13. `/dashboard/crm/followups` — Follow-ups list (FE/app/dashboard/crm/followups/page.tsx)

- **Access**: FE crm app (34). BE `GET /crm/activities` is crm-only (activities.py:102-146).
- **Inputs**: bucket tabs Open/Overdue/Today, pushed to the URL (79-100).
- **Views**
  - Columns: Type, Related (link), Organization, Due Date, Assigned To, Remarks (stripped HTML), Status badge (112-138). Sorted by due date client-side (56-59).
  - No search, no pagination, no export. Loading and empty rows (120-121). Error box (102-106).
  - Standard Back → `/dashboard/crm` (76).
- **Findings**
  - P1-CRM-53 [USER] **Dead-end navigation.** There is no CrmNav tab for Follow-ups (CrmNav.tsx:11-15). The page is reachable only from dashboard cards and the notification bell (FE/components/erp/NotificationBell.tsx:15).
  - P1-CRM-54 [USER] Generic error `'Failed to load follow-ups.'` (52) drops the reason.
  - P1-CRM-55 [BA] Capped at 200 rows (activities.py:112) with no indication. Organization-level follow-ups are not clickable (123), so they are a dead end. The Today bucket includes Closed/Hold items (P1-CRM-3).

---

### 14. `/dashboard/crm/products` — Product List (FE/app/dashboard/crm/products/page.tsx)

- **Access**: FE crm app (25). BE list/create are open to any CRM user (products.py:19-56). Edit/delete are creator/admin (69-70, 87-88).
- **Inputs**

| field | control | req | FE | BE | notes |
|---|---|---|---|---|---|
| Name | text `required` (107-110) | Y | HTML required | `name: str`, empty allowed; clash `ilike(name)` + model (products.py:40-46) | `ilike` with raw input treats `%`/`_` as wildcards, so it can report false duplicates. **No clash check on update** (59-75). |
| Model Number | text (111-114) | N | – | str | |
| Category | **free text** (115-118) | N | – | str | Not linked to the Product Category master. |
| Unit | free text (119-122) | N | – | str | |
| Default Price | number (123-126) | N | no min | float, no bound (schemas/product.py:10) | |
| Description | textarea (127-130) | N | – | str | |

- **Views**: table with Name, Model No., Category, Unit, Default Price, Edit/Delete (139-167). No search (the BE supports it, products.py:21-30), no pagination. Loading and empty rows (148-151).
- **Findings**
  - P1-CRM-56 [USER] **Dead-end screen.** No nav link or in-app link to `/dashboard/crm/products`, `/product-categories` or `/payment-terms` exists anywhere in `frontend/src` (CrmNav.tsx:11-19; only the API calls reference them). These screens are reachable only by typing the URL.
  - P1-CRM-57 [USER] **Delete without confirmation** on Products (162), Product Categories (product-categories/page.tsx:127) and Payment Terms (payment-terms/page.tsx:133).
  - P1-CRM-58 [USER] Edit/Delete are shown to every user on all three master pages, but the BE is creator/admin only (products.py:69-70, 87-88; product_categories.py:57-58, 85-86; payment_terms.py:49-50, 67-68). Non-creators discover the 403 only on click.
  - P1-CRM-59 [USER] Generic load errors on all three pages: 'Failed to load products.' (products/page.tsx:37), 'Failed to load product categories.' (product-categories/page.tsx:32), 'Failed to load payment terms.' (payment-terms/page.tsx:33).

### 15. `/dashboard/crm/product-categories` — Product Category List (FE/app/dashboard/crm/product-categories/page.tsx)

- **Access**: as §14 (product_categories.py:18-90).
- **Inputs**: Name text `required` (98-101). BE create silently returns the existing row on a case-insensitive match (product_categories.py:32-37). Update checks duplicates → 400 (62-67).
- **Views**: Name + Edit/Delete (108-133). Loading and empty rows (117-120).
- **Findings**
  - P1-CRM-60 [USER] "Add" with an existing name reports success and silently does nothing. Delete does not check usage: category names are copied as strings into products and inquiries, so deleting leaves orphan text. Also see P1-CRM-56 to 59.

### 16. `/dashboard/crm/payment-terms` — Payment Terms List (FE/app/dashboard/crm/payment-terms/page.tsx)

- **Access**: as §14 (payment_terms.py:18-72).
- **Inputs**: Label text `required` (99-102); BE `label: str`, empty allowed via API, **no duplicate check** (payment_terms.py:26-36). Description/Terms Text textarea (103-106).
- **Views**: Label, Description, Edit/Delete (113-138).
- **Findings**
  - P1-CRM-61 [BA] Duplicate payment terms accumulate. Every "New Payment Term" typed in the quotation form creates one (InquiryDetailPanel.tsx:526-532) with no de-dupe on FE or BE. See also P1-CRM-56 to 59.

---

### 17. `/dashboard/crm/bulk-import` — Bulk Import (admin) (FE/app/dashboard/crm/bulk-import/page.tsx; BE/routes/bulk_import.py)

- **Access**
  - The nav tab is admin-only (CrmNav.tsx:17-19, 42). The page renders "Bulk import is restricted to admins." for non-admins (35-42). BE `_require_admin` (bulk_import.py:71-73, 214).
  - The template download is **not** admin-gated (bulk_import.py:191-192), which is harmless.
- **Inputs**: "Download CSV Template" (95), file input `accept=".csv,text/csv"` (96-103), Import button (104-106).
- **BE file and row validation**
  - The file is read fully into memory, with no size or row cap (215).
  - UTF-8 decode error → 422 with a fix hint (76-80). No header → 422 (82-83). No rows → 422 (216-217).
  - Per row: `org_name` required (276-277); `org_type` required when the org is new (281-282); GST format + uniqueness (285-287, 328-330); official email format + uniqueness (288-290, 331-333); `contact_name` required on a new mobile (375); contact email format + per-org uniqueness (376-378, 395-399).
  - **Not validated:** phones, PIN, website, priority/lead_source/status against the FE lists, and `bd_owner` (free text, 427).
  - Each row runs in a SAVEPOINT with in-memory undo (263-274, 584-602).
  - Errors are capped at 300 (68, 616, 629).
- **Views**: result counters (113-121) and an errors table with Row / Reason skipped (123-146), plus "+N more error(s) not shown" (141-145).
- **Findings**
  - P1-CRM-62 [USER] **Upload errors lose detail.** Only `response.data.detail` is read when it is a string (64-65). A 422 `errors[]` array, a network error or a timeout all become "Import failed — check the file and try again." `extractErrorMessages` is not used. The template download has no try/catch (44-52).
  - P1-CRM-63 [USER/SEC] Row error text is the raw `str(e)` of any exception (bulk_import.py:585-602). A DB IntegrityError surfaces raw SQL/constraint text to the user instead of a reason and fix.
  - P1-CRM-64 [USER] Errors beyond 300 are unreachable (68, 141-145), and the error report cannot be downloaded, so a large file cannot be fully corrected.
  - P1-CRM-65 [BA] The import creates inquiries **without a contact** (`org_contact_id=contact.id if contact else None`, bulk_import.py:454), which the UI forbids (InquiryForm.tsx:291-294; InquiryCreate.org_contact_id required, schemas/inquiry.py:20). Imported values for priority/lead_source/status can be arbitrary strings.
  - P1-CRM-66 [ARCH] Inquiry numbers come from `db.query(Inquiry).count()` plus retry (bulk_import.py:238, 449-470) instead of `next_sequential_id` (inquiries.py:57-59). Two generators exist for one series. There is also no file-size or row limit on an in-memory import (215).

---

### 18. `/dashboard/crm/technical-offer/[id]` — Technical Offer Request viewer (FE/app/dashboard/crm/technical-offer/[id]/page.tsx)

- **Access**
  - FE `useProtectedPage()`, meaning any logged-in user, deliberately without the crm check (9-16).
  - BE `GET /crm/documents/{id}/content` allows any logged-in user when `doc.shared_via_tor` (documents.py:137-163).
  - A separate unauthenticated `/shared-content?token=` uses a 168 h signed token (documents.py:109-134; backend/app/auth/jwt_handler.py:40-41).
- **Inputs**: none.
- **Views**: title, PDF `<embed>` + Download link (55-63), loading (51-52), error (53-54). No CrmNav and no Back.
- **Findings**
  - P1-CRM-67 [SEC] **Any logged-in portal user can read every TOR document (and every reference doc attached to a TOR) by incrementing the numeric id** (documents.py:162). The check is only `shared_via_tor`, not "was this user a recipient". IDs are sequential.
  - P1-CRM-68 [USER] Non-403 errors collapse to "could not be loaded — it may have been removed" (35-37), even for network or SharePoint-config (503) failures. There is no way back into the app from this page.

---

### Summary counts
- Screens covered: 18 (dashboard; org list; org new; org edit; org detail; inquiries & tenders list; new record [inquiry+tender forms]; inquiry detail incl. quotations/docs/follow-ups/timeline; tender stubs + tender detail; follow-up/activity form; MOM export dialog; TOR picker; follow-ups; products; product categories; payment terms; bulk import; technical-offer viewer).
- Findings: P1-CRM-1 to P1-CRM-68.
- `window.alert/confirm/prompt` or bare `alert(`/`confirm(`/`prompt(`: **0**.
- Back buttons: **6 total, 2 non-standard** (InquiryDetailPanel.tsx:199-201, TenderDetailPanel.tsx:170-172). 6 screens have no Back at all.
- Destructive actions with **no** confirmation: 4. They are document delete (InquiryDetailPanel.tsx:1172, TenderDetailPanel.tsx:440), product delete, category delete and payment-term delete.


---

## 2.4 Procurement / P2P + GRN review

Scope: FE `frontend/src/app/dashboard/p2p/**`, `frontend/src/app/dashboard/store/grn/**`, `frontend/src/components/p2p/**`; BE `backend/app/modules/p2p/**`.
Paths below are shortened as FE = `frontend/src`, BE = `backend/app`. Line numbers were read directly from the working tree, which includes the uncommitted edits. Those edits are cosmetic: the header text changed from "Procure-to-Pay Module" to "Procurement Module" in 8 pages, the tab gating in `P2PNav.tsx` was added, and `P2PRequestList.tsx` got new fallback error text.

### Access model: the building blocks

| Gate | Where | Who passes |
|---|---|---|
| FE `useRequireApp(app)` | FE/hooks/useAuth.ts:66-78 | Only users whose `user.apps` includes `app`. Anyone else is sent to `/dashboard` with no message. Admins get every app through BE `get_apps()` (BE/modules/main/models/user.py:102-107). |
| FE tab filter | FE/components/p2p/P2PNav.tsx:44-45 (uncommitted) + FE/lib/tabAccess.ts:11-22 | `purchaseOnly` tabs need the `purchase` app. The Permission Matrix `tab_access.p2p` only hides tabs in the nav. |
| BE `require_app_access("p2p"/"purchase")` | BE/core/permissions.py:8-19 | App in `get_apps()`. |
| BE `_requester_or_purchase` | BE/modules/p2p/routes/p2p_requests.py:103-110 | `p2p` app, OR `purchase` app, OR PO approver flag (`is_purchase_head` / `is_director` / `is_md`). |
| BE `_check_view_access` | p2p_requests.py:168-172 | Purchase team, any PO approver, requester, or one of the 3 assigned heads. |
| BE `_check_approve_access` | p2p_requests.py:175-201 | An assigned head with a pending slot. Admin can override. With no heads assigned, the whole purchase team can approve. |
| BE `_check_reject_access` | p2p_requests.py:204-218 | Admin, or any assigned head (even one who already approved), or the purchase team when no heads are assigned. |
| BE `_check_po_approve_access` | p2p_requests.py:235-248 | Any flag holder whose role is still pending. **No order is enforced.** |
| BE `_check_po_reject_access` | p2p_requests.py:221-232 | Admin or any PO-approver flag. |
| BE `_require_mis_access` | BE/modules/p2p/routes/mis.py:36-41 | Admin, `purchase` app, or a PO-approver flag. |
| BE rfq `_assert_editable` | BE/modules/p2p/routes/rfq.py:63-65 | RFQ still in `draft`, or the user is an admin (at any stage). |
| BE `require_tab_access` | BE/core/permissions.py:36 | **Not used by any p2p route** (grep found it only in erp projects/service_requests). Tab restrictions are FE-only. |

Status vocabularies:
- PR (BE/modules/p2p/models/p2p_request.py:32-39): submitted, approved, vendor_quotations, technical_evaluation, commercial_evaluation, vendor_selected, po_drafted, po_raised, po_approved, partially_received, received, closed, rejected, cancelled.
- PO (models/purchase_order.py:14): draft, issued, acknowledged, partially_fulfilled, fulfilled, cancelled.
- GRN (models/goods_receipt.py:18,23): draft, completed. Line quality: pending, passed, failed, partial.
- RFQ: draft, locked.

---

#### /dashboard/p2p — "My Purchase Requisitions" list  (FE/app/dashboard/p2p/page.tsx + FE/components/p2p/P2PRequestList.tsx)
- **Access**:
  - FE: `useRequireApp('p2p')` at page.tsx:10.
  - BE: `GET /p2p/requests` uses `_requester_or_purchase` (p2p_requests.py:388). Scoping is at :394-414:
    - Purchase team sees **all** PRs.
    - A pure PO approver sees only statuses po_raised or later, plus rejected.
    - Everyone else sees PRs they raised or PRs where they are one of the heads.
- **Inputs**: none on the page itself. It has a "+ New Purchase Requisition" button (page.tsx:27-37).
- **Views**:
  - Columns (P2PRequestList.tsx:145): PR Number, Category, Project, Required Date, Priority, Status, and View. There is **no Requester, Department or Created column**.
  - Data: client-side fetch capped at `limit: 500` (:68). No search, filters, sort or pagination, even though the BE supports status/category/department/project/priority/required_date/search/skip/limit (p2p_requests.py:377-430).
  - Status badges (:14-36) cover submitted, approved, po_raised, po_approved, partially_received, received, closed, rejected and cancelled, plus a derived "Partially Approved" (:41-50). **Missing:** vendor_quotations, technical_evaluation, commercial_evaluation, vendor_selected, po_drafted. These render as raw snake_case in grey.
  - Loading row at :153, empty row at :154-156. Load errors go to a MessageDialog with a Reload action (:121).
  - No export or print.
- **Findings**: see P1-P2P-6, 7, 8, 21.

#### /dashboard/p2p/new — Raise Purchase Requisition  (FE/app/dashboard/p2p/new/page.tsx)
- **Access**:
  - FE: `useRequireApp('p2p')` at :34.
  - BE `POST /p2p/requests`: `require_app_access("p2p")` (p2p_requests.py:304). A purchase-only user can see the list but gets a 403 here.
  - Pickers:
    - `/p2p/requests/meta` and `/p2p/requests/projects` use `_requester_or_purchase` (:251-283).
    - `usersApi.directory()` returns **all active users** (BE/modules/main/routes/users.py:124-131).
  - Attachment upload `POST /{id}/attachments`: requester or purchase team (:1071-1075).
- **Inputs**:

| Field | Control | Required? | FE validation | BE validation | Mismatch / notes |
|---|---|---|---|---|---|
| Project | SearchableSelect (:183-188) | No | none | `project_label: str\|None` (BE/modules/p2p/schemas/p2p_request.py:77). No FK. | The label text is stored, not the project id (FE :124, route :326). On the detail page's edit panel the project is free text again (detail :300). [ARCH] |
| Category | select (:192-195) | Yes (*) | :113 | `category_code: str` (schema :78). Route checks it against `P2P_CATEGORIES` (:306-307). | OK |
| Department | — (not on form) | — | — | Taken from `user.department` (route :330) | The requester cannot choose it. If their profile has no department, it is null and the dept-head fallback (:312-315) is skipped. |
| Required Date | DateField (:199) | No (no *) | none | `date\|None` (schema :79). No past-date check. | [BA] A "required-by" date is optional and can be in the past. |
| Requirement Type | select from meta (:203-206) | No | none | `str\|None` (schema :80). **Not checked against `P2P_REQUIREMENT_TYPES`**. | Free string accepted by the API. |
| Priority | select low/medium/high (:274-276) | defaults to medium | none | `priority: str = "medium"` (schema :81). `P2P_REQUEST_PRIORITIES` (model :41) is **never enforced**. | Any string is accepted by the API. |
| Remarks | textarea (:280) | No | none | `str\|None` | — |
| Item Description | input (:232) | Only row 1 is checked | `!items[0].item_name` (:114). Blank rows are then **silently dropped** (:121). | `item_name: str` (schema :19). Empty string allowed. Route requires at least 1 item (:308-309). | A row with qty/make but no name vanishes without warning. |
| Make / Part Code / Category / Ship To | inputs (:235-257) | No | none | `str\|None` | Ship To is free text. It is later fuzzy-matched to a store location in the stock check (route :751-754). |
| UOM | free-text input (:241) | No | none | `str\|None` | No unit master. |
| Qty | `type=number` (:244), **no min** | implicit | Submit sends `Number(it.quantity) \|\| 1` (:138). 0 or blank **silently becomes 1**. Negative values pass. | `quantity: float = 1` (schema :23). **No `gt=0`**. | [USER]/[BA] P1-P2P-12 |
| Estimated price | **absent** | — | — | No field in `P2PRequestItemPayload` (schema :18-26) | [BA] Approvers sign off with no value or budget in front of them. |
| Department Head * | SearchableSelect over all users (:288-293) | FE yes | :115 | `approver_id: int\|None` (schema :87). `_validate_head` returns None when missing (:286-296, :311). The route then **auto-falls back** to a dept head (:312-315). | **FE-only requirement.** P1-P2P-4 |
| Project Head * | SearchableSelect (:297-302) | FE yes | :116 | Optional (schema :89, route :316) | Same as above |
| Plant Head * | SearchableSelect (:306-311) | FE yes | :117 | Optional (schema :91, route :317) | Same as above |
| Any head = the requester | — | — | Not blocked | Not blocked (:286-296) | [SEC] Self-approval is possible. P1-P2P-5 |
| Supporting / Spec docs | `<input type=file multiple>` (:319, :323) | No | **No type/size limit** | **No type/size/count limit** (:1064-1109). 503 if SharePoint is not configured (:1080-1081). | Upload failures are **swallowed**: `catch { /* ... */ }` (:146). P1-P2P-9 |

- **Views**:
  - Header plus a `secondaryBtnStyle` "← Back" top-right (:171-173). It uses `router.back()`, not a fixed route, so it can leave the app when the page was opened directly.
  - Sub-nav renders above the header (:162). Compliant.
  - A MessageDialog titled "Cannot Save Request" shows errors (:176).
  - No draft save. Load errors on the pickers are shown.
  - The `?item_name=` prefill (:64-79) is referenced from "Store's Raise P2P Request low-stock action", but **no FE caller links to `/dashboard/p2p/new?…`** (grep). This looks like dead code (inferred).
- **Findings**: P1-P2P-4, 5, 9, 12, 13, 23.

#### /dashboard/p2p/[id] — PR detail, approve/reject, stock check  (FE/app/dashboard/p2p/[id]/page.tsx)
- **Access**:
  - FE: `useRequireApp('p2p')` (:72).
  - BE `GET /{id}`: `_requester_or_purchase` + `_check_view_access` (p2p_requests.py:434-442).
  - Buttons shown:
    - Approve/Reject appear **only when `?from=approval`** (:251-252). They are computed from the assigned-head ids (:247-250).
    - Approve PO / Reject appear only when `?from=po-approval` (:254-255). `poRole` takes only the first flag the user holds (:253).
  - BE actions:
    - approve: `_requester_or_purchase` + `_check_approve_access` (:512-561).
    - reject: `_check_reject_access`, or `_check_po_reject_access` when the PR is po_raised (:597-628). Allowed from status submitted, approved or po_raised (:605).
    - approve-po: `_check_po_approve_access` (:564-594).
    - stock-check, issue-from-stock and send-to-procurement: `require_app_access("purchase")` (:728, :776, :855).
  - Side loads: `rfqApi.list` needs `purchase` (rfq.py:142) and `purchaseOrdersApi.list` needs `purchase` (purchase_orders.py:42). **Both 403s are swallowed** with `.catch(() => [])` (:118-119).
  - Attachment download needs the requester or the purchase team (p2p_requests.py:1122-1123). **Heads and PO approvers get a 403.**
- **Inputs**:

| Field | Control | Required? | FE | BE | Notes |
|---|---|---|---|---|---|
| Approve comment | PromptDialog (:610-617) | No | — | `comment: str\|None` (schema :119-120) | OK |
| Reject reason | PromptDialog, "Reason for rejecting (optional)" (:634-641) | **No** | — | `reason: str\|None` (schema :115-116) | [BA] A rejection can have no reason. P1-P2P-16 |
| Approve-PO comment | PromptDialog (:618-625) | No | — | Same as approve | — |
| Cancel reason | PromptDialog (:626-633) | — | **Unreachable.** Nothing calls `setPromptAction('cancel')`. | cancel route (:631-652) | Dead UI. P1-P2P-14 |
| Edit panel (project, required date, requirement type, priority, remarks) | inputs (:294-325) | — | **Unreachable.** Nothing calls `setActivePanel('edit')`. | PATCH needs `purchase` (:482) | Dead UI. P1-P2P-14 |
| Issue Qty (stock) | number, min 0 / max requested (:547-554) | — | Sends `qty > 0 ? qty : undefined` (:193) | `quantity: float\|None` (schema :73). When None the route issues **the full PR qty** (:799). It checks >0 and <= requested (:800-803). | Typing **0 issues the full requested qty**. P1-P2P-17 |
| Issue from stock | button (:559-566) | — | **No confirmation.** Stock is posted immediately. | Locks the row (:785-787), posts the ledger entry (:819-827) | "Send to Procurement" has a ConfirmDialog (:642-650) but the irreversible stock issue does not. |

- **Views**:
  - Header: PR number, status badge, category and project. Back, Approve and Reject buttons sit top-right (:266-290).
  - "← Back" uses `secondaryBtnStyle` but **always goes to `/dashboard/p2p`** (:277), even when the user came from P.R Approval or PO Approval.
  - Sections in order: Request Details (:327-339), Purchase Order (:341-363, only if the PO list loaded), Vendor Quotations (:365-384, only if the RFQ loaded), **PO Approval (:386-413) placed before PR Approval (:415-453)**, Items with fulfilment and stock check (:455-588), Attachments (:592-608).
  - Loading and error states are bare `<p>` elements with **no P2PNav** (:206-208).
  - No audit/history panel, although the BE serves `/audit` (p2p_requests.py:445-474).
  - No print or PDF of the PR or PO.
- **Findings**: P1-P2P-1, 2, 3, 10, 14, 15, 16, 17, 18.

#### /dashboard/p2p/approval — P.R Approval queue  (FE/app/dashboard/p2p/approval/page.tsx)
- **Access**: FE `useRequireApp('p2p')` (:19). The BE is the same list endpoint as above.
- **Inputs**: bucket tabs set via the URL (`?bucket=`) (:37-58).
- **Views**:
  - Buckets (:11-16):
    - Pending = `submitted`.
    - Approved = approved, po_raised, po_approved, partially_received, received, closed. **This excludes** vendor_quotations, technical_evaluation, commercial_evaluation, vendor_selected and po_drafted, so a PR drops out of "Approved" once its RFQ is locked and stays gone until the PO is submitted.
    - Rejected; All.
  - **Pending is not "awaiting my action".** It shows every submitted PR the user can see: their own, ones they already signed, and for the purchase team all PRs.
  - Rows link to `/dashboard/p2p/{id}?from=approval`. There is no inline PR approve; inline actions exist only for POs (P2PRequestList.tsx:84-87).
- **Findings**: P1-P2P-6, 7, 20.

#### /dashboard/p2p/rfq — R.F.Q list  (FE/app/dashboard/p2p/rfq/page.tsx)
- **Access**:
  - FE: `useRequireApp('p2p')` (:29). The nav tab is purchaseOnly (P2PNav.tsx:13), but the page itself has **no purchase guard**.
  - BE: `GET /p2p/rfqs` needs `purchase` (rfq.py:142). A p2p-only user opening the URL directly gets the "Cannot Load RFQ Data" dialog.
  - "Start RFQ" is shown only when `isPurchaseTeam` (:92, :100-104).
- **Views**:
  - Table 1, "Purchase Requests Awaiting RFQ" (:75-111): PRs with status `approved` (:43) that have no RFQ (:62-63). Columns: PR Number, Category, Project, Required Date, Start RFQ.
  - Table 2, "RFQs" (:113-146): RFQ Number, PR Number, Status (Draft/Locked), Single Quotation, Created, View.
  - Loading and empty rows at :85-88 and :123-126. Limit 500, client-side. No search, filter or pagination.
- **Findings**: P1-P2P-19, 22, 24.

#### /dashboard/p2p/rfq/new — Raise RFQ  (FE/app/dashboard/p2p/rfq/new/page.tsx)
- **Access**:
  - FE: `useRequireApp('p2p')` (:56), plus a hard `isPurchaseTeam` check that shows a red `<p>` with **no nav** (:90).
  - BE: create, update, upload and submit all use `require_app_access("purchase")` plus `_assert_editable` (rfq.py:96-347).
  - Create only works while the PR is `approved` (:105-106). An existing draft is reused (:114-118).
- **Inputs**:

| Field | Control | Required? | FE | BE | Notes |
|---|---|---|---|---|---|
| Purchase Requisition | SearchableSelect over approved PRs (:177-183) | Yes | :102 | `p2p_request_id: int` (BE/modules/p2p/schemas/rfq.py:25). PR must be approved (rfq.py:105). | The PR list load is **swallowed**: `.catch(() => {})` (:86). |
| Vendor 1..4 name | input (:210) | V1 yes; others only if a file is attached | :104, :106-109 | Form `vendor_name: str\|None` (rfq.py:190). **Not required.** | FE-only |
| Contact number | input (:214) | V1 yes | :105 | `vendor_contact: str\|None` (rfq.py:191). No format check. | FE-only. No phone validation on either side. |
| Quotation file | FileUploadField (:218-222) | V1 yes | :103 | Tier must be in `RFQ_VENDOR_TIERS` (rfq.py:198-199). Submit requires L1 (:308-312). **No type/size check. Duplicate tiers are allowed.** | On retry the loop at :132-135 **re-uploads every file**, creating duplicate L1..L4 rows. P1-P2P-24 |
| Vendor master link | — | — | Free-text vendor | `vendor_id` exists on the quotation/PO models but is never set from the UI | [BA] No vendor master or approved-vendor check. |
| Reason for single quotation / Comments | textareas (:241, :245), shown only if only V1 is attached | Conditionally | :110-113 | Submit checks both (rfq.py:314-319) | OK, aligned |
| Payment terms / Delivery lead time / Late delivery clause | inputs (:260-268) | Yes | :114-116 | Checked on submit (rfq.py:321-326). `RFQUpdate` fields are all optional strings (schemas/rfq.py:29-38). | Aligned. The label reads "Vendor 1 Commercial Terms" (:255), so terms are captured before any comparison. |
| RFQ due date / quotation deadline | **absent** | — | — | No field | [BA] |
| Requires technical evaluation | hard-coded `false` (:78) | — | — | `requires_technical_evaluation` (schemas/rfq.py:26) | The technical-evaluation stage can never be reached. P1-P2P-11 |

- **Views**:
  - Three steps. A "Once saved, this RFQ is locked" warning (:272-277). Save and Cancel buttons (:279-282).
  - "← Back" is `secondaryBtnStyle` top-right and routes to `/dashboard/p2p/rfq` (:163-165). Compliant.
  - Sub-nav renders above the header (:154). Errors go to a MessageDialog titled "Cannot Save RFQ" (:168).
- **Findings**: P1-P2P-11, 24, 25.

#### /dashboard/p2p/rfq/[id] — RFQ detail, record PO, send for PO approval  (FE/app/dashboard/p2p/rfq/[id]/page.tsx)
- **Access**:
  - FE: `useRequireApp('p2p')` (:61). No purchase check in the FE; every BE call needs `purchase` (rfq.py:157, 568, 695, 767).
  - "Admin Edit" shows when the RFQ is locked and the user is an admin (:224-226), **at any PR stage, including after PO approval**. The BE allows it through `_assert_editable` (rfq.py:63-65).
- **Inputs**:

| Field | Control | Required? | FE | BE | Notes |
|---|---|---|---|---|---|
| Vendor Tier | select of the RFQ's attached tiers (:273-285), shown only if more than 1 tier | — | — | — | Shows raw "L1". Everywhere else says "Vendor 1". |
| Vendor Name | free input (:290) | Effectively yes | none | Required when no VendorQuotation is selected (rfq.py:584-586) | Can be a vendor that **never quoted**. There is no comparison or selection step. |
| PO Number | input, "Auto-generated if blank" (:294) | No | none | Uniqueness checked (rfq.py:588-593) | OK |
| PO price / qty / tax / total value / expected delivery / delivery terms | **absent** | — | — | `P2PPurchaseOrderCreate` accepts total_value, expected_delivery, delivery_terms and items[] with unit_price and tax_rate (BE/modules/p2p/schemas/purchase_order.py:29-38). The route copies PR lines with `unit_price=None` (rfq.py:614-620). | The PO is created with **no value and no delivery date**. P1-P2P-3 |
| Item schema bounds | — | — | — | `quantity: float = 1`, `unit_price`, `tax_rate` have **no ge/gt/le bounds** (schemas/purchase_order.py:5-12) | Negative prices and >100% tax are accepted by the API. |
| PO Document | `<input type=file>` (:299, :330) | **No** | none | One-time upload, only while in draft (rfq.py:689-734). **Submit does not require it** (rfq.py:762-796). | [BA] A PO can go for approval with no document. |
| Send for Approval | ConfirmDialog (:428-436) | — | — | PR must be po_drafted and PO draft (rfq.py:778-779) | Good use of ConfirmDialog |
| Admin edit: terms, single-quote reason, comments | inputs (:361-393) | — | Sends `trim() \|\| undefined` (:188-194), so a field **cannot be cleared** | `RFQUpdate` (schemas/rfq.py:29-38) | — |

- **Views**:
  - Vendor quotation cards (:232-254) show the file, name and contact. **No quoted price.**
  - The Purchase Order panel is keyed to the PR stage (:256-359). Stage labels at :34-45 map all the evaluation statuses to "Pending PO".
  - The "Attach PO" form is also shown at technical_evaluation and commercial_evaluation (:267). The BE 409s there (rfq.py:581-582).
  - A `po_drafted` PO draft **cannot be edited or cancelled** from the UI (`updatePoDraft` is unused).
  - Loading and error states are bare `<p>` with no nav (:180-182). The PO-draft load error is swallowed (:122-124).
  - Unused BE capability: vendor quotation entry, comparison, technical and commercial evaluation, and vendor selection (rfq.py:355-561) have **no FE at all**. The API client wraps them (FE/lib/api.ts, rfqApi `addVendorQuotation` etc.) but nothing calls them.
- **Findings**: P1-P2P-3, 10, 11, 26, 27.

#### /dashboard/p2p/po-approval — P.O Approval queue  (FE/app/dashboard/p2p/po-approval/page.tsx)
- **Access**:
  - FE: `useRequireApp('p2p')` (:19). **A director/MD/purchase head without the `p2p` app is redirected to /dashboard**, even though the BE lets them in through `_requester_or_purchase` (p2p_requests.py:108).
  - Inline Approve appears when `poRole` is in `pending_po_approval_roles` (P2PRequestList.tsx:84-85). Inline Reject appears for any PO approver or admin (:86-87).
  - BE: approve-po (p2p_requests.py:564-594) and reject (:597-628).
- **Inputs**: Approve comment and Reject reason via PromptDialog (P2PRequestList.tsx:123-139). Both optional.
- **Views**:
  - Buckets (:11-16): Pending = po_raised; Approved = po_approved, partially_received, received, closed; Rejected = **all** rejected PRs, including PR-stage rejections; All.
  - Columns come from P2PRequestList. **No PO number, vendor or PO value column.**
- **Findings**: P1-P2P-1, 2, 3, 15, 20.

#### /dashboard/p2p/po-tracking — PO Tracking  (FE/app/dashboard/p2p/po-tracking/page.tsx)
- **Access**:
  - FE: `useRequireApp('purchase')` (:42). This differs from the other P2P pages. A purchase-only user lands here but most P2PNav tabs then redirect them away.
  - BE: `GET /p2p/purchase-orders` needs `purchase` (purchase_orders.py:42).
  - The tab has no `subtabKey` (P2PNav.tsx:15), so the Permission Matrix cannot restrict it.
- **Inputs**: status filter select (:87-92) covering the 6 PO statuses (:14-17), and an "Overdue only" checkbox (:93-96, client-side).
- **Views**:
  - Columns (:105): PO Number, Against PR, Vendor, PO Date, Expected Delivery, Buyer, Status, Overdue.
  - Rows click through to PR detail (:123), not to a PO detail page. No PO detail page exists.
  - Loading and empty rows at :113-116. No search (the BE supports `search`, purchase_orders.py:37). No export. No link to "Record GRN".
  - **The Overdue column is always "—"**: the only FE PO path never sets `expected_delivery` (rfq/[id] :154-157), and `daysOverdue` returns null in that case (:27).
  - A PO whose PR was rejected at PO stage still shows "Issued": the reject route never touches the PO row (p2p_requests.py:605-613).
- **Findings**: P1-P2P-3, 15, 28.

#### /dashboard/p2p/mis — M.I.S Report  (FE/app/dashboard/p2p/mis/page.tsx)
- **Access**:
  - FE: `useRequireApp('p2p')` (:53). The nav tab is purchaseOnly (P2PNav.tsx:16).
  - BE: `_require_mis_access` also allows PO approvers without the purchase app (mis.py:39). **Those PO approvers never see the tab.** If they also lack `p2p`, they are redirected.
- **Inputs**:
  - Period toggle Daily/Weekly/Monthly/Yearly (:129-144).
  - The BE also supports `custom` with date_from/date_to, `category_code` and `department` (mis.py:30, :97-127). **None of these are exposed in the FE.**
- **Views**:
  - 7 KPI tiles (:156-164). Bar chart "Created vs Approved vs PO Raised" (:167-182). Its labels are **raw ISO dates** (:170).
  - "PRs by Category" horizontal bar (:184-203) with an empty state. "Pending Approval — By Approver" table (:206-230) with an empty state.
  - Excel export (:70-86) → `/p2p/mis/export` (mis.py:410).
  - Loading is text (:152-153). The error banner is inline (:146-150).
- **Findings**: P1-P2P-10, 29.

#### /dashboard/store/grn — GRN & Inspection list  (FE/app/dashboard/store/grn/page.tsx)
- **Access**:
  - FE: `useRequireApp('store')` (:20). The StoreNav tab is visible to every store user (FE/components/store/StoreNav.tsx:21).
  - BE: `GET /p2p/goods-receipts` needs **`purchase`** (goods_receipts.py:167). A store-only user sees the tab, opens it, and gets an error.
  - The Permission Matrix has a `p2p.grn` subtab (BE/core/permission_registry.py:50), but StoreNav does not apply `filterTabsByAccess`, so the matrix entry has no effect.
- **Views**:
  - Columns (:56): GRN Number, PO Number, PR Number, Vendor, Received Date (**raw ISO**, :73), Status (draft = "Pending Inspection", completed = "Completed", :16-17), View.
  - Loading and empty rows at :62-65. No filters, search or pagination, although the BE takes purchase_order_id, p2p_request_id and status (goods_receipts.py:161-179).
  - The error is plain red text built from `err?.response?.data?.detail` (:30, :50). It does not use extractErrorMessages or MessageDialog. If `detail` is a Pydantic array it will not render as text.
  - "+ New Goods Receipt" is shown to everyone (:47).
- **Findings**: P1-P2P-2, 30.

#### /dashboard/store/grn/new — Record Goods Receipt  (FE/app/dashboard/store/grn/new/page.tsx)
- **Access**:
  - FE: `useRequireApp('store')` (:31) **and** a purchase-team check (:55-62) that shows a message.
  - BE `POST /p2p/goods-receipts`: `purchase` (goods_receipts.py:224). The PO must be in issued/acknowledged/partially_fulfilled (:238-239), and the PR in po_approved/partially_received (:240-246).
  - Picker `/pending-purchase-orders`: `purchase` (:182-208).
- **Inputs**:

| Field | Control | Required? | FE | BE | Notes |
|---|---|---|---|---|---|
| Purchase Order * | SearchableSelect (:111-116) | Yes | :68 | `purchase_order_id: int` (BE/modules/p2p/schemas/goods_receipt.py:36) plus status gates (routes :236-246) | OK |
| Store Location | select with "-- None --" (:119-123) | **No** | none | `store_location_id: int\|None` (schema :37) | With no location, **stock is never posted** (goods_receipts.py:60-61), and no step exists to fix it later. P1-P2P-31 |
| Received Date * | DateField (:127), default today | Yes (label) | none | `date\|None` (schema :38). Route defaults to today (:286). **No future-date check.** | — |
| Received Qty per line * | number, min 0, `max={it.quantity}` (:151-157) | At least 1 line >0 | Lines with 0 are dropped. At least one required (:69-72). `max` is the **ordered** qty, not the remaining qty, and is not enforced on typing. | `received_quantity: float` (schema :7). Route checks >0 (:271-272) and prior + new <= ordered (:273-279). | FE shows only Ordered Qty (:139). The **already-received / remaining** qty is not returned by the picker (routes :203-206), so users only find out when they get a 409. |
| Remarks | textarea (:167) | No | — | `str\|None` | — |

- **Views**: "← Back" is `secondaryBtnStyle` top-right and routes to /store/grn (:102). Compliant. StoreNav renders above the header (:93). Errors go to a MessageDialog (:105). The Save button is disabled until a PO is chosen (:177).
- **Findings**: P1-P2P-30, 31, 32.

#### /dashboard/store/grn/[id] — GRN detail and quality inspection  (FE/app/dashboard/store/grn/[id]/page.tsx)
- **Access**: FE `useRequireApp('store')` (:41). BE `GET /{id}` and `POST /{id}/inspect` both need `purchase` (goods_receipts.py:215, :326). **No QA/inspector role**: the same purchase user can receive and inspect.
- **Inputs** (only while the GRN is in draft):

| Field | Control | Required? | FE | BE | Notes |
|---|---|---|---|---|---|
| Accepted qty | number, min 0 / max received (:190-191) | defaults to the received qty (:59) | none | `accepted_quantity: float` (schema :12). Route checks it is not negative (:348-349). | — |
| Rejected qty | number (:198-199) | defaults to 0 | none | Checks not negative, and accepted + rejected <= received (:350-354) | **accepted + rejected < received is accepted**, leaving quantity unaccounted for. P1-P2P-33 |
| Quality Status | select passed/failed/partial (:206-208) | defaults to passed | none | Must be in the allowed set and not pending (:343-347) | **No consistency check**: "Passed" with rejected >0, or "Failed" with accepted >0, both pass. P1-P2P-33 |
| Rejection Reason | input, only when status is not passed (:216-217) | **No** | Trimmed, optional (:105) | `str\|None` (schema :15) | [BA] A "Failed" line can be saved with no reason. |
| Complete Inspection | button (:231) | — | **No ConfirmDialog** | Terminal. It posts stock (:364-370) and rolls up PO/PR status (:104-158). | Irreversible action taken in one click. P1-P2P-34 |

- **Views**:
  - Header card with PO, PR, vendor, Received Date (**raw ISO**, :157), location, received-by and inspected-by (:152-165).
  - A "Stock was not fully updated" notes panel links to "+ Add Item to Item Master" (:136-150). Those notes appear only right after completion and are lost on refresh; `stock_sync_notes` is populated only by `/inspect` (schema :71-75).
  - **Loading renders nothing** (`if (loading) return null`, :78). A not-found state shows a MessageDialog plus text (:80-88).
- **Findings**: P1-P2P-31, 33, 34.

---

### Findings

**P1-P2P-1 [USER][ARCH] — Approvers who lack the `p2p` app hit a dead end.**
- The head pickers list every active user (FE new/page.tsx:96-99; BE users.py:131). `_validate_head` accepts any active user (p2p_requests.py:286-296).
- The chosen head gets an in-app notification (:362-368) and an email (:372, BE/utils/email.py:367-416).
- If that head does not hold `p2p`, `purchase` or a PO flag, then both of these fail:
  - Every P2P page redirects them to /dashboard (`useRequireApp('p2p')`, hooks/useAuth.ts:66-75).
  - The BE rejects approve with "Access to the P2P module required" (p2p_requests.py:108-109).
- The PR can then only be cleared by an admin.
- PO approvers (is_director / is_md / is_purchase_head) without `p2p` are allowed by the BE (:108), but po-approval/page.tsx:19 and [id]/page.tsx:72 redirect them. They also never see the MIS tab (P2PNav.tsx:16), which the BE allows them (mis.py:39).

**P1-P2P-2 [USER] — Notifications do not open anything, and emails have no link.**
- Every P2P notification uses `entity_type="p2p_request"` (p2p_requests.py:367, :556, :623, :842, :1006, :1016) or `"p2p_goods_receipt"` (goods_receipts.py:313).
- `NotificationBell` `ENTITY_LINK` has no entries for either (FE/components/erp/NotificationBell.tsx:9-16), so clicking goes nowhere.
- The approval emails carry no portal URL (BE/utils/email.py:384-404, :436-450).
- Even when the approver finds the PR, Approve/Reject only render when the URL has `?from=approval` or `?from=po-approval` ([id]/page.tsx:251-255). Opening the PR from "My Purchase Requisitions", PO Tracking or a pasted link shows **no action buttons**.

**P1-P2P-3 [BA] — The PO that goes for Purchase Head / Director / MD approval has no value, no prices, no delivery date, and approvers cannot see it.**
- The only FE PO path is "Attach PO" (rfq/[id]/page.tsx:151-163). It sends only `vendor_name` and `po_number`. PO lines are copied from the PR with `unit_price=None` (rfq.py:614-620), so `total_value` is null (:640-643) and `expected_delivery` is null.
- PO approvers who are not on the purchase team cannot see the PO number, vendor or document on the PR detail page:
  - `purchaseOrdersApi.list` and `getPoDocumentBlob` need `purchase` (purchase_orders.py:42; rfq.py:742).
  - The FE swallows the 403 (`.catch(() => [])`, [id]/page.tsx:119).
- The PO Approval list has no PO or value columns (P2PRequestList.tsx:145).
- Knock-on effects: PO tracking's overdue logic, the daily overdue reminders (BE/main.py:345, inferred), and the AP 3-way match that trusts `total_value` (p2p_requests.py:940-945 comment) all get null data.

**P1-P2P-4 [BA][ARCH] — The three heads are required only in the FE.**
- The FE blocks submit without them (new/page.tsx:115-117).
- The BE schema makes them optional (schemas/p2p_request.py:87-92), `_validate_head` returns None (p2p_requests.py:291-292), and the route silently auto-picks a dept head (:312-315).
- A PR created with no heads is approvable by **anyone on the purchase team** (:183-186).
- The ERP Service-Request path creates PRs with only an optional `approver_id` and no project or plant head (BE/modules/erp/routes/service_requests.py:924-941).
- This contradicts commit c765df7, "require Department/Project/Plant Head on Purchase Requisitions".

**P1-P2P-5 [SEC] — Self-approval is possible.**
- Nothing stops the requester picking themselves as Department, Project and/or Plant Head. Neither the FE (new/page.tsx:97-99) nor the BE (p2p_requests.py:286-296, :311-317) checks.
- `_check_approve_access` then clears **all** their slots in one click (:189-194, "clears every one of their slots in a single click").

**P1-P2P-6 [USER][BA] — A PO approver's own PRs, and PRs assigned to them as a head, are invisible in lists.**
- For a PO approver without the `purchase` app, the list query is status-filtered to po_raised or later, plus rejected (p2p_requests.py:395-404). The requester/head OR-filter at :409-414 is skipped for them.
- So a Director who raises a PR, or who is picked as Plant Head, cannot see it in "My Purchase Requisitions" or in P.R Approval → Pending, even though `_check_view_access` would let them open it (:169).

**P1-P2P-7 [USER] — PRs in five backend statuses are unlabelled and fall out of the approval buckets.**
- `STATUS_LABELS` in P2PRequestList.tsx:14-24 and [id]/page.tsx:27-31 lack vendor_quotations, technical_evaluation, commercial_evaluation, vendor_selected and po_drafted (model p2p_request.py:32-39). They show as raw snake_case in grey.
- The P.R Approval "Approved" bucket (approval/page.tsx:13) omits them, so a PR disappears from "Approved" as soon as its RFQ is locked (rfq.py:339).
- The "Pending" bucket is every submitted PR the user can see (:12), not the ones awaiting *their* action.

**P1-P2P-8 [USER][ARCH] — PR lists have no search, filters, sort or pagination, and silently cap at 500.**
- The FE fetches `limit: 500` and filters client-side (P2PRequestList.tsx:68-69).
- The BE already supports status, category, department, project, priority, required_date, search and skip/limit (p2p_requests.py:377-430).
- The table has no Requester, Department or Created columns (P2PRequestList.tsx:145). Approvers cannot see who raised a PR without opening it.

**P1-P2P-9 [USER] — Attachment upload failures are swallowed.**
- new/page.tsx:146: `try { await p2pApi.uploadAttachments(...) } catch { /* upload failure shouldn't block PR creation */ }`.
- The PR is created and the user is redirected with no hint that their files were not saved. The likely causes are SharePoint not configured (503, p2p_requests.py:1080-1081) or the Graph upload failing.
- Neither side limits file type or size (new/page.tsx:319, :323; p2p_requests.py:1064-1109).
- Deleting an attachment is allowed for the requester at **any status**, including after approval or after the PO is raised, and writes no audit row (p2p_requests.py:1141-1160).

**P1-P2P-10 [USER] — Errors are swallowed or replaced by generic text.**
- [id]/page.tsx:118-119: RFQ/PO load `.catch(() => [])`.
- rfq/[id]/page.tsx:122-124: empty catch, "non-fatal".
- rfq/new/page.tsx:86: PR picker `.catch(() => {})`, which leaves an empty dropdown with no reason.
- mis/page.tsx:66: `.catch(() => setError('Could not load the MIS report. Purchase module or PO approver access is required.'))`. This discards the real BE reason (for example a 400 bad period, or a 500) and always blames access.
- store/grn/page.tsx:30: raw `detail` shown as plain `<p>` (no MessageDialog, no extractErrorMessages).
- The fallbacks "Action failed." ([id]/page.tsx:145; rfq/[id]/page.tsx:141) give no reason and no fix when the BE sends no detail.

**P1-P2P-11 [ARCH][BA] — The vendor quotation, comparison, evaluation and selection pipeline is backend-only.**
- These BE endpoints exist: vendor-quotations CRUD, start/record technical evaluation, start/record commercial evaluation, select-vendor-quotation (rfq.py:355-561). Also the legacy PR-level `request-quotations`, `select-vendor`, `create-po` and `assign-buyer` routes (p2p_requests.py:655-1022).
- None has a UI caller (grep).
- RFQ create hard-codes `requiresTechnicalEvaluation=false` (rfq/new/page.tsx:78).
- `create_po_draft` explicitly allows skipping straight from `vendor_quotations` (rfq.py:571-582). So there is **no L1/L2/L3 price comparison**, and the PO vendor is a free-text box that may not match any quote (rfq/[id]/page.tsx:288-291).

**P1-P2P-12 [USER][BA] — PR quantity is not validated.**
- The qty input has no `min` (new/page.tsx:244).
- Submit coerces with `Number(it.quantity) || 1` (:138), so 0 or blank becomes 1 silently and negative values are sent.
- BE `quantity: float = 1` has no `gt=0` (schemas/p2p_request.py:23).
- Only row 1's name is checked (:114). Other blank rows are dropped silently (:121).
- Priority and requirement_type are not validated against `P2P_REQUEST_PRIORITIES` / `P2P_REQUIREMENT_TYPES` (schema :80-81; model :41, :84).

**P1-P2P-13 [BA] — The PR carries no estimated value.**
- There is no price or estimate field on PR items (schemas/p2p_request.py:18-26; new/page.tsx:220). Heads approve spend blind.
- "Required Date" is optional with no past-date guard (new/page.tsx:198-199; schema :79).

**P1-P2P-14 [USER] — The requester cannot edit or withdraw a PR, because the UI for it is dead code.**
- The Edit panel ([id]/page.tsx:294-325) and the Cancel prompt (:626-633) are never opened: nothing calls `setActivePanel('edit')` or `setPromptAction('cancel')`.
- The BE cancel route exists for the requester (p2p_requests.py:631-652). PATCH is purchase-only (:482).
- A typo in a submitted PR therefore needs a head to reject it and the requester to raise a new one.

**P1-P2P-15 [SEC][BA] — PRs and POs can be edited after approval through the API, bypassing the approval chain.**
- `PATCH /p2p/requests/{id}` (purchase app): any header field, the head ids, **and `status` to any value** at any stage (p2p_requests.py:477-505; schema :97-112). For example a PR could be set straight to `po_approved` without the Director/MD signing. It is audited only as "manually changed status".
- `PATCH /p2p/purchase-orders/{id}`: status to any PO status (for example `fulfilled` without a GRN), plus expected_delivery and delivery_terms at any time (purchase_orders.py:127-160).
- Admin "Admin Edit" on a locked RFQ at any stage (rfq/[id]/page.tsx:224; rfq.py:63-65). An admin can also upload or delete RFQ quotation files after the PO is approved (rfq.py:186-268).
- Cancel is allowed from `po_approved` (the block list at p2p_requests.py:641 omits it). That leaves the PO `issued` while the PR is `cancelled`.

**P1-P2P-16 [BA] — Reject reasons are optional everywhere.**
- PR reject ([id]/page.tsx:637), PO reject (P2PRequestList.tsx:133), and the BE `reason: str | None` (schemas/p2p_request.py:115-116).
- A head can also reject a PR that is already **fully approved** (status `approved` is rejectable, p2p_requests.py:605; `_check_reject_access` :215-217). The FE never offers this.

**P1-P2P-17 [USER] — "Issue Qty" 0 issues the full quantity, and there is no confirmation.**
- [id]/page.tsx:193 sends `quantity: qty > 0 ? qty : undefined`. The BE then uses the full PR quantity (p2p_requests.py:799). Typing 0 or clearing the box issues everything.
- Issue from Stock (:559-566) posts to the stock ledger with no ConfirmDialog, while "Send to Procurement" has one (:642-650).
- Stock can also be issued **after the PO is raised or approved** for items still `pending` (FE :260; BE :779-780 only blocks submitted/rejected/cancelled). That double-fulfils the same line that is already on the PO.

**P1-P2P-18 [USER] — PR detail layout and navigation problems.**
- The PO Approval section renders **above** PR Approval ([id]/page.tsx:386 vs :415), which reverses the chronology.
- Back always goes to `/dashboard/p2p` (:277), even when the user arrived from P.R Approval or PO Approval (the `from` param is ignored).
- Loading and error states drop the P2PNav (:206-208).
- No audit timeline, although `GET /{id}/audit` exists (p2p_requests.py:445-474).
- No PR or PO print/PDF anywhere in the module.

**P1-P2P-19 [USER] — A failed or abandoned draft RFQ strands its PR.**
- The "Awaiting RFQ" list excludes any PR that has *any* RFQ, including a `draft` one (rfq/page.tsx:62-63).
- The RFQ detail page has no submit or edit UI for a draft; only "Admin Edit" when locked (rfq/[id]/page.tsx:224).
- The RFQ list has no "Raise RFQ" button. So after a mid-save failure (upload or submit validation) and navigating away, the only recovery is typing `/dashboard/p2p/rfq/new?pr_id=…`. The BE would reuse the draft (rfq.py:114-118).

**P1-P2P-20 [BA] — The PO approval order is not enforced, and PO rejection has no revise path.**
- The UI promises "Purchase Head → Director → MD" (rfq/[id]/page.tsx:352, :431).
- `pending_po_approval_roles` lists all three in parallel (model p2p_request.py:209-214), and `_check_po_approve_access` accepts any pending role (p2p_requests.py:245-247). An MD can approve before the Purchase Head.
- Rejecting at `po_raised` moves the **whole PR** to terminal `rejected` (p2p_requests.py:605-613). There is no send-back-for-revision, and the PO row stays `issued`.
- No notification goes to the buyer or requester when the PO is fully approved (:586-590).
- FE `poRole` picks only the first flag (P2PRequestList.tsx:83; [id]/page.tsx:253). A user holding two flags loses the inline Approve once the first role has signed, even though the BE would accept the second.

**P1-P2P-21 [USER] — Labels are inconsistent and use dotted abbreviations.**
- Nav tabs: "P.R Approval", "R.F.Q", "P.O Approval", "P.O Tracking", "M.I.S Report" (P2PNav.tsx:11-16). The H1s are "P.R Approval", "R.F.Q", "P.O Approval" and "M.I.S Report", but "PO Tracking" (po-tracking :83).
- Mixed terms: "Purchase Requests Awaiting RFQ" (rfq/page.tsx:75) vs "Purchase Requisition" elsewhere.
- BE notifications and errors still say "P2P Request" / "P2P module" (p2p_requests.py:109, :164, :365, :554, :621), while the uncommitted FE rename says "Procurement".
- Vendor tiers show as "L1" in the PO tier select (rfq/[id]/page.tsx:283) and on PR detail cards ([id]/page.tsx:371), but as "Vendor 1" on RFQ pages. L1 conventionally means "lowest bidder", which is misleading here.

**P1-P2P-22 [SEC][ARCH] — The Permission Matrix only hides tabs; it does not block access.**
- `filterTabsByAccess` (P2PNav.tsx:45, uncommitted) hides tabs.
- No P2P page checks `tab_access`, and no P2P route uses `require_tab_access` (grep). A hidden tab is still reachable by URL and by API.
- The registry's `p2p.grn` (permission_registry.py:50) maps to nothing, because GRN lives in StoreNav, which has no filter (StoreNav.tsx:8-22).
- PO Tracking and MIS have no `subtabKey` (P2PNav.tsx:15-16), so they cannot be restricted.
- The RFQ page is guarded only by the nav. A p2p-only user who opens it directly sees a load-error dialog instead of an access message (rfq/page.tsx:29).

**P1-P2P-23 [BA] — The dept-head fallback and department are implicit.**
- Department comes silently from the user profile (p2p_requests.py:330) and is not shown on the form.
- The fallback auto-picks the *first* `is_department_head` in that department (:312-315). With FE validation this is unreachable from the UI, but it is reachable from the API and from the ERP SR path.

**P1-P2P-24 [BA] — Retrying an RFQ save duplicates quotation files.**
- rfq/new/page.tsx:130-135 reuses `draftRfqId` but re-uploads every file on each retry.
- BE upload has no per-tier uniqueness (rfq.py:186-230). One RFQ can end up with several L1 attachments, and `tiers_present` still passes.

**P1-P2P-25 [BA] — The RFQ lacks basic commercial fields.**
- No RFQ due date or validity, no vendor master link (free-text name and contact; `vendor_id` never set), no phone format validation (rfq/new/page.tsx:210-215; rfq.py:189-191).
- No item list or quantities are shown on the RFQ; only "n item(s)" (rfq/new/page.tsx:186-188).
- RFQ quotation cards show no quoted price (rfq/[id]/page.tsx:239-250).

**P1-P2P-26 [BA] — The PO document is optional, and the PO draft cannot be edited or cancelled.**
- "Send for Approval" is enabled with no document (rfq/[id]/page.tsx:336). The BE submit does not check for one (rfq.py:762-796).
- `rfqApi.updatePoDraft` is unused. There is no way to fix a wrong vendor or PO number, or to cancel the draft, before submitting.
- The Attach PO form also shows at technical/commercial evaluation stages, where the BE returns 409 (rfq/[id]/page.tsx:267; rfq.py:581-582).

**P1-P2P-27 [BA] — Submitting a PO notifies nobody.**
- The FE path `submit_po_draft` (rfq.py:762-796) flips the PR to `po_raised` without `notify_user` and without `_send_p2p_po_approval_emails_background`.
- Only the legacy, unused `create_po` notifies approvers and the requester (p2p_requests.py:1001-1021).
- Result: Purchase Head, Director and MD receive **no in-app or email alert** that a PO is awaiting them.

**P1-P2P-28 [USER] — PO Tracking gaps.**
- Overdue is effectively never computed, because expected_delivery is never captured (see 3; po-tracking/page.tsx:27).
- No search or export. No PO detail page (rows go to PR detail, :123).
- A rejected or cancelled PR's PO still reads "Issued" (see 15/20).
- The page gates on `purchase` while its sibling pages gate on `p2p` (:42 vs others).

**P1-P2P-29 [BA] — MIS KPIs are miscounted and filters are missing.**
- `pos_approved` counts only `status == "po_approved"` (mis.py:137). POs that moved on to partially_received, received or closed drop out, so the count shrinks as goods arrive.
- `prs_approved` excludes PRs later rejected at PO stage (:133).
- `prs_rejected` is keyed on `updated_at` (:134), which any later edit shifts.
- The FE exposes neither custom range nor category/department filters, although the BE supports them (mis.py:30, :97-127).
- Trend x-axis shows raw ISO dates (mis/page.tsx:170).

**P1-P2P-30 [USER][ARCH] — GRN access mismatch between Store and Purchase.**
- GRN pages gate on the `store` app (grn/page.tsx:20; new :31; [id] :41). All GRN APIs require `purchase` (goods_receipts.py:167, 185, 215, 224, 326).
- A store-only user (the people who physically receive goods) sees the "GRN & Inspection" tab (StoreNav.tsx:21) and gets a raw 403 text on the list.
- New shows "Only the Purchase team can record a goods receipt" (new :55-62), and detail shows a load error.
- There is no link from PO Tracking or PR detail to "Record GRN" for the PO.

**P1-P2P-31 [BA] — The GRN can skip stock posting silently.**
- Store Location is optional (grn/new/page.tsx:119-123; schema goods_receipt.py:37). With none, stock is not updated (goods_receipts.py:60-61).
- Lines whose name has no exact Item Master match are skipped too (:67-70).
- The warning shows only once, right after completion, and is not persisted (schema :71-75; [id]/page.tsx:109, :136-150).
- There is no re-sync action; the note tells users to "adjust stock in manually".

**P1-P2P-32 [USER] — The GRN form does not show remaining quantity.**
- The picker returns only the ordered `quantity` per line (goods_receipts.py:203-206). The form's `max` is the ordered qty (grn/new/page.tsx:152).
- Users with a prior partial GRN get a 409 "… (N remaining)" only after submitting (goods_receipts.py:273-279).
- Received Date has no future-date guard on either side (grn/new :127; schema :38).

**P1-P2P-33 [BA] — Inspection data can be inconsistent.**
- `accepted + rejected < received` is accepted, leaving quantity unaccounted for (goods_receipts.py:350-354 checks only `>`).
- quality_status is not tied to the quantities ("passed" with rejected >0, "failed" with accepted >0) (:343-359).
- The rejection reason is optional for failed/partial (FE grn/[id]/page.tsx:105; BE schema :15).
- The same purchase user can both receive and inspect; there is no segregation or QA role (:224, :326).

**P1-P2P-34 [USER] — GRN detail page issues.**
- Complete Inspection is irreversible (it posts stock and rolls up PO/PR, goods_receipts.py:364-370) and has **no ConfirmDialog** (grn/[id]/page.tsx:231).
- Loading renders a blank page (`return null`, :78).
- Received Date shows raw ISO (:157; list :73).
- PR `close` has no UI anywhere (`p2pApi.close` unused; BE p2p_requests.py:1034-1061), so fully received PRs sit at "Received" forever.

### Counts
- `window.alert/confirm/prompt` or bare `alert(`/`confirm(`/`prompt(` in scope: **0** (grep over app/dashboard/p2p, app/dashboard/store/grn and components/p2p). Dialogs use PromptDialog, ConfirmDialog and MessageDialog.
- Back buttons: 6 in scope (new :171, [id] :277, rfq/new :163, rfq/[id] :221, grn/new :102, grn/[id] :131). All use `secondaryBtnStyle` "← Back" top-right in the header row. **Style deviations: 0.** **Behavioural deviations: 2.** new/page.tsx:171 uses `router.back()`, and [id]/page.tsx:277 hard-codes `/dashboard/p2p` whatever the entry point.
- Sub-nav above header: compliant on all rendered states. The exception is the loading, error and "not purchase team" states, which render without the nav: [id] :206-208, rfq/[id] :180-182, rfq/new :90. GRN [id] loading returns null.


---

## 2.5 Store & Inventory (excluding GRN pages)

Paths: FE = `frontend/src`, BE = `backend/app`. All line numbers were read directly from source unless marked "(inferred)".

### Cross-cutting (applies to every Store screen)

**Access model, as the code enforces it**
- FE gate on every page: `useRequireApp('store')` (`FE/hooks/useAuth.ts:66-78`). It only checks that `'store'` is in `user.apps`. While auth is loading, or if the user lacks access, the page renders `null` and then redirects to `/dashboard`.
- BE gate on every Store endpoint: `Depends(require_app_access("store"))` (`BE/core/permissions.py:8-19`). No store endpoint uses `require_tab_access`. It is used only in `erp/routes/projects.py` and `erp/routes/service_requests.py`.
- Permission Matrix: `BE/core/permission_registry.py:67` registers `"store": {"label": "Store", "subtabs": {}}`, so there are no subtabs to grant or deny. `StoreNav` (`FE/components/store/StoreNav.tsx:8-22, 58`) does not call `filterTabsByAccess`, although CrmNav, ErpNav, OrganizationNav, P2PNav, ProjectsNav, QualityNav and RndNav all import it (`FE/lib/tabAccess.ts:11`).
- Result: **every user with store app access can view AND perform every action** in the module. That covers create/delete of items, categories, warehouses and bins; posting manual receipts, issues and write-offs; posting adjustments; cancelling anyone's reservation. No endpoint has a role, ownership or approver check.
- StoreNav shows the "GRN & Inspection" tab to every store user (`StoreNav.tsx:18-21`). The comment says GRN needs `'purchase'` app access (GRN pages are out of scope).

**Uniform patterns**
- Sub-nav placement: every page renders `<StoreNav />` as its first child, before the header block. This follows the standard.
- Back buttons: all 10 are `secondaryBtnStyle` pills labelled `← Back`, top-right in the header row (list below). 0 non-standard. Minor: on item detail in edit mode, Back is replaced by Cancel (`store/[id]/page.tsx:154-155`).
- Browser dialogs: **0** uses of `window.alert/confirm/prompt` or bare `alert(`/`confirm(`/`prompt(` in `app/dashboard/store/**` (excluding grn) or `components/store/**`. Deletes and state changes use `ConfirmDialog`. Errors use `MessageDialog`. `window.location.reload()` is used only as a MessageDialog "Reload" action.
- Posting model: every stock document posts to the ledger the moment it is created (single step). There are no draft, approve, cancel, void or reversal endpoints for issues, returns, transfers or adjustments. The routes only have `GET`, `GET /{id}` and `POST` (`material_issues.py`, `material_returns.py`, `stock_transfers.py`, `stock_adjustments.py`). Mistakes can only be fixed with a counter-document.
- Lists: every list endpoint returns **all rows, unpaginated**, and builds each row with 1–5 extra queries (N+1), e.g. `items.py:14-18,40-41`, `material_issues.py:19-38,53-54`, `stock_reservations.py:18-28,46-47`, `locations.py:13-22`. FE lists are client-rendered in a scrolling `maxHeight` box, with no pagination and no column sort. The one exception is the stock ledger, which is capped at 500 rows (see Stock).
- Exports and prints: none anywhere in scope (grep for export/csv/xlsx/print returned nothing). There is no issue slip, transfer challan or adjustment sheet.
- Load-error pattern on the detail pages (`[id]`, `issues/[id]`, `returns/[id]`, `transfers/[id]`, `adjustments/[id]`): the render condition is `loading || !doc ? "Loading…"`. If the fetch fails and the user closes the error dialog with its X, the page shows "Loading…" forever.

---

#### /dashboard/store — Item Master list  (`FE/app/dashboard/store/page.tsx`)
- **Access**: FE `useRequireApp('store')` `page.tsx:25`. BE `GET /store/items` `BE/modules/store/routes/items.py:21-28`, `require_app_access("store")` only. "Add Item" button shown to all (`page.tsx:63`).
- **Inputs**
  | field | control | req | FE validation | BE validation | notes |
  |---|---|---|---|---|---|
  | Search | text `page.tsx:71` | no | none. Refetches on every keystroke, no debounce (`page.tsx:45-48`) | `ilike` on name/code `items.py:37-39` | responses can arrive out of order and overwrite newer results (inferred) |
  | Type filter | select `page.tsx:78-88` | no | – | `item_type` eq `items.py:33-34` | BE also supports `category` and `status` filters (`items.py:23,26`), but the FE doesn't expose them |
- **Views**: columns Code, Name, Type, Category, UOM, Min / Max, Status, View (`page.tsx:95`). Status pill is orange for active and grey otherwise (`:113-116`). Loading row `:101`. Empty row `:102-104`. No pagination or sort (BE sorts by name `items.py:40`). No on-hand stock column and no below-reorder flag.
- **Findings**
  - **P1-STO-1 [USER]** The empty state always says "No items yet — add the first item to the master." (`page.tsx:103`), even when a search or type filter just returned nothing.
  - **P1-STO-2 [BA]** Min/Max/Reorder are captured but nothing uses them. No screen shows stock against them and no BE code reads `reorder_level`/`minimum_stock` (only `models/item.py`, `schemas/item.py` and the 3 item pages reference them).
  - **P1-STO-3 [ARCH]** Search fires one unthrottled request per keystroke (`page.tsx:45-48`), and each request runs N+1 queries server-side (`items.py:14-18`).

#### /dashboard/store/new — Add Item  (`FE/app/dashboard/store/new/page.tsx`)
- **Access**: FE `new/page.tsx:25`. BE `POST /store/items` `items.py:56-68` (store access only).
- **Inputs**
  | field | control | req | FE validation | BE validation (`BE/modules/store/schemas/item.py`) | mismatch / notes |
  |---|---|---|---|---|---|
  | Item Code | text `:113-115` | yes | non-blank `:58` | `str` `:5`. Uniqueness is exact-match only `items.py:62-63` | "RM-1", "rm-1" and "RM-1 " (after the FE trims) are treated as different codes. No format or length check in the FE; the DB limit is 50 (`models/item.py:23`) |
  | Item Name | text `:116-118` | yes | non-blank `:59` | `str` `:6` | – |
  | UOM | free text `:119-121` | no | none | `str\|None` `:11` | no UoM master: "KG", "Kg" and "kgs" all coexist. `secondary_uom`/`conversion_factor` (`:12-13`) have no UI |
  | Item Type | select `:124-128` | – | fixed list | `str\|None` `:7`. Not validated against `STORE_ITEM_TYPES` (`models/item.py:10`) | an API caller can store any string |
  | Category / Subcategory | selects `:129-141` | no | subcategory list is matched by `parent_name === category` (`:54`) | free text `:8-9`, not an FK (`models/item.py:16-18`) | two top-level categories with the same name mix their subcategories. Deleting or renaming a category leaves items pointing at a stale string |
  | Description / HSN / Manufacturer | text `:142-153` | no | none | free text | HSN format not checked |
  | Batch / Serial / Expiry controlled | checkboxes `:156-167` | no | – | bool `:22-24` | **no posting form enforces these flags**: batch # is optional on every issue/return/transfer line and serial numbers are never captured (see P1-STO-24). `shelf_life_days` has no UI |
  | Min / Max / Reorder / Std Cost | `type=number` `:171-182` | no | **none** | `float\|None` `:26-31`, no constraints | negative values accepted. min > max accepted. Reorder level outside min–max accepted. `safety_stock`, `reorder_quantity`, `preferred_warehouse_id`, `plant` and `preferred_supplier` have no UI |
- **Views**: form only. Cancel at `:188`.
- **Findings**
  - **P1-STO-4 [BA]** There is no numeric sanity check on stock levels or cost in the FE (`new/page.tsx:171-182`) or the BE (`schemas/item.py:26-31`). Negative min stock, negative standard cost and min > max all save.
  - **P1-STO-5 [USER]** The category list fails silently: `.catch(() => setCategories([]))` (`new/page.tsx:50`). The user just sees an empty Category dropdown with no reason given.
  - **P1-STO-6 [ARCH]** Item code uniqueness is case- and space-sensitive (`items.py:62`). Case variants create near-duplicate masters.

#### /dashboard/store/[id] — Item detail + inline edit + delete  (`FE/app/dashboard/store/[id]/page.tsx`)
There is no separate `/edit` route. Editing happens inline on this page.
- **Access**: FE `[id]/page.tsx:32`. BE `GET/PATCH/DELETE /store/items/{id}` `items.py:44-99`, store access only. Edit and Delete buttons are shown to all store users (`:159-160`).
- **Inputs (edit mode)**: the fields from Add Item minus Item Code (immutable, not in `StoreItemUpdate` `schemas/item.py:38-70`), plus Status (`:224-228`; BE `status: str|None` `:66`, not validated against `STORE_ITEM_STATUSES`). FE validation: name non-blank only (`:78-81`). BE PATCH also accepts `moving_average_cost` (`schemas/item.py:65`), so a manual override is possible via the API (see P1-STO-35).
- **Views**: read-only InfoRows (`:167-194`). Loading "Loading…" (`:142-143`). The detail page does **not** show stock by warehouse, reservations, the ledger, preferred warehouse or moving average cost.
- **Findings**
  - **P1-STO-7 [BA] (bug)** Fields cannot be cleared once set. The save builds `category: form.category || undefined`, `minimum_stock: form.minimum_stock ?? undefined`, etc. (`[id]/page.tsx:88-100`). An emptied field becomes `undefined`, JSON drops it, and the BE applies only `exclude_unset` fields (`items.py:81`). The old value stays but the UI shows success. This affects category, subcategory, description, UOM, HSN, manufacturer, min, max, reorder and cost.
  - **P1-STO-8 [BA]** Setting Status to Inactive/Discontinued has no effect. Issue, return, transfer, adjustment and reservation forms list every item (`issues/new/page.tsx:35`, `returns/new:43`, `transfers/new:34`, `adjustments/new:37`, `reservations:42`). BE posting routes never check `item.status` (e.g. `material_issues.py:79-84`).
  - **P1-STO-9 [USER]** Deleting an item that has ledger or document history hits the FK. The global handler returns "This record is still linked to other records… Please delete or re-link those records first." (`BE/core/db_errors.py:163-170`), shown in "Cannot Save Item" (`[id]:133`). The advice is impossible to follow because the ledger is immutable, and the message doesn't say which records or suggest setting Status = Inactive. `delete_item` (`items.py:88-99`) has no pre-check. The dialog title "Cannot Save Item" is also wrong for a delete.
  - **P1-STO-10 [USER]** Stuck "Loading…" after a load error. Closing the error dialog with X clears `loadError` (`:132`), but `item` is null, so `:142` shows "Loading…" forever.
  - **P1-STO-11 [USER]** Categories fail to load silently (`:63`).
  - **P1-STO-12 [ARCH]** Delete is a hard delete of a master record. There is no soft-delete or "in use" guard, while Status already provides a deactivate path.

#### /dashboard/store/categories — Category master  (`FE/app/dashboard/store/categories/page.tsx`)
- **Access**: FE `:15`. BE `GET/POST/PATCH/DELETE /store/categories` `categories.py:18-76`, store access only.
- **Inputs (Add Category modal `:117-150`)**
  | field | control | req | FE | BE (`schemas/category.py`) | notes |
  |---|---|---|---|---|---|
  | Name | text `:124` | yes | non-blank `:55` | `str` `:5` | no uniqueness check (items link by **name**, see P1-STO-14) |
  | Code | text `:128` | yes | non-blank `:56` | `str` `:6`. Unique exact-match `categories.py:37-38` | – |
  | Parent | select `:132-135` | no | top-level only (`:86-87`) | `int\|None` `:7`. Existence and depth not validated | a missing parent id surfaces as a generic FK message via `db_errors.py:163+` (inferred). An API caller can nest 3+ levels |
- **Views**: Name (indented `↳` for children), Code, Parent, Status pill, Delete (`:156-181`). Loading `:162`. Empty `:163-165`. There is no edit UI even though `PATCH` exists (`categories.py:46-60`) and `storeApi.updateCategory` is defined (`FE/lib/api.ts:1268`) but never called. There is also no activate/deactivate control, although `is_active` is displayed.
- **Findings**
  - **P1-STO-13 [USER]** Rows come back sorted alphabetically by name (`categories.py:27`) and are rendered in that order (`:166`). Subcategories therefore scatter away from their parent, and the `↳` indentation shows the wrong hierarchy.
  - **P1-STO-14 [BA]** Deleting a category (`categories.py:63-76`) checks only for subcategories. It does not check items whose free-text `category`/`subcategory` equals this name, so items keep a category that no longer exists and can't be re-selected in the item form.
  - **P1-STO-15 [USER]** Categories can't be renamed or deactivated. The only fix for a typo is delete and re-create, which breaks item links (see P1-STO-14).

#### /dashboard/store/locations — Warehouses + Bins  (`FE/app/dashboard/store/locations/page.tsx`)
Bins are managed inline under each warehouse row. There is no separate bins route.
- **Access**: FE `:21`. BE `/store/locations` `locations.py:25-84` and `/store/bins` `bins.py:13-74`, store access only.
- **Inputs — Add Warehouse modal (`:195-236`)**
  | field | control | req | FE | BE (`schemas/location.py`) | notes |
  |---|---|---|---|---|---|
  | Name | text `:202` | yes | `:75` | `str` `:5` | – |
  | Code | text `:206` | yes | `:76` | `str` `:6`. Unique `locations.py:44-45` | – |
  | Branch | select `:210-213` | no | – | `int\|None` `:7`, existence not checked | – |
  | Warehouse Type | free text `:217` | no | – | `str\|None` `:8` | – |
  | Address | textarea `:221` | no | – | `:10` | – |
  | Manager, storage_type, inventory_type, operating_hours, status | — | — | no UI | `:9-14` | editable only from Organization › Plants edit (`FE/app/dashboard/organization/plants/[id]/edit/page.tsx:618` calls `storeApi.updateLocation`) |
- **Inputs — Add Bin row (`:297-312`)**
  | field | control | req | FE | BE (`schemas/bin.py`) | notes |
  |---|---|---|---|---|---|
  | Bin type | select rack/shelf/bin `:298-300` | yes | fixed list | `str` `:7`, not validated against `STORE_BIN_TYPES` (`models/bin.py:12`) | – |
  | Code | text `:301-308` | yes | Add disabled when blank `:309` | unique per location `bins.py:35-36` | – |
  | Parent / Name | — | — | **no UI** | `parent_id`, `name` `:6,9`. Parent isn't checked to belong to the same location | the rack › shelf › bin hierarchy the model describes (`models/bin.py:9-12`) can't be built from the UI. The FE draws `├─/└─` tree glyphs over a flat list (`:287`) |
- **Views**: columns Name, Code, Branch, Type, Status, Delete (`:242`). Status pill reads `is_active` (`:268-270`), while a separate `status` string exists (`schemas/location.py:14,27`). Loading `:248`. Empty `:249-251`. Bin panel loading/empty at `:279-282`. No warehouse edit UI.
- **Findings**
  - **P1-STO-16 [USER]** Adding or removing a bin swallows every error: `catch { // swallow }` (`:148-150`, `:159-161`), and the refresh does the same (`:116-118`). A duplicate bin code (409 "Bin code … already exists in this warehouse", `bins.py:36`) or a "has child bins" error (`bins.py:70-71`) just looks like nothing happened.
  - **P1-STO-17 [USER]** Removing a bin happens on one click with no ConfirmDialog (`:291`). Warehouse and category deletes do confirm.
  - **P1-STO-18 [USER]** The load error is hard-coded to 'Failed to load warehouses.' (`:52`), which discards the real reason. It comes from a `Promise.all` with `organizationApi.listBranches()` (`:48`), so a branch-API failure (e.g. no organization access) also blanks the warehouse list.
  - **P1-STO-19 [BA]** The warehouse delete guard (`locations.py:79-81`) checks only `Branch.default_warehouse_id`. It does not check `Company.default_warehouse_id` (`organization/models/company.py:73`), GRNs (`p2p/models/goods_receipt.py:42`), PR items (`p2p/models/p2p_request_item.py:35`), bins, balances or ledger rows. Those surface as the generic "still linked to other records" 409 (`db_errors.py:167-170`).
  - **P1-STO-20 [ARCH]** Bins never hold stock. Balances are keyed on (item, location) only (`models/stock_balance.py:16`). `bin_id` exists on the ledger (`models/stock_transaction.py:31`), but no FE posting form sends it, and `POST /store/stock/transactions` doesn't check that the bin belongs to the location (`stock.py:111`). Bins are master data with no stock function.
  - **P1-STO-21 [BA]** Inactive warehouses (`is_active`/`status`) are still offered in every posting form and accepted by every posting route. Routes only check existence, e.g. `material_issues.py:77-78`.

#### /dashboard/store/stock — Balances + Ledger + Manual stock entry  (`FE/app/dashboard/store/stock/page.tsx`)
- **Access**: FE `:34`. BE `GET /store/stock/balances` `stock.py:42-69`, `GET /store/stock/transactions` `:72-88`, `POST /store/stock/transactions` `:91-125`. All store access only. "Record Stock Entry" is available to everyone (`:133`).
- **Inputs — Record Stock Entry modal (`:140-196`)**
  | field | control | req | FE | BE (`schemas/stock.py` + `stock.py`) | notes |
  |---|---|---|---|---|---|
  | Entry Type | select receipt/issue/adj+/adj-/damage `:13-19,147` | yes | fixed | must be in `_MANUAL_ALLOWED_TYPES` `stock.py:25,97-101` | the comment at `:21-24` says receipt/issue "should normally be posted by their owning doc type", yet both are allowed |
  | Item | select `:153-156` | yes | `:92` | exists `:102-103` | all items, including inactive |
  | Warehouse | select `:160-163` | yes | `:93` | exists `:104-105` | – |
  | Quantity | number `:168` | yes | > 0 `:94` | > 0 and outbound ≤ available/on-hand `stock_ledger.py:63-79` | no available qty shown in the form. Negative on-hand is blocked server-side |
  | Batch | text `:172` | no | – | free text | not required for batch-controlled items |
  | Reference No. | text `:177` | no | – | free text `schemas/stock.py:13` | the placeholder invites typing a GRN number, but nothing links it |
  | Remarks | textarea `:181` | no | – | – | **no reason is required for write-offs or adjustments** |
  | Date / Bin | — | — | no UI | `transaction_date`, `bin_id` accepted `schemas/stock.py:8,14` | backdating is possible via the API |
- **Views**: "Current Balances" table: Item, Warehouse, On Hand, Reserved, Available (`:203-221`), loading `:209`, empty `:210-212`. "Recent Movements" ledger: Date, Item, Warehouse, Type badge, Quantity, Reference, By (`:231-255`), loading `:237`, empty `:238-240`. No filters in the FE, although BE supports `item_id`/`location_id`/`transaction_type` (`stock.py:44-45,74-76`). No search, sort, pagination, running balance, value, export or date range.
- **Findings**
  - **P1-STO-22 [SEC]** Any store user can post a free-hand **receipt** (creating stock with no GRN, PO or approval) or an **issue/damage/adjustment_out** (removing stock with no document, department or approver). Remarks are optional. See `stock.py:25,91-125` and `stock/page.tsx:13-19`. This bypasses the approver that the Adjustment document at least records.
  - **P1-STO-23 [USER]** Ledger rows show quantity as a bare positive number with the same orange badge for every type (`:247-251`), so inbound and outbound can't be told apart at a glance. There is no +/− sign and no running balance.
  - **P1-STO-24 [BA]** Batch, serial and expiry control is not enforced anywhere. Batch # is optional on manual entry (`:172`), issue (`issues/new:135`), return (`returns/new:166`) and transfer (`transfers/new:135`). Balances aren't kept per batch, so an issue can quote a batch that was never received.
  - **P1-STO-25 [ARCH]** The ledger is silently truncated to 500 rows (`stock.py:87`). The UI says "Recent Movements" but never says it is capped. With no filters in the FE, older history for an item can't be reached.
  - **P1-STO-26 [ARCH]** Stock issued via P2P "issue from stock" posts `reference_type="p2p_request"` with `reference_number = PR number`, not the MI number (`p2p/routes/p2p_requests.py:820-823`). `"p2p_request"` isn't in `STORE_STOCK_TXN_REFERENCE_TYPES` (`models/stock_transaction.py:22`). In the ledger's Reference column those rows can't be traced to their Material Issue.

#### /dashboard/store/issues — Material Issue list  (`FE/app/dashboard/store/issues/page.tsx`)
- **Access**: FE `:14`. BE `GET /store/material-issues` `material_issues.py:41-54` (store access. BE filters by location/department are not used by the FE).
- **Views**: columns Issue #, Warehouse, Department, Project / WO, Date, Items (count), View (`:50`). Loading `:56`. Empty `:57-59`. No search, filter, status, pagination or export.
- **Findings**
  - **P1-STO-27 [USER]** `.catch(() => setError('Failed to load material issues.'))` (`:23`) discards the server's reason (e.g. the 403 detail "Access to 'store' module required").

#### /dashboard/store/issues/new — New Material Issue  (`FE/app/dashboard/store/issues/new/page.tsx`)
- **Access**: FE `:17`. BE `POST /store/material-issues` `material_issues.py:69-118`, store access only. `issued_by_id` = current user (`:93`).
- **Inputs**
  | field | control | req | FE | BE (`schemas/material_issue.py` + route) | notes |
  |---|---|---|---|---|---|
  | Warehouse | select `:98-103` | yes | `:46` | exists `material_issues.py:77-78` | no available stock shown for the chosen warehouse |
  | Department | select `:104-109` | no | – | `int\|None` `:28`, **existence not validated** | a bad id surfaces as the generic FK message (inferred) |
  | Project / WO | free text `:110-112` | no | – | `str\|None` `:29` | not linked to the Projects module |
  | Requested By | — | — | **no UI** | `requested_by_id` `:27`, not validated | the detail page's "Requested By" (`issues/[id]:59`) is always "—" for issues made here |
  | Linked PR | — | — | **no UI** | `p2p_request_id` exists on the model (`models/material_issue.py:26`) but is **not in the Create or Response schema** | the PR link set by the P2P flow (`p2p_requests.py:813`) can't be seen on the issue |
  | Issue date | — | — | no UI | `issue_date` `:30`, defaults to today | backdating is possible via the API only |
  | Remarks | textarea `:114-116` | no | – | – | – |
  | Line: Item | select `:124-127` | yes | line kept only if item **and** qty set `:47` | exists `:80-82` | all items, including inactive. No available qty per line |
  | Line: Quantity | number `:131` | yes | > 0 `:49-51` | > 0 `:83-84`. ≤ available (on_hand − reserved) `stock_ledger.py:70-76` → 409 with the real numbers (`:73-76`) | negative stock is correctly blocked. The error names the quantities but not **which** item (message has no item name) |
  | Line: Batch | text `:135` | no | – | free text | see P1-STO-24 |
  | Line: Remarks | — | — | no UI | `schemas/material_issue.py:9` | the detail page shows a Remarks column that is always "—" |
- **Findings**
  - **P1-STO-28 [USER]** A line with an item but a blank quantity is silently dropped (`:47`). The issue then posts without it, with no warning.
  - **P1-STO-29 [USER]** The insufficient-stock 409 (`stock_ledger.py:73-76`) doesn't name the item or line, so on a multi-line issue the user can't tell which line failed. The form never shows available stock up front (`:120-139`), so users find out by trial and error.
  - **P1-STO-30 [USER]** Items, locations and departments all load with silent catches (`:35-37`). Empty dropdowns come with no explanation.
  - **P1-STO-31 [BA]** Issues can't be cancelled or reversed. The only undo is a Material Return, which returns to stock only if the condition is "good".

#### /dashboard/store/issues/[id] — Material Issue detail  (`FE/app/dashboard/store/issues/[id]/page.tsx`)
- **Access**: FE `:14`. BE `GET /store/material-issues/{id}` `material_issues.py:57-66`.
- **Views**: summary (Warehouse, Department, Project/WO, Issue Date, Requested By, Issued By, Remarks) `:52-62`. Lines table Item, Quantity+UOM, Batch, Remarks `:71-84`. Back `:47`.
- **Findings**
  - **P1-STO-32 [USER]** There is no print or issue slip for the receiving department to sign, no link to the linked PR (see the P1-STO-26 area / missing `p2p_request_id` in the response), and no "Return against this issue" shortcut. A return means going to Returns › New and re-picking the issue from an unfiltered list.
  - **P1-STO-33 [USER]** The load error is generic ('Failed to load this material issue.', `:26`), and the page gets stuck on "Loading…" after X (`:36`).

#### /dashboard/store/returns — Material Return list  (`FE/app/dashboard/store/returns/page.tsx`)
- **Access**: FE `:14`. BE `GET /store/material-returns` `material_returns.py:44-54`.
- **Views**: Return #, Warehouse, Source (issue # or description), Date, Items, View (`:50-69`). Loading `:56`. Empty `:57-59`. No filters or search.
- **Findings**: generic `'Failed to load material returns.'` (`:23`), same as P1-STO-27.

#### /dashboard/store/returns/new — New Material Return  (`FE/app/dashboard/store/returns/new/page.tsx`)
- **Access**: FE `:23`. BE `POST /store/material-returns` `material_returns.py:69-166`, store access only.
- **Inputs**
  | field | control | req | FE | BE (`schemas/material_return.py` + route) | notes |
  |---|---|---|---|---|---|
  | Warehouse | select `:109-114` | yes | `:54` | exists `:79-80` | **not checked against the source issue's warehouse** |
  | Source | select issue/other `:115-120` | – | – | in `STORE_RETURN_SOURCE_TYPES` `:77-78` | – |
  | Material Issue | select `:122-127` | **no** | not required even when Source = issue (`:70`) | optional `:30`. Validated only if given `:81-82` | the list shows every issue by number only (`:125`), with no date, department or item filter |
  | Source Description | text `:129-131` | no | – | – | – |
  | Reason | text `:135-137` | no | – | optional `:32` | – |
  | Line: Item | select `:149-152` | yes | `:55` | exists. Must be on the source issue if one is given `:111-117` | the dropdown isn't filtered to the chosen issue's items |
  | Line: Qty | number `:156` | yes | > 0 `:57-59` | > 0 `:88-89`. ≤ issued − already returned, **only when `source_issue_id` is set** `:98-127` | the returnable qty isn't shown in the FE |
  | Line: Condition | select good/damaged/rejected `:160-162` | – | fixed | validated `:90-91`. Only "good" posts `return_in` `:152-158` | labels explain this well (`:16-20`) |
  | Line: Batch | text `:166` | no | – | free text | not checked against the issue line's batch |
- **Findings**
  - **P1-STO-34 [SEC/BA]** Returns can create stock from nothing. The returned-qty cap applies only `if payload.source_issue_id:` (`material_returns.py:98`). With Source = "Other", or Source = "Against a Material Issue" with the issue left blank (the FE allows this, `:70`), any quantity with condition "good" posts `return_in` and raises on-hand (`:152-158`). There is no approval step and no reason requirement.
  - **P1-STO-35 [BA]** A return can go into a different warehouse from the one the issue drew from, with no check (`material_returns.py:79-82`). This shifts stock between warehouses outside the Transfer document. (Unrelated gap: no valuation exists at all. Ledger rows carry no rate, and `moving_average_cost` is never computed by any BE code, so returns and issues can't be costed.)
  - **P1-STO-36 [USER]** After picking an issue, the user still has to re-pick items from the full item list and guess quantities. The form shows neither the issue's lines nor the remaining returnable qty (`:144-171`), so the only feedback is the 422 at `:120-127`, whose wording is good.
  - Silent dropdown loads `:43-45` (as P1-STO-30). Silent line drop `:55` (as P1-STO-28).

#### /dashboard/store/returns/[id] — Return detail  (`FE/app/dashboard/store/returns/[id]/page.tsx`)
- **Access**: FE `:16`. BE `GET /store/material-returns/{id}` `material_returns.py:57-66`.
- **Views**: summary (Warehouse, Source, Return Date, Reason, Returned By, Remarks) `:54-63`. Lines with a condition pill (green for good, red otherwise, `:82-86`). Back `:49`.
- **Findings**: the Source issue number is plain text, not a link to `/issues/{id}` (`:56`). Generic load error `:28` and stuck "Loading…" `:38` (as P1-STO-10). No cancel/void.

#### /dashboard/store/transfers — Stock Transfer list  (`FE/app/dashboard/store/transfers/page.tsx`)
- **Access**: FE `:14`. BE `GET /store/stock-transfers` `stock_transfers.py:36-49`.
- **Views**: Transfer #, From, To, Date, Items, View (`:50-69`). Loading `:56`. Empty `:57-59`. No filters, although BE supports from/to location.
- **Findings**: generic load error `:23`.

#### /dashboard/store/transfers/new — New Stock Transfer  (`FE/app/dashboard/store/transfers/new/page.tsx`)
- **Access**: FE `:17`. BE `POST /store/stock-transfers` `stock_transfers.py:64-123`, store access only.
- **Inputs**
  | field | control | req | FE | BE (`schemas/stock_transfer.py` + route) | notes |
  |---|---|---|---|---|---|
  | From Warehouse | select `:98-103` | yes | `:44` | exists `:74-75` | – |
  | To Warehouse | select `:104-109` | yes | `:45`. from ≠ to `:46` | from ≠ to `:72-73`. Exists `:76-77` | the "To" list doesn't exclude the chosen "From" |
  | Reason | text `:110-112` | no | – | optional `:29` | – |
  | Line Item / Qty / Batch | `:124-136` | item+qty | > 0 `:49-51`. Line dropped if qty blank `:47` | > 0 `:83-84`. `transfer_out` checks available (on_hand − reserved) `stock_ledger.py:70-76` | qty ≤ available is correctly enforced server-side. Available qty isn't shown. The 409 doesn't name the item |
  | Transfer date | — | — | no UI | optional `:28` | – |
- **Findings**
  - **P1-STO-37 [BA]** A transfer lands instantly: `transfer_out` and `transfer_in` post in the same request (`stock_transfers.py:104-115`). There is no in-transit state and no receipt confirmation at the destination, so a truck in transit already shows as available stock at the destination. There is no cancel/void, and no transfer challan print for the gate.

#### /dashboard/store/transfers/[id] — Transfer detail  (`FE/app/dashboard/store/transfers/[id]/page.tsx`)
- **Access**: FE `:14`. BE `GET /store/stock-transfers/{id}` `stock_transfers.py:52-61`.
- **Views**: summary `:52-61`. Lines `:70-82`. Back `:47`.
- **Findings**: generic load error `:26` and stuck "Loading…" `:36`. No print.

#### /dashboard/store/adjustments — Adjustment list  (`FE/app/dashboard/store/adjustments/page.tsx`)
- **Access**: FE `:14`. BE `GET /store/stock-adjustments` `stock_adjustments.py:38-48`.
- **Views**: Adjustment #, Warehouse, Date, Approved By, Items, View (`:50-69`). Loading `:56`. Empty `:57-59`. There is no approval-status column because no approval state exists.
- **Findings**: generic load error `:23`.

#### /dashboard/store/adjustments/new — New Stock Adjustment  (`FE/app/dashboard/store/adjustments/new/page.tsx`)
- **Access**: FE `:18`. BE `POST /store/stock-adjustments` `stock_adjustments.py:63-129`, store access only.
- **Inputs**
  | field | control | req | FE | BE (`schemas/stock_adjustment.py` + route) | notes |
  |---|---|---|---|---|---|
  | Warehouse | select `:115-120`. Changing it resets the lines | yes | `:62` | exists `:71-72` | – |
  | Approved By | SearchableSelect of the whole user directory `:121-130` | yes | `:63` | `approved_by_id: int` `:27`. **Only checks the user exists** `stock_adjustments.py:73-74` | see P1-STO-38 |
  | Reason | text `:131-133` | **no** | – | optional `:29` | a count correction with no reason is accepted |
  | Line: Item | select `:148-151` (disabled until a warehouse is chosen) | yes | `:64` | exists `:78-79` | – |
  | Existing Qty | read-only `:153-156` from a balance snapshot loaded once (`:42-48`) | – | – | recomputed server-side under a row lock `:102-104` | the FE's displayed difference can be stale. Only the detail page shows what actually posted |
  | Line: Actual Qty | number `:159` | yes | ≥ 0 `:66-68` | ≥ 0 `:80-81`. `adjustment_out` limited to on-hand `stock_ledger.py:77-78` | the +/− difference is shown live, colour-coded (`:161-163`) |
  | Line: Remarks | — | — | **field in state (`:15,30,84`) but no input is rendered** | `schemas/stock_adjustment.py:8` | dead field. The detail page's Remarks column is always "—" |
  | Adjustment date | — | — | no UI | optional `:28` | – |
- **Findings**
  - **P1-STO-38 [SEC]** Adjustment "approval" is only a label. The creator picks any user from the directory, which can be themselves (`adjustments/new/page.tsx:121-130`). The BE only checks that the user exists (`stock_adjustments.py:73-74`) and **posts the stock change immediately** (`:95-121`). There is no pending state, no action by the approver, no check that the approver has store access or a role, and no creator ≠ approver rule. The "Approved By" column (`adjustments/page.tsx:65`) suggests a control that doesn't exist.
  - **P1-STO-39 [BA]** Two lines for the same item in one adjustment are processed in order against the live balance (`stock_adjustments.py:102-104`). The second line's "existing" equals the first line's actual, so the net result is the last line's count, while the FE shows both diffs computed against the original snapshot (`:143,161-163`).
  - **P1-STO-40 [USER]** Balance, items, locations and directory loads all fail silently (`:37-39,47`). If balances fail, "Existing Qty" shows 0 for every item (`:53`) and the difference looks like a large positive adjustment.

#### /dashboard/store/adjustments/[id] — Adjustment detail  (`FE/app/dashboard/store/adjustments/[id]/page.tsx`)
- **Access**: FE `:14`. BE `GET /store/stock-adjustments/{id}` `stock_adjustments.py:51-60`.
- **Views**: summary (Warehouse, Date, Approved By, Reason, Created By, Remarks) `:52-61`. Lines: Existing, Actual, Difference (signed, coloured) `:70-85`. Back `:47`.
- **Findings**: generic load error `:26` and stuck "Loading…" `:36`. No reversal or print.

#### /dashboard/store/reservations — Stock Reservations (list + create modal + fulfil/cancel)  (`FE/app/dashboard/store/reservations/page.tsx`)
- **Access**: FE `:18`. BE `/store/stock-reservations` `stock_reservations.py:31-143`, store access only. **Any store user can cancel or fulfil anyone's reservation.** `_release_reservation` has no ownership check (`:99-110`).
- **Inputs — New Reservation modal (`:147-194`)**
  | field | control | req | FE | BE (`schemas/stock_reservation.py` + route) | notes |
  |---|---|---|---|---|---|
  | Item | select `:153-158` | yes | `:72` | exists `:70-71` | – |
  | Warehouse | select `:159-164` | yes | `:73` | exists `:72-73` | – |
  | Quantity | number `:165-167` | yes | > 0 `:74` | > 0 `:68-69`. ≤ available `stock_ledger.py:112-114` → 409 with the available qty | correctly blocks over-reservation. Available isn't shown in the modal |
  | Project / Production Order | free text `:168-173` | no | – | free text `:9-10` | not linked to Projects |
  | Required Date | date `:174-176` | no | none (past dates allowed) | `date\|None` `:11`, no check | **no expiry**: no auto-release when the date passes (no job or code reads `required_date`) |
  | Remarks | textarea `:177-179` | no | – | – | – |
- **Views**: Reservation #, Item, Warehouse, Quantity, Project / PO, Required Date, Status pill, actions (Fulfill/Cancel on active rows only) (`:200-229`). Loading `:206`. Empty `:207-209`. No filter, although BE supports item/location/status (`stock_reservations.py:33-35`). No reserved-by column. No detail page. No overdue highlight.
- **Findings**
  - **P1-STO-41 [BA] (workflow dead end)** Reservations deadlock the issue they're meant for. The fulfil dialog tells users to issue the material first via a Material Issue, then mark it fulfilled (`:139`; BE docstring `stock_reservations.py:131-134`). But the Material Issue isn't linked to the reservation, and `issue` is reservation-aware: it only draws on `on_hand − reserved` (`stock_ledger.py:19,70-76`). When the reservation covers the remaining stock, the issue fails with "Insufficient available stock". The user has to **fulfil or cancel first**, which releases the earmark before any material moves (a race window), and that is the opposite of what the UI says.
  - **P1-STO-42 [USER]** The cancel confirm dialog has buttons "Cancel" and "Cancel Reservation" (`:133-145`; `ConfirmDialog` default `cancelLabel='Cancel'` `FE/components/erp/ConfirmDialog.tsx:10`), so it's unclear which one cancels the reservation.
  - **P1-STO-43 [BA]** There is no expiry or overdue handling. Stale active reservations keep blocking available stock forever (`required_date` is only displayed, `:217`).

#### StoreNav  (`FE/components/store/StoreNav.tsx`)
- 10 tabs, none gated (`:8-22,58`). Tour button and NotificationBell on the right (`:88-93`).
- **P1-STO-44 [SEC/ARCH]** The Permission Matrix can't restrict any Store tab: the registry has empty subtabs (`permission_registry.py:67`), there is no `filterTabsByAccess` call in StoreNav, and no BE `require_tab_access` on store routes. So "read-only store viewer" or "store clerk without adjustment rights" can't be configured.

---

### Counts
- `window.alert/confirm/prompt` or bare `alert(`/`confirm(`/`prompt(`: **0**
- Back buttons: **10**, all standard (`new/page.tsx:106`, `[id]/page.tsx:158`, `issues/new:91`, `issues/[id]:47`, `returns/new:102`, `returns/[id]:49`, `transfers/new:91`, `transfers/[id]:47`, `adjustments/new:108`, `adjustments/[id]:47`). **0 non-standard.** One is hidden in edit mode (`[id]/page.tsx:154-155`).
- Sub-nav below header: **0** (all pages render StoreNav first).
- Generic/swallowed errors: hard-coded load messages that drop the server reason in 10 places (`issues/page:23`, `issues/[id]:26`, `returns/page:23`, `returns/[id]:28`, `transfers/page:23`, `transfers/[id]:26`, `adjustments/page:23`, `adjustments/[id]:26`, `locations:52`, plus the reservation action fallback, which does pass the real reason). Silent `catch` blocks: `new:50`, `[id]:63`, `locations:116-118,133-134,148-150,159-161`, `issues/new:35-37`, `returns/new:43-45`, `transfers/new:34-35`, `adjustments/new:37-39,47`.


---

## 2.6 Quality module review (36 pages)

Scope read: `frontend/src/app/dashboard/quality/**` (36 `page.tsx`), `frontend/src/components/quality/QualityNav.tsx`, `backend/app/modules/quality/{routes,schemas,models}/**`, `service.py`. Also consulted for context: `core/permissions.py`, `core/permission_registry.py`, `lib/tabAccess.ts`, `hooks/useAuth.ts`, `lib/validation.ts`, `middleware/error_handler.py`, `core/db_errors.py`, `utils/sharepoint.py`.
Paths below: FE = `frontend/src`, BE = `backend/app/modules/quality` unless stated.

---

### 0. Cross-cutting facts (apply to every screen below)

**Access model (identical on all 36 pages / 11 routers)**
- FE gate: every page calls only `useRequireApp('quality')` (e.g. FE/app/dashboard/quality/page.tsx:32, ncr/page.tsx:23) → redirects to `/dashboard` if `user.apps` lacks `quality` (FE/hooks/useAuth.ts:66-78). No page-level Permission-Matrix check and no per-action check; Save/Delete/Status controls are shown to every quality user.
- Nav: `QualityNav` hides tabs via `filterTabsByAccess('quality', TABS, user)` (FE/components/quality/QualityNav.tsx:65; FE/lib/tabAccess.ts:11-22) — cosmetic only; a hidden tab's URL still loads.
- BE gate: every router has only `dependencies=[Depends(require_app_access("quality"))]` (routes/standards.py:12, checklists.py:14, inspection_plans.py:17-20, inspections.py:16-19, ncr.py:14-17, rejections.py:17-20, capa.py:14-17, complaints.py:21-24, supplier_quality.py:17-20, documents.py:16-19, dashboard.py:15-18). `require_tab_access` exists (BE/../../core/permissions.py:36-47) but is used only by ERP projects/service_requests — never in Quality. PATCH/DELETE handlers don't even take a `user` dependency (e.g. ncr.py:104-109, 139-140).
- ⇒ **Anyone with the quality app can create, edit, delete, close or re-open any NCR, CAPA, complaint, rejection, inspection, standard, checklist, plan and scorecard, and set any status value.** Only exception: document delete (uploader or admin, documents.py:121-122).

**Layout conformance**
- Sub-nav above header: ✅ all 36 pages render `<QualityNav />` as the first child before the header block.
- Back buttons: ✅ 22/22 new+detail pages use `secondaryBtnStyle` "← Back", top-right in header row (e.g. standards/new/page.tsx:74). List pages/dashboard/reports/documents have no Back (correct).
- Browser dialogs: ✅ 0 `window.alert/confirm/prompt`; all deletes use `ConfirmDialog`.
- Error banners: all use `extractErrorMessages(err, 'Failed to …')`; fallback text only appears when the server gives no `detail`, so real BE reasons surface in most cases (FE/lib/validation.ts:49-71). Exceptions noted per screen.

**Repeated patterns (cited once, referenced as [PAT-x] below)**
- **[PAT-A] Blank page on load error** — every `[id]` page does `if (loading || !entity) return null` after `setError(...)`, so on a 404/403/500 the error banner is never rendered and there's no Back button: standards/[id]:321, checklists/[id]:62, inspection-plans/[id]:77, incoming/in-process/final-inspection/[id]:91, ncr/[id]:93, capa/[id]:76, complaints/[id]:84, rejections/[id]:69, supplier-quality/[id]:70. Pages that `Promise.all` side lists (plans, users, capas) also blank-out if any side list fails (e.g. capa/[id]:55, ncr/[id]:64-69).
- **[PAT-B] Optional fields can't be cleared on edit** — FE sends `x.trim() || undefined` / `id ? Number(id) : undefined`; axios drops `undefined` keys, BE uses `model_dump(exclude_unset=True)` (e.g. ncr.py:111) → the old value stays. Save appears to succeed. Examples: standards/[id]:333-335, inspection-plans/[id]:87-91, incoming-inspection/[id]:108-118, ncr/[id]:106-112, capa/[id]:86-92, complaints/[id]:96-104, rejections/[id]:78-87, supplier-quality/[id]:79-86.
- **[PAT-C] No save confirmation** — detail pages only `setEntity(updated)` on success (e.g. standards/[id]:338); no toast/banner, button just returns from "Saving…".
- **[PAT-D] Stale error banner** — list pages never `setError('')` before refetch (e.g. standards/page.tsx:30-37, ncr/page.tsx:33-44, documents/page.tsx:73-82), so a transient failure's banner stays after the filter change succeeds.
- **[PAT-E] No pagination / full-table loads** — every list endpoint returns `.all()` (e.g. ncr.py:59) with per-row `db.query(User)` lookups in `_to_response` (N+1: ncr.py:20-30, capa.py:20-30, inspections.py:25-31); inspections list eager-loads results+attachments for list rows (inspections.py:51-54). FE tables are client-rendered with `maxHeight: calc(100vh - 320px)` scroll, no page size, no sort control (fixed `created_at desc`).
- **[PAT-F] Delete of a referenced record** — FKs have no `ondelete`, routes don't pre-check (e.g. standards.py:110-115). DB raises FK violation → `db_errors` returns 409 "This record is still linked to other records, so it can't be removed. Please delete or re-link those records first." (BE/../../core/db_errors.py FK branch) — real-ish, but doesn't say *which* records (e.g. "3 inspection plans").
- **[PAT-G] Required dates not starred** — `inspection_date`, `ncr_date`, `complaint_date`, `rejection_date` are required in Pydantic but labels have no `*`; if the user clears the pre-filled date FE sends `undefined` → 422 "… Date: Field required" only after submit.
- **[PAT-H] Default date is UTC** — `new Date().toISOString().slice(0,10)` (incoming-inspection/new:43 and siblings, ncr/new:38, complaints/new:34, rejections/new:35) → before 05:30 IST the default is yesterday.
- **[PAT-I] No length limits on FE** — `maxLength` absent everywhere; BE Pydantic has no `Field(max_length)`; overflow is explained post-submit by `db_errors` (STRING_TOO_LONG). Tight columns: scorecard `period` String(20) (models/supplier_quality.py:22), document `version` String(20) (models/quality_document.py:20), `sampling_plan` String(255) behind a textarea (models/inspection_plan.py:29), inspection `observed_value` String(255) (models/inspection.py:63).
- **No exports / prints / PDFs anywhere in the module** (grep for print/Export/csv/xlsx in quality pages: none).

---

### 1. `/dashboard/quality` — Quality dashboard KPIs  (FE/app/dashboard/quality/page.tsx)
- **Access**: FE `useRequireApp('quality')` page.tsx:32. BE `GET /quality/dashboard` router dep dashboard.py:15-18. No tab gate for `dashboard` subtab.
- **Inputs**: none.
- **Views**: 9 KPI cards (page.tsx:13-23): Open NCRs, Critical NCRs, Open CAPAs, Overdue CAPAs, Pending Inspections, Failed Inspections (30d), Open Complaints, Open Rejections, Active Standards. Counts computed in dashboard.py:25-55. Loading = "…" per card (page.tsx:83); error banner page.tsx:61-65; on error cards show "—". No drill-down, no date filter.
- **Findings**
  - P1-QA-1 [BA] "Open CAPAs" = status in (open,in_progress,pending_verification) (dashboard.py:32-34) — excludes CAPAs whose *status* is `overdue`; "Overdue CAPAs" = status≠closed AND due_date<today (dashboard.py:35-39). A CAPA manually set to `overdue` status with no due date is in neither card; one with status `overdue` and a future due date is in neither. `overdue` should not be a manual status (see P1-QA-24).
  - P1-QA-2 [BA] "Pending Inspections" is inflated: every inspection is force-created as `pending` regardless of what the user picked (inspections.py:100; see P1-QA-5).
  - P1-QA-3 [USER] KPI cards are not clickable (page.tsx:67-87) — dead end; user must re-navigate and re-filter the list manually.

### 2. `/dashboard/quality/reports` — Summary breakdowns  (FE/app/dashboard/quality/reports/page.tsx)
- **Access**: FE page.tsx:42; BE uses the four list endpoints (ncr/inspections/capa/supplier-quality routers).
- **Views**: NCR by severity, NCR by status, inspection pass/fail/pending, CAPA by status, supplier avg quality/OTD score + count (reports/page.tsx:130-200). Loading "Loading report data…" (:124-127); per-section empty states (:132, :143, :154, :167, :178). No date range, no filters, no export/print.
- **Findings**
  - P1-QA-4 [ARCH] Loads 4 whole tables client-side (reports/page.tsx:54-59), including every inspection's results+attachments (inspections.py:51-54). Grows unbounded [PAT-E].
  - P1-QA-4a [BA] "Passed" bar includes `conditionally_passed` (reports/page.tsx:83) — conditional passes should be shown separately for a QA report. No period selector makes the numbers "all-time" only.

### 3. Standards — `/standards`, `/standards/new`, `/standards/[id]`
Files: FE/app/dashboard/quality/standards/page.tsx, standards/new/page.tsx, standards/[id]/page.tsx. BE routes/standards.py, schemas/quality_standard.py. (new and [id] duplicate the same form inline — no shared component.)
- **Access**: FE list :21, new :25, [id] :26 (`useRequireApp`). BE router standards.py:12; create adds `user` dep :56; PATCH :84-89 / DELETE :110-111 no user.
- **Inputs**

| Field | Control | Req | FE validation | BE validation | Notes |
|---|---|---|---|---|---|
| standard_code | text | Y | trim non-empty new:40 / [id]:325 | `str` schema:6; unique 409 standards.py:60-61, 97-100 | No length/format check; String(50) |
| title | text | Y | trim non-empty new:41 | `str` schema:7 | Empty string `""` passes BE if called directly |
| category | text (free) | N | — | — | Free text; list filter by category exists in BE (standards.py:34) but not in UI |
| effective_date | DateField | N | — | `date` | — |
| status | select draft/active/obsolete | N | — | in `QUALITY_STANDARD_STATUSES` standards.py:58-59, 93-95 | New defaults `draft` (new:33) while BE default is `active` (schema:11) |
| description | textarea | N | — | — | — |

- **Views**: list columns Code, Title, Category, Effective Date, Status, View (page.tsx:98). Search = client-side over code/title/category (page.tsx:41-45) although BE supports `search` (standards.py:43-47); status filter server-side (:33). Loading/empty rows :106-109. Status badge colours :12-13. Detail shows "Created by … on …" ([id]:411-413).
- **Findings**
  - P1-QA-6 [USER] Delete of a standard used by a plan or document → generic 409 [PAT-F]; FK standards referenced by models/inspection_plan.py:28 and models/quality_document.py:21.
  - P1-QA-7 [USER] Clearing Category/Description/Effective Date on edit is silently ignored [PAT-B] (standards/[id]:333-335). [PAT-A] [id]:321. [PAT-C] [id]:338.

### 4. Checklists — `/checklists`, `/checklists/new`, `/checklists/[id]`
Files: checklists/page.tsx, checklists/new/page.tsx, checklists/[id]/page.tsx. BE routes/checklists.py, schemas/quality_checklist.py.
- **Access**: FE list :21, new :28, [id] :29. BE checklists.py:14; create user dep :45.
- **Inputs**

| Field | Control | Req | FE | BE | Notes |
|---|---|---|---|---|---|
| name | text | Y | new:48 | `str` schema:23 | no uniqueness |
| category | text | N | — | — | free text |
| status | select active/inactive | N | — | **Create schema has no `status`** (schema:22-26); PATCH validates set (checklists.py:84-86) | see P1-QA-8 |
| description | textarea | N | — | — | — |
| items[].parameter | text | Y (≥1 row) | rows with blank parameter dropped; ≥1 required new:49-50 | `str` schema:6 | — |
| items[].method / acceptance_criteria | text | N | — | — | acceptance criteria is free text only (no min/max/unit) |

- **Views**: list Name, Category, Items (count), Status, View (page.tsx:97); client search name/category (:41-45) though BE supports `search` (checklists.py:35-36); status filter server-side. Loading/empty :105-108. Item editor with + Add Item / Remove (new:117-148).
- **Findings**
  - P1-QA-8 [BA][USER] Status chosen on **New Checklist** is silently discarded: FE sends `status` (checklists/new:58, control :102-108) but `QualityChecklistCreate` has no status field (schema:22-26) → always saved `active`.
  - P1-QA-9 [BA] Deleting a checklist linked to a plan → [PAT-F] (models/inspection_plan.py:27). No "used by N plans" indicator on detail.
  - [PAT-A] [id]:62, [PAT-B] [id]:80-81, [PAT-C] [id]:85.

### 5. Inspection Plans — `/inspection-plans`, `/new`, `/[id]`
Files: inspection-plans/page.tsx, inspection-plans/new/page.tsx, inspection-plans/[id]/page.tsx. BE routes/inspection_plans.py, schemas/inspection_plan.py, service.py:30-41 (IP-YYYY-NNNN).
- **Access**: FE list :22, new :25, [id] :26. BE inspection_plans.py:17-20; create user dep :62.
- **Inputs**

| Field | Control | Req | FE | BE | Notes |
|---|---|---|---|---|---|
| item_name | text | Y | new:57 | `str` | free text — no item master picker |
| item_code | text | N | — | — | — |
| inspection_type | select incoming/in_process/final | Y | fixed options | in set inspection_plans.py:64-65, 102-104 | Can be changed on edit even when inspections already use the plan |
| status | select active/inactive | N | — | **not in Create schema** (schema:5-11); PATCH validated :105-107 | P1-QA-10 |
| checklist_id | SearchableSelect | N | — | exists-check 404 :66-67, :108-110 | options include inactive checklists (new:46) |
| standard_id | SearchableSelect | N | — | exists-check 404 :68-69, :111-113 | options include draft/obsolete standards (new:46) |
| sampling_plan | textarea | N | — | — | String(255) [PAT-I] |

- **Views**: list Plan #, Item, Type, Checklist, Standard, Status, View (page.tsx:95); filters type + status (server) :75-85; **no search**. Loading/empty :103-106.
- **Findings**
  - P1-QA-10 [BA][USER] Status chosen on New Plan is discarded (inspection-plans/new:68 vs schema:5-11) → always `active`.
  - P1-QA-11 [USER] Can't unlink checklist/standard once set [PAT-B] (inspection-plans/[id]:89-90).
  - P1-QA-12 [BA] Checklist/Standard pickers list inactive checklists and draft/obsolete standards (new:46, [id]:55-56); inspection "new" pages list inactive plans (incoming-inspection/new:53).

### 6. Inspections — Incoming / In-Process / Final (list, new, [id]) — 9 pages
Files (three near-identical copies, differences only type string + Vendor Name vs Project Label):
FE/app/dashboard/quality/incoming-inspection/{page,new/page,[id]/page}.tsx, in-process-inspection/{…}, final-inspection/{…}. BE routes/inspections.py, schemas/inspection.py, models/inspection.py, service.py:101-114 (INSP-INC/PROC/FIN-YYYY-NNNN).
- **Access**: FE `useRequireApp` (list :21, new :30, [id] :31 in each copy). BE inspections.py:16-19; create user dep :72; PATCH :129-134 and DELETE :176-177 no user. Subtabs `incoming_inspection`/`in_process_inspection`/`final_inspection` not enforced.
- **Inputs** (new & [id])

| Field | Control | Req | FE | BE | Notes |
|---|---|---|---|---|---|
| inspection_type | hidden constant | Y | hard-coded per route (new:72) | in set inspections.py:74-75 | Update schema has no type (schema:54-69); FE still sends it ([id]:107) — ignored |
| item_name | text | Y | new:66 | `str` | free text |
| item_code, batch_number | text | N | — | — | — |
| vendor_name (incoming only) | **free text** | N | — | `str|None` | `vendor_id` exists in schema:45 but never sent; no vendor picker |
| project_label (in-process/final) | free text | N | — | — | no link to Projects module |
| p2p_request_id | **no UI** | — | — | FK to p2p_requests (models/inspection.py:37), not exists-checked (inspections.py:95) | No PR/PO/GRN link from UI |
| quantity_inspected/accepted/rejected | number | N | none | `float|None` | P1-QA-16 |
| inspection_plan_id | SearchableSelect (plans of same type) | N | — | exists-check 404 :76-79, :141-143 | P1-QA-15 |
| inspection_date | DateField (default today UTC) | **Y (BE)** | none | `date` required schema:49 | [PAT-G] [PAT-H] |
| status | select 5 values | — | — | **Create: ignored, forced `pending`** (inspections.py:100); PATCH: any of 5 values (:138-140) | P1-QA-5 |
| remarks | textarea | N | — | — | — |
| results[].parameter | text | row kept only if non-blank (new:70) | — | `str` | — |
| results[].method/acceptance_criteria/observed_value | text | N | — | free text | no numeric tolerance fields |
| results[].result | select N/A/Pass/Fail, default N/A (new:16) | N | — | in (pass,fail,na) :105-107, :153-156 | — |
| attachments | **no UI** | — | — | **no endpoint** | P1-QA-14 |

- **Views**: list Inspection #, Item, Batch, Vendor (incoming) / Project (in-process, final), Qty Inspected, Date, Status, View (incoming-inspection/page.tsx:97); status filter + search both server-side (:33-36); Loading/empty :105-108; status badges :12-13. Detail = editable form + results grid; no attachments, no inspector shown (BE returns `inspected_by_name` but FE never renders it), no print/inspection report.
- **Findings**
  - P1-QA-5 [BA][USER] **Status picked on New Inspection is silently thrown away** — FE sends `status` (incoming-inspection/new:82, select :162-171) but `QualityInspectionCreate` has no status (schema:36-51) and route hard-codes `status="pending"` (inspections.py:100). A user who records a completed inspection as "Failed" gets "Pending"; the failed inspection then doesn't appear in the NCR "Related Inspection" picker (ncr/new:46) until someone edits it.
  - P1-QA-13 [USER] In-Process list heading renders **" Inspection"** (in-process-inspection/page.tsx:53) — the word "In-Process" was dropped.
  - P1-QA-14 [BA] **Inspection attachments are unreachable**: table + relationship (models/inspection.py:47-49, 70-82) and response field (schemas/inspection.py:26-33, 97) exist, but inspections.py has no upload/list/delete route and no FE page renders `attachments`. Test certificates/photos can't be attached to an inspection.
  - P1-QA-15 [BA] Choosing an Inspection Plan does not pre-fill Results from the plan's checklist (new:151-156 just stores the id), contrary to the model contract "items are copied onto a QualityInspection's results when an inspection is raised against a plan" (models/quality_checklist.py:15-18). Inspector re-types every parameter → the plan/checklist setup is functionally unused.
  - P1-QA-16 [USER][BA] No quantity rules: negatives allowed, accepted+rejected > inspected allowed, rejected>0 with status Passed allowed (FE new:137-148 no checks; BE schema:42-44 plain floats, no `ge=0`, no cross-field validator).
  - P1-QA-17 [BA] Overall status is not derived from results (all rows "Fail" can be saved as "Passed"), and acceptance criteria / observed value are free text (models/inspection.py:62-63) — no min/max/nominal/unit/tolerance, so out-of-tolerance can't be auto-flagged. New rows default to "N/A" (new:16) which hides un-evaluated rows.
  - P1-QA-18 [BA] No link to procurement: `p2p_request_id` supported in schema:47 but no FE field; vendor is free text (`vendor_id` never set) → incoming inspections can't be tied to a PR/PO/GRN or vendor, and supplier scorecards can't be computed from them.
  - P1-QA-19 [USER] Search placeholder promises "inspection #, item, batch, or vendor" (incoming-inspection/page.tsx:76; in-process/final say "…batch, or project") but BE searches only `item_name` and `inspection_number` (inspections.py:59-63).
  - P1-QA-20 [ARCH] Search triggers a server request on every keystroke (effect deps include `search`, incoming-inspection/page.tsx:40; same in ncr/page.tsx:44, complaints/page.tsx:44) with no debounce/abort → out-of-order responses can show results for an older query.
  - P1-QA-21 [BA] `[id]` pages don't check that the record's type matches the route: `/incoming-inspection/<id of a final inspection>` loads under the Incoming heading and the plan dropdown (filtered to incoming, [id]:64) shows the linked final plan as blank.
  - P1-QA-22 [USER] No "Raise NCR" / "Record Rejection" action on a failed inspection — user must go to NCR → New, re-type item name/code (NCR picker doesn't auto-fill item from the chosen inspection, ncr/new:121-126).
  - Deleting an inspection referenced by an NCR/rejection → [PAT-F]. [PAT-A] [id]:91, [PAT-B] quantities/plan/vendor can't be cleared [id]:108-118, [PAT-C] [id]:121, [PAT-G] new:159, [PAT-H] new:43.

### 7. NCR — `/ncr`, `/ncr/new`, `/ncr/[id]`
Files: ncr/page.tsx, ncr/new/page.tsx, ncr/[id]/page.tsx. BE routes/ncr.py, schemas/ncr.py, models/ncr.py, service.py:43-54.
- **Access**: FE list :23, new :26, [id] :33. BE ncr.py:14-17; create user dep :67; PATCH/DELETE no user (:104-109, :139-140). **Any quality user can close, reject, cancel or delete any NCR.**
- **Inputs**

| Field | Control | Req | FE | BE | Notes |
|---|---|---|---|---|---|
| source | select inspection/complaint/internal | Y | — | in set ncr.py:69-70, :113-115 | "Complaint" has no complaint picker; model has no complaint_id (models/ncr.py:24) |
| severity | select minor/major/critical | Y | — | in set :71-72, :116-118 | — |
| status ([id] only) | select 6 values | — | — | any of 6 (:119-121); closed_at set once on close (:128-129) | P1-QA-23 |
| inspection_id | SearchableSelect of **currently failed** inspections, only when source=inspection | N | — | exists-check 404 :73-76, :122-126 | P1-QA-25 |
| item_name | text | Y | new:53 | `str` | not auto-filled from inspection |
| item_code | text | N | — | — | — |
| ncr_date | DateField | **Y (BE)** | — | `date` schema:13 | [PAT-G] [PAT-H] |
| description | textarea | Y | new:54 | `str` | — |
| root_cause | textarea | N | — | — | not required to close |
| remarks | textarea | N | — | — | — |

- **Views**: list NCR Number, Item, Severity badge, Status badge, NCR Date, View (ncr/page.tsx:108); search (server: item/number/description, ncr.py:52-58), severity + status filters; Loading/empty :116-119. Detail: form + "Raised by" footer ([id]:221-223) + linked Rejections and CAPA cards (shown only when non-empty, [id]:226-274). No NCR PDF/print, no history/audit.
- **Findings**
  - P1-QA-23 [BA][SEC] NCR lifecycle is a free dropdown ([id]:175-183 → ncr.py:119-132): can jump open→closed with no root cause, with CAPAs still open, and by any quality user (no approver/QA-head check). Re-opening a closed NCR keeps the old `closed_at` (only set when None, ncr.py:128-129). Status `capa_assigned` is manual — creating a CAPA against the NCR doesn't set it (capa.py:58-83).
  - P1-QA-25 [USER] "Related Inspection" options are only *currently failed* inspections ([id]:66, 188-193). If the linked inspection's status later changes, `SearchableSelect` finds no matching option and shows blank (FE/components/erp/SearchableSelect.tsx:31) — looks unlinked. Changing Source away from "Inspection" hides the picker and sends `inspection_id: undefined` ([id]:106) → the old link silently persists [PAT-B].
  - P1-QA-26 [USER] Linked-record badges show raw enum values ("in_progress", "pending_verification") — ncr/[id]:243, :268 (label maps exist only for colour).
  - P1-QA-27 [USER] Extra clicks: no "+ CAPA" / "+ Rejection" buttons on the NCR; Rejections/CAPA sections are hidden when empty ([id]:226, :251), so there's no in-context way to start the loop. CAPA/Rejection creation then needs the NCR's *database id* (P1-QA-29).
  - P1-QA-28 [BA] Source "Complaint" can't reference a complaint (no field; models/ncr.py) — traceability complaint→NCR is lost.
  - Delete NCR with CAPA/rejection → [PAT-F]. [PAT-A] [id]:93.

### 8. Rejections — `/rejections`, `/rejections/new`, `/rejections/[id]`
Files: rejections/page.tsx, rejections/new/page.tsx, rejections/[id]/page.tsx. BE routes/rejections.py, schemas/rejection.py.
- **Access**: FE list :22, new :25, [id] :26. BE rejections.py:17-20; **create has no user dep and no creator column** (rejections.py:54-58; models/rejection.py) — who raised a rejection is not recorded.
- **Inputs**

| Field | Control | Req | FE | BE | Notes |
|---|---|---|---|---|---|
| ncr_id | **number input "NCR ID"** | N | — | exists-check 404 :61-62, :109-111 | raw DB id (P1-QA-29) |
| inspection_id | **number input "Inspection ID"** | N | — | exists-check 404 :63-66, :112-116 | raw DB id; detail never shows the inspection number |
| item_name | text | Y | new:43 | `str` | not auto-filled from NCR/inspection |
| item_code | text | N | — | — | — |
| quantity | number | N | none | `float|None` | negatives allowed; not checked against inspection's rejected qty |
| disposition | select RTV/scrap/rework/use-as-is | Y | — | in set :59-60, :103-105 | "Use As Is" needs no approval/concession |
| vendor_name | free text | N | — | — | vendor_id never sent |
| rejection_date | DateField | **Y (BE)** | — | `date` schema:14 | [PAT-G] [PAT-H] |
| status ([id]) | select open/in_progress/closed | — | — | in set :106-108 | no closure data captured |
| remarks | textarea | N | — | — | — |

- **Views**: list Rejection Number, Item, Disposition, Status, Rejection Date, View (page.tsx:96); filters status + "Filter by NCR ID…" (raw id, :77); no search. Loading/empty :105-107. Detail footer "Linked to NCR NCR-…" as plain text (rejections/[id]:183-187), not a link.
- **Findings**
  - P1-QA-29 [USER][BA] **Links entered as raw database IDs**: Rejection "NCR ID"/"Inspection ID" (rejections/new:91-98, [id]:133-140), CAPA "NCR ID" (capa/new:104-107, capa/[id]:146-149), complaint "Customer Org ID" (complaints/new:98-99), scorecard "Vendor ID" (supplier-quality/new:89-90), and list filters "Filter by NCR ID…" (capa/page.tsx:78-83, rejections/page.tsx:77). No list or detail ever displays these ids (they show NCR-2026-0001 etc.), so users can't know what to type; a wrong id links the wrong record silently if it exists.
  - P1-QA-30 [USER] Linked NCR on rejection/CAPA shown as plain text, not a link (rejections/[id]:183-187, capa/[id]:190-194) — dead end back to the NCR.
  - [PAT-A] [id]:69, [PAT-B] [id]:78-87.

### 9. CAPA — `/capa`, `/capa/new`, `/capa/[id]`
Files: capa/page.tsx, capa/new/page.tsx, capa/[id]/page.tsx. BE routes/capa.py, schemas/capa.py, models/capa.py.
- **Access**: FE list :23, new :26, [id] :27. BE capa.py:14-17; **create has no user dep / no creator recorded** (capa.py:58-62). PATCH/DELETE no user. Anyone can move a CAPA to Closed or Overdue.
- **Inputs**

| Field | Control | Req | FE | BE | Notes |
|---|---|---|---|---|---|
| action_type | select corrective/preventive | Y | — | in set :63-64, :101-103 | — |
| ncr_id | number "NCR ID" | N | — | exists-check 404 :65-66, :107-109 | raw id (P1-QA-29) |
| complaint_id | **no UI** | — | — | **not validated** (capa.py:72), FK models/capa.py:22-24 | P1-QA-31 |
| title | text | Y | new:51 | `str` | — |
| responsible_user_id | SearchableSelect of `usersApi.directory()` | N | — | **not validated** (capa.py:76) → FK 400 via db_errors | — |
| due_date | DateField | N | — | `date` | no ≥ today check; no check vs NCR date |
| root_cause | textarea | N | — | — | — |
| action_plan | textarea | **Y (BE)** | **none; label has no \*** (new:130-133) | `action_plan: str` required schema:11 | P1-QA-32 |
| verification_notes ([id]) | textarea | N | — | — | not required to close |
| status ([id]) | select open/in_progress/pending_verification/closed/**overdue** | — | — | in set :104-106; closed_at once :111-112 | P1-QA-24 |

- **Views**: list CAPA Number, Type badge, Title, Status badge, Due Date, View (capa/page.tsx:106); filters raw NCR id, type, status (server); **no search**; no responsible-user column/filter ("my CAPAs" impossible). Loading/empty :114-117. Detail shows "Linked to NCR …" text only.
- **Findings**
  - P1-QA-24 [BA] `overdue` is a manually selectable status (capa/[id]:157; models/capa.py:9) while the dashboard also computes overdue from due_date (dashboard.py:35-39) — two sources of truth (see P1-QA-1). Closing needs no verification notes / effectiveness check and no second person ([id]:150-158 → capa.py:104-115); reopen keeps old `closed_at`.
  - P1-QA-32 [USER] "Action Plan" is required by the API (schemas/capa.py:11) but optional-looking in the form (capa/new:130-133, no `*`, not validated at new:49-51) → user fills the form, clicks Save, and gets "Action Plan: Field required" only from the server.
  - P1-QA-31 [BA] CAPA ↔ complaint link is impossible from the UI: no complaint field on CAPA new/edit, and BE `list_capas` has no `complaint_id` filter (capa.py:41-45) — see P1-QA-33 for the resulting bug.
  - P1-QA-34 [USER] No "responsible user" shown on list; responsible user gets no notification (inferred — no notification call in capa.py).
  - [PAT-A] [id]:76 (also blanks if `usersApi.directory()` fails, :55), [PAT-B] [id]:86-92 (can't unlink NCR, clear due date or responsible user).

### 10. Customer Complaints — `/complaints`, `/complaints/new`, `/complaints/[id]`
Files: complaints/page.tsx, complaints/new/page.tsx, complaints/[id]/page.tsx. BE routes/complaints.py, schemas/customer_complaint.py.
- **Access**: FE list :23, new :25, [id] :30. BE complaints.py:21-24; create records `received_by_id` (:70, :84).
- **Inputs**

| Field | Control | Req | FE | BE | Notes |
|---|---|---|---|---|---|
| customer_name | **free text** | Y | new:43 | `str` | no CRM org picker |
| customer_org_id | number "Customer Org ID" | N | — | unvalidated plain int (models/customer_complaint.py:25) | raw id (P1-QA-29) |
| item_name | text | **Y (FE)** | new:44 | optional in BE (schema:8) | FE stricter than BE |
| item_code | text | N | — | — | — |
| severity | select | Y | — | in set :72-73, :110-112 | — |
| complaint_date | DateField | **Y (BE)** | — | `date` schema:12 | [PAT-G] [PAT-H] |
| description | textarea | Y | new:45 | `str` | — |
| resolution_notes / remarks | textarea | N | — | — | Resolution notes offered on *create* — odd before investigation |
| status ([id]) | select 6 values | — | — | any of 6 (:113-115) | no rule e.g. resolved requires resolution notes |

- **Views**: list Complaint Number, Customer, Item, Severity, Status, Complaint Date, View (complaints/page.tsx:108); server search + severity + status filters; Loading/empty :117-119. Detail shows "Received by …" and a CAPA list.
- **Findings**
  - P1-QA-33 [BA][USER] **Complaint detail lists every CAPA in the system as "linked"**: FE calls `listCapas({ complaint_id })` (complaints/[id]/page.tsx:61) but `GET /quality/capa` has no `complaint_id` parameter (capa.py:41-45), so the filter is ignored and all CAPAs are returned and rendered under "CAPA" (:207-230).
  - P1-QA-35 [USER] Search placeholder "complaint number, customer, or item" (complaints/page.tsx:80) — BE searches customer_name, complaint_number and **description**, not item (complaints.py:55-61).
  - P1-QA-36 [USER] Raw status text in CAPA badges (complaints/[id]:224). No "Raise NCR"/"Raise CAPA" actions from a complaint (dead end).
  - Delete complaint referenced by a CAPA → [PAT-F]. [PAT-A] [id]:84, [PAT-B] [id]:96-104.

### 11. Supplier Quality — `/supplier-quality`, `/new`, `/[id]`
Files: supplier-quality/page.tsx, supplier-quality/new/page.tsx, supplier-quality/[id]/page.tsx. BE routes/supplier_quality.py, schemas/supplier_quality.py.
- **Access**: FE list :21, new :24, [id] :25. BE supplier_quality.py:17-20; create user dep :61.
- **Inputs**

| Field | Control | Req | FE | BE | Notes |
|---|---|---|---|---|---|
| vendor_name | **no field at all** | **Y (BE)** | — | `vendor_name: str` required (schema:7) | P1-QA-37 |
| vendor_id | number "Vendor ID" | N | — | unvalidated int | raw id |
| period | text "e.g. 2026-Q1" | Y | new:41 | `str`, String(20) | free text, no format; no uniqueness per vendor+period |
| quality_score / on_time_delivery_score | number min 0 max 100 (HTML attrs only, new:98,102) | N | not enforced in submit | `float|None`, no bounds (schema:9-10) | 250 or -5 accepted |
| rejection_count / ncr_count | number min 0 | N | not enforced | `int`, default 0 | manually typed, not computed from rejections/NCRs |
| status | select draft/final | N | — | in set :63-64, :99-101 | final still editable/deletable |
| notes | textarea | N | — | — | — |

- **Views**: list Vendor (shows `vendor_name || "Vendor #id"`), Period, Quality Score, On-Time Delivery, Rejections, NCRs, Status, View (supplier-quality/page.tsx:103, :118); filters Vendor ID (raw), Period (exact match), status. Loading/empty :112-114.
- **Findings**
  - P1-QA-37 [USER][BA] **Creating a scorecard always fails**: the form has no Vendor Name input and doesn't send `vendor_name` (supplier-quality/new:45-54; FE type `QualitySupplierScorecardInput` also lacks it, FE/types/index.ts:2291-2300), but BE requires it (schemas/supplier_quality.py:7) → every Save returns 422 "Vendor Name: Field required" and the user has no field to fix it. Edit page likewise can't change the vendor name ([id]:79-86). The whole Supplier Quality screen and the Reports supplier section are effectively unusable.
  - P1-QA-38 [BA] Scores/counts are hand-entered and unbounded (see table); scorecards aren't derived from the incoming inspections/rejections/NCRs for that vendor and period (no vendor linkage exists, P1-QA-18). A `final` scorecard can still be edited or deleted (supplier_quality.py:90-116).
  - [PAT-A] [id]:70, [PAT-B] [id]:79-86, [PAT-I] period String(20).

### 12. Documents — `/documents`  (FE/app/dashboard/quality/documents/page.tsx)
BE routes/documents.py, schemas/quality_document.py, BE/../../utils/sharepoint.py.
- **Access**: FE :49. BE router documents.py:16-19; upload user dep :45; content no user dep :86-89; delete: uploader or admin (:121-122).
- **Inputs** (upload form)

| Field | Control | Req | FE | BE | Notes |
|---|---|---|---|---|---|
| doc_type | select 5 types | Y | fixed options | in set documents.py:47-48 | label lacks * |
| title | text | Y | :108-111 | `Form(...)` | same title applied to every file in a multi-upload |
| version | text | N | — | — | String(20) [PAT-I] |
| linked_standard_id | SearchableSelect (active standards only) | N | — | **not validated** (documents.py:41, 64) | P1-QA-40 |
| description | text | N | — | — | — |
| files | `<input type=file multiple>` | Y | ≥1 (:104-107); **no `accept`, no size hint** (:229) | per-file type allow-list, magic-byte check, 2 GB cap (sharepoint.py:28-45, 135-178) | error "Unsupported file type for X" (sharepoint.py:155) doesn't list allowed types |

- **Views**: table Title, Type badge, Version, File, Size, Uploaded By, Uploaded On, View/Delete (:269); filters doc type + linked standard (server); no search; Loading/empty :277-280. View opens blob in new tab (:136-142).
- **Findings**
  - P1-QA-39 [USER] Delete link is shown on every row (:297) but BE allows only uploader/admin (documents.py:121-122) → others confirm the dialog and then get a 403. Dialog says "permanently removes" (:166) while DB row is only soft-deleted (documents.py:130-131); SharePoint delete errors are swallowed with `except Exception: pass` (documents.py:125-128) → file may remain in SharePoint with no trace.
  - P1-QA-40 [ARCH] Upload writes to SharePoint *before* any DB validation: a bad `linked_standard_id` fails at FK insert after upload, and in a multi-file upload a validation failure on file N (sharepoint.py raises inside the loop, documents.py:58-59) leaves files 1..N-1 in SharePoint with no DB rows → orphaned files.
  - P1-QA-41 [USER] Swallowed error: standards list failure is ignored by an empty catch (documents/page.tsx:88) → "Linked Standard" picker and filter are silently empty with no explanation.
  - P1-QA-42 [USER] View errors aren't real reasons: `getDocumentContent` uses `responseType: 'blob'` (FE/lib/api.ts:946-948), so the JSON `detail` (e.g. "SharePoint site is not configured", "Document not found") arrives as a Blob, `extractErrorMessages` can't read it and shows axios's "Request failed with status code 503" (validation.ts:66-67). `window.open` after `await` may be popup-blocked and the object URL is never revoked (inferred).

---

### Findings index (all IDs)

| ID | Tag | Summary | Location |
|---|---|---|---|
| P1-QA-37 | USER/BA | Supplier scorecard create always 422 — no Vendor Name field, BE requires it | supplier-quality/new/page.tsx:45-54; schemas/supplier_quality.py:7 |
| P1-QA-33 | BA/USER | Complaint detail shows ALL CAPAs (complaint_id filter unsupported) | complaints/[id]/page.tsx:61; routes/capa.py:41-45 |
| P1-QA-5 | BA/USER | Inspection status chosen on create discarded, forced `pending` | incoming-inspection/new/page.tsx:82; routes/inspections.py:100 |
| P1-QA-8 | BA | Checklist status on create discarded | checklists/new/page.tsx:58; schemas/quality_checklist.py:22-26 |
| P1-QA-10 | BA | Inspection-plan status on create discarded | inspection-plans/new/page.tsx:68; schemas/inspection_plan.py:5-11 |
| P1-QA-32 | USER | CAPA Action Plan required by API, not marked/validated in FE | capa/new/page.tsx:130-133; schemas/capa.py:11 |
| §0 access | SEC | Any quality user can create/edit/delete/close anything; Permission-Matrix tabs are nav-only, no `require_tab_access` | QualityNav.tsx:65; routes/ncr.py:14-17 etc. |
| P1-QA-23 | BA/SEC | NCR status is a free dropdown; close without root cause/open CAPAs; closed_at not reset | ncr/[id]/page.tsx:175-183; routes/ncr.py:119-132 |
| P1-QA-24 | BA | CAPA `overdue` manual status; close without verification | capa/[id]/page.tsx:150-158; models/capa.py:9 |
| P1-QA-1 | BA | Dashboard CAPA counts inconsistent with manual `overdue` | routes/dashboard.py:32-39 |
| P1-QA-2 | BA | Pending-inspection KPI inflated by forced pending | dashboard.py:40-42; inspections.py:100 |
| P1-QA-3 | USER | KPI cards not clickable | quality/page.tsx:67-87 |
| P1-QA-4/4a | ARCH/BA | Reports load full tables; conditional pass counted as pass; no period/export | reports/page.tsx:54-59, 83 |
| P1-QA-6/9 | USER | Delete of referenced standard/checklist → unspecific 409 | standards.py:110-115; checklists.py:112-117 |
| P1-QA-7/11 | USER | Optional fields/links can't be cleared on edit [PAT-B] | standards/[id]:333-335; inspection-plans/[id]:89-90 |
| P1-QA-12 | BA | Pickers offer inactive checklists/plans, draft/obsolete standards | inspection-plans/new:46; incoming-inspection/new:53 |
| P1-QA-13 | USER | In-Process list H1 reads " Inspection" | in-process-inspection/page.tsx:53 |
| P1-QA-14 | BA | Inspection attachments: model exists, no endpoint, no UI | models/inspection.py:70-82; routes/inspections.py |
| P1-QA-15 | BA | Plan's checklist not copied into results | incoming-inspection/new:151-156; models/quality_checklist.py:15-18 |
| P1-QA-16 | USER/BA | No quantity rules (negative, accepted+rejected>inspected) | incoming-inspection/new:137-148; schemas/inspection.py:42-44 |
| P1-QA-17 | BA | Status not derived from results; no numeric tolerances; default N/A | new:16; models/inspection.py:62-63 |
| P1-QA-18 | BA | No PR/PO/GRN/vendor linkage; vendor free text | schemas/inspection.py:45-47; new:131-134 |
| P1-QA-19 | USER | Inspection search placeholder lists batch/vendor/project; BE searches item/number only | incoming-inspection/page.tsx:76; inspections.py:59-63 |
| P1-QA-20 | ARCH | Server search per keystroke, no debounce/abort | incoming-inspection/page.tsx:40; ncr/page.tsx:44; complaints/page.tsx:44 |
| P1-QA-21 | BA | Detail doesn't verify inspection type vs route | incoming-inspection/[id]:62-66 |
| P1-QA-22 | USER | No "Raise NCR/Rejection" from failed inspection; no auto-fill | ncr/new:121-126 |
| P1-QA-25 | USER | NCR inspection picker only lists currently-failed → blank; source change keeps stale link | ncr/[id]:66, 106, 188-193 |
| P1-QA-26/36 | USER | Raw enum text in linked badges | ncr/[id]:243, 268; complaints/[id]:224 |
| P1-QA-27 | USER | No in-context CAPA/Rejection creation from NCR; empty sections hidden | ncr/[id]:226, 251 |
| P1-QA-28 | BA | NCR source "Complaint" has no complaint link | ncr/new:104-108; models/ncr.py |
| P1-QA-29 | USER/BA | Links typed as raw DB ids (NCR/Inspection/Org/Vendor ID) | rejections/new:91-98; capa/new:104-107; complaints/new:98-99; supplier-quality/new:89-90 |
| P1-QA-30 | USER | Linked NCR shown as text, not link | rejections/[id]:183-187; capa/[id]:190-194 |
| P1-QA-31 | BA | CAPA↔complaint link impossible from UI; complaint_id/responsible_user_id unvalidated | capa/new; routes/capa.py:68-79 |
| P1-QA-34 | USER | CAPA list lacks responsible-user column/filter | capa/page.tsx:106 |
| P1-QA-35 | USER | Complaint search placeholder says item; BE searches description | complaints/page.tsx:80; complaints.py:55-61 |
| P1-QA-38 | BA | Scorecard scores unbounded, hand-typed; final still editable | schemas/supplier_quality.py:9-12; supplier_quality.py:90-116 |
| P1-QA-39 | USER | Document Delete shown to all, 403 after confirm; SharePoint delete errors swallowed | documents/page.tsx:297; documents.py:121-128 |
| P1-QA-40 | ARCH | SharePoint upload before validation → orphaned files | documents.py:41, 58-76 |
| P1-QA-41 | USER | Empty catch hides standards-load failure | documents/page.tsx:88 |
| P1-QA-42 | USER | Document View shows axios status text, not server reason | documents/page.tsx:136-142; lib/api.ts:946-948 |
| PAT-A | USER | Detail pages go blank on load error (error never shown) | standards/[id]:321 + 8 others |
| PAT-C | USER | No save confirmation on any detail page | standards/[id]:338 etc. |
| PAT-D | USER | Stale error banners on list reload | standards/page.tsx:30-37 etc. |
| PAT-E | ARCH | No pagination; N+1 per row | ncr.py:20-30, 59 |
| PAT-G/H | USER | Required dates unstarred; default date in UTC | new pages (see §0) |
| audit | SEC | CAPA and Rejection creation record no creator; no status-change history anywhere | capa.py:58-62; rejections.py:54-58 |

**Counts**: window.alert/confirm/prompt = **0**; non-standard Back buttons = **0** (22/22 conform); sub-nav-below-header = **0**; console-only / empty catch = **1** (documents/page.tsx:88); BE swallowed exception = **1** (documents.py:125-128).


---

## 2.7 Project Management, R&D Tools, Finance & Accounting

Read-only review of the working tree on 2026-09-29, branch main, including uncommitted changes to the Nav, tabAccess and permissions files.

### Cross-cutting findings (all three modules)

- **Permission Matrix is enforced only in the frontend.** `require_tab_access` (backend/app/core/permissions.py:36-47) is used only by ERP routes (erp/routes/projects.py:50, service_requests.py:228). No projects, rnd or accounts route uses it. `frontend/src/lib/tabAccess.ts:11-22` only hides Nav tabs, so a hidden page still opens by direct URL and its API still answers. See P1-PM-2 and P1-RND-1.
- **`/auth/me` does not return `is_finance_manager`.** CurrentUserResponse (backend/app/modules/main/schemas/auth.py:10-30) and its builder (routes/auth.py:433-456) leave it out. The frontend reads it at finance/ar-ap/page.tsx:49 and finance/ledger/page.tsx:42. See P1-FIN-1.
- **Browser dialogs:** 0 `window.alert/confirm/prompt` and 0 bare `alert(`/`confirm(`/`prompt(` in any of the six scoped FE directories (grep verified).
- **Back buttons:** 2 in scope, both standard: `secondaryBtnStyle`, "← Back", in the header row (projects/new/page.tsx:95, projects/[id]/ProjectWorkspace.tsx:82). R&D and Finance have none. Braking and Qmax show plain breadcrumb text instead (P1-RND-40).
- **Sub-nav placement:** ProjectsNav, RndNav and FinanceNav render above the header on every page. Finance pages have no header block at all (P1-FIN-36).

### (A) Project Management

Paths: FE = `frontend/src`, BE = `backend/app/modules/projects`. All files in scope were read in full.

**Module-wide access model (applies to every screen below unless noted)**
- FE page gate: `useRequireApp('projects')` (hooks/useAuth.ts:66-78) in each page: `projects/page.tsx:21`, `all/page.tsx:10`, `my/page.tsx:9`, `reports/page.tsx:48`, `new/page.tsx:26`, `[id]/page.tsx:14`. It only checks `user.apps.includes('projects')`. Sidebar entry: `components/Sidebar.tsx:165` (same check). No `dashboard/layout.tsx` guard for projects.
- FE tab gate: only the 4 top Nav tabs go through `filterTabsByAccess` (`components/projects/ProjectsNav.tsx:35`, uncommitted change). The 18 workspace tabs (`[id]/ProjectWorkspace.tsx:23-27,86`) are NOT filtered, and the pages themselves don't check tab access, so a hidden tab still opens by URL.
- FE action gating: **none**. No Edit, Delete, Decide or Accept control anywhere in the module checks role, ownership or PM/sponsor.
- BE gate: every router uses only `dependencies=[Depends(require_app_access("projects"))]`: `routes/project.py:15-18`, `phases.py:12-15`, `tasks.py:12-15`, `milestones.py:15-18`, `resources.py:12-15`, `budget.py:16-19`, `deliverables.py:13-16`, `documents.py:18-21`, `issues.py:14-17`, `risks.py:12-15`, `change_requests.py:14-17`, `approvals.py:14-17`. `require_tab_access` is used nowhere in `modules/projects` (grep: 0 hits). The only finer check in the module is document delete (uploader or admin), `documents.py:146-147`.
- IDOR: **none found.** Every child route loads its row with `id == X AND project_id == project_id`, for example `phases.py:34-40`, `tasks.py:34-40`, `budget.py:38-53`, `documents.py:38-45`, `approvals.py:36-42`. Cross-references are also checked against the same project: task→phase `tasks.py:82-88`, milestone→phase `milestones.py:71-73`, deliverable→milestone `deliverables.py:82-86`, cost→budget line `budget.py:188-192`.
- Error helper: `extractErrorMessages` (lib/validation.ts:49-71) is used in every mutation catch. It shows the backend `detail` and field `errors`, and falls back to "Failed to X" only when the server sends no detail, so the mutation handlers meet the standard. The problems are the swallowed lookup catches (P1-PM-9, P1-PM-46).
- Enum parity FE vs BE: **all match.** Project statuses and priorities, phase, task, milestone, deliverable, doc type, issue severity and status, risk level and status, change status, approval type and status. BE uses tuples (`models/*.py`) checked in the routes, not Pydantic `Literal`.
- Sub-nav placement: `<ProjectsNav />` renders first, above the header block, on every page: `page.tsx:52`, `all/page.tsx:17`, `my/page.tsx:15`, `reports/page.tsx:73`, `new/page.tsx:86`, `[id]/page.tsx:42` (workspace header follows at `ProjectWorkspace.tsx:73`). **Compliant everywhere.**
- Back buttons: `new/page.tsx:95` and `ProjectWorkspace.tsx:82`. Both are `secondaryBtnStyle`, text "← Back", right side of a `space-between` header row. **Both compliant.**

---

#### /dashboard/projects — Portfolio KPI dashboard  (frontend/src/app/dashboard/projects/page.tsx)
- **Access**: FE `page.tsx:21`; BE `GET /projects` `routes/project.py:69-96` (app access only). Everyone sees every project; there is no membership scoping.
- **Inputs**: none.
- **Views**: 4 KPI cards (Total, Active, On Hold, Completed), computed client-side from the full list (`page.tsx:38-48`). Loading shows "…" inside the cards (`page.tsx:83`). Error banner at `page.tsx:62-66`. No empty state. No list, links or drill-down.
- **Findings**: P1-PM-12 (Active, On Hold and Completed can never be non-zero), P1-PM-14 (placeholder text at `page.tsx:90-92`).

#### /dashboard/projects/all — All Projects list  (all/page.tsx + components/projects/ProjectListView.tsx)
- **Access**: FE `all/page.tsx:10`; "+ New Project" shown to every user (`all/page.tsx:26-32`). BE `project.py:69-96`.
- **Inputs**
| field | control | req | FE validation | BE validation | notes |
|---|---|---|---|---|---|
| search | text (`ProjectListView.tsx:85-90`) | no | trimmed (`:61`) | ILIKE on name, code, client (`project.py:83-87`) | applies only when Search is clicked; the selects apply immediately (`:69,71-74`) |
| status | select from `/meta` (`:91-94`) | no | none | exact match, not validated (`project.py:79-80`) | meta failure is swallowed (`:51`) |
| priority | select (`:95-98`) | no | none | exact match (`project.py:81-82`) | |
- **Views**: table columns Code, Name, Client, Status pill, Priority pill, PM, Start, End, View (`:111`). Loading row (`:117-118`), empty row "No projects found." (`:119-120`), sticky header, whole row clickable plus a redundant "View" `<span>` (`:123,133`). No pagination, sort or export. BE returns all rows ordered by created_at desc (`project.py:95`) with N+1 lookups (`project.py:30-54`).
- **Findings**: P1-PM-48, P1-PM-6.

#### /dashboard/projects/my — My Projects  (my/page.tsx)
- **Access**: FE `my/page.tsx:9`. BE `mine=true` matches PM, creator or resource (`project.py:88-94`).
- **Inputs / Views**: same as All Projects (`ProjectListView mine`), except there is no "+ New Project" button (`my/page.tsx:17-22`).
- **Findings**: P1-PM-49.

#### /dashboard/projects/reports — Portfolio breakdown  (reports/page.tsx)
- **Access**: FE `reports/page.tsx:48` (a user hidden from `project_reports` by the matrix can still open the URL, see P1-PM-2). BE `GET /projects`.
- **Inputs**: none.
- **Views**: two bar lists, By Status and By Priority, counted client-side (`:23-30,94-107`). Loading (`:89-90`), empty state (`:91-92`), error banner (`:83-87`). No filters, export, print or drill-down.
- **Findings**: P1-PM-50, P1-PM-14 (`:110-112`).

#### /dashboard/projects/new — Create project  (new/page.tsx)
- **Access**: FE `new/page.tsx:26`. Any user with the app can create. BE `POST /projects` `project.py:99-138`. Status is forced to "planning" (`:125`) and code is generated (`service.py:27-38`, advisory-locked).
- **Inputs**
| field | control | req | FE validation | BE validation | mismatch / notes |
|---|---|---|---|---|---|
| name | text `:108-109` | Y | non-blank trim `:56` | `str`, no min/max (`schemas/project.py:6`); DB String(255) (`models/project.py:22`) | no maxLength; blank allowed via API |
| client_name | text `:112-113` | N | none | none; DB 255 | |
| project_type / category | text `:116-121` | N | none | none; DB String(100) (`models/project.py:27-28`) | free text, no master list |
| start_date / end_date | DateField `:124-129` | N | **none** | **none** (`schemas/project.py:15-16`) | start > end accepted on both sides (P1-PM-4) |
| priority | select `:132-138` | Y (default medium) | enum | tuple check `project.py:105-106` | match |
| project_manager_id / sponsor_id | SearchableSelect `:141-156` | N | none | **not checked for existence** (`project.py:127-128`, unlike dept/branch `:107-110`) | bad id surfaces as a generic FK message |
| description / scope / objectives | textarea `:159-170` | N | none | none (Text) | |
| department_id / branch_id | — (not in form) | — | — | validated `project.py:107-110` | BE supports, FE never sends (P1-PM-20) |
- **Views**: single form. Error banner `:98-102`. Submit shows a busy state (`:177-179`). Cancel and Back both go to `/all`.
- **Findings**: P1-PM-4, P1-PM-3, P1-PM-20.

#### /dashboard/projects/[id] — Project workspace shell  ([id]/page.tsx, [id]/ProjectWorkspace.tsx)
- **Access**: FE `[id]/page.tsx:14`. Tabs are not filtered by the permission matrix (`ProjectWorkspace.tsx:86`). BE `GET /projects/{id}` `project.py:141-144`.
- **Inputs**: tab selector only (`ProjectWorkspace.tsx:85-101`).
- **Views**: header with code, name, status pill and priority pill (`:73-81`). 18 tabs (`:23-27`). Loading (`[id]/page.tsx:44-45`) and load error (`:46-49`). Four tabs render the placeholder "… is coming in a later phase." (`:117-124`).
- **Findings**: P1-PM-13, P1-PM-15, P1-PM-2.

#### Tab: Overview — Read-only summary  ([id]/tabs/OverviewTab.tsx)
- **Access**: whoever can open the workspace.
- **Inputs**: none.
- **Views**: Summary, Timeline and People cards (`:33-48`), plus a Scope card shown only when data exists (`:51-60`). Status and priority print raw enum values (`:41-42`). No counts.
- **Findings**: P1-PM-47, P1-PM-14 (`:62-64`).

#### Tab: Details & Scope — Edit/delete project  ([id]/tabs/DetailsScopeTab.tsx)
- **Access**: Save and Delete shown to all (`:183-195`). BE `PATCH`/`DELETE` `project.py:147-200`. No PM, owner or admin check; delete has no status precondition.
- **Inputs**
| field | control | req | FE validation | BE validation | mismatch / notes |
|---|---|---|---|---|---|
| name | text `:118-119` | Y | non-blank `:62` | none (`schemas/project.py:23`) | |
| client/type/category | text `:122-131` | N | none | none | clearing does not persist (P1-PM-16) |
| start/end | DateField `:134-139` | N | **none** | **none** | P1-PM-4 |
| priority | select `:142-148` | Y | enum | `project.py:160-162` | match |
| PM / sponsor | SearchableSelect `:151-166` | N | none | not existence-checked | cannot be unassigned (sends `undefined`, `:77-78`) |
| description/scope/objectives | textarea `:169-180` | N | none | none | |
| **status** | **absent** | — | — | accepted `project.py:157-159`, no transition rules | P1-PM-12, P1-PM-19 |
| closure_* | absent | — | — | accepted on generic PATCH `schemas/project.py:39-45` | P1-PM-18 |
- **Views**: form, success banner (`:108-112`, lost on save, see P1-PM-15), error banner (`:103-107`), ConfirmDialog for delete (`:197-203`). No window dialogs.
- **Findings**: P1-PM-12, P1-PM-15, P1-PM-16, P1-PM-17, P1-PM-18, P1-PM-19, P1-PM-7, P1-PM-8, P1-PM-9 (`:56`).

#### Tab: Planning — Phases  ([id]/tabs/PlanningTab.tsx)
- **Access**: Add, Edit and Delete shown to all (`:153-159,277-278`). BE `phases.py:52-123`, app access only.
- **Inputs**
| field | control | req | FE validation | BE validation | mismatch / notes |
|---|---|---|---|---|---|
| name | text `:166,217` | Y | non-blank `:69,105` | none (`schemas/phase.py:6`) | |
| planned_start / planned_end | DateField `:170-175,221-226` | N | **none** | **none** | no start ≤ end check, no check against project window (P1-PM-4) |
| actual_start / actual_end | DateField (edit only) `:229-234` | N | none | none | cannot be cleared once set (`:112-113` sends `undefined`) |
| status | select `:178-183,237-242` | N | enum | create: **field not in schema** (`schemas/phase.py:5-11`), route hardcodes `not_started` (`phases.py:68`); update: tuple check `phases.py:92-94` | **the status chosen on create is silently dropped** (P1-PM-21) |
| sort_order | number `:187,246` | N | none | `int`, any value | negatives and duplicates allowed |
- **Views**: cards sorted by sort_order (`:140`), status pill, planned and actual dates (`:269-274`). Inline edit (`:213-261`). Loading and empty states (`:202-205`). ConfirmDialog for delete (`:288-294`).
- **Findings**: P1-PM-21, P1-PM-22, P1-PM-4, P1-PM-7 (deleting a phase used by tasks or milestones gives a generic 409).

#### Tab: Tasks  ([id]/tabs/TasksTab.tsx)
- **Access**: all controls shown to all. BE `tasks.py:72-183`.
- **Inputs**
| field | control | req | FE validation | BE validation | mismatch / notes |
|---|---|---|---|---|---|
| title | text `:163-164` | Y | non-blank `:83` | none | |
| description | single-line input `:167-168` | N | none | none | never displayed (P1-PM-10) |
| phase | select `:171-175` | N | — | same-project check `tasks.py:82-85` | good |
| assignee | SearchableSelect `:178-184` | N | — | exists `tasks.py:89-91` | not editable later |
| priority | select `:187-193` | Y | enum | `tasks.py:80-81` | match |
| due_date | DateField `:196-197` | N | none | none | not checked against project end; no start_date input (BE supports `schemas/task.py:12`) |
| status (inline) | select `:234-241` | — | enum | `tasks.py:128-130` | decoupled from % (P1-PM-24) |
| % complete (inline) | number min 0 / max 100 **uncontrolled** `:246-252` | — | **none** (attributes only); `Number('')` becomes 0 `:108` | 0-100 → 422 `tasks.py:134-137` | the box keeps the rejected value; PATCH fires on every blur (P1-PM-23) |
- **Views**: table columns Title, Phase, Assignee, Status, Priority, Due, %, Delete (`:221`). Phase and status filters (`:142-149`). Loading and empty states (`:212-215`). No search, assignee filter, overdue highlight or sort.
- **Findings**: P1-PM-23, P1-PM-24, P1-PM-25, P1-PM-11, P1-PM-10, P1-PM-9 (`:75,76`).

#### Tab: Milestones  ([id]/tabs/MilestonesTab.tsx)
- **Access**: all. BE `milestones.py:63-141`.
- **Inputs**
| field | control | req | FE validation | BE validation | mismatch / notes |
|---|---|---|---|---|---|
| title | text `:145-146` | Y | non-blank `:72` | none | |
| description | input `:149-150` | N | none | none | never displayed |
| phase | select `:153-157` | N | — | same-project `milestones.py:71-73` | |
| target_date | DateField `:160-161`, **label has no "*"** | **FE optional** (types/index.ts:2474) | none | **required** `date` (`schemas/milestone.py:9`; NOT NULL `models/milestone.py:23`) | **FE/BE mismatch**: the user only learns it's required from a 422 after submit (P1-PM-26); no check against project window |
| status (inline) | select `:196-198` | — | enum | `milestones.py:105-107`; "achieved" auto-stamps actual_date = today `:108-109` | no way to enter the real achieved date; reverting keeps actual_date (P1-PM-27) |
- **Views**: cards with title, status pill, phase, target and actual dates (`:182-203`). Status filter (`:128-131`). Loading and empty states (`:176-179`). BE sorts by target_date (`milestones.py:59`).
- **Findings**: P1-PM-26, P1-PM-27, P1-PM-11, P1-PM-7, P1-PM-9 (`:65`).

#### Tab: Budget & Cost  ([id]/tabs/BudgetCostTab.tsx)
- **Access**: all. Any app user can create or delete budget lines and cost entries. BE `budget.py:88-258`.
- **Inputs**
| field | control | req | FE validation | BE validation | mismatch / notes |
|---|---|---|---|---|---|
| budget line category | text `:167-168` | Y | non-blank `:75` | none; DB 150 | duplicates allowed |
| budgeted_amount | number min 0 `:171-172`, **labelled "*"** | Y (label) | **not enforced**: empty becomes 0 `:80` | `float`, **negative allowed** (`schemas/budget.py:7`) | P1-PM-28 |
| notes | input `:175-176` | N | none | none | |
| cost budget line | select `:241-245` ("None" allowed) | N | — | same-project `budget.py:188-192` | "None" entries fall outside every total (P1-PM-30) |
| amount | number `:248-249` | Y | > 0 `:109` | `float`, negative allowed (`schemas/budget.py:36`) | BE weaker than FE |
| cost_date | DateField `:252-253`, **no "*"** | FE optional | none | **required** (`schemas/budget.py:37`; NOT NULL `models/budget.py:34`) | **mismatch**, 422 after submit (P1-PM-29) |
| description | input `:256-257` | N | none | none | |
- **Views**: Budget Lines table (Category, Budgeted, Spent, Remaining in red when < 0, Notes) `:200-219`. Cost Entries table (Category, Amount, Date, Description, Recorded By) `:281-299`. Loading and empty states for each (`:191-194,272-275`). Deletes go through ConfirmDialog with busy label (`:307-323`). Deleting a line that has entries is blocked with a clear 409 (`budget.py:149-154`), a good pattern. **No currency symbol, no totals row, no edit** (`api.ts:983,987` update methods unused).
- **Findings**: P1-PM-28, P1-PM-29, P1-PM-30, P1-PM-11, P1-PM-6.

#### Tab: Resources  ([id]/tabs/ResourcesTab.tsx)
- **Access**: all. BE `resources.py:58-135`.
- **Inputs**
| field | control | req | FE validation | BE validation | mismatch / notes |
|---|---|---|---|---|---|
| user | SearchableSelect `:112-118` | Y | selected `:55` | exists `resources.py:66-68` | same user can be added twice (P1-PM-31); empty dropdown if directory fails (swallowed `:50`) |
| role | text `:121-122` | N | none | none; DB 150 | |
| allocation_percent | number min 0 / max 100 `:125-133` | N (default 100) | **none** (attributes only) | 0-100 → 422 `resources.py:69-70` | OK on BE; no cross-project over-allocation check |
| start / end | DateField `:136-141` | N | none | none | no start ≤ end check (P1-PM-4) |
- **Views**: table columns User, Role, Allocation, Start, End, Delete (`:165`). Loading and empty states (`:156-159`). No edit, even though BE has PATCH (`resources.py:90`); `projectsApi` has no `updateResource` (`api.ts:977-979`).
- **Findings**: P1-PM-31, P1-PM-11, P1-PM-9.

#### Tab: Deliverables  ([id]/tabs/DeliverablesTab.tsx)
- **Access**: all, including Accept and Reject through the inline status select (`:223-229`). BE `deliverables.py:74-162`.
- **Inputs**
| field | control | req | FE validation | BE validation | notes |
|---|---|---|---|---|---|
| name | text `:159-160` | Y | non-blank `:81` | none | |
| description | input `:163-164` | N | none | none | never displayed |
| milestone | select `:167-171` | N | — | same-project `deliverables.py:82-86` | |
| owner | SearchableSelect `:174-180` | N | — | exists `:87-89` | |
| due_date | DateField `:183-184` | N | none | none | not checked against the milestone or project dates |
| status (inline) | select `:223-229` | — | enum | `deliverables.py:122-124` | anyone can "accept" (P1-PM-32). FE sends `status` on create (`:90`), BE drops it (schema `:5-10`); harmless because the form has no status control |
- **Views**: table columns Name, Milestone, Owner, Due, Status (`:208`). Milestone and status filters (`:138-145`). Loading and empty states (`:199-202`). ConfirmDialog for delete (`:242-249`).
- **Findings**: P1-PM-32, P1-PM-10, P1-PM-11, P1-PM-9 (`:73,74`).

#### Tab: Documents  ([id]/tabs/DocumentsTab.tsx)
- **Access**: Upload shown to all. Delete shown to all (`:244`), but BE allows only the uploader or an admin (`documents.py:146-147`).
- **Inputs**
| field | control | req | FE validation | BE validation | notes |
|---|---|---|---|---|---|
| doc_type | select `:163-167` | Y | enum | tuple check `documents.py:75-76` | match |
| title | text `:171` | Y | non-blank `:84-87` | `Form(...)`, no max; DB 255 | the same title is applied to every file in a multi-upload |
| version | text `:175` | N | none | none; **DB String(20)** (`models/document.py:24`) | no maxLength; long input fails at the DB (P1-PM-3) |
| description | text `:180` | N | none | none | |
| files | `<input type=file multiple>` `:184` | Y | at least one file `:80-83`; **no `accept`, no size check** | **no type or size check** (`documents.py:70,86-104`) | P1-PM-33 |
- **Views**: table columns Title, Type pill, Version, File, Size, Uploaded By, Uploaded On, View / Delete (`:216`). doc_type filter (`:200-207`). Loading and empty rows (`:224-227`). Separate upload error banner (`:153-157`). View opens a blob with `window.open` (`:113`). No preview, download naming or version history.
- **Findings**: P1-PM-33, P1-PM-34, P1-PM-35, P1-PM-36, P1-PM-37, P1-PM-8.

#### Tab: Issues  ([id]/tabs/IssuesTab.tsx)
- **Access**: all. BE `issues.py:78-165`.
- **Inputs**
| field | control | req | FE validation | BE validation | notes |
|---|---|---|---|---|---|
| title | text `:171-172` | Y | non-blank `:80` | none | |
| description | input `:175-176` | N | none | none | never displayed |
| severity | select `:179-182` | Y (default) | enum | `issues.py:86-87` | match |
| assigned_to | SearchableSelect `:185-191` | N | — | exists `:88-90` | not editable later in UI |
| raised_date | DateField `:194-195` | N | none | defaults to today (`issues.py:100`) | future dates allowed |
| status (Update row) | select `:248-251` | — | enum | `issues.py:124-126`; resolved or closed stamps resolved_date `:134-135` | reopening leaves resolved_date set |
| resolution | textarea shown for resolved or closed `:253-261` | **N** | none | none | not required on resolve (P1-PM-38) |
- **Views**: table columns Title, Severity, Status, Assigned, Raised, Resolved (`:219`). Severity and status filters (`:150-157`). Expandable Update row (`:243-276`). Loading and empty states (`:210-213`). Resolution text is never displayed.
- **Findings**: P1-PM-38, P1-PM-10, P1-PM-9 (`:75`).

#### Tab: Risks  ([id]/tabs/RisksTab.tsx)
- **Access**: all. BE `risks.py:73-162`.
- **Inputs**
| field | control | req | FE validation | BE validation | notes |
|---|---|---|---|---|---|
| title | text `:174-175` | Y | non-blank `:92` | none | |
| description | input `:178-179` | N | none | none | never displayed |
| probability / impact | select low/medium/high `:182-191` | Y (default medium) | enum | `risks.py:81-84` (tuples `models/risk.py:7-8`) | **range matches**; score = weight product 1-9 (`models/risk.py:30-35`) |
| owner | SearchableSelect `:194-200` | N | — | exists `:85-87` | |
| mitigation_plan | textarea `:203-208` | N | none | none | never displayed |
| status (inline) | select `:247-253` | — | enum | `risks.py:127-129` | the only editable field in the UI |
- **Views**: table columns Title, Probability, Impact, Score pill (≤2 green, ≤4 amber, else red, `:35-40`), Status, Owner (`:232`). Filters for probability, impact and status (`:149-160`). Loading and empty states (`:223-226`). No sort by score, no heat map.
- **Findings**: P1-PM-10, P1-PM-11 (probability and impact can't be re-assessed, so the score goes stale), P1-PM-9 (`:87`).

#### Tab: Changes — Change requests  ([id]/tabs/ChangesTab.tsx)
- **Access**: any user can move a CR to Approved, Rejected or Implemented through the inline select (`:192-198`). BE `change_requests.py:99-133`.
- **Inputs**
| field | control | req | FE validation | BE validation | notes |
|---|---|---|---|---|---|
| title | text `:139-140` | Y | non-blank `:68` | none | |
| description / impact_assessment | textarea `:142-157` | N | none | none | never displayed |
| status (inline) | select `:192-198` | — | enum | tuple `:111-113`; **no transitions**; decided_by and decided_at stamped only the first time (`:115-119`) | no confirm step (P1-PM-39) |
- **Views**: table columns Title, Status, Requested By, Decided By, Decided At (raw ISO, `:202`). Status filter (`:122-125`). Loading and empty states (`:171-174`). No link to the Approvals tab. No schedule, budget or scope impact fields beyond free text.
- **Findings**: P1-PM-39, P1-PM-40, P1-PM-10.

#### Tab: Approvals  ([id]/tabs/ApprovalsTab.tsx)
- **Access**: "Decide" and "Delete" shown to all (`:242-245`). BE `approvals.py:109-156` never compares the user with `approver_id` or `requested_by_id`.
- **Inputs**
| field | control | req | FE validation | BE validation | notes |
|---|---|---|---|---|---|
| approval_type | select `:168-171` | Y | non-empty `:79` | tuple `approvals.py:83-84` | match |
| reference_id | raw number `:174-182` | N | none | **none**, not checked against type or table (`approvals.py:89-92`) | user must know a DB id (P1-PM-43) |
| approver | SearchableSelect `:185-191` | N | — | exists `:85-87` | optional, so an approval can have no approver |
| comments | textarea `:194-199` | N | none | none | |
| decision status | select `:253-256` | — | enum | tuple `:121-123` | **reject needs no comment**; can go back to pending while decided_at stays (`:125`) (P1-PM-42) |
| decision comments | textarea `:258-264` | N | none | none | overwrites the requester's comments (same column, `models/approval.py:29`) |
- **Views**: table columns Type, Reference, Requested By, Approver, Status, Requested At (raw ISO), Decided At (raw ISO) (`:223,239-240`). Type and status filters (`:147-154`). Inline decision row (`:248-279`). Loading and empty states (`:214-217`). No decided_by column exists (`models/approval.py:22-31`).
- **Findings**: P1-PM-41, P1-PM-42, P1-PM-43, P1-PM-40.

#### Tab: Project History — Audit trail  ([id]/tabs/ProjectHistoryTab.tsx)
- **Access**: all. BE `GET /projects/{id}/audit` `project.py:203-230`.
- **Inputs**: none.
- **Views**: card list with actor, timestamp and "action — field: old → new" (`:23-42`). Loading and empty states (`:18-19`). **The actor key doesn't match**: FE reads `performed_by_name` (`:33`, `types/index.ts:2397`), BE sends `performed_by` (`project.py:226`). **`summary` is never rendered** (BE `project.py:225`). **No `.catch`** (`:13-15`). No filter by tab (subtab_key is stored but not returned) and no pagination.
- **Findings**: P1-PM-44, P1-PM-45, P1-PM-46.

#### Tabs: Activities, Meetings & Communication, Reports, Closure — Placeholders  (ProjectWorkspace.tsx:25-26,117-124)
- **Access**: visible to all users. Clicking one shows "{tab} is coming in a later phase."
- **Inputs / Views**: none. Closure fields already exist in the model and schema (`models/project.py:39-47`, `schemas/project.py:39-45`) but have no UI and no dedicated endpoint.
- **Findings**: P1-PM-13, P1-PM-18.

---

#### Findings

**Cross-cutting**
- **P1-PM-1 [SEC]** No role or ownership authorization on any write in the module. Every create, update and delete in all 12 routers depends only on `require_app_access("projects")`, for example delete project `routes/project.py:190-200`, edit project `:147-187`, budget `budget.py:88-136`, decide approval `approvals.py:109-140`. Any app user can delete any project, rewrite its budget or approve its approvals. The FE hides nothing (e.g. `DetailsScopeTab.tsx:184`, `ApprovalsTab.tsx:242-245`). *Fix:* add a shared `_require_project_role(project, user, roles)` helper (PM, sponsor or admin for edits, delete and close; named approver for decisions), use it in each mutating route, and mirror it in the FE to hide buttons.
- **P1-PM-2 [SEC]** The projects entries in the Permission Matrix (`core/permission_registry.py:88-97`, 22 subtabs) are enforced only as FE hiding of the 4 top Nav tabs (`ProjectsNav.tsx:35`). The BE never calls `require_tab_access` in `modules/projects`. Workspace tabs are unfiltered (`ProjectWorkspace.tsx:86`) and hidden pages still open by URL (`reports/page.tsx:48` checks only the app). *Fix:* add `Depends(require_tab_access("projects", "<subtab>"))` to each router, filter `TABS` in ProjectWorkspace with `filterTabsByAccess`, and add a page-level tab guard.
- **P1-PM-3 [ARCH]** The Pydantic schemas carry no constraints at all: no `Literal` enums, no `Field(min_length/max_length/ge/le/gt)`, no date validators (`schemas/project.py:5-45`, `phase.py:5-21`, `task.py:5-26`, `budget.py:5-45`, `resource.py:5-17`, `approval.py:5-14`). Blank names, negative money and overlong strings (e.g. doc version > 20 chars, `models/document.py:24`, no FE maxLength at `DocumentsTab.tsx:175`) reach the DB. An explicit `null` sent to NOT NULL columns (title, target_date, amount) through PATCH also gets through. *Fix:* use `Literal[...]` types and `Field` bounds, add `model_validator` date checks, and mirror the maxLength values on FE inputs.
- **P1-PM-4 [BA]** No date-order or containment validation anywhere. Project start ≤ end is unchecked on FE (`new/page.tsx:54-80`, `DetailsScopeTab.tsx:59-87`) and BE (`project.py:99-138,147-187`). Phase planned and actual dates (`PlanningTab.tsx:67-124`; `phases.py:52-108`) and resource dates (`ResourcesTab.tsx:53-73`; `resources.py:58-119`) are unchecked. Phase, task, milestone and deliverable dates are never checked against the project window (`tasks.py:72-113`, `milestones.py:63-90`, `deliverables.py:74-107`). *Fix:* add a BE `model_validator` plus a route check against `project.start_date`/`end_date` returning e.g. "Due date 2027-01-05 is after the project end date 2026-12-31. Move the date or extend the project". Block submit on the FE too.
- **P1-PM-5 [BA]** Nothing freezes a completed or cancelled project. No child route reads `project.status` (e.g. `tasks.py:79`, `budget.py:95,187`, `approvals.py:82`, `documents.py:74`). *Fix:* add a `_assert_project_open(project)` 409 ("Project PRJ-2026-0003 is Completed. Reopen it before changing tasks.") and disable forms on the FE.
- **P1-PM-6 [ARCH]** Every list endpoint does N+1 lookups: projects `project.py:30-54` inside the loop at `:96` (up to 3 queries per row); tasks `tasks.py:43-49`; budget lines `budget.py:56-65` (a SUM per line); same in deliverables, issues, risks, changes and approvals (`*_to_response`). *Fix:* batch user and name lookups the way the audit route already does (`project.py:212-216`), and do one grouped SUM for spent amounts.
- **P1-PM-7 [USER]** Deleting a parent that has children fails with the generic "This record is still linked to other records…" (`core/db_errors.py:167-171`), because the FKs have no `ondelete` (`models/task.py:21`, `milestone.py:20`, `deliverable.py:20`; migration `babf5e1cadcf`). This hits project delete (`project.py:190-200`), phase delete (`phases.py:111-123`) and milestone delete (`milestones.py:129-141`), and the message never says which records block it. *Fix:* pre-count like `budget.py:149-154` and name the blockers ("4 tasks and 1 milestone are linked to phase 'Design'. Reassign or delete them first").
- **P1-PM-8 [BA]** Documents are soft-deleted (`documents.py:155-156`) but keep their FK to the project (`models/document.py:21`). A project that ever had a document can therefore never be deleted. *Fix:* use cancel/archive instead of hard delete for projects, or hard-delete soft-deleted document rows inside the project delete.
- **P1-PM-9 [USER]** Lookup failures are silently swallowed: 11 `.catch(() => {})` (listed in counts). If the users directory fails, the required "User *" picker on Resources (`ResourcesTab.tsx:50,112-118`) shows empty with no reason, and the tab becomes a dead end. The same happens to the phase and milestone pickers. *Fix:* route these through `setError(extractErrorMessages(err, …))`.
- **P1-PM-10 [USER]** Several fields are captured but never shown. Task description (`TasksTab.tsx:166-169` vs columns `:221`), milestone description (`MilestonesTab.tsx:148-151`), deliverable description (`DeliverablesTab.tsx:162-165` vs `:208`), issue description and resolution (`IssuesTab.tsx:174-177,254-261` vs `:219`), risk description and mitigation (`RisksTab.tsx:177-180,202-208` vs `:232`), CR description and impact (`ChangesTab.tsx:142-157` vs `:180`), and approval comments (`ApprovalsTab.tsx:193-200` vs `:223`) are all write-only. *Fix:* add an expandable row or detail drawer that shows them.
- **P1-PM-11 [USER]** Records can barely be edited after creation, even though the BE supports PATCH. Tasks allow only status and % (`TasksTab.tsx:234-253`). Milestones, deliverables, risks and CRs allow only status. Resources can't be edited at all (no `updateResource` in `api.ts:977-979`, although `resources.py:90` exists). Budget lines and cost entries can't be edited either (`api.ts:983,987` defined but unused). A typo means delete and recreate, which breaks the audit history. *Fix:* reuse the inline-edit pattern from `PlanningTab.tsx:213-261`.

**Workspace / Details & Scope**
- **P1-PM-12 [USER]** Project status can't be changed anywhere in the UI. Create forces "planning" (`project.py:125`), and Details & Scope has no status field (`DetailsScopeTab.tsx:116-180`). The dashboard KPIs Active, On Hold and Completed (`page.tsx:39-47`) and the status filter are therefore permanently 0. *Fix:* add a status control (header action or Details & Scope) backed by transition rules (P1-PM-19).
- **P1-PM-13 [USER]** Four workspace tabs are visible dead ends: Activities, Meetings & Communication, Reports and Closure show "… is coming in a later phase." (`ProjectWorkspace.tsx:25-26,117-124`). *Fix:* remove them from `TABS` until they're built.
- **P1-PM-14 [USER]** Roadmap placeholder copy is shipped to users: `page.tsx:90-92`, `reports/page.tsx:110-112`, `OverviewTab.tsx:62-64`. *Fix:* delete the lines.
- **P1-PM-15 [USER]** Saving Details & Scope throws the user back to Overview and loses the "Project saved." banner. `onSaved` runs `load()`, which sets `loading=true` (`[id]/page.tsx:23-31,44-45`) and unmounts the workspace. On remount the tab is read from `?tab=` (`ProjectWorkspace.tsx:67-69`), but tab clicks never write it (`:89`). The same gap means refresh or Back always lands on Overview. *Fix:* refresh without toggling `loading`, and `router.replace` `?tab=` on each tab click.
- **P1-PM-16 [USER]** Clearing an optional field doesn't save, yet the UI reports success. Cleared fields are sent as `undefined` (`DetailsScopeTab.tsx:68-78`), dropped from the JSON, and the BE `exclude_unset` keeps the old value (`project.py:155`), while the page shows "Project saved." (`:108-111`). This affects client, type, dates, PM and sponsor. Phase actual dates have the same problem (`PlanningTab.tsx:110-113`). *Fix:* send `null` for cleared fields.
- **P1-PM-17 [SEC]** The "Delete Project" button is shown to every user (`DetailsScopeTab.tsx:184-186`). The BE lets any app user hard-delete with no status or child precondition (`project.py:190-200`). *Fix:* limit it to admin or the PM, allow it only while status is planning and there are no children, and otherwise offer Cancel/Archive.
- **P1-PM-18 [SEC]** Closure goes through the generic PATCH with a client-supplied `closed_by_id` and no preconditions (`schemas/project.py:39-45`; `project.py:173-183`). Anyone can record another user as the closer, set `final_status` to any string, or close with open tasks and issues, pending approvals or no client sign-off. *Fix:* add a dedicated `POST /projects/{id}/close` that sets `closed_by_id=user.id`, validates `final_status ∈ {completed, cancelled}`, returns 409 listing any open tasks, issues or approvals, and drop the closure fields from `PmProjectUpdate`.
- **P1-PM-19 [BA]** Project status PATCH accepts any transition, e.g. cancelled → active or completed → planning (`project.py:157-159`). *Fix:* add an allowed-transitions map with a 409 that names the valid next states.
- **P1-PM-20 [BA]** Department and Branch are supported and validated by the BE (`schemas/project.py:13-14`, `project.py:107-110`) but there's no FE field on New or Details (`new/page.tsx:106-157`), so `department_name` is always blank and projects can't be scoped by department. PM and sponsor ids aren't checked for existence (`project.py:127-128`). *Fix:* add both pickers and check the user ids exist.

**Planning / Tasks / Milestones**
- **P1-PM-21 [USER]** The status chosen when adding a phase is silently discarded. FE sends `status` (`PlanningTab.tsx:76,177-183`), `PmProjectPhaseCreate` has no status field (`schemas/phase.py:5-11`), and the route hardcodes `not_started` (`phases.py:68`). *Fix:* add a validated `status` to the create schema, or remove the select from the add form.
- **P1-PM-22 [BA]** Phase status is independent of the actual dates: Completed with no `actual_end`, In Progress with no `actual_start`. `sort_order` accepts negatives and duplicates (`PlanningTab.tsx:187,246`; `phases.py:92-104`). *Fix:* require actual_start for in_progress and actual_end for completed, and auto-number sort order.
- **P1-PM-23 [USER]** The inline % Complete box is uncontrolled (`defaultValue`, `TasksTab.tsx:246-252`). After the BE rejects 150 (`tasks.py:134-137`) the box still shows 150. An empty box silently saves 0 (`TasksTab.tsx:108`). A PATCH fires on every blur even when nothing changed. *Fix:* make it a controlled input, clamp 0-100 on the FE, PATCH only on change, and reset on error.
- **P1-PM-24 [BA]** Task status and % complete are decoupled: Completed at 0%, or Not Started at 100%, are both accepted (`tasks.py:128-159`). *Fix:* auto-set 100% when status is completed (and the reverse), or reject the inconsistent combination.
- **P1-PM-25 [BA]** The task model supports start date and subtasks (`models/task.py:22,28`; `schemas/task.py:7,12`), but the Add form offers neither (`TasksTab.tsx:161-208`). The list has no assignee filter, search or overdue highlight (`:141-148,244`). *Fix:* add start date, parent task and an assignee filter, and flag overdue rows.
- **P1-PM-26 [USER]** Milestone Target Date is required by the BE (`schemas/milestone.py:9`; NOT NULL `models/milestone.py:23`) but the FE marks it optional (label `MilestonesTab.tsx:160`, no check at `:72`, type `types/index.ts:2474`). Users only find out from a post-submit "Target Date: Field required". *Fix:* add the "*" and an FE check.
- **P1-PM-27 [BA]** Setting a milestone to Achieved auto-stamps today (`milestones.py:108-109`) with no way to enter the real date (`MilestonesTab.tsx:196`), and reverting to Pending keeps the stale `actual_date`. *Fix:* ask for the achieved date (PromptDialog or inline DateField) and clear it on revert.

**Budget / Resources / Deliverables**
- **P1-PM-28 [USER]** "Budgeted Amount *" isn't enforced: an empty value is saved as 0 (`BudgetCostTab.tsx:80,171`). The BE accepts negative budgets and negative cost amounts (`schemas/budget.py:7,36`; `budget.py:96-101,194-201`). *Fix:* require > 0 on the FE and add `Field(gt=0)` on the BE with a clear message.
- **P1-PM-29 [USER]** Cost Date is required by the BE (`schemas/budget.py:37`; `models/budget.py:34`) but optional on the FE (`BudgetCostTab.tsx:115,252`, no "*"), so the user gets a 422 after submit. *Fix:* mark it required, or default it to today.
- **P1-PM-30 [USER]** Money is shown with no currency and no totals. `fmtAmount` prints bare numbers (`BudgetCostTab.tsx:21-24,211-213,292`). There's no project-level Budget, Spent or Remaining total, and cost entries with budget line "None" (`:243`) don't count in any line total (`budget.py:56-58`), so unallocated spend is invisible. *Fix:* add a ₹ prefix and label, plus a summary card with total budget, allocated spend, unallocated spend and remaining.
- **P1-PM-31 [BA]** The same user can be assigned to a project more than once, and allocation isn't summed within or across projects (`resources.py:58-87`). *Fix:* reject a duplicate (project, user) with a 409 naming the existing assignment, and warn when the total exceeds 100%.
- **P1-PM-32 [SEC]** Any app user can mark a deliverable Accepted or Rejected from the inline select (`DeliverablesTab.tsx:223-229`; `deliverables.py:110-146`), and the BE records no accepted_by or accepted_at. *Fix:* restrict accept/reject to the sponsor or PM and stamp who and when.

**Documents**
- **P1-PM-33 [SEC]** Uploads have no file type or size limit on either side: FE `<input type=file multiple>` has no `accept` and no size check (`DocumentsTab.tsx:184`), and the BE accepts any `list[UploadFile]` (`documents.py:70,86-104`). *Fix:* enforce an extension/MIME allow-list and a max size on the BE with a message like "setup.exe: .exe files aren't allowed (allowed: pdf, docx, xlsx…)", and mirror it on the FE.
- **P1-PM-34 [ARCH]** Multi-file upload isn't atomic. Each file is pushed to SharePoint in the loop and the DB commits only at the end (`documents.py:86-112`), so a failure on file N leaves N-1 orphan SharePoint files with no DB rows. SharePoint delete errors are swallowed with `except Exception: pass` (`documents.py:150-153`). *Fix:* delete already-uploaded files on failure, and log plus return a warning when the remote delete fails.
- **P1-PM-35 [USER]** Delete is shown on every document (`DocumentsTab.tsx:244`), but the BE allows only the uploader or an admin (`documents.py:146-147`), so the user learns this only after confirming. *Fix:* show Delete only when `uploaded_by_id === user.id || role === 'admin'`.
- **P1-PM-36 [USER]** "View" calls `window.open(URL.createObjectURL(blob))` after an `await` (`DocumentsTab.tsx:110-117`). That's outside the user gesture, so popup blockers often stop it silently, and the blob URL is never revoked. *Fix:* open the window synchronously before the fetch, or use an in-app viewer, and call `revokeObjectURL`.
- **P1-PM-37 [USER]** The 503 "SharePoint site is not configured" (`documents.py:77-78,127-128`) gives the user no next step. *Fix:* reword to "Document storage (SharePoint) isn't set up for this environment. Ask an admin to set SHAREPOINT_SITE_ID."

**Issues / Changes / Approvals**
- **P1-PM-38 [BA]** An issue can be Resolved or Closed with no resolution (`IssuesTab.tsx:111-113`; `issues.py:134-135`), and reopening keeps `resolved_date` (`issues.py:134-145`). *Fix:* require a resolution for resolved/closed and clear `resolved_date` when the issue is reopened.
- **P1-PM-39 [SEC]** Any user, including the requester, can approve, reject or implement a change request from an inline dropdown with no confirm (`ChangesTab.tsx:192-198`). The BE has no transition rules, so rejected → implemented is allowed (`change_requests.py:111-113`), and `decided_by`/`decided_at` are stamped only the first time, so a later reversal keeps the original decider (`:115-119`). *Fix:* replace the dropdown with explicit Approve and Reject actions for the approver role, behind a ConfirmDialog, add a transition map, and re-stamp on every decision.
- **P1-PM-40 [USER]** Timestamps show as raw ISO strings, e.g. "2026-09-29T10:22:33.1+00:00": `ChangesTab.tsx:202`, `ApprovalsTab.tsx:239-240`. *Fix:* format them with `toLocaleString`, as ProjectHistoryTab does at `:34`.
- **P1-PM-41 [SEC]** Any app user can decide any approval. The BE never checks `user.id == approval.approver_id` and doesn't block self-approval by `requested_by_id` (`approvals.py:109-140`). "Decide" is shown to everyone (`ApprovalsTab.tsx:242-244`), and there's no `decided_by_id` column (`models/approval.py:22-31`). *Fix:* return 403 "Only <approver name> can decide this request" unless the user is the approver or an admin, forbid requester == approver, and add a `decided_by_id` column.
- **P1-PM-42 [BA]** Approval decisions have no integrity rules. Reject needs no comment (`ApprovalsTab.tsx:104-119`; `approvals.py:121-126`). A decision can be moved back to Pending while `decided_at` stays (`approvals.py:125`). The decision comment overwrites the requester's comment (same column, `models/approval.py:29`). Decided approvals can be deleted (`approvals.py:143-156`). *Fix:* require a comment on reject, lock decided rows (no revert or delete), and store `decision_comments` separately.
- **P1-PM-43 [BA]** "Reference ID" is a raw integer the user must know (`ApprovalsTab.tsx:173-182`). It isn't checked against `approval_type` (`approvals.py:89-92`), and approving changes nothing on the referenced CR, budget line or project closure. *Fix:* replace it with a type-dependent picker (CRs or budget lines), and on approve update the referenced record's status.

**History / Overview / Lists / Reports**
- **P1-PM-44 [USER]** The actor name is blank on every history entry: FE reads `performed_by_name` (`ProjectHistoryTab.tsx:33`; `types/index.ts:2397`), BE returns `performed_by` (`project.py:226`). *Fix:* rename the BE key to `performed_by_name`, or fix the FE type.
- **P1-PM-45 [USER]** History entries don't say what changed. BE returns `summary` (`project.py:225`) but the FE shows only `action` (`ProjectHistoryTab.tsx:37-39`), so create and delete entries read just "created" or "deleted". Field entries show raw column names and ids ("phase_id: 3 → 5") and never name the child record (`tasks.py:151-158`, same in every child router). *Fix:* render `summary`, and include the entity label (e.g. "Task 'Pour slab'") in child-route audits.
- **P1-PM-46 [USER]** The history load has no `.catch` (`ProjectHistoryTab.tsx:13-15`), so a failed request shows "No history yet." and leaves an unhandled rejection. *Fix:* catch the error and show `extractErrorMessages`.
- **P1-PM-47 [USER]** Overview shows Status and Priority as raw enums ("on_hold", "critical") (`OverviewTab.tsx:41-42`), while the header uses labels (`ProjectWorkspace.tsx:29-40`). It has no counts even though task, issue, risk and budget data exist. *Fix:* reuse the label maps and add count cards (open tasks, open issues, high risks, budget vs spent).
- **P1-PM-48 [USER]** The All and My Projects lists have no pagination or column sort (BE `project.py:95` returns every row; FE `ProjectListView.tsx:108-139`). Search applies only on submit while the selects apply immediately (`:69-74`). "View" is a clickable `<span>` (`:133`), so it can't be opened in a new tab. *Fix:* add server-side pagination and sortable headers, debounce the search, and use `<Link>`.
- **P1-PM-49 [BA]** "My Projects" leaves out projects where the user is sponsor or a task assignee (`project.py:88-94`), and the page has no "+ New Project" button (`my/page.tsx:17-22`). *Fix:* add `sponsor_id` and task-assignee subqueries, and add the create button.
- **P1-PM-50 [USER]** Project Reports shows only two count bars built from the list API (`reports/page.tsx:94-107`): no export, print, filters or drill-down, and no budget or schedule reporting even though the data exists. *Fix:* make each bar click through to a filtered All Projects view, and add CSV export plus budget-vs-actual and overdue-milestone reports.

---

##### PM counts
- **Screens/tabs covered: 24.** 6 pages (Dashboard, All, My, Reports, New, Workspace shell), 14 implemented workspace tabs (Overview, Details & Scope, Planning, Tasks, Milestones, Budget & Cost, Resources, Deliverables, Documents, Issues, Risks, Changes, Approvals, Project History), and 4 placeholder tabs (Activities, Meetings & Communication, Reports, Closure).
- **window.* dialog count: 0.** Grep for `window.confirm|alert|prompt` and bare `alert(|confirm(|prompt(` across `app/dashboard/projects/**` and `components/projects/**` returns nothing. Every delete uses `ConfirmDialog`. The only other `window.*` call is `window.open` at `DocumentsTab.tsx:113`, which isn't a dialog (see P1-PM-36).
- **Non-standard Back button count: 0.** Both Back buttons in scope are compliant: `new/page.tsx:95` and `[id]/ProjectWorkspace.tsx:82`.
- **Sub-nav placement violations: 0.** All 6 pages render `<ProjectsNav />` above the header.
- **Swallowed or missing catches: 12.** Eleven silent `.catch(() => {})`: `ApprovalsTab.tsx:74`, `DeliverablesTab.tsx:73`, `DeliverablesTab.tsx:74`, `DetailsScopeTab.tsx:56`, `IssuesTab.tsx:75`, `MilestonesTab.tsx:65`, `ResourcesTab.tsx:50`, `RisksTab.tsx:87`, `TasksTab.tsx:75`, `TasksTab.tsx:76`, `ProjectListView.tsx:51`. One missing catch: `ProjectHistoryTab.tsx:13-15`. BE also swallows at `documents.py:152-153`.
- **Placeholder/"later phase" text visible to users: 4 locations.** `ProjectWorkspace.tsx:122` (renders for 4 tabs), `page.tsx:91`, `reports/page.tsx:111`, `OverviewTab.tsx:63`.
- **FE/BE mismatches**:
  - Required on BE but optional on FE: milestone target_date, cost_date.
  - Sent by FE but silently dropped by BE: phase create status.
  - Response key mismatch: `performed_by` vs `performed_by_name`.
  - Clear-field (null) semantics don't round-trip.
  - FE stricter than BE: cost amount > 0.
  - Enum mismatches: none.
- **IDOR (child not verified against project_id): 0 found.**
- **Findings by tag (50 total):** [USER] 25 · [BA] 14 · [SEC] 8 · [ARCH] 3
  - SEC: 1, 2, 17, 18, 32, 33, 39, 41
  - ARCH: 3, 6, 34
  - BA: 4, 5, 8, 19, 20, 22, 24, 25, 27, 31, 38, 42, 43, 49
  - USER: 7, 9, 10, 11, 12, 13, 14, 15, 16, 21, 23, 26, 28, 29, 30, 35, 36, 37, 40, 44, 45, 46, 47, 48, 50


### (B) R&D Tools

Scope read in full: FE `frontend/src/app/dashboard/rnd/**` (hub + 7 tools + history), `frontend/src/components/rnd/**`, `rndApi` in `frontend/src/lib/api.ts:1831-1932`; BE `backend/app/modules/rnd/routes/{calculations,history}.py`, every `tools/*/api.py|schemas.py|validation.py|constants.py`, braking `units.py/service.py/core.py`, spline `core.py`, TE `core.py`, load `core.py`, qmax `core.py/service.py`, vehicle `service.py` (init + outputs), models, `services/pdf_service.py`, `utils/templates/spline_template.tex` (grep), `middleware/error_handler.py`.

#### Cross-cutting facts (apply to every screen below)

- **Router mount**: `main.py:297-298` mounts `rnd_calculations_routes.router` and `rnd_history_routes.router` at `/api/v1/rnd`. `routes/calculations.py:13` creates `APIRouter(dependencies=[Depends(require_app_access("rnd"))])` and includes each tool's `api.py` router under `/tools/<tool>` (`calculations.py:15-21`). Tool routers themselves (`tools/*/api.py`) declare no dependency; they inherit auth + `rnd` app access from the parent. **All 18 calculation/report endpoints are auth + app-gated.**
- **History router is NOT app-gated**: `routes/history.py:19` is `APIRouter(prefix="/history")` with only `Depends(get_current_user)` per endpoint. No `require_app_access("rnd")`.
- **Tab access (Permission Matrix)**: `rnd` subtabs are registered (`core/permission_registry.py:53-65`), `RndNav.tsx:49` hides tabs via `filterTabsByAccess`, but no R&D page checks tab access (all use only `useRequireApp('rnd')`, `hooks/useAuth.ts:66-78`) and no R&D BE route uses `require_tab_access`. Hub cards (`rnd/page.tsx:74`) are not filtered either.
- **FE app gate**: every page calls `useRequireApp('rnd')` and returns `null` while loading/unauthorized (redirects to `/dashboard`).
- **Sub-nav placement**: `<RndNav />` is the first child, above the `<h1>` header block, on every screen (hub `page.tsx:67`, braking `:357`, hydraulic `:197`, qmax `:174`, load `:162`, TE `:150`, vehicle `:204`, spline `:191`, history `:112`, ToolCalculatorPage `:138`). **Compliant everywhere.**
- **Back buttons**: none on any R&D screen (grep for `Back`/`router.back`/`secondaryBtnStyle`/`←` in `app/dashboard/rnd` + `components/rnd` = 0 hits). Braking (`braking/page.tsx:370`) and Qmax (`qmax/page.tsx:183`) show a text-only breadcrumb "R&D Tools / …" that looks like navigation but is not clickable.
- **Browser dialogs**: grep `window.(confirm|alert|prompt)` and bare `alert(|confirm(|prompt(` in scope = **0**. History delete uses `ConfirmDialog` (`history/page.tsx:226-232`).
- **ToolCalculatorPage is dead code**: no file imports `components/rnd/ToolCalculatorPage.tsx` (grep = 0 importers). Every tool page hand-rolls its own layout, error handling, auto-save and download logic.
- **Error helpers**: `extractErrorMessages` (`lib/validation.ts:49-71`) reads `data.errors` / `data.detail`, but it cannot read a `Blob` body, so on `responseType:'blob'` download calls it falls through to axios's `err.message` ("Request failed with status code 500"). `getErrorMessage` (`components/rnd/toolStyles.ts:60-75`) does read Blob bodies but only returns `detail`, and for app-wide 422s that is the bare word "Validation error" (`middleware/error_handler.py:69-78` puts the field list in `errors`).
- **Auto-save**: every tool (except the unused ToolCalculatorPage) fires `rndApi.saveHistory(...)` after each successful Calculate and swallows failures with `.catch(() => {})`. The user never picks a name or chooses to save.

---

#### /dashboard/rnd — R&D hub / tool launcher (`frontend/src/app/dashboard/rnd/page.tsx`)
- **Access**: FE `useRequireApp('rnd')` `page.tsx:60,63`. BE none (static page). Tab access for `all` is not checked on the page. Cards for tabs hidden by `filterTabsByAccess` still show (`page.tsx:74`).
- **Inputs**: none.
- **Views**: 8 cards (7 tools + History) `page.tsx:7-57,73-110`. Each card is a `div onClick={router.push}` (`:75-77`), not a link. No loading or empty state (not needed).
- **Findings**: see P1-RND-4 (tab gate), P1-RND-38 (cards are not keyboard-accessible).

---

#### /dashboard/rnd/braking — Braking performance (DIN EN 15746-2) (`frontend/src/app/dashboard/rnd/braking/page.tsx`)
- **Access**: FE `useRequireApp('rnd')` `:106,191`. BE `calculations.py:13` → `braking/api.py:13` (`/braking_calculate`), `:29` (`/braking_report_pdf`), `:48` (`/braking_download_docx`, which the FE never calls; `api.ts:1834-1840` has only calculate + pdf).
- **Inputs**

| field | control | unit | req? | FE validation | BE validation | mismatch / notes |
|---|---|---|---|---|---|---|
| Doc No / Made / Checked / Approved | text `:389-392` | – | no | none; blank Doc No becomes `'BRK-001'` `:217` | `schemas.py:21-24` Optional str; LaTeX-escaped `service.py:310-313` | ok |
| GVW `mass_kg` | number `:408` | kg | yes | `>0` `:206` | `schemas.py:7` float; `validation.py:29` `>0` | ok |
| Max Speed `rail_speed_input` | text CSV `:413` | km/h | yes | ≥1 token parses `>0` `:207` | `schemas.py:12` str; `units.py:8-16` `parse_list` returns `[]` if **any** token is bad | FE accepts "10,abc" (10 is valid) but BE drops the whole list, returns 0 rail rows, and the table says "No results for the selected scenario filters" `:633-634`. Label says "Max Speed" but it is a list of speeds. |
| Driving Wheels `num_wheels` | number `:419` | – | yes | `parseInt ≥1` `:209` | `schemas.py:9` int, `validation.py:31` `>0` | "2.5" → FE parseInt=2, fine. The "Braked Wheels" field `:423` is a disabled mirror. |
| Reaction Time | number step .1 `:427` | s | labelled `*` | **none** | `schemas.py:8` float, no range check | FE `parseFloat(x) \|\| 1` `:222`: an entered **0 becomes 1 s** without telling the user. Negative values are accepted by both sides. |
| Wheel Dia | number `:428` | mm | no | none | `schemas.py:25`, only printed in the report | not used in any calculation |
| Track Standard / Max Curve / Super-elev / Cant / Gauge | radio + disabled inputs `:446-470` | m/mm | – | – | **not in schema, never sent** `:216-233` | the IR/HSR preset and Track CSV import change values that do nothing |
| Max Gradient + type | radio (°, 1:G, %) + text `:457-461` | per type | yes | ≥1 token `≥0` `:210` | `schemas.py:13-14` free str; `units.py:18-28` unknown type falls back to % | the input is 70 px wide for a comma list. Negative (downhill) gradients: FE filters them out, BE sorts them in. |
| Road Mode + road speed/gradient/type/μ | checkbox + inputs `:476-488` | km/h, %/°, – | if road | none | `validation.py:21` `raw.mu or 0.7`, `:33` `mu<=0` | μ=0 → FE `\|\| 0.7` `:232` **and** BE `or 0.7`, so 0 silently becomes 0.7 and the BE `<=0` check can only catch negatives. Empty road speed → `'30'` `:229`. |
| Brake Type Disc/Tread | radio `:504-506` | – | – | – | **not sent** | dead control |
| Calculate: force/distance/detail, Custom stop distance, Target distance | radio + number `:512-543` | m | – | none | **not sent** | FE-only maths `:644-651`. Not in PDF. |
| Scenario filters, Show GBR % | checkbox `:565-572` | – | – | – | not in schema (`service.py:349-352` reads `show_*` from inputs, which Pydantic drops) | the PDF ignores these toggles (inferred from context keys) |

- **Views**: 4 stat cards shown after calculation `:374-381` (GBR, Max force kN, Mass, Reaction time). Results table `:598-718` has 12-15 columns, a sticky header, per-row expandable step text in "detail" mode `:697-711`, row count `:606`, and empty states `:628-635`. There is also a static EN distance table `:720-743`. Busy label "Calculating…" `:584`. Exports: Inputs CSV `:292`, Outputs CSV `:294-307`, PDF `:263-279` named `${docNo}.pdf`. A "History" link `:590` goes to history. Auto-save to history `:249-254` stores only `{gbr,max_force,rows_count}`. Load from history via `?load=` `:164-189`. `saveStatus` `:156,592` is never set (dead UI).
- **Findings**: P1-RND-9, 10, 11, 12, 13, 14, 20, 26, 27, 30, 33, 36, 40.

---

#### /dashboard/rnd/hydraulic — Hydraulic motor/pump sizing (`frontend/src/app/dashboard/rnd/hydraulic/page.tsx`)
- **Access**: FE `useRequireApp('rnd')` `:50,90`. BE `calculations.py:13` → `hydraulic/api.py:17` (`/calculate`), `:51` (`/download-report` DOCX), `:91` (`/hydraulic_report_pdf`).
- **Inputs** (all rendered as untyped `<input>` with no `type="number"`: `:132,239,266`; the only FE validation is none)

| field | unit (FE label `:24-32`) | modes `:17-22` | BE (`schemas.py:5-42` all `str`; `validation.py`) | mismatch / notes |
|---|---|---|---|---|
| weight | t | cc/speed/pressure | `float()` `validation.py:40`; `core.py:45` `>0` | empty → BE 400 "could not convert string to float: ''" with no field name |
| axles / drive_axles | – | all but gear | `int()` `:41-49`; drive ≤ axles `:56-57`; `core.py:38-44` | "2.0" → `int('2.0')` ValueError → raw Python text shown |
| wheel_diameter | mm | all | float; `core.py:31`, `:321` | ok |
| speed | km/h | cc/pressure/gear | float `:94` | ok |
| max_vehicle_rpm, pto, engine_gear_ratio (CSV), axle ratio | – | cc/speed | float `:59-70`; engine list parse `:66-70` | one bad token fails the whole request with a raw ValueError |
| slope_percent / curve_degree | % / degree | cc/speed/pressure | unit converters `:128-186`; FE hard-codes `slope_unit:'percent', curve_unit:'degree'` `page.tsx:65` | BE supports ratio/degree/radius but the FE offers no unit choice |
| pressure | bar | cc/speed | FE hard-codes `pressure_unit:'bar'` `:66`; BE converts Pa/kPa/MPa/kgf `:97-115` | same as above |
| mech_eff_motor, vol_eff_motor, vol_eff_pump | % | varies | plain `float()` `:74-75,122`; **no range**. Only `mech_eff_pump` is range-checked `:78-88` | 150% is accepted. 0 is caught only deep in core (`core.py:82-88,143`). |
| motor_disp_in / pump_disp_in | cc | speed/pressure | float | the "Suggested … Use" chip `page.tsx:133-143` edits the input but leaves the old result on screen |
| max_motor_rpm, num_motors, per_axle_motor, num_pumps | – | varies | int/float | – |
| doc_no / made_by / checked_by / approved_by / doc_date | – | – | schema `:37-41`, escaped for PDF `api.py:128-130` | **the FE has no inputs for these**, so the PDF/DOCX header is always blank |

- **Views**: mode radio cards `:215-221`. Input cards filtered by mode `:238-278`. Terminal log of BE `report` text `:287` (TerminalPanel empty state "System Ready"). DOCX `:109-113` and PDF `:115-119` buttons are enabled before any calculation. Filenames are fixed `Hydraulic_Report.*` (the BE builds a `doc_no`-based name `api.py:75-77,133` that the FE overrides). Auto-save `:100` is named `Hydraulic — calc_cc`, i.e. the raw mode key. There are no stat cards and no charts. Errors go through `getErrorMessage` `:103,112,118`, so real BE text appears, but it is raw Python text.
- **Findings**: P1-RND-18, 19, 26, 27, 31, 33.

---

#### /dashboard/rnd/qmax — Max permissible wheel load (`frontend/src/app/dashboard/rnd/qmax/page.tsx`)
- **Access**: FE `useRequireApp('rnd')` `:38,87`. BE `calculations.py:13` → `qmax/api.py:13` (`/calculate`), `:25` (`/download-report` DOCX only, no PDF).
- **Inputs**

| field | control | unit | req? | FE validation | BE validation | mismatch / notes |
|---|---|---|---|---|---|---|
| Material σB | 3 cards 880/680/Custom `:193-203` | N/mm² | yes | custom `>0` `:97` | `schemas.py:7-8` str; `validation.py:21-43` fuzzy match; **anything unmatched, including "Custom" with an empty custom value, silently becomes 880** `:42` | the FE blocks the empty case, but the API accepts it |
| Custom σB | number step 10 `:206` | N/mm² | if custom | `>0` | `validation.py:23-29` | the specific reason is overwritten by the generic "Invalid custom sigma_b value" `:28-29` |
| d | number `:222` | mm | yes | `>0` `:96` | `validation.py:13-18` `>0`, but the inner message is replaced by "Invalid worn rail diameter" | label "Worn Rail Head Diameter" vs help text "worn tread diameter of the wheel/rail contact" `:221-223`: rail or wheel? |
| e (optional) | number `:227` | mm | no | none | **not in schema** | FE-only recompute `:105-113` (`d_eff = √(d·e)`) |
| v_head | number step .05 `:238` | – | yes | `>0` `:98` | `validation.py:46-51` `>0` | ok |
| Q_applied (optional) | number `:243` | kN | no | none | not in schema | FE-only PASS/FAIL `:170,271-276` |

- **Views**: big Qmax kN tile `:260-264`. Four MiniResults `:265-270`; "Diameter d" shows the live input `d`, not `result.d`. Compliance banner `:271-276`. Formula card `:280-294`. Actions: Calculate, Export CSV `:125-140`, DOCX `:142-146` (fixed name `Qmax_Report.docx`), History as `<a href>` `:305`. Terminal shows the BE report `:308`. No tonnes display on screen (BE returns `qmax_tonnes`; only the CSV shows it).
- **Findings**: P1-RND-15, 16, 17, 26, 27, 28, 33, 35.

---

#### /dashboard/rnd/load-distribution — Wheel load ΔQ/Q check (`frontend/src/app/dashboard/rnd/load-distribution/page.tsx`)
- **Access**: FE `useRequireApp('rnd')` `:44,88`. BE `calculations.py:13` → `load_distribution/api.py:14` (`/calculate`), `:31` (`/download-report` DOCX only).
- **Inputs**

| field | control | unit | req? | FE validation | BE validation (`schemas.py`) | mismatch / notes |
|---|---|---|---|---|---|---|
| config_type | 2 cards Bogie/Axle `:30-33,182-191` | – | yes | – | `Literal["Bogie","Truck","Axle"]` `:8` | FE has no "Truck". Selecting a card also overwrites Total Load (19 or 28 t) `:185`. |
| total_load | number `:206` | Ton | yes | only `isNaN` `:94` | `>0` `:14-19` | `Number('')` is `0`, not NaN, so an empty field passes the FE check and fails BE 422 → generic error |
| front_percent | number min0 max100 `:209` | % | yes | 0-100 `:98` | `>0` **and** 0-100 `:14-26` | FE allows 0, BE rejects it |
| q1_percent / q3_percent | number 0-100 `:214,219` | % of front/rear | yes | 0-100 | `>0` and 0-100 `:28-33` | same 0 mismatch |

- **Views**: Front/Rear bogie boxes Q1-Q4 `:237-240`. Safety panel QL/Q/ΔQ and ΔQ/Q with a PASS/FAIL/PENDING pill `:242-259`. Terminal `:263`. Formula card `:268-293`. Q summary `:295-312` with an empty state. Export CSV `:118-129`, DOCX `:131-135` (fixed name), History `<a>` `:171`. Auto-save `:109`.
- **Findings**: P1-RND-5, 6, 7, 26, 27, 33.

---

#### /dashboard/rnd/tractive-effort — TE / Power / OHE current (`frontend/src/app/dashboard/rnd/tractive-effort/page.tsx`)
- **Access**: FE `useRequireApp('rnd')` `:33,77`. BE `calculations.py:13` → `tractive_effort/api.py:14` (`/calculate`), `:24` (`/download-report` DOCX only).
- **Inputs**

| field | control | unit | req? | FE validation | BE (`schemas.py:6-21`) | mismatch / notes |
|---|---|---|---|---|---|---|
| mode | Running/Start cards `:170-174` | – | yes | – | `Literal["Start","Running"]` | text at `:177` misdescribes BE behaviour (P1-RND-8) |
| load | number `:191` | t | yes | `isNaN` only `:82` | `≥0` `:16-20` | empty → 0 accepted. "T1 per ton" divides by the live `load` → Infinity/NaN `:304`. |
| loco_weight | number `:192` | t | yes | same | `≥0` | – |
| speed | number min0 `:195` | km/h | yes | same | `≥0` | help "Set 0 for pure starting TE" `:196` is wrong (see P1-RND-8) |
| gradient + grad_type | number + select (1 in G, Degree) `:204-209` | – | yes | none, negatives allowed | `≥0`; `Literal["Degree","1 in G"]` | a downhill (negative) value → BE 422 → generic "Calculation failed". No % option, unlike braking/vehicle. |
| curvature + unit | number + select (Degree, Radius(m)) `:211-216` | ° or m | yes | none | `≥0`; `Literal["Radius(m)","Degree"]` | Radius 0 → treated as straight (`core.py:23`) |

- **Views**: 3 summary tiles TE kg / HP / Amps `:233-237`. Resistance bars T1-T4 plus a % breakdown `:239-263`. Terminal `:267`. Formula card `:272-298` (lists "kW = HP × 0.7457" although kW is never shown). "Specific Values" `:300-308` is computed from **live** inputs `:144`. Export CSV `:101-111`, DOCX `:113-117`, History `<a>` `:159`.
- **Findings**: P1-RND-8, 26, 27, 28, 33.

---

#### /dashboard/rnd/vehicle-performance — Loco traction envelope (`frontend/src/app/dashboard/rnd/vehicle-performance/page.tsx`)
- **Access**: FE `useRequireApp('rnd')` `:50,135`. BE `calculations.py:13` → `vehicle_performance/api.py:14` (`/calculate`), `:36` (`/download-report` DOCX only).
- **Inputs**

| field | control | unit | FE validation | BE (`schemas.py:6-28`, `validation.py`, `service.py:100-139`) | mismatch / notes |
|---|---|---|---|---|---|
| Doc No/Made/Checked/Approved | text `:231-235` | – | none | Optional str | **defaults are real names: Checked "Jasbir Singh", Approved "Madhav Arora"** `:56-57` |
| Date | `type=date defaultValue` `:232` | – | – | `doc_date` Optional | uncontrolled and **never sent** (`payload` `:89-97` has no doc_date) |
| GVW | number `:242` | kg | none | float → `loco_gvw_kg` `validation.py:13`, /1000 `service.py:119-120` | unit is kg here but t in TE/spline/hydraulic |
| Max Speed | number `:243` | km/h | none | float → `max_speed_kmh` `service.py:121` | **never used in any calculation** (only assigned). Max speed comes from max_rpm. |
| No. of Axles | number `:244` | – | none | `int` `schemas.py:11` | "2.5" → 422 → generic error |
| Rear axle ratio, Gear ratios CSV | number/text `:245-246` | – | NaN tokens dropped `:93` | `List[float]` | an empty list → `max()` ValueError → HTTP 500 with raw "max() arg is an empty sequence" |
| Shunting load | number `:247` | t | none | float | – |
| Max curve + unit (degree/m) | `:254-259` | – | none | `curve_unit=='m'` → 1750/R `service.py:110-112` | ok |
| Max slope + unit (%/degree) | `:261-266` | – | none | `service.py:114-116` | ok |
| Peak power, μ, wheel dia, min/max RPM | `:274-278` | kW, –, **m**, rpm | none | float/int | wheel dia is in m here but mm in braking/hydraulic |
| Torque curve rows | editable table `:306-316`, CSV import/export | rpm / N·m | rows with NaN/≤0 rpm silently dropped `:80-87` | `Dict[int,float]`, empty → ValueError `service.py:136-137` | – |

- **Views**: 3 tiles (Max traction N, No-slip N, Status) after calculation `:217-223`. Torque table. Speed-vs-slope table `:321-340` (one speed per slope, computed for the lowest gear only, `service.py:~264`, inferred). Two Chart.js line charts with an empty state `:343-350`, `ChartJsLineChart.tsx:134-136`. Terminal text is composed on the FE from **live** inputs `:357`. "Save Doc" `:212` is the DOCX download (fixed name). Export CSV of inputs `:165-173`. History `<a>` `:213`.
- **Findings**: P1-RND-21, 22, 26, 27, 28, 33, 34.

---

#### /dashboard/rnd/spline — Spline shaft strength / FOS (`frontend/src/app/dashboard/rnd/spline/page.tsx`)
- **Access**: FE `useRequireApp('rnd')` `:34,103`. BE `calculations.py:13` → `spline/api.py:18` (`/calculate`), `:26` (`/report` PDF), `:56` (`/docx`). There is also `GET /tools/spline/` `:12-15`, which redirects to a non-existent `/spline_calculator.html`.
- **Inputs** (BE `schemas.py:3-27` **all `str`**; `validation.py` is never called; `core.py:17-38` `as_float` only)

| field | unit (FE) | FE validation `:105-120` | BE | mismatch / notes |
|---|---|---|---|---|
| number_teeth | – | `>0` | float, no int/range | 8.5 teeth accepted |
| diametral_pitch | – (teeth/in) | `>0` | float | pitch dia = Z/P is **inches** (`core.py:44` comment) but the FE labels it mm `:276-278,295-297` |
| pressure_angle | ° | **not required**, default **0** `:44` | float | 0° pressure angle on an "Involute spline · ANSI B92.1" screen `:195` (B92.1 uses 30/37.5/45°) |
| outer/inner diameter, length | mm | `>0` | float; no OD>ID check | ID > OD → negative tooth height → negative area → negative FOS shown as "UNSAFE" with no explanation |
| yield_strength | MPa | `>0` | float | – |
| material_type | text | none | str → LaTeX template unescaped | P1-RND-3 |
| loco_weight | t | `>0` | float | – |
| axles, wheels/axle | – | `>0` | float | – |
| speed | km/h | **not required** | float; empty → unhandled ValueError → HTTP 500 "Something went wrong… ValueError #id" | – |
| wheel_diameter | **m** | `>0` | float | – |
| friction_coeff | – | `>0` | float | – |
| doc fields | – | none | rendered raw into LaTeX | P1-RND-3 |

- **Views**: 3 stat tiles `:260-264`. Verdict banner `:266-271` (the FE has an `ACCEPTABLE` style `:16,21` that the BE never returns, `core.py:94`). Geometry details `:273-283`. The terminal log is composed on the FE `:285,292-312`. Export CSV `:138-151`, DOCX `:153-157` and PDF `:158-162` (named `Spline_Report_${docNo}`), History `Link` `:201`. Auto-save `:129` stores the full result.
- **Findings**: P1-RND-3, 23, 24, 25, 26, 27, 29, 31, 33.

---

#### /dashboard/rnd/history — Saved calculations (own + admin all-users) (`frontend/src/app/dashboard/rnd/history/page.tsx`)
- **Access**: FE `useRequireApp('rnd')` `:41,85`. Admin toggle is shown only when `user.role==='admin'` `:44,120`. BE: `history.py:19` **no app gate**. `/save` `:153`, `/list` `:188` (own rows only), `/detail/{id}` `:255`, `/rename/{id}` `:276`, `/delete/{id}` `:295` all use `get_current_user` plus an owner-or-admin check (`:264,287,304`), so **no IDOR**. `/admin/list` `:210` and `/admin/users` `:240` use `require_admin` (`role=="admin"`, `:44-51`), so admin mode is **BE-enforced**.
- **Inputs**: tool filter pills `:155-158` (server-side `tool_name`). Search by name `:160-165` (client-side). Admin user dropdown `:134-143`. Inline rename `:189-193` (Enter or ✓). Delete via ConfirmDialog.
- **Views**: 3 stat cards `:148-152`, computed over the currently loaded (filtered) set. Table `:170-222` has columns # (row index, not id), Name, User (admin only), Tool, Saved On, Actions (Open/Rename/Delete). Loading row `:179`. Empty row `:180`. No pagination and no sort control: BE returns newest-first, capped at 100 (`history.py:198`) or 500 for admin (`:225`), with no "showing N of M". There is no view of stored `results_json`; "Open" routes to the tool with `?load=id` and **recalculates** `:90-93`.
- **Findings**: P1-RND-1, 2, 32, 37, 39, 41, 42.

---

#### components/rnd/ToolCalculatorPage.tsx — generic calculator shell (unused)
- **Access**: `useRequireApp('rnd')` `:71`. **Not imported by any page.** It contains the only manual "Save to History with name" flow (`:116-134,195-208`) and a generic fallback "Calculation failed. Check your inputs and try again." `:92`.
- **Findings**: P1-RND-36.

---

#### Findings

**Security / access**
- **P1-RND-1 [SEC]** The history router has no `require_app_access("rnd")` (`backend/app/modules/rnd/routes/history.py:19`, while `calculations.py:13` has it). Any logged-in user without the R&D app can call `/rnd/history/save|list|detail|rename|delete`. Fix: `APIRouter(prefix="/history", dependencies=[Depends(require_app_access("rnd"))])`.
- **P1-RND-2 [SEC]** `/history/save` accepts any `tool_name: str` and unbounded `dict` inputs/results (`history.py:32-36,153-185`). A user can store arbitrary blobs and junk tool names, and those rows show in History with no working "Open" (`history/page.tsx:91-92` silently does nothing). Fix: `Literal[...]` tool_name, a max JSON size, and a max length on `calculation_name`.
- **P1-RND-3 [SEC]** Spline PDF has a LaTeX injection. `spline/api.py:34-38` passes raw `data.dict()` to `utils/templates/spline_template.tex:44,53-55,148` (`doc_no`, `made_by`, `checked_by`, `material_type`), which is compiled by pdflatex (`services/pdf_service.py:61-70`). A Doc No like `\input{/app/.env}` would render file contents into the PDF. Hydraulic already escapes these (`hydraulic/api.py:124-130`) and so does braking (`braking/service.py:310-313`). Fix: `escape_latex` every free-text field before rendering (or enable Jinja finalize-escaping).
- **P1-RND-4 [SEC]** R&D tab permissions are FE-cosmetic. `RndNav.tsx:49` hides tabs, but tool pages only check `useRequireApp` (e.g. `braking/page.tsx:106`), hub cards are unfiltered (`rnd/page.tsx:74`), and no BE R&D route uses `require_tab_access` (`core/permissions.py:36`) despite `permission_registry.py:53-65` defining the subtabs. Fix: add `require_tab_access("rnd", <tab>)` to each `include_router` in `calculations.py:15-21` and to history, plus an FE page guard and filtering in the hub.
- **P1-RND-41 [SEC]** Admin rename/delete of *other users'* calculations is allowed (`history.py:287,304`) with no audit-log entry. The FE gives no indication that the record belongs to someone else before deleting (`history/page.tsx:214,226-232`). Fix: write an audit log row on admin rename/delete, and name the owner in the ConfirmDialog message.

**Business-logic / engineering correctness**
- **P1-RND-5 [BA]** Load Distribution shows the wrong safety limit. The FE says "ΔQ/Q ≤ 25%" (`load-distribution/page.tsx:31-32,284,290`), but the BE passes up to **60% (Bogie) / 50% (Truck/Axle)** (`load_distribution/constants.py:5-6`, `core.py:51`). A 40% imbalance shows "✓ PASS" beside text that says the limit is 25%. Fix: agree the standard limit with R&D, put it in one constant, and have the FE render `result.limit` only.
- **P1-RND-6 [BA]** Load Distribution "Axle" config is mis-modelled. The FE note says "Single axle, 2 wheel loads" (`:32`) but still renders front/rear bogies Q1-Q4 (`:238-239`). The BE treats Axle like Truck (50% limit) and computes 4 loads. "Truck" (`schemas.py:8`) is not offered. Fix: define the Axle/Truck semantics, then align the options and layout.
- **P1-RND-7 [BA]** Load Distribution FE/BE range mismatch. The FE allows 0% (`:98`) and treats empty as 0 (`Number('')`, `:59-62,94`), while the BE rejects `<=0` (`schemas.py:14-19`) → 422 → generic "Calculation failed". Fix: FE `>0` checks with per-field messages, and treat empty strings as missing.
- **P1-RND-8 [BA]** The Tractive Effort mode descriptions contradict the maths. Running says "Speed-dependent rolling resistance (Davis formula)" (`tractive-effort/page.tsx:177`) but the BE uses constant 1.3505/2.913 kg/t (`tractive_effort/constants.py:7-8`, `core.py:27-33`). Start says "speed used only for HP/OHE output", but the BE forces speed = 1.0 in Start (`core.py:29-30`), and the help "Set 0 for pure starting TE" (`:196`) is wrong. Fix: correct the copy, or implement the stated formulas.
- **P1-RND-9 [BA]** Braking GBR / max braking force does not depend on the user's speeds or gradients. `braking/core.py:9-18` takes the max over the fixed `BRAKING_DATA` table (`constants.py:7-10`) and ignores `reaction_time`, so GBR = max(v²/2d)/g ≈ 8.4% for every vehicle (inferred numerically). The stat card (`braking/page.tsx:376`) presents it as a computed result. Fix: confirm the intended definition with R&D, or label it "EN reference GBR".
- **P1-RND-10 [BA]** Braking "Moving down" hides runaway. `core.py:50` uses `abs(f_net / mass)`, so when the gravity component exceeds the braking force the table still shows a positive deceleration and a finite stopping distance. Fix: when `f_net <= 0`, mark the row "Cannot stop (gravity > brake force)" / Inf.
- **P1-RND-11 [BA]** Braking compliance differs between screen and report. The FE interpolates EN limits (`braking/page.tsx:50-61`) and ignores the BE `status`. The BE steps down to the lower table speed (`braking/units.py:30-47`), and PDF/DOCX use the BE status (`reports/pdf_builder.py:265`). At 45 km/h the screen limit is 122.5 m while the report limit is 90 m, so the screen can say PASS where the PDF says FAIL. Fix: compute compliance once on the BE (one method) and render `row.status`.
- **P1-RND-12 [BA]** Braking has dead inputs: Brake Type (`:504-506`), Track Standard / Curve / Super-elevation / Cant / Gauge (`:446-470`, Track CSV import `:334-346`), Custom/Target distance and distance mode (`:518-543`), Show GBR (`:572`). None is sent (`payload` `:216-233`) or reaches the PDF (schema `braking/schemas.py:6-25`). Fix: remove them, or wire them into the schema and report.
- **P1-RND-13 [BA]** Braking silently coerces inputs. Reaction Time 0 → 1 s (`page.tsx:222`), μ 0 → 0.7 (`:232`, plus `validation.py:21` `raw.mu or 0.7`, which makes the `mu<=0` check at `:33` unreachable for 0), and empty road speed/gradient → '30'/'5' (`:229-230`). Fix: validate and show errors instead of substituting.
- **P1-RND-14 [BA]** Braking speed list: one bad token empties the whole list. `units.py:8-16` returns `[]` on any parse error. The FE check (`page.tsx:207`) passes "10,abc", the BE returns zero rail rows, and the UI says "No results for the selected scenario filters" (`:633-634`). Fix: raise a 400 naming the bad token, and make the FE validate every token.
- **P1-RND-15 [BA]** The Qmax "e" parameter and Q_applied exist only on the FE. `qmax/page.tsx:105-113` recomputes Qmax client-side with an undocumented `√(d·e)`. The terminal report (`:308`) and DOCX (`:144`, payload without e) show the **unadjusted** BE value, so the same screen shows two Qmax numbers and the report disagrees with the screen. Fix: move e and Q_applied into `QmaxInput` and the BE service/report.
- **P1-RND-16 [BA]** Qmax BE silently defaults σB to 880. `qmax/validation.py:22-43`: "Custom" with an empty/invalid custom value, or any unknown selection, becomes 880 N/mm² with no error. Fix: reject it with 422 "Custom σB required".
- **P1-RND-17 [USER]** Qmax label is ambiguous. "Worn Rail Head Diameter — d (mm)" with the help text "worn tread diameter of the wheel/rail contact" (`qmax/page.tsx:221-223`, BE comment `schemas.py:6` "Worn rail diameter"). Fix: confirm whether d is wheel or rail and label it consistently in the UI and report.
- **P1-RND-18 [BA]** Hydraulic efficiencies are not range-checked. `mech_eff_motor`, `vol_eff_motor` and `vol_eff_pump` are plain `float()` (`hydraulic/validation.py:74-75,122`). Only `mech_eff_pump` is checked (`:78-88`), so 150% is accepted. Every hydraulic schema field is `str` (`schemas.py:7-35`). Fix: typed numeric fields with `gt/le` constraints.
- **P1-RND-19 [USER]** Hydraulic has no FE validation or typed inputs. All inputs are plain text (`hydraulic/page.tsx:132,239,266`). A blank field produces the raw BE message "could not convert string to float: ''" with no field name (`validation.py:40-70`, `api.py:43-46`). Fix: `type="number"`, required markers, and BE errors that name the field.
- **P1-RND-20 [BA]** Braking distance-mode "Req. Force" and the detail-row reaction distance use **live** inputs (`braking/page.tsx:646,702`), not the inputs the result was computed from. Editing mass or reaction time after Calculate changes these columns without recalculating. Fix: snapshot the inputs with the result.
- **P1-RND-21 [BA]** Vehicle "Max Speed" input is ignored. It is stored as `max_speed_kmh` (`vehicle_performance/service.py:121`) and never read; top speed is derived from max_rpm. The Date field is uncontrolled and never sent (`vehicle-performance/page.tsx:54,232,89-97`). Fix: use or remove Max Speed, and send `doc_date`.
- **P1-RND-22 [BA]** Vehicle report defaults to named approvers. Checked By "Jasbir Singh" and Approved By "Madhav Arora" are prefilled (`vehicle-performance/page.tsx:56-57`), so every DOCX claims a check and approval that never happened. The spline LaTeX template has similar defaults (`spline_template.tex:54-55`). Fix: default to blank or the current user for Made By only.
- **P1-RND-23 [BA]** Spline unit label is wrong. Pitch/base diameter = Z/P is in inches when P is diametral pitch (`spline/core.py:44`), but it is shown as mm (`spline/page.tsx:276-278,295-297`). The default pressure angle is 0° (`:44`) on an "ANSI B92.1" screen (`:195`). Fix: convert to mm or label it "in", and default to 30°.
- **P1-RND-24 [BA]** Spline does not check OD > ID, and speed/pressure angle are not required (`spline/page.tsx:105-110`). The BE `validation.py` is never called (`spline/api.py:21` calls `core` directly), so ID ≥ OD gives a negative area and FOS with just "UNSAFE", and an empty speed gives a 500 (P1-RND-29). Fix: call `validate_spline_inputs` with real checks.
- **P1-RND-25 [USER]** The spline FE defines an `ACCEPTABLE` verdict (`spline/page.tsx:16,21`) that the BE never returns (`core.py:94`: SAFE/UNSAFE only). Fix: drop it, or add the band on the BE.

**Error handling (standard: real reason + fix)**
- **P1-RND-26 [USER]** Calculate errors swallow the BE detail and show a generic message. Braking `:256-257` "Calculation failed. Check your inputs and try again."; Qmax `:118-119`; Load `:111-112`; TE `:94-95`; Vehicle `:152-153`; Spline `:131-132`. That makes 6 screens where BE 400/422/500 text (e.g. "Drive axles cannot exceed…", Pydantic field errors) never reaches the user. Braking PDF `:274-275` "PDF generation failed." is also generic. Fix: `catch (err) { setError(extractErrorMessages(err, …).join(' ')) }`.
- **P1-RND-27 [USER]** Swallowed failures. The auto-save `.catch(() => {})` appears 7 times: braking `:254`, hydraulic `:100`, qmax `:116`, load `:109`, TE `:92`, vehicle `:150`, spline `:129`. The user believes a run was saved when it may not have been. The history-load `.catch(() => setError('Could not load the saved calculation.'))` appears 7 times (braking `:187`, hydraulic `:86`, qmax `:83`, load `:84`, TE `:73`, vehicle `:131`, spline `:99`) and hides 403/404 reasons. Fix: surface a non-blocking error with the real reason.
- **P1-RND-28 [USER]** DOCX download errors show "Request failed with status code …". `extractErrorMessages` cannot read Blob bodies (`lib/validation.ts:60-67`) and is used on blob calls at qmax `:145`, load `:134`, TE `:116`, vehicle `:162`, spline `:156,161`. Fix: use `getErrorMessage` (reads Blob, `toolStyles.ts:60-75`) and extend it to read `errors[]`.
- **P1-RND-29 [ARCH]** Spline endpoints bypass the error contract. `/calculate` has no try/except (`spline/api.py:18-23`), so a ValueError becomes the generic 500 "Something went wrong… ValueError #id" (`error_handler.py:48-57`). `/report` and `/docx` return `{"error": …}` (`api.py:53,73`), not `detail`, so no FE helper can read them. Fix: `HTTPException(400, detail=…)` like hydraulic.
- **P1-RND-30 [ARCH]** User-input errors are returned as HTTP 500 with raw `str(e)`: braking `api.py:24-25,43-44,62-63`; qmax `api.py:22-23,37-38`; load `api.py:28-29,49-50`; TE `api.py:21-22,36-37`; vehicle `api.py:29-33,55-59`. The client sees "server error" for their own typo, plus internals such as "max() arg is an empty sequence". Fix: catch ValueError → 400 with a field-named message, and keep 500 for real faults.
- **P1-RND-31 [ARCH]** Debug output in production paths: `print()` of full inputs/results in spline (`spline/api.py:20-22,28-53`) and vehicle (`vehicle_performance/api.py:30-32,56-58`). Hydraulic PDF writes tracebacks to a relative `logs/pdf_error.log` (`hydraulic/api.py:143-156`). Fix: use `logger`, and drop the file writes.

**UX / consistency / dead code**
- **P1-RND-32 [USER]** History auto-fills without consent and is truncated. Every Calculate creates a record (P1-RND-27 sites) with names like `Hydraulic — calc_cc` (`hydraulic/page.tsx:100`). `/history/list` caps at 100 newest (`history.py:198`), so older saves vanish with no pagination or notice (`history/page.tsx:168-222`). Fix: an explicit "Save to History (name)" action (as in the unused ToolCalculatorPage `:116-134`), plus pagination.
- **P1-RND-33 [USER]** Reports are built from **current form inputs**, not the result on screen: braking `:267`, hydraulic `:111,117`, qmax `:144`, load `:133`, TE `:115`, vehicle `:161`, spline `:155,160`. Download buttons are enabled before any calculation (hydraulic `:204-205`, load `:170`, TE `:158`, vehicle `:212`, spline `:199-200`). After an input edit the PDF/DOCX disagrees with the on-screen table. Fix: clear the result on input change, or build the report from the payload that produced the result.
- **P1-RND-34 [USER]** Stale values after an input change. Braking stat cards Mass/Reaction show live inputs (`braking/page.tsx:378-379`). Qmax "Diameter d" MiniResult (`qmax/page.tsx:269`). TE Specific Values (`tractive-effort/page.tsx:144,303-305`). Vehicle terminal text (`vehicle-performance/page.tsx:357`). Fix: render from the result snapshot.
- **P1-RND-35 [USER]** Report-format coverage is inconsistent. Braking: PDF only (the BE DOCX endpoint `braking/api.py:48` has no FE caller, `api.ts:1834-1840`). Hydraulic and Spline: DOCX+PDF. Qmax, Load, TE, Vehicle: DOCX only. Filenames are fixed (`Hydraulic_Report.docx` etc.) except braking and spline. The Vehicle DOCX button reads "Save Doc" (`vehicle-performance/page.tsx:212`), which is easily confused with saving to history. Fix: one DownloadDef pattern with PDF + DOCX per tool, named by Doc No.
- **P1-RND-36 [ARCH]** Duplicated patterns and dead code. `ToolCalculatorPage.tsx` is unused. Seven pages each re-implement state, error, auto-save, CSV import and downloads. `parseCsvKeyValue` is copied 6 times (braking `:309`, hydraulic `:148`, qmax `:154`, load `:143`, TE `:125`, spline `:170`). Local StatCards duplicate `components/rnd/StatCard.tsx` (braking `:770`, history `:280`). Braking redefines styles that exist in `toolStyles.ts` (`braking/page.tsx:79-95,750-759`). Dead BE `calculate.py` in tractive_effort, vehicle_performance and spline is never imported (TE `calculate.py:38` even labels HP as `power_kW`). There is a dead spline `GET /` redirect (`spline/api.py:12-15`). Fix: adopt ToolCalculatorPage (or delete it) and remove the dead modules.
- **P1-RND-37 [BA]** Per-tool snapshot rows go out of sync. `_snapshot_tool_calculation` (`history.py:68-150`) writes `rnd_*_calculations` rows with no FK to `rnd_calculation_history`. Rename (`:290`) and delete (`:306`) never touch them, so they keep old names and deleted data. Fix: add `history_id` FK with cascade, or drop the duplicate tables.
- **P1-RND-38 [USER]** Hub tool cards are `div onClick` (`rnd/page.tsx:75-77`), which cannot be reached by keyboard or opened in a new tab. History links on 4 pages are `<a href>`, causing a full reload (qmax `:305`, load `:171`, TE `:159`, vehicle `:213`), while braking/hydraulic/spline use `Link`. Fix: use `<Link>` everywhere.
- **P1-RND-39 [USER]** History error handling gaps. `load()` has no catch (`history/page.tsx:58-73`), so a failed fetch shows "No saved calculations yet." (`:180`). Rename/delete have no try/catch (`:88-89,230`), so failures are silent. The admin-users fetch uses `.catch(() => {})` (`:82`). Fix: add an error banner with the BE reason.
- **P1-RND-40 [USER]** The braking/qmax pseudo-breadcrumb "R&D Tools / …" is non-clickable text in the header's top-right, where the standard puts "← Back" (`braking/page.tsx:370`, `qmax/page.tsx:183`). No R&D sub-page has a Back button. Fix: replace it with the standard `secondaryBtnStyle` "← Back" pill to `/dashboard/rnd`.
- **P1-RND-42 [USER]** History detail gaps. The empty-state text is the same whether there is no data or the filter/search matches nothing (`history/page.tsx:180`). `colSpan={6}` is used on the 5-column non-admin table (`:179-180`). Rename accepts blank, which the BE stores as NULL (`history.py:289-290`) and the table shows as "—". Stored `results_json` can never be viewed: "Open" recalculates, and braking stores only `{gbr,max_force,rows_count}` (`braking/page.tsx:252`). Fix: a filter-aware empty state, blank-name validation, and a read-only "view saved result" drawer.

##### R&D counts
- **Screens covered**: 10 (hub, braking, hydraulic, qmax, load-distribution, tractive-effort, vehicle-performance, spline, history incl. admin mode, plus the unused ToolCalculatorPage shell).
- **window.* / bare alert/confirm/prompt dialogs**: **0** (none found in `app/dashboard/rnd/**` or `components/rnd/**`; history delete correctly uses `ConfirmDialog`, `history/page.tsx:226-232`).
- **Non-standard Back buttons**: **0 Back buttons exist**, so there are 0 deviating ones. Two non-clickable breadcrumb stand-ins sit where the Back pill should be (`braking/page.tsx:370`, `qmax/page.tsx:183`), counted as P1-RND-40.
- **Sub-nav placement violations**: 0 (RndNav is above the header on all 10).
- **Findings by tag** (42 total): **SEC 5** (1, 2, 3, 4, 41) · **BA 19** (5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 21, 22, 23, 24, 37) · **USER 14** (17, 19, 25, 26, 27, 28, 32, 33, 34, 35, 38, 39, 40, 42) · **ARCH 4** (29, 30, 31, 36).


### (C) Finance & Accounting

Scope read in full: FE `frontend/src/app/dashboard/finance/{page,masters,ledger,ar-ap,banking,reports}/page.tsx`, `components/finance/FinanceNav.tsx`, `lib/api.ts:1413-1631` (accountsApi), `types/index.ts:28`; BE `backend/app/modules/accounts/{routes/*.py, schemas/*.py, service.py (1-787), reports.py, models/*.py}`, routers `backend/app/main.py:284-295`.

Cross-cutting facts (apply to every screen below):
- **FE gate** everywhere = `useRequireApp('accounts')` (masters:40, ledger:41, ar-ap:48, banking:32, reports:35). Page renders `null` while loading/unauthorized.
- **BE gate** everywhere = `require_app_access("accounts")` (`core/permissions.py:8`). The ONLY role checks in the whole module: `_require_finance_manager` on period close (`routes/period_close.py:20-22,69`) and variance approval (`routes/vendor_invoices.py:24-26,117`); `_require_admin` on reopen (`period_close.py:25-27,88`). No `require_tab_access`; `core/permission_registry.py` has no accounts/finance entries; FinanceNav does not call `filterTabsByAccess`.
- **`is_finance_manager` is NOT in `/auth/me`** (`main/schemas/auth.py:10-30`), although it exists on the model (`main/models/user.py:57`) and FE type (`types/index.ts:28`). So `user?.is_finance_manager` is always `undefined` on FE.
- All money columns are SQLAlchemy `Float` and all Pydantic amounts are `float` (e.g. `models/journal_entry.py:65-66`, `models/gl_balance.py:22-25`, `models/vendor_invoice.py:26-41`, `models/bank_account.py:25-26`).
- Nav placement: `<FinanceNav />` is the first child on every page (masters:47, ledger:165, ar-ap:268, banking:123, reports:67) — compliant. None of the pages has a page-header/title block at all.
- `window.confirm/alert/prompt` or bare `alert(`/`confirm(`/`prompt(`: **0** (grep over `app/dashboard/finance` + `components/finance`, exit 1). All dialogs use `MessageDialog`/`ConfirmDialog`/`PromptDialog`.
- Back buttons: **0 present, 0 deviations** — the module has no detail/child pages that would need one.
- JE ledger lines below are cited as `ledger:N` = line in `ledger/page.tsx`.

---

#### /dashboard/finance — redirect (frontend/src/app/dashboard/finance/page.tsx)
- **Access**: none on the redirect itself (page.tsx:6-13); target page gates.
- **Behaviour**: `router.replace('/dashboard/finance/masters')` (page.tsx:10). No landing/overview/KPIs.
- **Findings**: none beyond P1-FIN-36 (no page titles anywhere).

---

#### /dashboard/finance/masters › GL Accounts — chart of accounts CRUD (frontend/src/app/dashboard/finance/masters/page.tsx:77-204)
- **Access**: FE masters:40; sub-tab pill buttons masters:36,49-63 (local state, not URL-addressable). BE `routes/gl_accounts.py:22,40,58,76,97` — `require_app_access("accounts")` only for create/update/delete.
- **Inputs**

| field | control | req? | FE validation | BE validation | mismatch / notes |
|---|---|---|---|---|---|
| code | text | Y (`*`) | trim non-empty masters:105 (sent untrimmed masters:109) | `str` (`schemas/gl_account.py:6`); uniqueness app-check `gl_accounts.py:62-63,83-85` + DB `unique=True` (`models/gl_account.py:19`) | no trim/case-normalise BE → `"1000 "` ≠ `"1000"`; no length check vs `String(20)` → DB error |
| name | text | Y | trim masters:105 | `str` | no max length (150) |
| account_type | select asset/liability/equity/revenue/expense masters:148-156 | Y | fixed list | checked vs `GL_ACCOUNT_TYPES` `gl_accounts.py:60-61,81-82` | OK; but type can be changed after postings (P1-FIN-29) |
| account_sub_type | text | N | – | `str|None` | free text |
| opening_balance | number masters:158 | N | none | `float|None` | **field has no effect anywhere** — never read by posting/reports (grep: only `GLBalance.opening_balance` is used) (P1-FIN-29/4) |
| status | select active/inactive | – | – | not validated vs `GL_ACCOUNT_STATUSES` (`models/gl_account.py:8`, never referenced) | any string accepted |
| is_posting_account | select | – | – | bool | can flip to "group" after postings |
| is_control_account | select | – | – | bool | **never enforced** in `post_journal_entry` (P1-FIN-11) |
| currency | — not in FE | – | – | default "INR" | FE cannot set |

- **Views**: card list (code — name; type · subtype · status · Posting/Group · Control) masters:182-201; no search/filter/sort/pagination (BE supports `search`, `account_type`, `status` at `gl_accounts.py:18-31`, unused); no balance column; loading "Loading…" / empty "No GL accounts yet." masters:182. Edit inline via same form masters:93-101; delete via ConfirmDialog masters:143,195.
- **Findings**: P1-FIN-17 (raw-detail errors masters:115-116,129-130; delete FK 500), P1-FIN-18 (masters:90 no catch), P1-FIN-29, P1-FIN-11, P1-FIN-28.

#### /dashboard/finance/masters › Bank Accounts — company bank master (masters/page.tsx:210-322)
- **Access**: FE masters:40. BE `routes/bank_accounts.py:36,52,71` app-access only.
- **Inputs**

| field | control | req? | FE validation | BE validation | mismatch / notes |
|---|---|---|---|---|---|
| bank_name | text | Y | trim masters:237 | `str` (`schemas/bank_account.py:6`) | – |
| account_no | text, disabled on edit masters:283 | Y | trim masters:237 | unique app-check `bank_accounts.py:38-39,57-59` + DB unique (`models/bank_account.py:20`) | no digit/length format |
| account_holder_name / branch_name | text | N | – | `str|None` | – |
| ifsc_code | text masters:286 | N | none | `str|None` | **no IFSC format (`^[A-Z]{4}0[A-Z0-9]{6}$`) FE or BE** |
| opening_balance | number, locked on edit masters:287-289 | N | none | `float` → `current_balance` seeded `bank_accounts.py:40` | **never posted to the bank's GL account** → GL and bank sub-ledger start out of sync (P1-FIN-4/9) |
| status | select active/inactive/closed | – | – | not validated vs `BANK_ACCOUNT_STATUSES` | – |
| **gl_account_id** | **absent from FE form** (masters:211, 281-296) | – | – | `int|None` (`schemas/bank_account.py:13,24`) | **payments/collections refuse a bank with no GL link and tell the user to set it "under Finance > Masters > Bank Accounts", where no such field exists** (P1-FIN-7) |
| currency | absent | – | – | default INR | – |

- **Views**: card list "bank — acct no" + `Balance: {current_balance.toLocaleString('en-IN')} · status` masters:302-319 (only place in module with Indian digit grouping; no ₹); no GL account shown; loading/empty masters:302.
- **Findings**: P1-FIN-7, P1-FIN-17 (masters:251-252,265-266; delete has no reference check `bank_accounts.py:73-78` while `payment_transactions.bank_account_id` is NOT NULL FK `models/payment_transaction.py:26` → IntegrityError 500 (inferred)), P1-FIN-18 (masters:223), P1-FIN-28.

#### /dashboard/finance/masters › Vendors — AP vendor master (masters/page.tsx:328-452)
- **Access**: FE masters:40. BE `routes/vendors.py:40,56,75` app-access only; no audit log.
- **Inputs**

| field | control | req? | FE validation | BE validation | mismatch / notes |
|---|---|---|---|---|---|
| code / name | text | Y | trim masters:361 | code unique `vendors.py:42-43,61-63` + DB unique (`models/vendor.py:21`) | – |
| gstin | text masters:408 | N | none | `str|None` (`schemas/vendor.py:8`) | **no 15-char GSTIN format/checksum; no PAN-in-GSTIN consistency** |
| pan | text masters:409 | N | none | `str|None` | **no `^[A-Z]{5}[0-9]{4}[A-Z]$`** |
| city/state | text | N | – | – | state free text (GST place of supply) |
| contact_phone / contact_email | text | N | none | none | no phone/email format |
| bank_name / bank_account_no / ifsc_code | text masters:415-417 | N | none | none | **no IFSC format; changes unaudited (P1-FIN-3)** |
| credit_limit | number | N | none | `float|None` | negative allowed; never enforced on invoice |
| payment_days | number | N | none | `int|None` | negative allowed; drives AP due date |
| status | select active/inactive/blocked | – | – | not validated vs `VENDOR_STATUSES` | **blocked vendor still invoiced/paid** (`service.py:316-318` no status check) |
| address, pin_code, account_holder_name, early_payment_discount_pct, gl_reconciliation_account_id | **absent from FE** | – | – | in schema `vendor.py:10,13,20,23,24` | cannot be set from UI (P1-FIN-30) |

- **Views**: card list code — name; city · state · GSTIN · status masters:432-449; no search (BE `search` supported `vendors.py:22,29-31`); loading/empty masters:432.
- **Findings**: P1-FIN-3, P1-FIN-17 (masters:375-376,389-390; delete no ref check `vendors.py:77-82` vs `vendor_invoices.vendor_id` NOT NULL FK), P1-FIN-18 (masters:344), P1-FIN-28, P1-FIN-30.

#### /dashboard/finance/masters › Internal Orders — budgeted spend trackers (masters/page.tsx:458-595)
- **Access**: FE masters:40. BE `routes/internal_orders.py:44,62,83`.
- **Inputs**

| field | control | req? | FE validation | BE validation | mismatch / notes |
|---|---|---|---|---|---|
| code / name | text | Y | trim masters:493 | unique `internal_orders.py:48-49,69-71` + DB unique | – |
| order_type | select capital/maintenance/it/training | Y | fixed | vs `INTERNAL_ORDER_TYPES` `internal_orders.py:46-47` | OK |
| start_date / end_date | date | N | none | `date|None` | **end < start accepted** FE & BE |
| budgeted_amount | number | N | none | `float|None` | negative accepted |
| cost_center_id | select masters:553-558 | N | – | FK only | list source is admin-only (P1-FIN-16) |
| status | select | – | – | not validated vs `INTERNAL_ORDER_STATUSES` | – |
| gl_account_id | absent | – | – | in schema | – |

- **Views**: card list code — name; type · cost centre · status masters:575-592; no budget/actual shown.
- **Findings**: P1-FIN-16 (masters:474-476 Promise.all with `/organization/cost-centers` = `require_admin` `organization/routes/cost_center.py:37`), P1-FIN-17 (masters:509-510,523-524; delete no ref check `internal_orders.py:85-90` vs `journal_entry_lines.internal_order_id` FK), P1-FIN-28.

---

#### /dashboard/finance/ledger › Period Close bar — close/reopen current month (frontend/src/app/dashboard/finance/ledger/page.tsx:74-106,176-212)
- **Access**: FE `canClosePeriod = !!user?.is_finance_manager || role==='admin'` ledger:42 → **"Close Period" link is HIDDEN (not disabled, no message)** when false ledger:205-207; "Reopen" hidden unless admin ledger:208-210. BE close `period_close.py:69` (FM or admin), reopen `period_close.py:88` (admin).
- **Impact of missing flag**: a non-admin user flagged Finance Manager sees only "Period YYYY-MM: Open" with no action; BE would allow the close. Only admins can close in practice.
- **Inputs**

| field | control | req? | FE | BE | notes |
|---|---|---|---|---|---|
| period | implicit current month `new Date().toISOString().slice(0,7)` ledger:74 | – | none | path str, **no YYYY-MM validation** (`period_close.py:62-65`); `String(7)` column | UTC month → wrong month in IST 00:00–05:30 on the 1st; cannot choose a prior month |
| notes | PromptDialog ledger:176-184 | N | – | `str|None` | – |
| reopen reason | PromptDialog ledger:185-192 | Y | PromptDialog allows empty (`PromptDialog.tsx:100`) | service rejects blank `service.py:639-640` with real message | OK |

- **Locking enforcement**: `post_journal_entry` blocks closed period (`service.py:116-126`) — so JE create, reversal, vendor-invoice post, payment, AR post and collection are all blocked for a closed period **at posting time**. Creating a pending vendor/AR invoice dated in a closed period is NOT blocked (`service.py:308-344,474-505`), and close refuses while any pending invoice exists (`service.py:606-615`) — combined with no cancel path this is a dead end (P1-FIN-6). Close does not check in-progress bank reconciliations or earlier open periods.
- **Views**: status badge Open/Closed + "by {closed_by_name}" ledger:196-203; no period history list although `listPeriodCloses` returns all ledger:62.
- **Findings**: P1-FIN-1, P1-FIN-21, P1-FIN-6, P1-FIN-34.

#### /dashboard/finance/ledger › New Journal Entry — manual double-entry posting (ledger/page.tsx:108-146,214-291)
- **Access**: FE ledger:41 only. BE `routes/journal_entries.py:86` app-access only — **any accounts user posts directly, no maker-checker**.
- **Inputs**

| field | control | req? | FE validation | BE validation | mismatch / notes |
|---|---|---|---|---|---|
| posting_date | date ledger:219 | Y | none (defaults today UTC ledger:53) | `date` (`schemas/journal_entry.py:36`); closed-period check `service.py:116-126` | future dates allowed; JE number year = `date.today()` not posting date `service.py:43` |
| description | text ledger:223 | N | – | `str|None` | – |
| line.gl_account_id | SearchableSelect of active **posting** accounts ledger:108-109,240-245 | Y | lines w/o account silently dropped ledger:130 | exists/active/posting `service.py:94-103` | **control accounts (AP 2010/AR 1130) selectable & postable** — `is_control_account` never checked (P1-FIN-11) |
| line.debit / credit | number ledger:248-257 | one of | typing in one clears the other ledger:250,256 (XOR); no `min=0` | per line ≥0 `service.py:89-90`; exactly one >0 `service.py:91-92`; min 2 lines `service.py:83-84` | FE XOR ✔; FE allows negatives (BE rejects with real msg) |
| balance | computed ledger:111-114, badge ledger:277-285 | – | submit disabled unless `diff===0 && totalDebit>0` ledger:287 | `round(sum,2)` equality `service.py:105-108` | **FE totals include lines with no account, which are then dropped ledger:130** → FE shows "Balanced" yet BE may receive an unbalanced/1-line set (BE error is clear) |
| remarks | text | N | – | `str|None` | – |
| cost_center_id / internal_order_id / due_date | **absent** | – | – | accepted `schemas/journal_entry.py:9-11` | Variance Analysis actuals can never be populated (P1-FIN-24) |

- Minimum 2 line rows enforced FE (remove hidden at 2, ledger:120,263); BE also.
- Entries are created directly as `status="posted"` (`service.py:138`) — no draft, no "Save", no confirm before "Post Journal Entry" ledger:287-289.
- Units: totals `Debit: 0.00 / Credit: 0.00` with no ₹ ledger:275-276.
- **Findings**: P1-FIN-2, P1-FIN-11, P1-FIN-22, P1-FIN-23, P1-FIN-31, P1-FIN-40.

#### /dashboard/finance/ledger › Recent Journal Entries + Reverse (ledger/page.tsx:148-161,293-329)
- **Access**: FE ledger:41; Reverse shown for every `status==='posted'` row ledger:322 (no role). BE `journal_entries.py:111` app-access only.
- **Inputs (reverse)**: reason via PromptDialog ledger:168-175 — **empty allowed** (`PromptDialog.tsx:100`; BE `reason: str` no min length `schemas/journal_entry.py:41-42`).
- **Views**: table Entry No / Date / Description / Debit / Credit / Status / action ledger:299; loading ledger:305, empty "No journal entries posted yet." ledger:306-308; sticky header; **no lines/accounts shown, no detail view** (`getJournalEntry` api.ts:1482 unused), no posting_type/source column (manual vs system invisible), no filters/search/pagination (BE supports `accounting_period`, `status`, `gl_account_id` `journal_entries.py:53-65`, hard `limit(500)` `:66`), no export.
- **Behaviour**: reversal posts swapped lines dated today (`service.py:172-212`) — good "never edit" design. But:
  - reversing a system entry (vendor invoice / payment / collection) does not touch `VendorInvoice.status/amount_due`, `ARTransaction`, `PaymentTransaction` or `BankAccount.current_balance` → sub-ledgers desync (P1-FIN-10);
  - the reversal entry is itself `posted` → shows its own Reverse button (reverse-of-reverse allowed, original stays "reversed").
  - list refreshed after reverse ledger:154 ✔; after post ledger:140 ✔.
- **Findings**: P1-FIN-10, P1-FIN-22, P1-FIN-35, P1-FIN-34, P1-FIN-18 (ledger:61-62,66).

---

#### /dashboard/finance/ar-ap › Record Vendor Invoice — AP invoice with 3-way match (frontend/src/app/dashboard/finance/ar-ap/page.tsx:107-152,281-327)
- **Access**: FE ar-ap:48. BE create `routes/vendor_invoices.py:92`, preview `:48` — app-access only.
- **Inputs**

| field | control | req? | FE validation | BE validation | mismatch / notes |
|---|---|---|---|---|---|
| purchase_order_id | SearchableSelect ar-ap:288 from `purchaseOrdersApi.list` (`/p2p/purchase-orders` = `require_app_access("purchase")` `p2p/routes/purchase_orders.py:42`, default limit 200) filtered to issued/acknowledged/partially_fulfilled ar-ap:122 | Y | ar-ap:133 | PO exists `service.py:313-315`; **no PO status check** | **`fulfilled` POs (fully received — the normal invoicing case) are excluded FE** (P1-FIN-14); accounts-only user gets silent empty list (P1-FIN-15) |
| invoice_number | text ar-ap:292 | Y | trim ar-ap:133, sent untrimmed ar-ap:141 | dup per vendor app-check `service.py:320-321` + DB `UniqueConstraint(vendor_id, invoice_number)` (`models/vendor_invoice.py:19`) | whitespace/case variants bypass; race → IntegrityError 500 (inferred) |
| invoice_date | date ar-ap:296 | Y | none | `date` | future allowed; not checked vs PO date / closed period at create |
| invoice_qty | number ar-ap:300 | Y | truthy only ar-ap:133 | `float`, no >0 | **qty summed across all PO lines regardless of UoM** `service.py:265-277`; label "Quantity" doesn't say so |
| invoice_amount | number ar-ap:304 | Y | truthy only | `float`, no >0 | label "Amount" — pre-GST? no ₹ |
| invoice_gst | number ar-ap:308 | N | `Number()||0` | `float`, no ≥0 | label "GST" — amount or %? negative GST → unbalanced JE on post |
| expense_gl_account_id | SearchableSelect of posting accounts ar-ap:99,312 | Y | ar-ap:133 | **not validated at create** (only at post) | any type allowed (e.g. a bank/revenue account) |

- **3-way match** (`service.py:281-305`): qty tolerance 2%, amount 1%. Issues: (a) `invoice_amount` (ex-GST) compared with `po.total_value` which includes tax (`p2p/service.py:88-91`) → systematic false "variance" when PO lines have tax_rate; (b) `po_amount==0/None` → amount check silently passes `service.py:292,296`; (c) no GRN → falls back to PO qty `service.py:294` → invoice for undelivered goods = "matched"; (d) no cumulative check against previously invoiced qty/amount on the same PO → the same PO can be billed repeatedly under different invoice numbers.
- **Preview**: debounced 400 ms ar-ap:107-117, "Checking 3-way match…" ar-ap:316, badge + "PO qty · GRN accepted · Qty variance % · Amount variance %" ar-ap:317-322 (PO amount itself not shown); preview error swallowed `.catch(() => setPreview(null))` ar-ap:113.
- **Findings**: P1-FIN-12, P1-FIN-13, P1-FIN-14, P1-FIN-15, P1-FIN-19, P1-FIN-26, P1-FIN-32, P1-FIN-20 (stale "AR is a later phase" text ar-ap:283).

#### /dashboard/finance/ar-ap › Vendor Invoices list — approve variance / post / pay (ar-ap/page.tsx:154-203,329-406)
- **Access**: Approve Variance shown only if `canApproveVariance` (`is_finance_manager||admin`, ar-ap:49) ar-ap:358-360 → **hidden for non-admin FMs**; Post shown only when `matching_status !== 'variance'` ar-ap:361-363. ⇒ for a non-admin Finance Manager (and everyone non-admin) a variance row has **no action at all and no explanation**. BE approve `vendor_invoices.py:117` (FM/admin — would allow), post `:134` app-access only, pay `routes/payments.py:53` app-access only.
- **Inputs (payment panel ar-ap:370-399)**

| field | control | req? | FE | BE | notes |
|---|---|---|---|---|---|
| bank_account_id | SearchableSelect (active only) ar-ap:376 | Y | ar-ap:187 | exists + has GL `service.py:416-420`; **status not checked** | GL link cannot be set in UI → always fails for UI-created banks (P1-FIN-7) |
| amount | number, prefilled amount_due ar-ap:181,380 | Y | truthy only | >0 `service.py:411-412`; ≤ amount_due `service.py:413-414` | partial ✔, over-payment blocked ✔ with real msg; no FE max hint |
| payment_mode | select neft/rtgs/cheque/cash ar-ap:384-389 | Y | fixed | `str`, **not validated vs `PAYMENT_MODES`** (`models/payment_transaction.py:9`) | – |
| payment_date | date ar-ap:393 | Y | none (state not reset per invoice) | `date`, closed-period via JE | may precede invoice date / be future |
| cheque_number / cheque_date | **absent** | – | – | in schema `schemas/payment.py:11-12` | cheque mode without cheque no. |

- **Variance approval**: PromptDialog note optional ar-ap:271-279; BE no SoD — creator may approve own invoice (`service.py:347-358`).
- **Views**: columns Invoice / PO / Vendor / Total / Due / Match / Status / Payment ar-ap:335 (no invoice date, due date, GST split, approver); loading ar-ap:341, empty ar-ap:342-344; list + bank balances refreshed after pay ar-ap:196-197 ✔, after post ar-ap:158 ✔. No filter/search (BE supports `status/matching_status/vendor_id` `vendor_invoices.py:59-71`). No payments history screen (`listPayments` api.ts:1526 unused). No cancel action (status `cancelled` label exists ar-ap:33, no endpoint). Post / Pay have no confirm; "Record Payment" styled red danger ar-ap:365.
- **Findings**: P1-FIN-1, P1-FIN-6, P1-FIN-7, P1-FIN-27, P1-FIN-33, P1-FIN-38, P1-FIN-2.

#### /dashboard/finance/ar-ap › Record Customer Invoice — AR invoice (ar-ap/page.tsx:205-229,408-438)
- **Access**: FE ar-ap:48. BE `routes/ar_transactions.py:67` app-access only.
- **Inputs**

| field | control | req? | FE | BE | notes |
|---|---|---|---|---|---|
| customer_id | SearchableSelect from `crmApi.listOrganizations` ar-ap:101,415 (`require_app_access("crm")` `crm/routes/organizations.py:57`) | Y | ar-ap:210 | exists `service.py:480-482` | silent empty list for accounts-only users (P1-FIN-15) |
| invoice_date | **no input — hard-coded today (UTC)** ar-ap:218 | – | – | `date` | cannot back-date/forward-date |
| invoice_amount | number ar-ap:419 | Y | truthy | `float`, no >0 (`schemas/ar_transaction.py:8`) | – |
| gst_amount | number ar-ap:423 | N | `||0` | no ≥0 | amount vs % unclear |
| discount_amount | number ar-ap:427 | N | `||0` | no ≤ amount check | **any discount > 0 makes the invoice unpostable** (P1-FIN-5) |
| revenue_gl_account_id | SearchableSelect (all posting accts) ar-ap:431 | Y | ar-ap:210 | not type-checked | expense/asset accounts selectable |

- Due date = invoice_date + `customer.credit_days` (default 30) `service.py:484-485` — not shown before save.
- **Findings**: P1-FIN-5, P1-FIN-15, P1-FIN-32, P1-FIN-26.

#### /dashboard/finance/ar-ap › Customer Invoices list — post / collect (ar-ap/page.tsx:231-264,440-513)
- **Access**: Post / Record Collection visible to all accounts users ar-ap:468-473; BE `ar_transactions.py:90,110` app-access only.
- **Inputs (collection panel ar-ap:477-506)**: bank (active) Y ar-ap:249; amount prefilled amount_due; BE >0 and ≤ amount_due `service.py:552-555` ✔; mode not validated; bank GL link required `service.py:560-561` (same dead end P1-FIN-7); no cheque fields.
- **Views**: Invoice / Customer / Due Date / Total / Due / Status / Collection ar-ap:446 ("Due Date" and "Due" side by side); loading ar-ap:452, empty ar-ap:453-455; refresh after post/collect ✔ ar-ap:235,257-258. `collection_status='overdue'` label ar-ap:40 is never set by BE (`service.py:590`). `days_outstanding` returned (`routes/ar_transactions.py:24`) but not displayed. No cancel/credit-note path.
- **Findings**: P1-FIN-5, P1-FIN-6, P1-FIN-33, P1-FIN-37, P1-FIN-38.

---

#### /dashboard/finance/banking › Start Bank Reconciliation (frontend/src/app/dashboard/finance/banking/page.tsx:69-85,127-146)
- **Access**: FE banking:32. BE `routes/bank_reconciliations.py:101` app-access only.
- **Inputs**

| field | control | req? | FE | BE | notes |
|---|---|---|---|---|---|
| bank_account_id | SearchableSelect active banks banking:132 | Y | banking:70 | exists `service.py:690-692` | duplicate in-progress recon for same bank/date allowed |
| statement_date | date banking:136 | Y | none | `date` | future allowed; not checked vs last completed recon |
| statement_balance | number banking:140 | Y | truthy banking:70 | `float` | – |

- **Book balance**: `book_balance = bank_account.current_balance` at creation (`service.py:696`) — not as-of statement_date, while outstanding items are filtered `payment_date <= statement_date` (`service.py:664-668`) → any payment dated after the statement date, or a back-dated payment posted after the recon was opened, produces a wrong difference (P1-FIN-8). `current_balance` itself moves only via payments/collections (`service.py:437,579`), never via manual JEs to the bank GL, and excludes nothing posted to GL (P1-FIN-9).
- **Findings**: P1-FIN-8, P1-FIN-9, P1-FIN-41.

#### /dashboard/finance/banking › Active reconciliation — match & complete (banking/page.tsx:87-119,148-192)
- **Access**: FE banking:32; BE `bank_reconciliations.py:123,141`.
- **Views/behaviour**: header label + statement date banking:150; Book / Statement / Outstanding Cheques / Deposits in Transit / Difference badge banking:153-167 (no ₹, no formula shown); checkbox list of unreconciled payments (number, type, party, amount, date) banking:171-184, empty text banking:173; "Mark Selected as Reconciled" banking:186 (no confirm, no undo endpoint); "Complete Reconciliation" disabled while |difference| ≥ 0.01 banking:187 — BE mirrors `service.py:735-737` ✔. Only PaymentTransactions are reconcilable — bank charges, interest, direct debits, manual JEs have no entry path → recon can be stuck forever (P1-FIN-9). Unreconciled list load has no catch banking:66.
- **Findings**: P1-FIN-9, P1-FIN-33, P1-FIN-18.

#### /dashboard/finance/banking › Reconciliation History (banking/page.tsx:194-206)
- **Views**: rows "bank — date", status text, Open banking:198-203; empty banking:197; **no loading state** (reconciliations load banking:50 no catch/flag); no amounts/difference/completed-by columns; no filter by bank (BE supports `bank_account_id` `bank_reconciliations.py:40`).
- **Findings**: P1-FIN-41, P1-FIN-18.

#### /dashboard/finance/banking › Liquidity Forecast — read-only projection (banking/page.tsx:208-236)
- **Access**: BE `routes/liquidity_forecast.py:16`.
- **Views**: note banking:210; Current Cash banking:213; table Period / Inflows (AR) / Outflows (AP) / Net / Projected Balance, buckets overdue/0-30/31-60/61+ banking:214-233; no chart; nothing rendered while loading or on error (`forecast &&` banking:211, load no catch banking:51).
- **Logic**: cash = Σ `BankAccount.current_balance` (not GL) `service.py:750`; AP due recomputed from current vendor `payment_days` `service.py:770-772` (not the due_date stamped on the JE line `service.py:377`).
- **Findings**: P1-FIN-37, P1-FIN-9, P1-FIN-18.

---

#### /dashboard/finance/reports › Trial Balance (frontend/src/app/dashboard/finance/reports/page.tsx:90-129)
- **Access**: FE reports:35; BE `routes/reports.py:25`.
- **Inputs**: `period` `<input type="month">` reports:86 (only month; no from/to); BE `period: str`, **no YYYY-MM validation** (`routes/reports.py:21-27`) — bad string → silently empty report.
- **Views**: Code / Name / Type / Opening / Debits / Credits / Closing reports:100; totals footer coloured green/red on equality reports:119-124; sorted by type then code (`reports.py:20`). "View Monthly Close Pack" button reports:94. All accounts listed incl. zero rows; **Opening always 0** because `GLBalance.opening_balance` is never rolled forward (`service.py:55-64,166`); Closing is signed Dr−Cr without Dr/Cr label reports:114. No drill-down to GL ledger (`getGLLedger` api.ts:1603 exists, unused). No loading/error state (renders only when data truthy reports:90; fetch reports:51 no catch). No export/print.
- **Data source**: `GLBalance` only — every JE is created `posted` (`service.py:138`), so there is no "unposted entries in reports" risk; reversed entries net to zero via their reversal. ✔
- **Findings**: P1-FIN-4, P1-FIN-25, P1-FIN-26.

#### /dashboard/finance/reports › P&L Statement (reports/page.tsx:131-163)
- **Access**: BE `routes/reports.py:65`.
- **Views**: two columns Revenue / Expense with totals, Net Profit/Loss banner reports:134-161. Single month only (no range/YTD/comparative). Only accounts with a GLBalance row in that month appear (`reports.py:134-153`). No export.
- **Findings**: P1-FIN-25, P1-FIN-26.

#### /dashboard/finance/reports › Balance Sheet (reports/page.tsx:165-217)
- **Access**: BE `routes/reports.py:74`.
- **Views**: Balanced/Out of Balance badge reports:169-171, explanatory note reports:173, Assets | Liabilities + Equity + "Current Period Earnings" reports:174-215.
- **Logic defect**: uses only the selected month's `GLBalance.closing_balance` (`reports.py:179,186`), and closing = 0 opening + that month's movements (`service.py:166`) → the "Balance Sheet" is a month-movement statement, not a position as-of period end; docstring claims cumulative (`reports.py:170-175`). Bank/GL opening balances never included.
- **Findings**: P1-FIN-4, P1-FIN-25.

#### /dashboard/finance/reports › AR / AP Aging (reports/page.tsx:219-258)
- **Access**: BE `routes/reports.py:47,56`.
- **Views**: inner pills AP/AR reports:221-224; Invoice / Vendor|Customer / Due Date / Amount Due / Bucket reports:234; loading reports:227, empty "Nothing outstanding." reports:228; total reports:253. No as-of date (always today), no per-party subtotals or bucket totals, no export. AP due date recomputed from current `payment_days` (`reports.py:101`) vs AR stored `due_date` (`reports.py:123`) — inconsistent.
- **Findings**: P1-FIN-37, P1-FIN-25.

#### /dashboard/finance/reports › Variance Analysis (reports/page.tsx:260-289)
- **Access**: BE `routes/reports.py:84`.
- **Inputs**: FE sends `(period, period)` reports:55 — BE supports from/to but FE has no range; BE doesn't check from ≤ to or format (`routes/reports.py:79-87`).
- **Views**: Type / Code / Name / Budgeted / Actual / Variance / Variance % reports:268; BE note when no budgets reports:263 (`reports.py:258`). Cost-centre `annual_budget` compared against one month's actuals (`reports.py:241-253`); actuals come only from JE lines with `cost_center_id`/`internal_order_id`, which no posting path in this module ever sets (JE form lacks them; `post_vendor_invoice`/`post_payment`/AR never set them) → Actual is always 0.
- **Findings**: P1-FIN-24.

#### /dashboard/finance/reports › Monthly Close Pack (reports/page.tsx:61-63,291-314)
- **Views**: summary paragraphs TB / P&L / BS / AP / AR totals with aging note reports:297-312; opened from TB tab but panel persists when switching tabs (`showPack` not reset); fetch reports:62 no catch; **no PDF/Excel/print** — a "pack" that cannot be distributed.
- **Findings**: P1-FIN-25.

---

#### Findings

- **P1-FIN-1** [SEC][USER] `is_finance_manager` missing from `/auth/me` (`main/schemas/auth.py:10-30`, route `main/routes/auth.py:433-456`) → FE hides (not disables, no message) "Close Period" (ledger:42,205-207) and "Approve Variance" (ar-ap:49,358-360) for non-admin Finance Managers although BE allows them (`period_close.py:21`, `vendor_invoices.py:25`); because Post is suppressed for variance rows (ar-ap:361), such rows show **zero actions** → dead end. Fix: add `is_finance_manager: bool = False` to `CurrentUserResponse` and populate it in `/auth/me`.
- **P1-FIN-2** [SEC] Every mutating finance endpoint except close/reopen/variance is gated only by `require_app_access("accounts")`: GL CRUD (`gl_accounts.py:58,76,97`), bank CRUD (`bank_accounts.py:36,52,71`), vendor CRUD incl. bank details (`vendors.py:40,56,75`), IO CRUD (`internal_orders.py:44,62,83`), JE post/reverse (`journal_entries.py:86,111`), invoice create/post (`vendor_invoices.py:92,134`), payment (`payments.py:53`), AR create/post/collect (`ar_transactions.py:67,90,110`), recon create/match/complete (`bank_reconciliations.py:101,123,141`). No maker-checker or SoD (creator can post, approve own variance `service.py:347-358`, and pay). Fix: add finance roles/`require_tab_access` entries in `permission_registry.py` and approval step for JE & payments.
- **P1-FIN-3** [SEC] No AuditLog writes in master routes (0 matches in `gl_accounts.py`, `bank_accounts.py`, `vendors.py`, `internal_orders.py`) → vendor bank account/IFSC changes (`vendors.py:64-65`) are untracked — classic payment-diversion risk. Fix: audit + approval on vendor bank-detail change.
- **P1-FIN-4** [ARCH] Period balances never roll forward: `_get_or_create_gl_balance` creates rows with opening 0 (`service.py:55-64`), closing = opening + period Dr − Cr (`service.py:166`); GL-master opening (`models/gl_account.py:25`) and bank opening (`bank_accounts.py:40`) are never posted. Result: TB "Opening" always 0 (`reports.py:28`), Balance Sheet = one month's movement (`reports.py:179,186`), GL-ledger opening wrong (`reports.py:47-50`). Fix: compute opening from cumulative prior closing (or carry-forward on first posting / at period close) and post opening balances via an opening JE.
- **P1-FIN-5** [BA] AR discount breaks posting: total = amount + GST − discount (`service.py:486`) but JE debits AR `total_amount` and credits revenue `invoice_amount` + GST (`service.py:520-529`) with no discount line → any invoice with discount > 0 fails "out of balance" on Post (ar-ap:469), and then blocks period close (`service.py:611-615`). Fix: add a Dr "Sales Discount" line (or credit revenue net of discount).
- **P1-FIN-6** [BA] No cancel/void path for pending vendor or customer invoices: statuses `cancelled` exist (`models/vendor_invoice.py:10`, `models/ar_transaction.py:9`, labels ar-ap:33,38) but no endpoint/service sets them; close_period tells the user "Post or cancel it first" (`service.py:610,615`). A wrong/unpostable invoice permanently blocks closing its month. Fix: add cancel endpoints + UI action.
- **P1-FIN-7** [USER][BA] Bank Account form has no GL account field (masters:211,281-296) though schema supports `gl_account_id` (`schemas/bank_account.py:13,24`); `post_payment`/`post_collection` reject banks without it and tell the user to "set one under Finance > Masters > Bank Accounts first" (`service.py:419-420,560-561`) — a field that does not exist → payments/collections impossible for UI-created banks. Fix: add a GL account select (asset, posting) to the bank form.
- **P1-FIN-8** [ARCH] Reconciliation book balance is `BankAccount.current_balance` snapshotted at creation (`service.py:696`, comment `models/bank_reconciliation.py:25-27`), not the book balance as of `statement_date`, while outstanding items use `payment_date <= statement_date` (`service.py:664-668`) → difference is wrong whenever payments exist after the statement date or back-dated payments are recorded after the recon starts. Fix: compute book balance as-of statement_date from bank GL lines.
- **P1-FIN-9** [BA] Bank sub-ledger vs GL divergence + unreconcilable items: `current_balance` moves only in `post_payment`/`post_collection` (`service.py:437,579`); manual JEs to the bank GL don't move it; reconciliation can only tick PaymentTransactions (`bank_reconciliations.py:73-77`) — no way to book bank charges/interest/direct debits from the statement or to unmatch, so "Complete Reconciliation" (banking:187) can stay disabled forever. Fix: derive bank balance from GL; add "post statement item" + unmatch.
- **P1-FIN-10** [BA] Reverse on Ledger (ledger:322) applies to system entries too; `reverse_journal_entry` (`service.py:172-212`) never updates the source VendorInvoice/ARTransaction/PaymentTransaction/BankAccount → invoice still "posted/paid", bank balance unchanged, AP/AR aging wrong. Reversal entry is itself `posted` and reversible. Fix: block reversal when `reference_document_type` is set (route to document-level cancel) and block reversing a reversal.
- **P1-FIN-11** [BA] `is_control_account` is never enforced (no reference outside schema/model); manual JEs can post directly to AP 2010 / AR 1130 (`service.py:96-103`), breaking sub-ledger tie-out with aging. Fix: reject manual (`posting_type="adjustment"`) lines on control accounts.
- **P1-FIN-12** [BA] 3-way-match compares ex-GST `invoice_amount` against tax-inclusive `po.total_value` (`service.py:292-296`; `p2p/service.py:88-91`) → systematic false "variance" on taxed POs; when `total_value` is None the amount check is skipped (`service.py:296`). Fix: compare against PO pre-tax value (or invoice_total vs total_value) and treat missing PO value as variance.
- **P1-FIN-13** [BA][SEC] No GRN ⇒ quantity reference falls back to PO qty (`service.py:294`) so goods never received match and can be posted and paid; no cumulative invoiced-qty/amount check per PO (`service.py:320-323`) so one PO can be billed repeatedly under new invoice numbers. Fix: require completed GRN qty and subtract previously-invoiced qty/amount.
- **P1-FIN-14** [USER] PO dropdown keeps only issued/acknowledged/partially_fulfilled (ar-ap:122) — fully received `fulfilled` POs (`p2p/models/purchase_order.py:14`) cannot be invoiced from the UI; conversely BE accepts draft/cancelled POs (`service.py:313-315`). Fix: FE include `fulfilled`, BE reject draft/cancelled.
- **P1-FIN-15** [USER] AR/AP dropdown data needs other modules' app access — POs `require_app_access("purchase")` (`p2p/routes/purchase_orders.py:42`), customers `require_app_access("crm")` (`crm/routes/organizations.py:57`) — fetched with no catch (ar-ap:98,101) → accounts-only users see empty "Select a PO…/customer…" with no reason. Fix: accounts-scoped lookup endpoints, or show the 403 reason.
- **P1-FIN-16** [USER] Internal Orders loads via `Promise.all([listInternalOrders, listCostCenters])` (masters:474-476) but cost centres are `require_admin` (`organization/routes/cost_center.py:37`) → for non-admins the whole load rejects and the tab shows "No internal orders yet." (masters:575) even when orders exist. Fix: load independently; accounts-accessible cost-centre lookup.
- **P1-FIN-17** [USER] Masters error handling reads only `response.data.detail` (masters:115-116,129-130,251-252,265-266,375-376,389-390,509-510,523-524) instead of `extractErrorMessages` → 422 shows bare "Validation error" (per `lib/validation.ts:61-65`), network errors show generic "Failed to save …". Deletes have no reference checks for bank (`bank_accounts.py:73-78`), vendor (`vendors.py:77-82`), IO (`internal_orders.py:85-90`); GL delete misses journal_entry_lines/gl_balances/vendor_invoices/ar_transactions (`gl_accounts.py:107-113`) → FK IntegrityError 500 (inferred) → generic message. Fix: use `extractErrorMessages`; add 409 "referenced by N postings — set inactive" checks.
- **P1-FIN-18** [USER] Silent load failures: `.then(set…)` with no catch at ledger:61-62,66; masters:90,223,344,474; ar-ap:92,94,98-101; banking:48-52,66; reports:51-55,62 → an API error looks like an empty state ("No journal entries posted yet.", "No GL accounts yet.") or a blank report. Fix: catch → error banner with real reason.
- **P1-FIN-19** [USER] Match-preview errors swallowed `.catch(() => setPreview(null))` (ar-ap:113) — e.g. "Purchase order not found." never shown. Fix: surface message inline.
- **P1-FIN-20** [USER] Stale placeholder copy: "Accounts Receivable (customer invoices/collections) is a later phase — this page currently covers Accounts Payable only." (ar-ap:283) while AR is implemented on the same page (ar-ap:408-513). Fix: delete the sentence.
- **P1-FIN-21** [BA] Period close UI is fixed to the current calendar month (ledger:74,205) — month-end close normally happens after month end, so the prior month can never be closed from the UI; UTC month via `toISOString` (ledger:74) is wrong in IST 00:00–05:30 on the 1st; BE accepts any `{period}` string without YYYY-MM validation (`period_close.py:62-78`), no sequential-close check, no check for in-progress reconciliations. Fix: period picker + list of periods; validate format; enforce order.
- **P1-FIN-22** [BA] JEs are posted on submit with no draft/approval (`service.py:138`) and no confirm (ledger:287); the list shows only header totals — no line/account detail, no source/posting_type, no filters/search/pagination (BE supports `accounting_period/status/gl_account_id`, `journal_entries.py:53-66`, capped at 500) and `getJournalEntry` (api.ts:1482) is unused. Fix: JE detail drawer + filters; optional draft→approve flow.
- **P1-FIN-23** [USER] JE form: balance totals include lines without an account (ledger:111-112) that are then silently dropped (ledger:130) → "Balanced" badge can lie; amount inputs accept negatives (no `min`, ledger:248,254); no cost centre / internal order / due date per line though BE accepts them (`schemas/journal_entry.py:9-11`). Fix: validate rows with amounts must have an account; `min=0 step=0.01`; add CC/IO columns.
- **P1-FIN-24** [BA] Variance Analysis compares one month's actuals (FE passes `(period, period)` reports:55) against `CostCenter.annual_budget` (`reports.py:241-253`), and no posting path ever sets `cost_center_id`/`internal_order_id` (JE form lacks them; `service.py:373-381,427-430,520-529,568-571`) → Actual is always 0 and variance always fully "favourable". Fix: add from/to range (FY default) and capture CC/IO on postings.
- **P1-FIN-25** [USER] Reports have no export/print (no CSV/Excel/PDF anywhere in reports/page.tsx); Monthly Close Pack is on-screen text only (reports:291-314); no drill-down from TB to GL ledger (`getGLLedger` api.ts:1603 unused, BE `routes/reports.py:30-42`); no loading/error states (reports:90,131,165,260 render only when data exists). Fix: add Excel/PDF export, GL ledger view, loading/error.
- **P1-FIN-26** [USER] Unlabelled amounts: no ₹ and no Indian digit grouping anywhere except masters:309 (`toFixed(2)` e.g. ledger:275-276,314-315; ar-ap:351-352; banking:154-165; reports:111-114); TB closing is signed Dr−Cr with no Dr/Cr indicator (reports:114); AP form "Amount"/"GST"/"Quantity" ambiguous (pre/post tax? amount or %? total across PO lines?) ar-ap:299-308; "Due" vs "Due Date" columns ar-ap:335,446. Fix: shared `formatINR`, Dr/Cr suffix, explicit labels ("Taxable value (₹)", "GST amount (₹)").
- **P1-FIN-27** [BA] Payment/collection inputs: `payment_mode` not validated vs `PAYMENT_MODES` (`schemas/payment.py:9`, `schemas/ar_transaction.py:46`); cheque number/date not captured in UI (ar-ap:384-389) though schema supports (`schemas/payment.py:11-12`); payment date not checked vs invoice date/future; inactive/closed bank not rejected in BE (`service.py:416-420`); no overdraft/negative-balance check (`service.py:437`). Fix: Literal enum, cheque fields when mode=cheque, date and status checks.
- **P1-FIN-28** [BA] Master-data validation gaps: no GSTIN/PAN/IFSC/email/phone formats FE (masters:408-417,286) or BE (`schemas/vendor.py:5-25`, `schemas/bank_account.py:5-14`); status strings not validated (`GL_ACCOUNT_STATUSES`, `VENDOR_STATUSES`, `BANK_ACCOUNT_STATUSES`, `INTERNAL_ORDER_STATUSES` unreferenced); IO end < start and negative budget/credit limit/payment days allowed; codes not trimmed; blocked vendor still invoiced (`service.py:316-318`). Fix: Pydantic `pattern`/`Literal`/validators.
- **P1-FIN-29** [BA] GL accounts with postings can have code, type and posting flag changed (`gl_accounts.py:71-90`) → silently reclassifies history in TB/P&L/BS; GL "Opening Balance" input (masters:158) is persisted but used nowhere. Fix: lock type/code/posting flag once a GLBalance/JE line exists; remove or implement opening balance.
- **P1-FIN-30** [BA] Vendor UI omits schema fields address, pin_code, account_holder_name, early_payment_discount_pct, gl_reconciliation_account_id (masters:328-333 vs `schemas/vendor.py:10-24`); `compute_early_payment_discount` (`service.py:395-400`) is dead code. Fix: add fields or drop from schema.
- **P1-FIN-31** [ARCH] Money as `Float` in every table and `float` in every schema (e.g. `models/journal_entry.py:65-66`, `models/gl_balance.py:22-25`, `models/vendor_invoice.py:26-41`); per-line amounts not rounded (only totals, `service.py:105-106`), GLBalance accumulates floats (`service.py:164-166`). Fix: `Numeric(18,2)` + `Decimal`, `condecimal(max_digits=18, decimal_places=2, ge=0)`.
- **P1-FIN-32** [BA] AP/AR create accept zero/negative amount, qty, GST and discount (`schemas/vendor_invoice.py:5-12`, `schemas/ar_transaction.py:5-13`; FE only truthy checks ar-ap:133,210); negative GST → unbalanced JE at post; expense/revenue GL type not validated (any posting account, incl. bank); AR invoice date forced to today (ar-ap:218). Fix: `gt=0`/`ge=0`, discount ≤ amount, account-type checks, date input.
- **P1-FIN-33** [USER] GL-impacting one-click actions without confirmation: Post vendor invoice (ar-ap:362), Post customer invoice (ar-ap:469), Pay (ar-ap:395), Collect (ar-ap:502), Mark reconciled (banking:186), Complete reconciliation (banking:187); "Record Payment"/"Record Collection" styled as red danger links (ar-ap:365,472); Post has no busy guard (double-click → second call errors). Fix: ConfirmDialog summarising Dr/Cr; primary styling.
- **P1-FIN-34** [USER] Ledger uses one error dialog titled "Cannot Post Journal Entry" (ledger:167) for period close/reopen and reversal failures (ledger:86,101,156). Fix: per-action title.
- **P1-FIN-35** [USER] JE reversal reason can be blank: PromptDialog confirm has no empty guard (`PromptDialog.tsx:100`) and BE `reason: str` has no min length (`schemas/journal_entry.py:41-42`). Fix: `min_length=1` + disable confirm until filled.
- **P1-FIN-36** [USER] No page title/header on any finance page — content starts right under FinanceNav (masters:47-49, ledger:165-194, ar-ap:268-281, banking:123-127, reports:67-69). Nav placement itself is compliant. Fix: add standard header row (title + subtitle) below FinanceNav.
- **P1-FIN-37** [BA] AP due dates recomputed from the vendor's *current* `payment_days` in aging (`reports.py:101`) and liquidity (`service.py:770-772`) instead of the due_date stamped at posting (`service.py:377`) — editing vendor terms rewrites aging; AR `collection_status='overdue'` (label ar-ap:40) is never set (`service.py:590`), `days_outstanding` returned but not shown. Fix: store `due_date` on VendorInvoice; compute overdue at read time.
- **P1-FIN-38** [USER] AR/AP is one long scroll of four blocks (ar-ap:281-513) with no tabs; no payment/collection history screen (`listPayments` api.ts:1526 unused), no invoice detail, no filters/search on either list (BE supports `status/matching_status/vendor_id/collection_status/customer_id`). Fix: AP/AR sub-tabs, payments list, filters.
- **P1-FIN-39** [SEC] No tab-level permissions for Finance: no accounts entries in `core/permission_registry.py`, FinanceNav tabs are unconditional (FinanceNav.tsx:7-13,39-65), BE never uses `require_tab_access` in accounts routes → cannot give someone Reports-only or AP-only access. Fix: register finance subtabs and enforce BE-side.
- **P1-FIN-40** [ARCH] JE/PAY/ARINV numbers use `date.today().year` (`service.py:43,221,462`) rather than posting/invoice date — back-dated December entries posted in January get next year's series. Fix: derive from posting date (or FY).
- **P1-FIN-41** [BA] Reconciliation controls: multiple in-progress recons allowed for the same bank/date; statement date not validated against the last completed recon or future (`service.py:688-700`); history has no loading state or amount/difference columns (banking:194-206). Fix: one open recon per bank; date ordering; richer history.

##### Finance counts
- Screens/tabs covered: 6 routes (`/finance` redirect, masters, ledger, ar-ap, banking, reports) → 21 screens/sub-tabs/sections: Masters ×4 (GL, Bank, Vendors, Internal Orders); Ledger ×3 (Period Close, New JE, JE list/Reverse); AR/AP ×4 (AP form, AP list+payment, AR form, AR list+collection); Banking ×4 (Start recon, Active recon, History, Liquidity); Reports ×6 (TB, P&L, BS, AR/AP Aging, Variance, Monthly Pack); + redirect.
- window.* / bare alert/confirm/prompt dialogs: **0** (none in `app/dashboard/finance/**` or `components/finance/**`).
- Non-standard Back buttons: **0** (no Back buttons exist; no detail pages).
- FinanceNav above header: compliant on 5/5 pages (but no header block exists — P1-FIN-36).
- Findings: **41** total (P1-FIN-1 … P1-FIN-41). By tag (multi-tag counted in each): [USER] 17, [BA] 18, [ARCH] 4, [SEC] 5.
