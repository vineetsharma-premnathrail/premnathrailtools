# Screen Specifications

Grounded in actual page implementations — every claim about loading/empty/error state cites the exact conditional in the source file. Cross-reference: [../product/PRODUCT.md](../product/PRODUCT.md).

---

## 1. Dashboard Home

**File:** `frontend/src/app/dashboard/page.tsx`

**Purpose:** Post-login landing page and app launcher — greets the user by first name and surfaces only the modules they have access to.

**Key elements:**
- Time-of-day greeting (`getGreeting()`: "Good morning" <12:00, "Good afternoon" <17:00, else "Good evening") + user's first name, `fontSize: 30, fontWeight: 800`.
- Today's date, formatted `en-IN` (weekday, year, month, day), `fontSize: 14`, muted color.
- Section label "YOUR APPLICATIONS" — `fontSize: 11, fontWeight: 700, letterSpacing: .08em`, uppercase-styled via literal caps.
- Responsive grid of `ModuleCard` components: `gridTemplateColumns: repeat(auto-fill, minmax(280px, 1fr))`, `gap: 20`.
- Each card: colored top bar (`barColor`, 4px), icon in a tinted circle, title, description (`minHeight: 40` reserved so cards align even with short descriptions), feature tag pills, and a circular arrow affordance.

**Modules shown (filtered by `user.apps`):** Service Module (`erp`), R&D Tools (`rnd`), CRM (`crm`), Purchase (`purchase`), Purchase Requisition (`p2p`).

**States:**
- **Loading:** Not implemented on this page itself — `useAuth()` returns `isLoading` but `DashboardPage` does not branch on it before rendering; `user?.name.split(' ')[0]` would render as "undefined" split briefly, or the layout wrapper may gate rendering (not visible in this file — check the dashboard layout, not confirmed here).
- **Empty:** If `user.apps` is empty, `visibleModules` is `[]` and the grid renders with zero cards — no explicit "no modules assigned" empty-state message exists in this file.
- **Error:** No error state — the page has no data fetch of its own (relies on `useAuth`'s already-fetched `user`).

**Actions available:** Click any `ModuleCard` → navigate to that module's root route (`href` per module, e.g. `/dashboard/erp`).

---

## 2. Module List View (example: Purchase Requisitions list)

**File:** `frontend/src/app/dashboard/purchase/page.tsx`

**Purpose:** Browse, search, and filter all SR-linked Purchase Requisitions; entry point to each PR's detail page and to the standalone Purchase Requisition module.

**Key elements:**
- Header: eyebrow label "Purchase Module", `h1` title, live count "`{prs.length}` PR(s) found".
- `NotificationBell` (top-right) — see COMPONENT_DOCUMENTATION.md.
- Toggle row: "From Service Requests" (active pill) vs. "Standalone Requisitions →" button (routes to `/dashboard/purchase/p2p-requests`).
- Status summary strip: one tinted stat tile per `PRStatus` value showing a live count (`counts[key]`), built from `STATUS_LABELS`/`STATUS_HEX` maps covering `submitted, approved, po_raised, partially_received, received, closed, rejected, cancelled`.
- Filter row: text search input (PR number, debounced 300ms via `setTimeout`) + status `<select>` dropdown (`all` + each status).
- Data table inside a glass panel (`borderRadius: 18`, `backdropFilter: blur(28px)`, sticky header row), columns: PR Number, Machine/Asset, Service Request, Client, Status (pill), Priority (pill), Vendor, Raised (date), row action.
- Clicking a row (or its "View" text) navigates to `/dashboard/purchase/{id}`.

**States (all explicitly implemented in this file):**
- **Loading:** `loading` state set true during `purchaseApi.list()`; table body renders a single centered row: `"Loading…"` (`colSpan={9}`).
- **Empty:** `!loading && prs.length === 0` renders `"No purchase requisitions found."` in the same centered-row style.
- **Error:** `error` state set from the catch block ("Failed to load purchase requisitions.") and rendered as a dedicated red banner above the table (`background: rgba(220,38,38,0.08)`) — this does not replace the table, both can coexist.

**Actions available:** Search by PR number; filter by status; switch to standalone-PR list; click a row to view detail.

---

## 3. Module Detail View (example: Project detail page)

**File:** `frontend/src/app/dashboard/erp/projects/[id]/page.tsx`

**Purpose:** Full record view of one machine/asset (Project) with tabbed sub-sections, plus entry points to raise a Service Request, edit, or delete the record.

**Key elements:**
- `ErpNav` (module sub-nav, not detailed here — see COMPONENT_DOCUMENTATION.md for sibling components).
- Header: serial number as `h1`, status pill (green if `active`, red otherwise — only these two color branches exist, other status values still render red), model + client subtitle line.
- Action buttons, each permission-gated via `hasErpPermission(user, permission)`:
  - "+ New Service Request" — requires `sr_create`.
  - "Edit Project" — requires `project_edit`.
  - "Delete" — requires `project_delete`; opens a `ConfirmDialog` rather than deleting immediately.
- Two summary stat cards: "Active Tickets" (count of SRs with `status !== 'closed'`) and "Warranty Status" (computed client-side from `warranty_end_date`: `Active` if days-left ≥ 0, else `Expired`, else "No warranty on record" if unset).
- Tab bar: `Overview | Technical Specs | Maintenance History | Documents | Audit Trail` — client-side tab state, no route change.
  - **Overview:** four glass `Card`s (Machine Identity, Timeline, Client & Site, Warranty & AMC) of label/value rows, plus a conditional "Production Notes" card if `project.notes` is set.
  - **Technical Specs:** Operator Details + Technical Specifications cards.
  - **Maintenance History:** table of this project's Service Requests.
  - **Documents:** drag-and-drop upload with staged-file review (`FileUploadPreview`), per-file private/shared access control (`SharePicker`), and a preview-link flow that opens a short-lived Microsoft Graph URL in a new tab.
  - **Audit Trail:** chronological list of audit entries.

**States:**
- **Loading (page-level):** `loading` guards the whole page — `if (loading) return <p>Loading…</p>` (plain text, not styled as a skeleton).
- **Error (page-level):** `if (error && !project) return <p>{error}</p>` — shown as `"Machine not found."` in red-tinted text; this fully replaces the page content.
- **Loading/Empty per tab:** each tab component (`MaintenanceHistoryTab`, `DocumentsTab`, `AuditTab`) has its **own independent** `loading` state and explicit empty-state text ("No service requests raised for this machine yet.", "No documents uploaded.", "No audit history yet.") — these are real, implemented states, not assumed.
- **Delete confirmation:** modal `ConfirmDialog` (see COMPONENT_DOCUMENTATION.md) — deleting routes back to the projects list on success; no visible error handling on delete failure (the `await erpApi.deleteProject(...)` call is unguarded by try/catch in this file).

**Actions available:** switch tabs; raise SR; edit; delete (with confirm); upload/preview/delete/manage-access on documents; nothing editable inline elsewhere (all edits go through the separate Edit Project form).

---

## 4. Create Form (example: Project create/edit — `ProjectForm`)

**File:** `frontend/src/components/erp/ProjectForm.tsx` (shared by `frontend/src/app/dashboard/erp/projects/new/page.tsx` and the `[id]/edit/page.tsx`, per `initial`/`submitLabel`/`onSubmit` props).

**Purpose:** Create or edit a Project (machine/asset) record via a multi-tab wizard-style form, with inline validation and optional file attachments.

**Key elements:**
- 5-tab bar (not a route-based wizard — `tabIndex` state, `Previous`/`Next` buttons at the bottom): `Machine Identity | Client & Site | Technical Specs | Timeline & Warranty | Documents`.
- Field-level components reused across tabs: plain `<input>`/`<select>`/`<textarea>` styled via a shared `inputStyle` object, `DateField`, `PhoneField` (+ `isPhoneValid`), `YearField` (+ `isFinancialYearValid`), `ValidatedInput` (email/GST with `isValidEmail`/`isValidGST` from `lib/validation`).
- Conditional fields: "Other" machine type / application type reveal a free-text field; export toggle switches State (India) vs. Country (free text) fields; warranty-status toggle reveals date-range fields only when "Active Warranty Period" is selected; AMC status conditionally reveals AMC end date.
- Documents tab: drag-and-drop zone identical in style to the detail page's upload zone, staged file list with per-file remove, `SharePicker` for private/shared visibility of the whole batch.
- Bottom action bar: `Cancel` (calls `onCancel`), `Previous`/`Next` (tab navigation, shown conditionally at wizard ends), and the primary submit button showing `submitLabel` normally or `"Saving…"` while `saving` is true.

**Validation (all client-side, executed in `handleSubmit` before any API call, and each failure both sets an error banner AND jumps `tabIndex` to the offending tab):**
1. Serial number required (tab 0).
2. Custom machine-type text required if "Other" selected (tab 0).
3. Custom application-type text required if "Other" selected (tab 0).
4. Client company required (tab 1).
5. Phone validity for client phone / alt phone / operator phone (`isPhoneValid`) — jumps to tab 1 or 2 depending on which field failed.
6. Financial-year format validity (e.g. "2026-27") (tab 0).
7. Email validity for client email / operator email (tab 1 or 2).
8. GST format validity (tab 1).

**States:**
- **Loading (initial data for edit mode):** Not handled inside `ProjectForm` itself — it receives `initial` as a prop already resolved; the parent edit page is responsible for its own loading state before rendering the form (not verified in this file).
- **Saving:** `saving` boolean disables the submit button, changes its label to `"Saving…"`, and drops opacity to 0.7.
- **Error:** a single `error` string state renders as a banner above the tab content (red-tinted, same visual pattern as elsewhere in the app) — covers both client-side validation failures and the catch block on `onSubmit` (falls back to `err?.response?.data?.detail || 'Failed to save project.'`).
- **Empty:** N/A for a create form — the "Documents" tab shows no dropzone-empty-state text beyond the static "Drag & drop files here / or click to browse" prompt (this is the default zone appearance, not a data-empty state).

**Actions available:** navigate tabs freely (clicking tab headers, not gated by validation — only the final Submit is validated); add/remove queued files; toggle attachment visibility (private + specific users/departments/designations); cancel; submit.
