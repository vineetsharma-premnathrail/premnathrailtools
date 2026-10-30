
# Spec: R&D rework, Sales module removal, priority = Standard / Urgent

Date: 2026-10-30 · Size: L · Author: BA agent · Status: for Manager decision
Inputs: `requirement.md` (owner list and answers, decided), `current-state.md`.
The owner's decisions are not reopened here. Where a decision has a consequence the owner did not mention, it is listed in section 3 with a default.

## 1. Request and assumptions

Business here means BD (CRM), R&D, Design, Production and Finance. The request has six workstreams:

- **WS-1 Requirement intake.** R&D formally accepts or returns each BD submission. It gets a unique R&D ID, a Revision ID per BD re-send, a Timeline, fixed document categories, and a simple notification. Discussion, Access, Share Department and Milestones are removed.
- **WS-2 Technical Offer by upload.** R&D uploads the offer instead of creating it in Word. BD can upload its own offer for quotations.
- **WS-3 Priority.** Standard / Urgent in every module.
- **WS-4 Origin.** R&D Prototype / Research origin becomes Existing Projects / New Project.
- **WS-5 R&D Tasks.** Rename, Create Task by type, and an analytics table.
- **WS-6 Sales deletion.** Project creation moves to Project Management (PM).

Assumptions (the Manager can overrule):

- "R&D prototype form" means the existing Prototype / Research project form (`rnd/projects/new`, table `rnd_projects`). It does not mean the BOM-level `rnd/prototypes` pages. verify.
- "Remove document creation" means the R&D side only: Word creation of Technical Offers and any create-document button in R&D. BD's TOR PDF (the system snapshot of what was sent) stays.
- "Remove Milestones" applies to both requirements and Prototype / Research projects. The owner wrote "keep Tasks only" without limiting it. Project Management (PM) milestones are a different module and are not touched.
- Tables are never dropped in this run (owner rule). Code and UI are removed; data stays.
- The R&D calculators are untouched.

## 2. Where this sits in the core flow, and what it touches

Core flow: Customer → BD → **R&D** → Design/EHP → BOM → Store/Purchase → Production → QC → Dispatch → Commissioning → Machine → Service → Finance.

| Change | Position | Upstream | Downstream |
|---|---|---|---|
| WS-1, 2, 4, 5 | BD → R&D (and R&D → BD for the offer) | CRM inquiry/tender send, CRM quotation | Design/EHP get work through R&D tasks; quotation stacks the offer |
| WS-3 | Cross-cutting | All modules with a priority column | Dashboards, sorting, tours |
| WS-6 | Removes the step between BD and the project | CRM "Order Received" and the Sales Order handoff | PM project, Units, Production, Store, Quality, Dispatch, **Finance billing, credit and receivables** |

Verified coupling to Sales (grep of `modules.sales`, 88 files; the list below is a summary, not exhaustive):

- Finance: billing, credit, receivables, outstanding, cash position, profitability, vouchers, bank guarantees, payments.
- Production: MRP, routing control, RRV handover.
- Store: project stock, material issues (dispatch).
- Quality: order-project inspection.
- Design: order-project links.
- PM: `projects/so_projects.py` and `routes/units.py` (From Sales Order).
- CRM: stage guard, quotation status, organisation delete rules, SalesOrderHandoff, `ensure_not_with_sales`.
- P2P account assignment, ERP projects, the home analytics, `tasks/sales_scheduler.py`.

## 3. Challenges and conflicts (read first)

**A. "Sales" also hosts Products and Pricing.**
- Permission module `sales` contains the tabs `products` and `pricing` (`permission_registry.py` ~254-268).
- The Sales sidebar entry is the only door to Products (`Sidebar.tsx` ~92-96, `SalesNav.tsx`).
- Deleting Sales "completely" would delete the product master, and CRM quotation lines depend on it.
- **Default:** Products becomes its own top-level sidebar entry and permission module `products`, with a gear for its settings.
- Existing `sales:products:*` and `sales:pricing:*` grants are aliased to it, using the same legacy-alias mechanism already used for the old `products` module.
- Everything else in `sales` (orders, delivery, reports, settings, dashboard) is removed.
- This changes memory "Permission modules = UI modules" (Products under Sales, 10-19). Flag to the owner.

**B. Project "Units" exist only through Sales Orders.**
- `PmProjectElement` rows are created only in `so_projects.py` (lines 240 and 254).
- Production per-vehicle builds, Store reservation, Quality inspection and Dispatch all hang on Units.
- A project created from the PM form (no Sales Order) has zero Units, so the chain from Production to Dispatch has nothing to attach to.
- **Default:** in scope is "Add / edit Unit" inside the PM project (Units tab), with unit kind vehicle or lot, quantity and description. Without it, Sales removal breaks the core flow.

**C. Finance billing runs off the Sales Order.**
- Today the billing plan, advances, credit check, delivery events and invoice links all hang off the Sales Order (`accounts/services/billing.py`, `credit.py`, `receivables.py`).
- With no new Sales Orders, new projects have no billing trigger, credit exposure or receivable source.
- This is a business decision, not a code detail: what is the commercial source for a new project (customer PO, value, billing milestones)?
- **Default (staged retirement, so nothing crashes):**
- **Stage 1, this run:** remove all Sales UI, routes, services, schemas, reports, scheduler and permissions, and block creation of new orders.
  - Keep the `sales` SQLAlchemy models and the few helper functions that Finance, Production and Store import. They then work only on historic orders.
  - A hard delete of those imports would crash the app at boot, because the tables stay.
- **Stage 2, a separate requirement and a separate owner OK:** move billing plan, credit and receivable basis to the PM project, then drop the tables.
- **Until Stage 2:** whether Finance can invoice a project that has no order is `verify:` (not checked). Record this gap in the final report.

**D. CRM stage lock and delete rules.**
- Today a live Sales Order freezes the inquiry/tender stage and blocks its edit and delete (`stage_guard.py`).
- **Default:** keep the lock only for historic orders. For new projects, add an optional "Source: CRM inquiry/tender" link on PM New Project, which blocks delete of the source (same rule as "a linked record is never deleted"). It does not freeze the record.
- This also keeps BD → project traceability once the Sales Order step is gone.

**E. Removing Discussion leaves BD and R&D with no clarification channel.**
- **Default:** allow Return to BD also from Accepted (before the response), with a mandatory reason. This is the only channel for "your requirement is unclear".
- Discussion is removed on **both** sides (R&D page and the CRM Inquiry and Tender panels). Keep the table as history. verify the CRM panels' `seeTab('Discussion')`.

**F. Removing Access and Share Department reverses 10-08 and 10-09 decisions.**
- Memory `project_rnd_requirement_work` says need-to-know per requirement (head-only by default, View/Download/Upload/Respond ticks), and sharing with Design/Electrical/Hydraulic.
- **Default replacement (keeps the R&D → Design/EHP handoff of the core flow):**
- Heads and admins can do everything.
- R&D-side users with `rnd:requirements:view` see all requirements and download their files. Sensitive blocks (customer, CRM commercial) stay masked by the existing role features. Need-to-know now comes from roles, not per-record ticks.
- People outside R&D get View and Download only on a requirement where they hold a task (the automatic grant on task assignment stays; `rnd_requirement_access` stays as an internal table with no UI).
- Design/EHP "Requirements" tabs and pages (`design|electrical|hydraulic/requirements`, `DeptRequirementDetail`) are removed. Design/EHP work arrives as an R&D task.
- Existing share and feasibility data stay in the tables, read-only. Nothing shows in the UI.

**G. Removing Milestones from Prototype / Research projects reverses 10-24 "R&D milestones".** Default: remove (see section 1). Tasks that sat in a milestone become plain tasks of the project or requirement (`milestone_id` ignored). Plans and milestone data stay in the tables.

**H. Accept / Return is not routed through the central approval engine.**
- It is an acceptance of work by one R&D head, with no stages, amount, or escalation chain.
- The engine is for authorisation. Sending it through the engine would add a workflow with a single stage and a template per document.
- Role features still gate the action, and the audit trail is full. Partner escalation does not apply.
- Challenge if the owner wants Partner visibility; otherwise leave it.

**I. Priority "app-wide" is the largest blast radius.**
- 16 models have a priority column (backend grep) and about 119 frontend files reference it.
- The mapping is lossy (low, medium, high and critical collapse into two values), so it is not exactly reversible.
- Do it in waves, but ship one release so the app never has two vocabularies.

**J. Technical Offer upload and Word stacking.**
- Today quotations stack the offer's Word file on top of the quotation Word file (`workflow.py` ~658-670).
- An uploaded PDF cannot be stacked into Word.
- Default: accept DOCX and PDF. A DOCX is stacked. A PDF is attached to the quotation as a separate file, with a note on the quotation screen.
- This does not violate "Word documents, not PDF", which governs generated documents. Uploads are not generated.

## 4. Roles and permissions (module → tab → feature → action)

Existing rules stay: deny-by-default, data scope on every route. Record rules are in `requirement_access.py` (verify the new rules there). Partners (`is_partner`) have no role in this flow (see H).

| Actor | What they can do |
|---|---|
| BD user (CRM `inquiries_tenders`, feature `send_tor`) | Send and re-send a requirement. See status, return reason, R&D ID and revisions. Upload an independent Technical Offer. Cannot see R&D internals. |
| R&D head (Organization › Department head), admin | Accept, Return, Respond, release offers, create tasks, see everything. |
| R&D member | See all requirements per F, create tasks if granted, upload documents, upload an offer if in `offer_team`. |
| Design/EHP assignee | View and Download on the requirement where they hold a task. Nothing else on the requirement. |
| PM / Project Manager | Create Project: New Project. |

Registry changes (Manager edits the registry; the exact keys are for the architecture and backend roles):

- `rnd:requirements`
- New feature **`review`** (action; `accept`, `return`). Default holder: heads. Ticked explicitly, like `offer_team`.
- Feature `history` keeps its key (so grants survive) and is relabelled "Timeline".
- Features **removed**: `milestones`, `milestone_status`, `departments`, `discussion`, `access`.
- Features kept and relabelled: `documents` (view, create = upload, export = open/download), `technical_offers` (view, create = upload, approve = release), `offer_team`, `tasks`, `crm_request`, `customer`, `crm_info`, `product_requirement`, `projects`.
- `rnd:projects`
- Features removed: `milestones`, `milestone_status`, and the matching assignee pickers.
- New tab **`rnd:tasks`** "R&D Tasks" (view, create).
- Feature **`analytics`** (view): all R&D tasks, not only mine.
- The R&D Nav tab "My Tasks" is renamed "R&D Tasks". Its tab key list replaces `project_work, projects, requirements`. verify the current `subtabKeys`.
- CRM `inquiries_tenders`
- Feature for BD offer upload: new action `technical_offer` (create/delete).
- Tab `Discussion` removed.
- `projects:all_projects`: add view for R&D roles (see open point 6).
- `rnd:project_work` ("Ongoing Projects") legacy key: leave in place (it still gates legacy `/pm-work`).
- Module `sales` removed, except `products` and `pricing` re-homed to module `products`. Role editor shows no phantom module.

## 5. Workstreams: workflow, fields, rules

### WS-1 Requirement intake

A requirement is still the CRM Inquiry/Tender (single source of truth). Each send is one revision.

**State machine (per revision):**

```
BD "Send to R&D" ──► SUBMITTED ──Accept(head)──► ACCEPTED ──Respond(R&D)──► RESPONDED
                       │                          │
                       │ Return(head, reason)     │ Return(head, reason, only before Respond)
                       ▼                          ▼
                    RETURNED  ◄───────────────────┘
BD edits + re-sends  ──► NEW revision Rn+1 = SUBMITTED
 previous revision in SUBMITTED or ACCEPTED (unanswered) becomes SUPERSEDED
 previous RETURNED / RESPONDED stay as they are
Requirement status shown = status of the latest revision.
```

Transition owners:

| Transition | Who | Rule |
|---|---|---|
| Submit / re-submit | BD with `send_tor` | Existing checks: product and specification filled, due date not in the past. |
| Accept | R&D head or `review` holder | Latest revision only. Optional remark. |
| Return | Same | Reason mandatory (at least 10 characters). |
| Respond | Existing rule | Allowed only when the latest revision is ACCEPTED. Not allowed while SUBMITTED or RETURNED. |
| Supersede | System | On re-send. |

Gate: until a revision is ACCEPTED, R&D cannot create requirement tasks, upload an R&D Technical Offer, or respond. Why: acceptance is the commitment to do the work, and it prevents work on a requirement that may be wrong. Existing tasks are not blocked when a new revision arrives, but they show "requirement changed since task created" until the new revision is accepted.

**Fields (business view; the database role maps them):**

*Requirement header (new, R&D-owned small table; verify naming):*

| Field | Type | Required | Source | Why it exists |
|---|---|---|---|---|
| R&D ID | text, unique, `RDR-YYYY-NNNN` | auto | Counter per calendar year (IST), assigned at the first successful send, never changes | One stable reference for R&D, tasks, offers, reports. The CRM numbers (`INQ-…`, `TOR-…`) are BD identifiers. |
| source + record id | link | yes | CRM inquiry/tender | One R&D ID per CRM record. |
| first received at | date-time | auto | System | Timeline and sorting. |

*Revision (extend `crm_rnd_requests`, one row per send):*

| Field | Type | Required | Why it exists |
|---|---|---|---|
| Revision no. | integer from 0 | auto | Order of sends. |
| Revision ID | text, unique, `<R&D ID>-R<n>` | auto | Owner request: each change gets an ID. Same pattern as the offer's `-Rn`. |
| Review status | submitted / accepted / returned / responded / superseded | auto | State machine above. |
| Reviewed by / at | user, date-time | on accept/return | Accountability. |
| Review remarks | text | optional on accept | A note to BD. |
| Return reason | text | required on return | The reason BD must see. |
| Snapshot of what R&D received | existing audit snapshot | auto | The diff between revisions (`list_movements`). |

The Revision ID is allocated by the system at BD submit, so the revision is recorded the moment it is received. R&D does not type it. R&D's act is Accept or Return.

**UI changes:**

- Requirement page tabs become: Requirement, Tasks, Technical Offers, Documents, Timeline.
- Tasks is a flat list (no Milestones tab, no department chips).
- Header shows R&D ID, the current Revision ID, the status chip, and the Accept / Return buttons for reviewers.
- Return opens a PromptDialog (reason required). Accept uses a ConfirmDialog. No browser dialogs.
- Requirements list: add columns R&D ID, Revision, Status. Default sort by R&D ID ascending, and the list shows "Needs my review" first. verify against the sort rule.
- BD side: the TOR / R&D card and the movements tab show R&D ID, revision list, the status, and "Returned by R&D: <reason>" with a "Re-send to R&D" button. Discussion tab removed.
- **Timeline** (replaces History; read-only, newest first): submitted / revision created, accepted, returned (with reason), responded, task events, offer uploaded/released/superseded, document uploaded or category changed, project linked or unlinked. Source: AuditLog plus task events. verify the current `RndProjectHistory` source.
- **Documents:** one fixed category per file, picked at upload (required). Upload only; no creation. The list filters by category.
- **Notification (simple):**
- On submit and on re-submit: bell to R&D heads, plus role subscribers to the event (`rnd.tor_received`, event key kept so subscriptions survive; label becomes "New requirement received"). The message includes the R&D ID and the due date.
- On accept or return: bell to the BD requester and the BD owner (new CRM events).
- Teams: only the reminder "review pending" (default: 2 working days unreviewed, then every 3 days, same cadence as the PM reminders). No Teams for submitted/accepted/returned.
- The existing email with the TOR PDF stays unchanged (open point 8).

**Document categories (fixed, coded list; no admin editing, per "no metadata customization"):**

| Category | Typical content |
|---|---|
| Customer Specification | Client RFQ, tender specification, requirement document |
| Technical Specification | Internal specification, design basis |
| Reference Standard | RDSO / IRS / IS / EN extract |
| Drawing | GA, part, 3D, mark-up |
| Calculation | Strength, braking, tractive effort output |
| Test Report | Trial and test data |
| Datasheet | Component or vendor datasheet |
| Technical Offer | Set only by the offer upload flow; not selectable in the generic upload |
| Other | Photos, minutes, anything else |

System labels stay as they are, set by the system and not shown in the picker: "Technical Offer Request" (BD's TOR PDF) and "R&D Response".

Back-fill of existing files:

- Requirement documents: "Other", changeable once by the uploader or a head.
- R&D project documents (`RND_DOCUMENT_TYPES`): specification → Technical Specification; drawing → Drawing; test_report → Test Report; research_note, process_document, other → Other.
- Client files shared via TOR keep their CRM category.

**Removed:** Discussion (R&D and CRM), Access, Share Department (R&D and the three department Requirements tabs), Milestones (requirement and Prototype / Research project), Word creation of offers, per-document department visibility (`RndRequirementDocVisibility`; with no department sharing, every document with view access is visible).

### WS-2 Technical Offer upload

**Flow, R&D offer:**

```
Uploaded (uploader) ──► PENDING RELEASE ──Release(R&D head)──► RELEASED ──(newer release)──► SUPERSEDED
                            │ Return(head, reason)
                            ▼
                        RETURNED (uploader uploads a corrected file = new revision)
```

The maker-checker from 10-22 stays. An offer is quotable only when RELEASED.

Fields:

| Field | Type | Required | Why it exists |
|---|---|---|---|
| Requirement / revision | link | yes (R&D offer) | Which revision the offer answers. If BD re-sends after release, the offer shows "based on an earlier revision". |
| Offer number | text, existing pattern `TO-…[-Rn]`, auto | auto | No change to existing numbering. |
| Title | text | yes | Identifies the file in lists. |
| Offer date | date | yes | Used on the quotation (`technical_offer_date`). |
| File | DOCX or PDF | yes | The offer itself. Size limit as in other uploads. verify the limit. |
| Notes | text | optional | Context for the reviewer. |
| Origin | R&D / BD | auto | Which side uploaded. |
| Uploaded by / at | user, date-time | auto | Accountability. |
| Status, released by/at, return reason | existing | auto | State machine above. |

**BD independent offer** (inquiry/tender detail, Technical Offers area):

- Same fields, Origin = BD.
- No R&D requirement is required (BD may upload even when nothing was sent to R&D).
- No release step: it is quotable at once, and the quotation screen labels it "Uploaded by BD, not reviewed by R&D".
- BD can delete it only while no quotation uses it.

Recommended storage: one offer table with an `origin` column, so `crm_quotations.technical_offer_id` stays valid (no quotation migration).

Existing offers:

- released and superseded: unchanged, still downloadable;
- draft and submitted (Word-created, not released): system-returned with reason "Offer creation was replaced by upload — upload the final file", so nothing is silently lost;
- `build_docx`, "Edit in Word" and `tor-options` for offers are removed (verify nothing else calls them).

### WS-3 Priority = Standard / Urgent

Single shared definition: backend constant plus frontend constant. Every form, filter, chip and API validation uses the same two values (no per-module lists).

Mapping of old to new (default; the one judgement call is High and Critical):

| Old value | New |
|---|---|
| low, medium, normal, standard, Low, Medium | Standard |
| high, High, critical, urgent, Urgent | Urgent |

Tables to map (verified list; this gives the DB role its scope): CRM inquiry and tender (`priority`, capitalised strings; `followup_priority` too), R&D project, R&D requirement task, R&D project task, PM project, PM task (two tables), Design request, Design change notice, Electrical job, Maintenance request and work order, Production work order and RRV build, P2P request. Service request already uses standard / urgent, so it is the reference.

Also:

- the Design mapper `_PRIORITY` in `change_requests.py`, the Maintenance settings priority list, and every frontend label map;
- the CRM tour configs that mention priority (`crmInquiryForm`, `crmInquiryDetailPage`, `crmTenderForm`, `crmOrganizationDetail`); project rule 6 requires them updated before any push;
- any place that sorts or colours by priority order (for example production shop-floor): verify.

Why Urgent for High and Critical: it never silently downgrades something someone flagged as important. The cost is more Urgent items; the owner can review after the migration (the migration logs counts per table).

### WS-4 Origin

Options: **Existing Projects** and **New Project** (labels exactly as the owner wrote).

| Old origin | New origin | Notes |
|---|---|---|
| product_improvement | Existing Projects | Keeps the machine and PEW link. |
| new_development | New Project | |
| process_research | New Project | `origin_note` kept; `project_type` stays `technology_research` so old reports still read. |
| customer_requirement | New Project | Source link to the inquiry/tender is kept. |

Rules (default):

- **Existing Projects:** pick the existing project / machine (PEW), required. Improvement reason stays required (existing five reasons); the owner only renamed it. The reason's former extra proof rules were already dropped on 10-27.
- **New Project:** "Who proposed it and why" required, proof document required on create (existing rule for new development). Optional "Customer requirement" picker, listing requirements by R&D ID. Why: keeps customer-driven prototypes traceable to the requirement after the "Customer Requirement" option is removed.
- `project_type` derived: Existing Projects → product_improvement; New Project → new_product (as today).
- Validation lives in `services/project_origin.py`. Messages stay real (reason + fix).
- Labels in `projects/page.tsx`, `ProjectOriginFields.tsx`, filters and the `RndProjectOrigin` type are updated.

### WS-5 R&D Tasks

Page: **R&D › R&D Tasks** (renamed from My Tasks).

**Create Task** (primary button, FormSheet popup per the form standard):

- Step 1: **Type**, Requirement or Prototype (required). The matching form follows.
- Step 2 (same for both unless stated): Title, Details, Assignee, Start date, Due date, Priority (Standard / Urgent), Checklist, Attachments.
- Requirement form: **Requirement** picker (shows R&D ID and title; only requirements the user can open and whose latest revision is ACCEPTED).
- Prototype form: **Prototype / Research project** picker (shows RND number and title; only projects the user may give tasks on).
- Authorised persons: heads, and users with `rnd:tasks:create` who also meet the existing record rule (requirement access, or project lead for a project task). The existing "Assign to" role rule limits the assignee list.
- Why two task tables stay: the existing flows (extend, ask for approval, sub-tasks, reopen) live on `rnd_requirement_tasks` and `rnd_project_tasks`. A third table would duplicate them.

**Status and progress (new):**

| Field | Values | Rule |
|---|---|---|
| Work status | Not started, In progress, On hold (existing); Completed and Cancelled come from the existing task status | Assignee changes the first three. Completed is the existing "complete". |
| Progress % | 0 to 100 integer | If the task has a checklist, progress = ticked steps / total, shown read-only. Otherwise the assignee enters it. Completing sets 100; reopening caps at 99; Cancelled keeps the last value. |

**Analytics** (below the toolbar on the same page; gated by `rnd:tasks:analytics`; others see only tasks they are assigned or created):

- Summary tiles: Total, Pending, Completed, Overdue, Average progress.
- Views, switched by a toggle: **By task** (default), **By person**, **By project / requirement**. The grouped views show task count, pending, completed, overdue and progress % per row.
- Columns (By task): Task, Type, Project or Requirement (R&D ID or RND number), Assignee, Department, Priority, Status, Progress %, Start, Due, Completed on, Days overdue.
- Definitions (mutually exclusive buckets, so the tiles add up):
- **Completed** = completed tasks.
- **Overdue** = open and due date before today (IST).
- **Pending** = open and not overdue.
- **Cancelled** is excluded from the tiles and from progress; it is shown only when the status filter asks for it.
- **Project progress** = average progress of its non-cancelled tasks, equal weight. Why: simple and explainable; duration weighting can come later.
- **Department** = the assignee's department from the user master (Organization). The stored `department` column on requirement tasks is no longer used, because Share Department is gone.
- Filters (Filters popup standard): Project / requirement, Assigned user, Department, Type (Requirement / Prototype), Status, Priority, Date range (applies to due date; default due date), Completion progress (bands 0, 1-49, 50-99, 100). Default sort: R&D ID / task code ascending.
- PM tasks (the old "Ongoing Projects" category) are removed from this page; they stay in PM › My Tasks. Default: remove (open point 7).

### WS-6 Sales deletion and PM Create Project

**Create Project** (PM › All Projects):

- The "From Sales Order" button, its awaiting-orders count, and the endpoints behind them are removed.
- **+ Create Project** opens a chooser popup (rendered through `createPortal`): **New Project** or **New Prototype**.
- New Project goes to the existing PM project + machine form (`projects/new`, PEW numbering unchanged).
- New Prototype goes to the R&D Prototype / Research form, and the result is an R&D project (`RND-YYYY-NNNN`).
- Each card is disabled with the reason when the user lacks `projects:all_projects:create` or `rnd:projects:create`. If both are missing the button is hidden.
- New Project form additions (default): optional CRM source (inquiry or tender in "Order Received"), and Units added in the project (see 3B).

**Removal inventory** (what to delete):

- Frontend: `dashboard/sales/*` (orders, amendments, reports, settings, dashboard), `SalesNav`, the Sidebar "Sales" entry (replaced by "Products"), `SalesOrderHandoff` in CRM, `SalesBillingDue` links, `NotificationBell` Sales links.
- Backend: `modules/sales` routes, views, services, schemas, reports and events; `tasks/sales_scheduler.py`; the registrations in `main.py`; the `sales` entries in `permission_registry` and its feature files; `PRODUCT_TABS` special-casing.
- Old `/dashboard/sales/*` URLs show a clear page: "Sales Orders were removed. Create projects from Project Management." There is no broken link, no 404. Old notifications pointing there do the same.
- Keep (Stage 1): the `sales` models and the helper functions that Finance, Production, Store and Quality import (see 3C).
- Sales settings consumed elsewhere (spares, service rates, freight, quotation settings read by `crm/services/quotation_status.py` and Products pricing) move to Products' gear settings. The rest is dropped (open point 4).
- Home dashboard widgets reading Sales Orders (`main/routes/analytics.py`): remove the Sales tiles or read only historic orders (verify, open point 9).

## 6. Acceptance criteria (Given / When / Then)

**Intake, IDs, revisions**

- **AC-1.** Given an inquiry with product and specification filled and a future due date, when BD sends it to R&D for the first time, then an R&D ID `RDR-YYYY-NNNN` is created, revision R0 with Revision ID `<R&D ID>-R0` exists with status Submitted, and the R&D ID never changes afterwards.
- **AC-2.** Given two requirements submitted in the same second, when both are saved, then the R&D IDs are different and no number is skipped or duplicated (the counter is locked per year).
- **AC-3.** Given a requirement with R0 Submitted, when BD edits it and re-sends, then R1 is created with ID `<R&D ID>-R1`, R0 becomes Superseded, and R1 is Submitted.
- **AC-4.** Given R0 is Responded, when BD re-sends, then R1 is Submitted, R0 stays Responded, and the offer released against R0 shows "based on an earlier revision".
- **AC-5.** Given a send with the product or specification empty, when BD clicks Send, then it is refused with "Fill Product and Specification … before sending" and no R&D ID or revision is created.
- **AC-6.** Given a due date in the past, when BD sends, then the send is refused with the existing past-date message and nothing is created.
- **AC-7.** Given revision R1 differs from R0, when R&D opens the Timeline, then the changed fields (old to new) are shown against R1 and each revision lists who sent it and when.

**Accept and Return**

- **AC-8.** Given the latest revision is Submitted and I hold `review`, when I click Accept (and confirm), then its status is Accepted, reviewer and time are saved, a Timeline entry is written, and the BD requester and BD owner get a bell notice.
- **AC-9.** Given the latest revision is Submitted, when I click Return and leave the reason empty or shorter than 10 characters, then it is refused with "Enter the reason BD must fix (at least 10 characters)" and the status is unchanged.
- **AC-10.** Given a valid reason, when I click Return, then the status is Returned, BD sees "Returned by R&D: <reason>" on the inquiry/tender with a "Re-send to R&D" button, and R&D tasks, offer upload and response stay blocked.
- **AC-11.** Given a revision is Accepted and not yet answered, when a reviewer returns it with a reason, then it becomes Returned (this is the only clarification channel).
- **AC-12.** Given a revision is Responded, when anyone tries to Return it, then it is refused: "Already answered — ask BD to re-send if it must change."
- **AC-13.** Given a revision was superseded by a newer send, when a reviewer opens the old revision and tries to Accept, then it is refused: "R1 is newer — review the latest revision."
- **AC-14.** Given I am an R&D member without `review`, when I call Accept or Return (UI or API), then I get 403 saying who can grant it and the status is unchanged; the buttons are not shown.
- **AC-15.** Given a revision that is Submitted or Returned, when someone tries to Respond to CRM, create a requirement task, or start an R&D offer upload, then it is refused with "Accept the requirement first".
- **AC-16.** Given a new revision arrives while tasks are open, when R&D views those tasks, then they show "requirement changed since task created" and they are not blocked, but new tasks wait for Accept.

**Notification and reminders**

- **AC-17.** Given a submit or re-submit, when it is saved, then each R&D head and each R&D role subscribed to the event gets one bell notification with the R&D ID and due date, and nobody gets a duplicate; the sender is not notified. No Teams message is sent.
- **AC-18.** Given a revision stays Submitted for 2 working days, when the reminder job runs, then each head gets a Teams reminder, repeated every 3 days until Accept or Return; Accepted or Returned revisions get none.

**Pages, tabs, access, documents**

- **AC-19.** Given I open a requirement, when the page loads, then the tabs are exactly Requirement, Tasks, Technical Offers, Documents, Timeline (each only if I hold its feature); there is no Discussion, Access, Milestones or Departments anywhere on R&D or CRM pages.
- **AC-20.** Given I am a user outside R&D with a task on this requirement, when I open it, then I can view and download its files and cannot upload, respond, accept or return; for a requirement with no task for me I get 403 "You don't have access to this requirement".
- **AC-21.** Given I am an R&D member with `rnd:requirements:view`, when I open the list, then I see all requirements; given I have no R&D access, then I see none.
- **AC-22.** Given a role without `customer` or `crm_info`, when I open a requirement, then those blocks are hidden; this also holds for the revision snapshot.
- **AC-23.** Given I upload a document, when I do not pick a category, then it is refused "Pick a category"; with a category it saves, shows the category, and the list can be filtered by it. "Technical Offer" is not in the picker.
- **AC-24.** Given existing requirement files, when the migration has run, then every file has a category (Other, or the mapping in section 5), and no file is lost.
- **AC-25.** Given an R&D page, when I look for any "create document" or "edit in Word" control for offers, then there is none; BD's TOR PDF is still produced on send.
- **AC-26.** Given the History tab, when it is renamed, then it reads "Timeline" everywhere, role grants on the old `history` key still work, and the role editor shows "Timeline".

**Technical Offer upload**

- **AC-27.** Given an Accepted requirement and I am an R&D uploader (`offer_team` create, or a head), when I upload a DOCX or PDF with title and date, then an offer with an auto number is created in Pending release linked to the current revision.
- **AC-28.** Given I upload a file that is not DOCX/PDF, empty, or over the limit, when I submit, then it is refused with the exact reason and the allowed types.
- **AC-29.** Given a Pending release offer, when the R&D head releases it, then it is Released and appears in BD's quotation picker; when the head returns it with a reason, then the uploader sees the reason and can upload a corrected file as the next revision.
- **AC-30.** Given a Pending release or Returned offer, when BD opens the quotation picker, then it is not listed (only Released offers, and older Superseded ones for existing quotations).
- **AC-31.** Given a BD user with `technical_offer` create, when they upload an offer on an inquiry that was never sent to R&D, then it is saved with Origin BD, is quotable at once, and the quotation shows "Uploaded by BD, not reviewed by R&D".
- **AC-32.** Given a BD offer already used by a quotation, when BD tries to delete it, then it is refused: "Used by quotation <no.> — remove it from the quotation first".
- **AC-33.** Given a quotation with a DOCX offer, when the quotation Word file is generated, then the offer is stacked on top as today; given a PDF offer, then it is attached separately and the screen says so.
- **AC-34.** Given offers created in Word before this release, when the migration has run, then Released and Superseded offers still download, and Draft/Submitted ones are Returned with "Offer creation was replaced by upload — upload the final file".
- **AC-35.** Given I am a BD user, when I try the R&D release or an R&D upload endpoint, then I get 403.

**Priority**

- **AC-36.** Given any form or filter in any module, when I open its priority control, then it has exactly Standard and Urgent, with Standard as default.
- **AC-37.** Given existing rows, when the migration has run, then low, medium, normal, standard map to Standard, and high, critical, urgent map to Urgent in every table listed in WS-3; the migration reports counts per table; no row has any other value.
- **AC-38.** Given an API client sending `priority = "high"`, when it saves, then it is refused with "Priority must be Standard or Urgent."
- **AC-39.** Given lists that filter or sort by priority (CRM, Design, PM, Production, Maintenance, P2P, R&D), when I filter Urgent, then all rows previously High, Critical or Urgent appear.
- **AC-40.** Given the CRM tour configs, when the CRM UI changes, then the tours no longer mention Low/Medium/High, and `npm run test:ui` stays at 0 errors.

**Origin**

- **AC-41.** Given the Prototype / Research form, when I open Origin, then the options are exactly Existing Projects and New Project.
- **AC-42.** Given Existing Projects without an existing project picked, when I save, then it is refused: "Pick the existing project being improved (PEW number)".
- **AC-43.** Given New Project with an empty "who proposed it and why" or no proof document on create, when I save, then it is refused naming the missing item.
- **AC-44.** Given existing projects, when the migration has run, then the origin mapping in WS-4 is applied, source links and origin notes are kept, and filters show only the two new origins.

**R&D Tasks**

- **AC-45.** Given the R&D nav, when it renders, then the tab reads "R&D Tasks" and opens the new page.
- **AC-46.** Given I hold `rnd:tasks:create`, when I click Create Task, then I pick Type first; Requirement shows the requirement form, Prototype shows the project form; with neither type picked the form cannot be saved.
- **AC-47.** Given the Requirement form, when I open the Requirement picker, then it lists only requirements I can open whose latest revision is Accepted, each with its R&D ID; an assignee list limited by my "Assign to" rule.
- **AC-48.** Given a Due date before the Start date, when I save, then it is refused with the existing "start date after due date" message.
- **AC-49.** Given I lack `rnd:tasks:create`, when I call create (UI or API), then I get 403 and the button is hidden.
- **AC-50.** Given a task without a checklist, when the assignee sets progress 40, then it saves; given a task with a checklist, then progress equals ticked / total and cannot be typed; progress above 100 or below 0 is refused.
- **AC-51.** Given a task is completed, when it saves, then progress is 100; given it is reopened, then progress is at most 99.
- **AC-52.** Given a due date earlier than today and the task still open, when analytics loads, then it counts as Overdue (not Pending) and shows the days overdue.
- **AC-53.** Given a mix of tasks, when the tiles load, then Pending + Completed + Overdue equals Total (cancelled excluded).
- **AC-54.** Given the filters (project, assigned user, department, type, status, priority, date range, completion progress), when I apply any combination, then tiles, table and grouped views all use the same filtered set; Clear resets them.
- **AC-55.** Given I hold `rnd:tasks:analytics`, when I open the page, then I see all R&D tasks; given I do not, then I see only tasks I am assigned or created; given I am an admin or head, then all.
- **AC-56.** Given By project view, when a project has tasks of 100, 50 and one Cancelled task, then project progress is 75 (cancelled ignored).
- **AC-57.** Given a task row, when I click it, then it opens its detail through a signed ref (never a raw id); an edited link shows "Invalid link".

**PM Create Project and Sales removal**

- **AC-58.** Given I hold `projects:all_projects:create`, when I click + Create Project, then a popup asks New Project or New Prototype; New Project opens the PM form, New Prototype opens the R&D form.
- **AC-59.** Given I lack `rnd:projects:create`, when the popup opens, then New Prototype is disabled with "You need R&D › Prototype / Research create access"; given I lack both rights, then the button is hidden.
- **AC-60.** Given the PM project list, when it loads, then there is no "From Sales Order" button or awaiting count, and the old endpoints return 404/410 with a clear message.
- **AC-61.** Given a New Project, when I add Units (kind, quantity, description), then Production, Store and Quality can pick those Units as before.
- **AC-62.** Given the app after removal, when any user opens the sidebar, then there is no "Sales" entry; "Products" is its own entry and opens the product master for users with products access; the Role editor has no Sales module.
- **AC-63.** Given a role that had `sales:products:*`, when the migration has run, then it still grants Products access (alias), and one that only had `sales:orders:*` has no leftover grant.
- **AC-64.** Given an old bookmark or notification to `/dashboard/sales/...`, when opened, then a page explains "Sales Orders were removed" and links to Project Management; no crash.
- **AC-65.** Given the app starts, when Python imports run on 3.12, then there are no import errors (`ruff --select F821 --target-version py312` clean), and `alembic heads` shows one head.
- **AC-66.** Given existing historic Sales Orders, when Finance, Production, Store or Quality open them, then they still read normally; creating a new order, amendment or approval is impossible.
- **AC-67.** Given an inquiry that has a PM project linked as source, when someone deletes it, then it is refused "linked to project <PEW>".
- **AC-68.** Given R&D roles, when they open PM All Projects, then they have view-only access limited by data scope (open point 6).

**Cross-cutting**

- **AC-69.** Given any failed action in this scope, when it fails, then the message states the reason and the fix, not "Something went wrong".
- **AC-70.** Given every new route, when called without permission or outside data scope, then it returns 403 with who can grant it.
- **AC-71.** Given any new list with a code or ID (R&D ID, tasks), when it loads, then it is sorted ascending by default (backend `order_by` and frontend).
- **AC-72.** Given a double click on Send, Accept, Return, Upload or Create Task, when the request repeats, then only one record is created (Idempotency-Key, `useFormDraft` on create forms).

## 7. Migration and back-fill

| Item | Rule |
|---|---|
| R&D ID | Backfill for every inquiry/tender with `technical_offer_sent_at`, ordered by first-send date, so numbers are ascending. |
| Revisions | One per existing send (from `crm_rnd_requests` and the audit logs): R0 to Rn. |
| Revision status (legacy) | open → Accepted (already in progress, so the review queue is not flooded); responded → Responded; superseded → Superseded. |
| Document categories | As in section 5. |
| Offers | As in WS-2. |
| Priority | As in WS-3. |
| Origin | As in WS-4. |
| Permissions | Role grants for removed features are dropped; `history` stays; `sales:products/pricing` aliased to `products`. |
| Task progress | Default 0; completed = 100; checklist-based where a checklist exists. |
| Tables | Nothing dropped. Share, access, milestone, comment and sales tables stay. |

## 8. Dependencies, notifications, audit

- Impacted modules: CRM (send flow, panels, tours, quotation picker, stage guard), R&D (requirements, offers, tasks, projects, registry), PM (Create Project, Units), Products (re-homed), Finance, Production, Store, Quality, Design, Electrical, Maintenance, P2P, Organization (roles), Sidebar, NotificationBell.
- Shared registries are edited only by the Manager: `main.py`, `alembic/env.py`, `permission_registry.py`, `notification_events.py`, `api.ts`, `types/index.ts`, `useAuth.ts`, Sidebar. Re-read before editing; one linear migration chain.
- Notifications: bell for submitted, accepted, returned, offer released and returned; Teams only for the review-pending reminder (reminders may use Teams).
- Audit events (all written to the audit log, shown on the Timeline): requirement submitted / revision created, accepted, returned (reason), responded, superseded, offer uploaded / released / returned / superseded, BD offer uploaded / deleted, document uploaded / category changed, task created / edited / progress changed / completed / reopened / cancelled, origin changed, project created from the chooser, priority changed.

## 9. Out of scope

- Dropping any database table, including Sales tables (needs a separate owner OK).
- Rewiring Finance billing, credit and receivables to PM projects (Stage 2, separate requirement).
- Excel/PDF export of the task analytics, Gantt or dependencies, duration-weighted progress.
- Changes to the R&D calculators, BD's TOR PDF generation, PM milestones and Work Breakdown.
- A third task table, or merging R&D tasks with PM tasks.
- Admin-editable document categories.
- Using the central approval engine for Accept / Return (see 3H).

## 10. Risks

1. Stage 1 retirement leaves the Sales models and helpers in place, so the code is not fully removed. The owner must understand "deleted" means no longer usable, not gone (3C).
2. New projects without Units or billing source can silently stall Production and Finance (3B, 3C).
3. Priority migration is lossy and cannot be exactly reversed; the largest file count in this change.
4. Loss of the BD / R&D discussion channel; mitigated only by Return from Accepted.
5. Reversal of memory decisions 10-08, 10-09, 10-19, 10-24 (3A, 3F, 3G). Update the memory notes after the owner confirms.
6. Role-editor churn: removed features may leave roles with stale grants; the migration must clean them.
7. Design/EHP people lose their own Requirements pages; their only way in is the task link, so confirm they can open the requirement page without full R&D app access (`is_rnd_side` rules in `requirement_access.py`, verify).
8. CRM tours and the Playwright check are mandatory for UI work (project rules 6 and visual gate).

## 11. Open points with recommended default (the Manager decides)

1. **Priority mapping of High/Critical.** Default: Urgent. Alternative: High → Standard.
2. **Return from Accepted allowed.** Default: yes, before Respond, with reason.
3. **R&D ID format.** Default `RDR-YYYY-NNNN`, revision ID `-R<n>` from R0. (Avoids clash with `RND-YYYY-NNNN` projects and `TO-…` offers.)
4. **Where Sales settings go** (spares, service rates, freight, quotation). Default: Products' gear settings; drop the rest.
5. **Sales removal depth.** Default: Stage 1 retire (3C), Stage 2 later with owner OK. Alternative: do both now (large, risky).
6. **"R&D users can open projects to create tasks."** Default: R&D roles get view-only on PM All Projects (data scope); no PM-project field on R&D tasks in v1; the R&D task project picker covers Prototype / Research projects only. Needs the owner's confirmation of what a task on a PM project means.
7. **PM tasks on the R&D Tasks page.** Default: remove (they stay in PM › My Tasks).
8. **Existing email with the TOR PDF on submit.** Default: keep unchanged ("simple notification" read as no new channels). Alternative: bell only.
9. **Home dashboard Sales tiles.** Default: remove.
10. **Uploaded PDF offers in quotations.** Default: attach separately (3J).
11. **Existing-requirement visibility** (3F). Default: all R&D-side users with view see all; task assignees from other departments see only their requirements.
12. **Review reminder timing.** Default: 2 working days, then every 3 days.
13. **New Project CRM source link.** Default: optional on PM New Project.
14. **Document creation scope.** Default: R&D side only; BD's TOR PDF/Word draft stays.
15. **Milestones removal also on Prototype / Research projects.** Default: yes.

## 12. Suggested role split (order)

1. **Database:** `rnd_requirements` header (R&D ID counter), revision columns, task progress, offer origin and file columns, document category column, priority mapping and origin mapping data migrations, permission-grant migration (aliases and cleanup). One linear chain.
2. **Backend:** intake state machine and gates, accept/return routes, notification events and reminder, offer upload and release, BD offer upload, quotation picker, task create and analytics endpoints, priority validation shared constant, origin validation, Create Project chooser support and manual Units, Sales route and service removal with kept models, stage guard rewrite. The Manager edits registries and `main.py`.
3. **UI/UX:** requirement page (tabs, header actions, Return dialog, Timeline), R&D Tasks page (tiles, filters, grouped views, Create Task by type), chooser popup, Products entry. Playwright before and after.
4. **Frontend:** implement per the UI/UX output, remove deleted pages and components, update types and API, redirect pages for old Sales URLs, CRM tour configs.
5. **QA / Security / Reviewer:** permission-denied and data-scope tests per AC-14, 20, 21, 35, 49, 55, 70; Idempotency; ruff and import checks on Python 3.12; `npm run test:ui`.

---
