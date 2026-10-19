# Service & Commissioning Module — Overview

**Module:** Service & Commissioning (machine registry, field service, customer documents)
**App key:** `erp` (shown as "Service Module")
**Backend Location:** `backend/app/modules/erp/`
**Frontend Location:** `frontend/src/app/dashboard/erp/`
**Prepared by:** Vineet Sharma
**Date:** 7 October 2026
**Status:** In use. Recent changes: SR priority collapsed to Standard / Urgent and a required Service Type added (6 October 2026); Raise PR from the SR Materials tab with the New-PR form, PR created already approved (commit `2da327c`); fixed-format delivery letters with Word documents of record. Commissioning as its own record, SLA tracking and Engineering-BOM spares are **not** built.

Detail pages written on 29 August 2026 — [workflows.md](workflows.md), [permissions.md](permissions.md), [api.md](api.md), [requirements.md](requirements.md), [ui.md](ui.md), [testing.md](testing.md), [user-stories.md](user-stories.md) — predate several of these changes. Where they disagree with this page, this page follows the code (see §12).

---

# 1. Purpose

This module looks after **every machine we have delivered** and **every service visit made on it**. It answers:

1. **Which machines are in the field, where, for which customer, and are they under warranty or AMC?** The machine registry (`erp_projects`; "Projects" in the UI and code, for historical reasons).
2. **What is wrong with a machine, who is attending, and is it fixed?** Service Requests (SR).
3. **What parts does the job need, and have they arrived?** SR Materials, with Raise PR into Procurement.
4. **What paperwork went to the customer?** Letters and fixed-format delivery documents per machine, as Word documents of record.

It covers **customer machines** only. Our own plant equipment is the Maintenance module. There is no telematics or remote monitoring (rule R5).

> **ERP standard: why the machine is the master record.**
> In SAP CS this is the *equipment* / *installed base*: one record per serial number that every service order, warranty claim and contract hangs off. Without it, warranty checks become "search old emails for the delivery date", and repeat failures on the same vehicle are invisible. That's why RRV Completion creates the machine automatically (§2): the same serial must flow from the build into service, never retyped.

---

# 2. How Service relates to other modules

Mapped against `docs/MODULE_DETAILED_PLAN.md` §24 ("Production → Service: RRV Completion / Handover → machine registry, warranty").

| Other module | What exists in code | Direction |
|---|---|---|
| **Production (RRV Build)** | RRV Completion creates the machine if the build has none (serial, chassis, engine, model, client, PO; status `manufacturing_under_progress`). Handover sets `status = active`, `delivery_date` and `handover_date`, `commissioning_date` (if entered), `warranty_start_date = handover date`, `warranty_end_date = handover + warranty months`, site location. All `erp` users get a "New machine in service" bell. Production WOs can be read per machine (`GET /production/integrations/projects/{id}/work-orders`, `erp` app allowed). | Production writes `erp_projects`. |
| **Procurement (P2P)** | **Raise PR** on the SR Materials tab creates a `p2p_requests` row **already `approved`** (no PR approval for service PRs), auto-assigns the buyer for the category, runs the normal stock check / line routing, and notifies P2P users plus the Purchase mailbox. Materials keep `pr_id`, `pr_number` and a read-only `pr_status` mirror. | One-way hand-off; P2P owns the PR after that. |
| **Store / Quality (dispatch, rule 8)** | The machine is the "order" a Store `dispatch` issue goes against. `third_party_inspection_required` + `inspection_agency` on the machine make Quality demand an accepted inspection call with a certificate before dispatch. | Store/Quality read the machine. |
| **Electrical / Hydraulic** | Their jobs and systems point at `erp_project_id`; the RRV build's integration stages read them by machine. | They reference the machine. |
| **Organization** | Company letterhead; **Partners** (`is_partner`, set in Company Info → Partners) are the default signatory of letters. | Read only. |
| **SharePoint** | Machine documents, SR attachments and material photos; served through the backend (`/content`, `/preview`), never a raw SharePoint URL. | Write. |
| **Email (Graph)** | Client email on SR create and close (to the Reported-by email); team email to `TEAM_EMAIL`; PR email to `PURCHASE_EMAIL`. | Outbound. |
| **Managed documents** | Letters are Word documents of record (`entity_type = "erp_project_letter"`), folder `ERP-Letters/<serial>`. | Write. |
| **CRM / Sales / Finance** | **No link.** Client details are typed on the machine; service billing fields exist on the SR but no invoice is raised. | — |

---

# 3. Roles and access

Every route requires `require_app_access("erp")`. Within the module, **two separate permission systems** are used, which matters when setting someone up:

## 3.1 Permission Matrix subtabs (`MODULES["erp"]`)

| Subtab key | Nav label | Routes that check it |
|---|---|---|
| `dashboard` | Dashboard | Frontend only (computed from the SR list) |
| `projects` | Projects | `GET /erp/projects` (list) |
| `service_requests` | Service Requests | `GET /erp/service-requests` (list) |
| `reports` | Reports | Frontend only (computed from up to 1,000 SRs) |
| `recycle_bin` | Recycle Bin | `GET /erp/projects/recycle-bin/list`, `GET /erp/service-requests/recycle-bin` |

Only `require_tab_access` (view) is used. **No `require_tab_action` check exists in this module**, so the matrix's create/edit/delete/approve columns for Service do nothing today. As elsewhere, a user with no matrix grants for `erp` passes every tab check.

## 3.2 Granular ERP permissions (`User.erp_permissions`, `has_erp_permission`)

| Permission | Guards |
|---|---|
| `project_create` | Register a machine |
| `project_edit` | Edit a machine; upload machine documents; create / edit letters; create or edit a letter's Word document |
| `project_delete` | Delete / restore a machine; delete machine documents; delete letters |
| `sr_create` | Raise an SR |
| `sr_edit` | (with **ownership**) edit an SR incl. status; attachments; add / edit / receive materials; material photos; Raise PR; PR documents |
| `sr_delete` | (with **ownership**) delete / restore an SR; delete attachments, materials, photos |
| `project_view`, `sr_view` | Offered in the UI but not checked; reading needs only the `erp` app |

**Ownership rule** (`_can_edit` / `_can_delete`): admin always; anyone else must be the SR's **creator** **and** hold `sr_edit` / `sr_delete`. Machines have no ownership rule. Sending the mail-configuration test email is admin-only.

## 3.3 Typical roles

| Role | Typical person | Set-up |
|---|---|---|
| **Service coordinator** | Service head / desk | `erp` app, `sr_create`, `sr_edit`, `project_*`. Because of the ownership rule, the coordinator who **raises** an SR is the one who can progress it. |
| **Service engineer** | Field engineer | `erp` app. Named on the SR (`assigned_service_person_id` / `assigned_to_name`) but **can't edit the SR** unless they created it. |
| **Purchase** | Buyer | `p2p` app; receives the PR. |
| **Management** | Partner / plant head | `erp` app with `dashboard` and `reports` |

> **ERP standard: who should update a service ticket.**
> In SAP CS or Salesforce Field Service, the ticket is worked by whoever it is **assigned** to, and the coordinator can always intervene. "Only the creator can edit" fits a single desk that raises and runs every ticket, but breaks as soon as engineers update their own jobs from site. If engineers are expected to update tickets, the rule should become *creator or assignee or coordinator role*.

---

# 4. Data model

All tables use `TimestampMixin` and `SoftDeleteMixin`.

## 4.1 `erp_projects` (`Project`) — the machine

| Group | Columns |
|---|---|
| Identity | `serial_number` (unique), `machine_type` (`RRV` from Production), `model_name`, `engine_number`, `chassis_number`, `application_type`, `year_of_manufacture`, `software_version`, `specifications`, `installed_options` |
| Status | `status` (free string; default `active`; Production uses `manufacturing_under_progress` → `active`) |
| Order & delivery | `po_number`, `po_date`, `delivery_date`, `commissioning_date`, `handover_date`, `third_party_inspection_required`, `inspection_agency` (Quality master value) |
| Client | `client_company`, `client_name`, `client_designation`, `client_email`, `client_phone`, `client_phone_alt`, `client_address`, `client_gst` |
| Site | `site_name`, `site_location`, `site_state`, `site_pincode`, `site_country`, `zone`, `is_export` |
| Warranty / AMC | `warranty_start_date`, `warranty_end_date`, `warranty_override`, `extended_warranty`, `extended_warranty_end`, `amc_status`, `amc_end_date`, `warranty_terms` |
| Operator | `operator_name`, `operator_phone`, `operator_email`, `operator_qualification` |
| Notes | `notes`, `tech_notes` |

Children: `erp_project_attachments` (documents, private/shared per file), `erp_project_letters` (§4.4), `erp_service_requests`.

## 4.2 `erp_service_requests` (`ServiceRequest`), numbered `SR-YYYY-YY-NNNN`

The number uses the Indian financial year (April–March), e.g. `SR-2026-27-0001`, with an advisory lock per prefix.

| Group | Columns |
|---|---|
| Link | `project_id` (required, live machine) |
| Issue | `issue_title` (required), `issue_description`, `issue_category`, `sub_category`, `failure_mode`, `root_cause` |
| Classification | **`service_type`** (required on create): `installation_commissioning`, `warranty`, `amc`, `repair_breakdown`, `inspection_maintenance`, `paid_service` (null only on old SRs). **`priority`**: `standard` (default) or `urgent` |
| Status | `status` (§5), `opened_at`, `closed_at` |
| Reporter | `reported_by_name`, `reported_by_phone`, `reported_by_email` (client contact; receives the client emails) |
| Assignment | `assigned_service_person_id`, `assigned_to_name`, `created_by_id`, `expected_date_to_attend`, `expected_completion_date` |
| Execution | `actual_date_attended`, `actual_completion_date`, `actual_service_duration_hours`, `downtime_hours` |
| Resolution | `resolution_description` (**Corrective Action — required to close**), `service_report_notes`, `preventive_actions` |
| Customer sign-off | `customer_feedback`, `customer_satisfaction`, `customer_sign_off_name`, `customer_sign_off_date` |
| Warranty claim | `warranty_status`, `warranty_claim_number`, `warranty_claim_status`, `warranty_approved_amount` |
| SLA (unused) | `sla_response_hours`, `sla_resolution_hours`, `sla_response_met`, `sla_resolution_met`, `first_response_at`, `resolution_at` — no route sets or computes them |
| Billing | `service_cost`, `transport_cost`, `accommodation_cost`, `miscellaneous_cost`, `total_material_cost` (sum of materials' `estimated_budget`), `tax_percentage` (default 18), `tax_amount`, `total_bill` — recomputed when a billing input changes; `payment_status`, `invoice_number` |
| Lock (unused) | `is_locked`, `locked_by_id`, `lock_reason` — nothing sets them; when set, writes return 423 |
| Email guards | `created_notification_sent`, `closed_notification_sent` (each email sent once) |

Children: `erp_service_request_attachments`, `erp_service_materials` (§4.3).

Migrations: `d4e5f6a7b8c9_sr_priority_standard_urgent` (critical/high → urgent, everything else → standard), `e5f6a7b8c9d0_sr_service_type`.

## 4.3 `erp_service_materials` (`ServiceMaterial`)

`material_name` (required), `part_number`, `model_number`, `description`, `estimated_budget` (line total), `reason`, `quantity`, `unit`, `is_warranty_covered`, `phase` (default `expected`), `status` (default `pending`; set to `issued` when fully received), `pr_id` / `pr_number` / `pr_status` (mirror), `received_quantity`, `receiving_status` (`pending`, `partial`, `received`). Material photos: `erp_service_material_attachments` (images only). Materials are **free text, not Item Master items**.

## 4.4 `erp_project_letters` (`ProjectLetter`)

Per machine: `seq`, `letter_no` = `<serial>/LTR/NNN` (never reused, even after delete), `revision` (bumped on every content edit), `letter_date`, `recipient`, `subject`, `body`, `signatory_name`, `signatory_designation`, `letter_type`, `data` (JSON), `created_by_id`.

`letter_type`:
- `general`: free-form letter (recipient, subject, body).
- `delivery_cover` — Delivery Cover Letter; `delivery_confirmation` — Delivery Confirmation; `guarantee_certificate` — Guarantee Certificate for Quality (`reports/letter_templates.py`). Each prints twice: "ORIGINAL FOR RECIPIENT" and "DUPLICATE FOR SUPPLIER" (signed by the customer and returned as proof of delivery). The type can't be changed after creation.

---

# 5. Status machines

## 5.1 Service request

```text
open ─▶ acknowledged ─▶ assigned ─▶ scheduled ─▶ in_progress ─▶ pending_parts ─▶ on_hold ─▶ work_completed ─▶ review ─▶ closed
                                       (any status can be set from any other; cancelled is a side exit)
```

Values are validated against `SR_STATUSES` (schemas/service_request.py). The rules the backend enforces:
- An SR can't be **created** as `closed`.
- **Closing** needs Corrective Action (`resolution_description`) — "Fill Corrective Action on the Diagnostics & RCA tab before closing".
- Closing stamps `closed_at`, bells all `erp` users (`sr_closed`) and emails the client and team once. Reopening clears `closed_at`.
- Otherwise the move is free: any status to any other, including backwards. The detail page's stepper lets the user click a step (with a confirm dialog).

> **ERP standard: field-service SLA.**
> Priority only means something when it carries a clock: e.g. *Urgent = respond in 4 h, resolve in 48 h; Standard = respond in 24 h, resolve in 7 days*. The response clock stops at the first real action (acknowledged / engineer assigned), the resolution clock at work completed, and both pause while the ticket waits on the customer. SLA met % per customer is the number a service head reports. The SR already has the SLA columns, and §44 lists "priorities with SLA (response/resolution hours)" as a setting, but nothing fills them yet. Because status moves freely, any SLA has to be measured from timestamped transitions, not from the current status.

## 5.2 Material

`pending` → (`receiving_status` `partial` → `received`, status `issued`). Receipt is independent of the SR status and of P2P's GRN.

## 5.3 Machine

Free `status` string set by edit (default `active`), plus soft delete to the recycle bin (cascades to its SRs; restore brings back only the SRs deleted with it). Production uses `manufacturing_under_progress` until handover.

---

# 6. Workflows

## 6.1 Machine registration

- **From Production (preferred):** RRV Completion registers the vehicle; Handover makes it live with dates and warranty (see [Production overview](../production/overview.md) §6.6). A serial clash returns 409 and asks to link the existing machine instead.
- **Manually** (`project_create`): for machines delivered before the portal, or not built through an RRV build. Duplicate serial → 409.

> **ERP standard: warranty start.**
> The registry stores `warranty_start_date` / `warranty_end_date`; Production fills them from the **handover date** + `warranty_months` (default 12). §44 of the module plan says the default should be "starts from commissioning". Commissioning-based warranty doesn't penalise the customer for installation delays; handover-based is easier to prove. Whatever the contract says should win, and it should be one rule for every machine.

## 6.2 Service request

1. Raise (`sr_create`): machine, title, **service type**, priority, reporter contact, optional assignee and expected dates. Client "created" email and team email go out in the background.
2. Work it by editing the SR (creator with `sr_edit`): status, Diagnostics & RCA (failure mode, root cause, corrective action, preventive actions), execution dates, downtime, costs, customer sign-off.
3. Close: Corrective Action required; client "closed" email.
4. Delete (creator with `sr_delete`): recycle bin, shown with "days remaining" out of 10.

**Service type** decides who pays: warranty / AMC visits are no-charge, `paid_service` is billable. Billing fields roll up to `total_bill` with GST at `tax_percentage`.

## 6.3 Materials and Raise PR

1. Add material lines (creator with `sr_edit`), optionally with photos.
2. **Raise PR** (`POST /{sr_id}/raise-pr`), from the New-PR-style form (`GET /pr-form-meta` gives categories, requirement types and UOMs, because service users usually don't have the `p2p` app):
   - With `items[]`: each form line becomes a new material line and a PR line (`project_inhouse` must be Project or Inhouse; quantity > 0).
   - Without items: every material not yet on a PR is picked up.
   - The PR is created **`approved`** (approved by the raiser), with the category's auto-buyer, the SR number in remarks, then the same stock check / line routing a normal PR gets on approval.
   - All `p2p` users get a `pr_raised` bell; the Purchase mailbox gets an email. Documents can be attached to that PR (`POST /{sr_id}/raise-pr/{pr_id}/attachments`).
3. **Receive** (`POST /{sr_id}/materials/{mat_id}/receive`): marks the physical arrival at site (clamped to the line quantity). Refreshes the `pr_status` mirror; it does **not** change the PR (P2P's GRN owns that).

## 6.4 Letters and delivery documents

- Create / edit / delete under the machine's Documents tab (`project_edit` / `project_delete`). Default signatory: a Partner (the logged-in user if a Partner, else the first by name), else the last letter's signatory (`GET /{id}/letter-defaults`).
- `GET /{id}/letters/{letter_id}/file?format=pdf|docx` returns the document **of record**: the Word version (with edits made in Word) once one exists for the current revision, else a fresh render on the letterhead.
- The managed Word document (`/managed-documents/erp_project_letter/{letter_id}`) can be created, opened in Word Online, compared and uploaded; modifying needs `project_edit`. Editing the letter bumps its revision, and an older Word draft is flagged as out of date.

---

# 7. Notifications

Bell only; **nothing in this module uses Teams** (Teams is reserved for approvals and reminders). Types ending in `_created`, `_updated`, `_deleted` are suppressed app-wide, so `sr_created`, `sr_updated`, `sr_deleted`, `project_created` and `project_deleted` calls in the code send **nothing**.

| `notification_type` | Recipients | When |
|---|---|---|
| `sr_closed` | All `erp` users (except actor) + the actor | SR closed |
| `pr_raised` | All `p2p` users | PR raised from an SR |
| `pr_received` | All `p2p` users | Material received and the PR is already `received` (rare) |
| `production_rrv_handed_over` | All `erp` users | RRV handed over (from Production) |

Email: client "created" / "closed" (to `reported_by_email`, resendable via `POST /{sr_id}/resend-client-email`), team "created" / "closed" (`TEAM_EMAIL`), PR (`PURCHASE_EMAIL`).

There are no scheduled jobs: no warranty / AMC expiry reminder, no SLA breach reminder, and no recycle-bin purge.

---

# 8. API endpoints

All under `/api/v1`; every route requires the `erp` app.

**Machines** `/erp/projects`
| Method and path | Check |
|---|---|
| `GET ?search&status&application_type&client_company&skip&limit` | `projects` tab |
| `GET /filter-options`, `GET /{id}`, `GET /{id}/audit` | app |
| `POST` | `project_create` |
| `PATCH /{id}` | `project_edit` |
| `DELETE /{id}`, `POST /{id}/restore` | `project_delete` |
| `GET /recycle-bin/list` | `recycle_bin` tab |
| `GET /{id}/attachments`, `GET …/{att}/preview`, `GET …/{att}/content` | app + per-file private/share visibility |
| `POST /{id}/attachments` | `project_edit` |
| `PATCH /{id}/attachments/{att}/permissions` | uploader or admin |
| `DELETE /{id}/attachments/{att}` | `project_delete` |
| `GET /{id}/letter-defaults`, `GET /{id}/letters`, `GET /{id}/letters/{lid}/file?format=` | app |
| `POST /{id}/letters`, `PATCH /{id}/letters/{lid}` | `project_edit` |
| `DELETE /{id}/letters/{lid}` | `project_delete` |
| `/managed-documents/erp_project_letter/{lid}[/changes\|/edit\|/docx\|/upload]` | `erp` app; modify needs `project_edit` |

**Service requests** `/erp/service-requests`
| Method and path | Check |
|---|---|
| `GET ?search&status&priority&service_type&project_id&skip&limit` (limit ≤ 1000) | `service_requests` tab |
| `POST` | `sr_create` |
| `GET /recycle-bin` | `recycle_bin` tab |
| `GET /pr-form-meta`, `GET /{id}`, `GET /{id}/audit`, `GET /{id}/materials` | app |
| `PATCH /{id}` | owner + `sr_edit` |
| `DELETE /{id}`, `POST /{id}/restore` | owner + `sr_delete` |
| `POST /{id}/attachments`; `GET …/{att}/content`, `…/preview`; `DELETE …/{att}` | owner + `sr_edit` / app / owner + `sr_delete` |
| `POST /{id}/materials`, `PATCH /{id}/materials/{mid}`, `POST …/{mid}/receive` | owner + `sr_edit` |
| `DELETE /{id}/materials/{mid}` | owner + `sr_delete` |
| `POST …/{mid}/attachments` (images); `GET …/content`, `…/preview`; `DELETE …` | owner + `sr_edit` / app / owner + `sr_delete` |
| `POST /{id}/raise-pr` | owner + `sr_edit` |
| `POST /{id}/raise-pr/{pr_id}/attachments` | owner + `sr_edit` |
| `POST /{id}/resend-client-email` | app |
| `POST /test-email` | admin |

---

# 9. Frontend pages

| Route | Page |
|---|---|
| `/dashboard/erp` | Dashboard |
| `/dashboard/erp/projects`, `/new`, `/[id]`, `/[id]/edit` | Machine registry; detail with documents, letters (`LetterEditorDialog`, Word panel), service history |
| `/dashboard/erp/service-requests`, `/new`, `/[id]`, `/[id]/edit` | SR list; form (`ServiceRequestForm`, service type from `serviceTypes.ts`); detail with stepper and tabs Overview, Diagnostics & RCA, Materials (Raise PR form), Attachments, Audit Trail |
| `/dashboard/erp/reports` | Reports, computed in the browser from `listServiceRequests({ limit: 1000 })` |
| `/dashboard/erp/recycle-bin` | Deleted machines and SRs |

Components: `frontend/src/components/erp/` (`ErpNav`, `ProjectForm`, `ServiceRequestForm`, `LetterEditorDialog`, `SharePicker`, `serviceTypes.ts`, dialogs).

---

# 10. Known gaps

1. **No commissioning record.** §19 says commissioning (date, report, customer sign-off) should be its own record and the only commissioning lifecycle; today it's a date on the machine plus an SR of type `installation_commissioning`.
2. **SLA not wired**: columns exist, nothing computes them; priority has no response/resolution hours.
3. **Assigned engineer gets no notification** (assignment is an `sr_updated` change, which is suppressed) and **can't edit** the SR unless they created it.
4. **Status moves freely**; no transition rules beyond "close needs Corrective Action".
5. **Materials are free text**, not Item Master items; no recommended-spares list from the Engineering BOM (§19 items 3–4). The PR line therefore can't be stock-checked by item code reliably.
6. **No warranty / AMC expiry reminders** and no warranty-claim link to NCR / CAPA (§19 item 6).
7. **Recycle bin shows "days remaining" but nothing purges** after 10 days.
8. **`is_locked` is never set**, so "lock SR after closure" (§44) isn't in effect.
9. **Permission Matrix actions not used** — two parallel permission systems (§3); `project_view` / `sr_view` are offered but not checked.
10. **Reports are client-side** over at most 1,000 SRs; no backend report.
11. **Warranty start = handover** (Production), while §44 proposes commissioning.
12. **No AR invoice** from service billing (`total_bill`, `invoice_number` are typed).

---

# 11. Related documentation

- [Production overview](../production/overview.md): RRV Completion and Handover write the machine
- [Store overview](../store/overview.md): dispatch issue against the machine
- [P2P overview](../p2p/overview.md): where Raise PR lands
- Older detail pages in this folder (see §12 for what changed)
- `docs/MODULE_DETAILED_PLAN.md` §19, §24, §44

# 12. Where the older pages in this folder are out of date

| Page says (29 Aug 2026) | Code now |
|---|---|
| workflows.md: backend `PATCH` accepts any string as status | Validated against `SR_STATUSES`; can't create as closed; closing needs Corrective Action |
| workflows.md: Raise PR notifies Purchase (`purchase` app); receiving syncs the PR and advances it to `received` | PR created **approved** with auto-buyer; bell to `p2p` users; receive only mirrors `pr_status` — P2P's GRN owns the PR status |
| overview.md / api.md: no letters | Letters and three delivery templates, Word documents of record |
| api.md: priority filter implies four levels | Priority is `standard` / `urgent`; `service_type` required |
| api.md: missing `pr-form-meta`, PR attachments, letters, letter-defaults | Listed in §8 |
| permissions.md: no mention of Permission Matrix tabs | List and recycle-bin routes also check `projects` / `service_requests` / `recycle_bin` tabs |
| overview.md: "permissions.md (pending)" | It exists |
