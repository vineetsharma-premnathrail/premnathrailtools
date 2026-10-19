# Design Module

The Design module is the company's engineering document control system. It holds every controlled drawing and engineering document (GA drawings, part drawings, schematics, wiring diagrams, hydraulic circuits, specifications, calculations and so on), each with its numbered revisions (R0, R1, R2…), its files, and a signed check and approval trail. It also holds the engineering Bills of Materials (BOMs) that Store, Purchase and Production build from, the design requests other departments bring to Design, customer drawing approval (transmittals), and the formal change process (Engineering Change Request, ECR, then Engineering Change Notice, ECN). In the core business flow (Customer → BD → R&D → Design/EHP → BOM → Store/Purchase → Production → QC → Dispatch → Commissioning → Machine → Service → Finance), Design sits right after R&D: it takes BD and R&D requirements, produces released drawings and the released BOM, and hands those to Store, Purchase and Production. Later changes asked for by Production, Quality, Purchase, Service or customers come back into Design as ECRs.

## 1. Navigation Tabs

The sub-nav sits at the top of every Design page, above the page header. Each tab is shown only if the user has view access to that tab (role permissions). On the right of the sub-nav there is a guided-tour button and the notification bell.

| Tab | Route | What it opens |
|---|---|---|
| Dashboard | /dashboard/design | Design dashboard: my-work counters, drawing / BOM / change counters, waiting-on-me list, recent releases, customer waits, stuck items, team workload |
| Requests | /dashboard/design/project-work | Register of design requests (work brought to Design) plus Design WBS evidence. Request detail pages (/dashboard/design/requests/…) also highlight this tab |
| Requirements | /dashboard/design/requirements | Customer requirements the R&D head shared with Design for a feasibility reply |
| My Work | /dashboard/design/tasks | My Project Management tasks with linked deliverables, and all review / approval / change queues waiting on me |
| Drawings | /dashboard/design/documents | Document Register (all drawings and documents) |
| BOMs | /dashboard/design/boms | Bills of Materials register, new-item-code requests and where-used search |
| Reviews & Approvals | /dashboard/design/reviews | Internal checks waiting on me, drawings waiting on the customer, customer submission (transmittal) register |
| Changes | /dashboard/design/change-notices | Change requests (ECR) and change notices (ECN). ECR pages (/dashboard/design/change-requests/…) also highlight this tab |
| Library | /dashboard/design/library | Standards, standard parts, approved makes, templates, review checklists |
| Reports | /dashboard/design/reports | Master Document List export and Design reports |
| Settings | /dashboard/design/settings | Design team roles, default approver, time limits, change board, ECN acknowledgers |

Note: the old link /dashboard/design/ongoing-projects is not in the sub-nav. It only redirects to the company-wide Ongoing Projects page (/dashboard/ongoing-projects), keeping an opened project if one was in the link.

## 2. Dashboard

Route /dashboard/design. Header: "Design Module" / "Engineering Document Control" and "Your role: …" (Design head, Reviewer (senior designer), Designer, Viewer (other department) or Admin). All counts respect the user's data scope (records they own or are assigned to, unless their role has wider scope).

**Actions:** "+ New Document" button (top right) opens the New Document form. It is hidden for viewers (people with the Design app who are not on the Design team).

### My work (4 cards)

| Card | What it shows | How computed | Click |
|---|---|---|---|
| Waiting on me | Number of items needing my action ("checks, approvals, votes & returns") | Sum of all my queues: drawings to check / approve / returned to me / ready to release, BOMs to check / approve / returned to me, ECR votes and ECRs to progress, ECNs to approve and to acknowledge, customer comments assigned to me. Shown orange when above zero | Opens My Work |
| My PM tasks this week | Open Project Management tasks assigned to me due in the next 7 days; sub-line "N overdue" | PM tasks with me as assignee and an open status. Red when any overdue | Opens My Work |
| Requests waiting on Design | Active design requests whose "waiting on" is Design; sub-line "N overdue" | Active = open, accepted, in progress, on hold. Overdue = due date before today | Opens Requests |
| Customer approvals pending | Customer submissions in status "sent"; sub-line "N overdue · oldest N d" | Overdue = response due date before today. Oldest = days since the earliest sent date | Opens Reviews & Approvals |

### Drawings (8 cards in two rows)

| Card | What it shows | Click |
|---|---|---|
| Active documents | Documents with status active; sub-line "N released" (display status released or released · revising) | Opens Drawings register |
| Released this month | Revisions released since the 1st of the current month | No link |
| Drafts | Open revisions in draft | Drawings register filtered to Draft |
| In review | Open revisions in check | Drawings register filtered to In Review |
| In approval | Open revisions awaiting approval | Drawings register filtered to In Approval |
| Stuck > N days | Drawing and BOM revisions in review or approval for at least N days (N = "Review overdue after (days)" in Settings, default 7) | No link |
| BOMs in workflow | BOM revisions in check or awaiting release; sub-line "N released BOMs" | Opens BOMs |
| Open change notices | ECNs in draft, submitted or approved (open) status | Opens Changes |

### Changes (2 cards)

| Card | What it shows | Click |
|---|---|---|
| Open change requests (ECR) | ECRs in "Open (impact check)" or "With change board" | Opens Changes |
| ECNs awaiting acknowledgement | ECNs released and waiting for department acknowledgement | Opens Changes |

### Waiting on me

Up to 12 items from my queues, longest-waiting first. Each row shows the reference (drawing number + revision, BOM number + revision, ECR number, ECN number, or the customer comment text), the title and "by <author>", days waiting ("today" or "Nd", red at 7 days or more), and a coloured badge: Check, Approve, Returned to you, ECN approval, ECN to implement, BOM check, BOM approval, BOM returned, ECR vote, ECR impact check, ECR decision, ECN acknowledge, Release (customer approved), Customer comment. Empty text: "Nothing needs your action right now."

**Actions:** clicking a row opens the related drawing, BOM, ECR, ECN or submission page.

### Recently released

The last 8 released drawing revisions: drawing number + revision, title, release date and the approver's name. Empty text tells the user to create a document, upload its drawing and submit it for check.

**Actions:** click a row to open the drawing.

### Waiting on customers (shown only when there are sent submissions)

Up to 8 sent customer submissions, oldest first: submission number, customer name, days waiting ("sent today" or "N days") and "overdue" in red when past the response due date.

**Actions:** click a row to open the submission.

### Stuck in workflow (over N days) (shown only when something is stuck)

Up to 10 drawing and BOM revisions sitting in check or approval for at least the overdue days. Same row layout as Waiting on me.

**Actions:** click a row to open the record.

### Team workload (shown only when a Design team is set up in Settings)

| Column | What it shows |
|---|---|
| Person | Team member name |
| Role | Design head / Reviewer / Designer |
| Open PM tasks | Open Project Management tasks assigned to them |
| Overdue | Of those, how many are past due (red, bold when above zero) |
| Draft revisions | Drawing revisions they authored that are still draft |
| Drawings to check | Drawing revisions in check where they are the named checker |

Sorted by total load (tasks + drafts + checks), highest first. No actions.

## 3. Screens

### Requests (/dashboard/design/project-work)

Header "Requests": work brought to Design by BD, projects and R&D, and the evidence for each design WBS element in Project Management.

#### List view

Status chips: Active (open, accepted, in progress, on hold; default), Open, Accepted, In progress, On hold, Completed, Cancelled, All.

Filters: search box ("Search by request number, title or CRM reference…"), Source dropdown (All sources, BD / CRM, Project, R&D hand-over, Internal), Waiting dropdown (Waiting on anyone, Waiting on Design, Waiting on requester), "Mine (lead / raised by me)" checkbox, a request count, and a Refresh button.

| Column | What it shows |
|---|---|
| Request | Request number (DRQ-YYYY-NNNN) and a priority badge (Low / Medium / High / Urgent) |
| Title | Title; an orange "Requirement changed · rev N" flag when the requirement was revised after the lead designer last confirmed reading it |
| Source | BD / CRM, Project, R&D hand-over or Internal |
| Customer / CRM | Customer name and the CRM inquiry / tender reference |
| Project / WBS | Project (or machine) and the WBS element |
| Lead Designer | Lead designer, or "Not assigned" |
| Due | Due date; "overdue" in red if past due while active |
| Waiting On | Badge "Design" or "Requester" (dash when completed / cancelled) |
| Status | Open, Accepted, In progress, On hold, Completed, Cancelled |
| Deliverables | "N / M released" (drawings and BOMs linked to the request), or "none yet" |
| (last) | View link |

Row click or View opens the request detail page.

**Top button:** "+ New Request" opens the inline create form (any user with the Design app, including BD, can raise a request).

#### Create form (inline "New design request")

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Title | text | Yes | Free text | At least 3 characters |
| Source | dropdown | Yes | BD / CRM, Project (default), R&D hand-over, Internal | Fixed after creation |
| Priority | dropdown | No | Low, Medium (default), High, Urgent | |
| Due date | date | No | Date picker | |
| CRM record | dropdown | No (only when Source = BD / CRM) | Inquiry or Tender | |
| Inquiry / Tender | searchable dropdown | No (only for BD) | CRM inquiries or tenders | Picking one fills the Customer from its organisation if Customer is empty; the reference is stored on the request |
| Customer | searchable dropdown | No | CRM organisations | Must exist in CRM |
| Project | searchable dropdown | No | Project Management projects | Changing it clears the WBS |
| WBS | searchable dropdown | No | WBS elements (milestones) of the chosen project | Disabled until a project is picked; must belong to the selected project |
| Lead designer | searchable dropdown | No | Users holding the Design app | Hint: the Design head can assign this when accepting |
| Technical requirement | long text | Yes | Free text | At least 5 characters. Saved as requirement revision 0 ("Original requirement") |

Buttons: "Create Request" (opens the new request's page), Cancel.

On create: status Open, waiting on Design. The Design head(s) get a bell notification "New design request"; the lead designer (if named) gets "Design request assigned".

#### Design WBS elements (lower section of the same page)

Shows Project Management WBS elements (milestones) owned by the Design department, with an "Include closed" checkbox (by default achieved and cancelled ones are hidden). Each card shows: WBS title, project, target date ("overdue" if past and not submitted / achieved / cancelled), PM status badge (Not started, In progress, Submitted, Achieved, Cancelled), and an "Evidence complete" badge when there are released deliverables, no pending documents and no customer approvals pending. Three blocks: "Released drawings & BOMs · N" (chips with number and released revision), "Pending documents · N", and "Customer approvals pending" (count of drawings with a revision approved but waiting on the customer). Evidence comes from drawings / BOMs linked to requests on that WBS and from deliverables linked to its PM tasks. Clicking a chip opens the drawing or BOM. This is read-only; the WBS itself is submitted in Project Management.

### Request detail (/dashboard/design/requests/<ref>)

#### View page

Header: "Design Request · <source>", request number, title, status badge; priority badge; "Due <date>" (· overdue); while active, "Waiting on Design" or "Waiting on <requester>" with the waiting note. "← Back" returns to Requests.

Banners:
- "Requirement changed since your review" (rev N, revised date, last change note) with an "I've reviewed it" button for the lead designer or Design head.
- "On hold: <reason>" when on hold; "Cancelled on <date>: <reason>" when cancelled.

Left column:
- Technical requirement · rev N: the current requirement text; "Last revised …" and whether Design has reviewed it; "Show revision history (N)" lists every revision with number, who, when, change note and text.
- Deliverables · released / total: table Type (Drawing / BOM), Number, Title, Released rev, Status. Buttons "+ New drawing for this request" and "+ New BOM" (team members only, while the request is active) open the New Document / New BOM forms with the request pre-linked (customer and project carried over).

Right column, Details:

| Field | Meaning |
|---|---|
| Source | Where the work came from |
| CRM reference | Inquiry / tender reference (only if set) |
| Customer | CRM organisation |
| Project / WBS | Linked project and WBS element |
| Machine | Linked machine (only if set) |
| Lead designer | Person responsible, or "Not assigned" |
| Raised by | Requester and date |
| Completed / Cancelled | Closing date-time (only when closed) |

Timeline: comment box with Post (anyone who can open the request), and events such as raised the request, accepted, started work, put it on hold, revised the requirement, reviewed the revised requirement, set it waiting on Design / requester, created a drawing / BOM for it (clickable), commented.

#### Action buttons and when they appear

| Button | When shown | What it does |
|---|---|---|
| Accept | Design head, status Open | Confirmation; refused if no lead designer. Status → Accepted. Requester and lead designer notified |
| Start Work | Design head, status Accepted | Status → In progress; requester notified |
| Resume | Design head, status On hold | Status → In progress |
| Mark Completed | Design head when Accepted or In progress; lead designer when In progress | Confirmation warns if deliverables are not all released. Status → Completed |
| Waiting on Requester… / Back with Design… | Design head, requester or lead designer, while active | Radio Design / Requester and a note (required when setting to requester). Requester is notified "Design needs input"; switching back notifies the lead designer "Input received" |
| Revise Requirement | Design head or requester, while active | New requirement text (must differ, at least 5 characters) and a change note (at least 3 characters). Revision number increases; lead designer and Design head notified and must confirm review |
| Put on Hold | Design head, when Open / Accepted / In progress | Reason required |
| Reopen | Design head, when Completed or Cancelled | Reason required; status → In progress |
| Cancel Request | Design head, while active | Reason required |

#### Edit

"Edit" in Details (Design head or requester, while active). Editable: Title (at least 3 characters), Priority, Due date, Lead designer, Customer, Project, WBS, Machine. Source and CRM reference are fixed. The requirement changes only through "Revise Requirement". A newly named lead designer is notified.

#### Statuses & workflow

Open → Accepted (head assigns a lead designer) → In progress → Completed. On hold and Cancelled need a reason; completed / cancelled requests can be reopened to In progress. Each status change notifies the requester (bell).

### Requirements (/dashboard/design/requirements)

Customer requirements (CRM inquiries / tenders) that the R&D head shared with Design for a feasibility reply. The same shared screen is used by Electrical and Hydraulic & Pneumatic.

#### List view

Header text shows how many are awaiting reply and how many are overdue. Search box ("Search offer no., customer, product…") and filter chips: Awaiting reply (default), Replied, All.

| Column | What it shows |
|---|---|
| Requirement | Offer number (or universal id) and the requirement title |
| Customer | Customer organisation |
| R&D asks | R&D's note to Design, who shared it and when |
| Reply by | Reply-by date |
| Status | Awaiting reply, Reply overdue, the reply given (Feasible / Feasible with changes / Not feasible), or "Replaced by newer request" |

Row click opens the requirement.

### Requirement detail (/dashboard/design/requirements/<ref>)

Header: offer number, Inquiry / Tender id, priority, title, customer and share date, "← Back". A strip shows who shared it with Design, the reply-by date, a status chip and a "Reply →" shortcut when the user may reply. A warning appears if CRM edited the requirement after it was sent to R&D.

Tabs:
- **Requirement:** "What R&D needs from Design" (the note, who, when, reply-by, overdue); Technical Offer Request to R&D (offer number, sent date, links to the TOR files); Customer (organisation, type, city / state) and Contact Person (name, designation, department, mobile, email); From CRM (BD owner, CRM status, priority); Product Requirement / Tender Details (all CRM requirement fields, read-only).
- **Tasks & Departments, Documents, Discussion:** the same shared tabs R&D works in for this requirement (every department's tasks, documents and the discussion thread), with rights as given by the R&D requirement access rules.
- **Reply to R&D:** when open and the user may reply: pick Feasible, Feasible with changes or Not feasible; Remarks (required unless Feasible); optional attached files; "Send reply to R&D". The reply goes to the R&D head and cannot be edited afterwards. When already replied it shows the reply, who and when, remarks and files. When replaced, it says a newer request exists. "Earlier requests on this requirement" lists older shares.

Replying needs the "edit" right on Design › Requirements; otherwise the tab says the user can read but not reply.

### My Work (/dashboard/design/tasks)

Header line: number of project tasks (and overdue), and how many review / approval items need action.

#### My project tasks

Project Management tasks assigned to me, with a "Show closed tasks" checkbox.

| Column | What it shows |
|---|---|
| Project / WBS | Project and WBS element |
| Task | Task title; badges for priority (when not medium), "Requirement changed", and "Ready to close in Project Management" (every linked deliverable released) |
| Due | Due date; "overdue" |
| Status | To do, In progress, Blocked, Done, Cancelled |
| Deliverables | Linked drawings / BOMs with their status badge and "rel. Rn" or "not released"; an Unlink button on each |
| (last) | "+ Link deliverable" / Cancel |

**Actions:** "+ Link deliverable" opens a row with a Drawing / BOM selector, a searchable picker and Link. Only the task's assignee or the Design head can link or unlink; a deliverable cannot be linked twice. Unlink asks for confirmation (the drawing / BOM itself is not changed). The task itself is closed in Project Management, not here.

#### Reviews, approvals & changes

One card per queue, each with a count and hint. Rows show the reference and title, days waiting, "by <author> · since <date>" and any comment; clicking opens the record.

| Queue | Meaning |
|---|---|
| Drawings to check | I am the named checker of a revision in check |
| Drawings to approve | Checked revisions waiting for my approval |
| Drawings returned to me | My revisions returned to draft — fix and resubmit |
| Ready to release | Customer-approved revisions I can release |
| BOMs to check / BOMs to approve / BOMs returned to me | Same three steps for BOM revisions |
| Customer comments | Customer comment actions assigned to me |
| Change requests to vote on | ECRs where I sit on the change board |
| Change requests to progress | ECRs waiting for an impact check or the head's decision |
| Change notices to decide | ECNs where I am the named approver |
| Change notices to release | My open ECNs to release once every affected item is released |
| Change notices to acknowledge | Released ECNs my department must acknowledge |
| My drafts | My draft revisions not yet submitted |

### Drawings — Document Register (/dashboard/design/documents)

#### List view

Status chips: Active (default: everything except obsolete), Released (released and released · revising), In Workflow (in review + in approval), In Review, In Approval, Awaiting Customer, Customer Rejected, Draft, Obsolete, All. The dashboard can open this page with a status pre-selected.

Filters: search ("Search by number, legacy number, title or description…"), type dropdown (All types + the 16 document types), discipline dropdown (All disciplines + 8 disciplines), document count.

| Column | What it shows |
|---|---|
| Doc Number | Register number; "old: <legacy number>" underneath if migrated |
| Title | Title; project or machine underneath |
| Type | Document type |
| Discipline | Discipline |
| Customer | Customer name and "approval required" when customer approval is needed |
| Controlled Rev | Released revision and release date, or "Not released" |
| Work in Progress | Open revision label and its state (draft, in review, in approval, awaiting customer) and "with <person>" |
| Owner | Responsible engineer |
| Status | Draft, In Review, In Approval, Approved · awaiting customer, Released, Released · Revising, Customer rejected, Obsolete |
| (last) | View link |

Viewers (not on the Design team) only see documents that have a released (or superseded) revision. Row click or View opens the document.

**Top button:** "+ New Document" (hidden for viewers).

#### Create form (/dashboard/design/documents/new)

Creates the document with its first revision R0. The number is generated from the type: <prefix>-<year>-<4-digit sequence>, prefixes GA (GA Drawing), DWG (Part Drawing), ASM (Assembly Drawing), SCH (Schematic), SPC (Specification), CAL (Calculation), DS (Datasheet), PRC (Procedure), MAN (Manual), BOM (BOM), WD (Wiring Diagram), HRN (Harness Drawing), HYC (Hydraulic Circuit), PNC (Pneumatic Circuit), PNL (Panel Layout), DOC (Other). Only Design team members can create documents. "← Back" top right. Opening the form from a design request (…/new?request_id=…) pre-selects that request and fills its customer and project.

Section Document:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Title | text | Yes | Free text | At least 2 characters, max 255 |
| Type | dropdown | Yes | 16 document types (default Part Drawing) | Fixed after creation (baked into the number) |
| Discipline | dropdown | Yes | Mechanical (default), Electrical, Hydraulic, Pneumatic, Structural, Civil, Instrumentation, General | |
| Legacy drawing number | text | No | Old number when migrated | Max 100; stays searchable |
| Standard | searchable dropdown | No | Library standards | Must still be in the library |
| Description | long text | No | Scope, variant, key notes | |

Section Associations:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Project | searchable dropdown | No | Project Management projects | Must exist |
| Machine (RRV / asset) | searchable dropdown | No | Machines | Must exist |
| Part (Store item) | searchable dropdown | No | First 200 Item Master items | "Part not in the list? Search Item Master" box + Search loads more by code / name / part number |
| Department | searchable dropdown | No | Departments | |
| Design request | searchable dropdown | No | Requests with status open, accepted, in progress, on hold | Picking one fills customer / project / machine where still empty; makes the drawing a deliverable of the request |

Section Customer:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Customer | searchable dropdown | No | CRM organisations | |
| Customer approval required | checkbox | No | | Needs a customer. When ticked, internal approval stops at "Approved · awaiting customer" and the revision is released only after customer approval on a submission |

Section R0 — sign-off:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Owner (responsible engineer) | searchable dropdown | No | Users with the Design app | Defaults to the creator |
| Checked by | searchable dropdown | Only if submitting now | Users with the Design app, excluding me | Checker ≠ approver; neither can be the author; must be active with the Design app; when a team is set up the checker must be a reviewer or head |
| Approved by | searchable dropdown | Only if submitting now | Same list | When a team is set up the approver must be a Design head. If left blank, the default approver from Settings is used (unless that is me or the checker) |
| Issue note | text | No | Defaults to "Initial issue" | |

Section Files:

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Add as | dropdown | — | Controlled print (PDF), Native / CAD source, Supporting | Role given to the next files picked; each staged file's role can be changed |
| Choose files | file (multiple) | Only if submitting now | .pdf .dwg .dxf .step .stp .iges .igs .stl .sldprt .sldasm .slddrw .ipt .iam .idw .x_t .zip .doc .docx .xls .xlsx .png .jpg .jpeg | Duplicate names skipped; each staged file has a remove (×) |

Bottom: "Submit R0 for check now" checkbox (ticked by default), Cancel, and "Create & Submit" / "Create Draft". If ticked, both signatories and at least one file are needed. After creation, files upload to SharePoint (Design-media/<doc number>/<revision>/) and, if ticked, R0 is submitted. Upload or submit problems do not undo creation; they show as a notice on the document page.

#### View page (/dashboard/design/documents/<ref>)

Header: type · discipline, document number, title, status pill; "Controlled revision: Rn (released date)" and the open revision with its state and who it is with. "← Back".

Banners: obsolete ("Obsolete — not for use", by whom, when, reason); viewer note ("You're viewing released revisions only…"); customer wait note when the open revision is approved and waiting on the customer; superseded / customer-rejected notes on a selected old revision.

Check & approval panel: the central approval panel (stages from Organization › Approval Workflows, "Drawing / document revision release") showing the approval steps and letting the current approver act. Hidden for viewers.

Left column:
- Revision selector (one button per revision). For the selected revision: label, status pill, "returned N×", "under ECN-…" link, and "Edit revision" (open draft only).
- Revision info: Change summary, Prepared by (author · date), Checked by (name · date, or named checker "(pending)"), Approved by (same), Released (date-time), Checker remarks, Approver remarks.
- Files: name, role, size, uploaded by, date, with Open and Download; Remove and an upload area (Add as + Upload files) only on the open draft for its author, owner or admin. Files of non-released revisions are only open to the Design team.
- Revision history table: Rev, Status, Change summary (with ECN), Prepared, Checked, Approved, Released (with "by" if released by someone other than the approver, and superseded date), Checklist (number of answers and Not OK count, expandable per check cycle with each item's result and remark).
- Customer submissions (team only, when customer approval is required or submissions exist): Transmittal, Rev, Status, Sent, Customer response (+ comment), Responded. Row opens the submission.
- Where used: BOM lines that use this drawing: BOM (number, title), Rev (status), Product, Qty, Project / Machine. Row opens the BOM.

Right column, Details:

| Field | Meaning |
|---|---|
| Description | Free text (only if set) |
| Owner | Responsible engineer |
| Project / Machine | Linked project and machine |
| Part (Store item) | Linked Item Master item |
| Department | Linked department |
| Customer | Customer, with "· approval required" |
| Standard | Standard the drawing is made to |
| Design request | Link to the request |
| Legacy number | Old number (only if set) |
| Created | Creator and date |
| Approved change notices | ECNs in Open status listing this document (links) |

Timeline: comment box ("Comment on Rn…") and Post; events such as created, submitted for check, passed the check, returned it, approved and released it, approved it — now awaiting the customer, sent it to the customer, recorded customer approval / rejection, released it after customer approval, superseded, obsoleted, reactivated, file added / removed, commented. Viewers see only events on released revisions.

#### Action buttons and when they appear

| Button | When shown | What it does |
|---|---|---|
| Submit Rn for Check | Open revision is draft; user is its author, the document owner, creator or admin; document not obsolete | Confirmation. Needs checker and approver, at least one file, and (from R1 on) a change summary; a linked ECN must still be Open. Revision → In review; signatures reset; request sent to the approval engine (checker stage, then approver stage) |
| Check against Checklist | Revision in review, user may act on the check stage, and an active checklist exists for the type / discipline | Dialog: answer every item OK / Not OK / N/A with optional remark, plus a check comment. Pass needs every item answered and none Not OK; Return needs a comment |
| Pass Check / Return to Author | Revision in review, no checklist, old (pre-engine) path only | Pass moves it to approval; Return needs a reason and sends it back to draft |
| Approve & Release / Approve for Customer | Revision in approval, old path only | Releases it (or, when customer approval is required, sets "Approved · awaiting customer") |
| Return to Author (approval) | Revision in approval, old path only | Reason required; back to draft |
| Release Rn | Revision is "Approved · awaiting customer"; user is Design head, the revision's approver or admin | Needs a submission line recording Approved or Approved with comments for this exact revision. Releases it |
| Recall to Draft | Revision in review or approval; author, owner, creator or admin | Optional reason; back to draft; waiting people told no action needed |
| + New Revision | No open revision; a released (or customer-rejected) revision exists; not obsolete; team member | Panel: Change summary (required, min 3 characters), Checked by, Approved by, Under change notice (only Open ECNs listing this document). Creates Rn+1 as draft |
| Discard Rn | Open revision is a draft that is not the first one (an earlier revision was released, superseded or customer-rejected); author, owner or admin, and delete permission | Removes the draft and its files |
| Mark Obsolete | Ever released (or customer-rejected), no open revision; owner or admin | Reason required. Document withdrawn from use; revisions kept |
| Reactivate | Document obsolete; admin only | Becomes active again |
| Delete Document | Never released, nothing approved / customer-rejected, open revision still draft; owner, creator or admin with delete permission | Deletes the document and its draft files (also removed from SharePoint) |
| Raise ECR | Any user (including viewers) when a released revision exists | Opens the ECR form with this drawing pre-added |

With the approval engine (all revisions submitted after the cut-over), Check and Approve decisions are made on the approval panel by whoever the engine allows on the current stage (named person, delegate, escalation target or admin). The checker still uses "Check against Checklist" when a checklist exists; the engine refuses to pass the check stage on the panel if a checklist exists and was not answered.

#### Edit

- **Details** ("Edit" in Details): owner, creator or admin, document not obsolete. Editable: Title (cannot be empty), Description, Discipline, Owner (required), Project, Machine, Part (Store item, with Item Master search), Department, Customer, Customer approval required, Standard, Design request, Legacy drawing number. Type and number are never editable.
- **Revision** ("Edit revision"): only while the open revision is draft; author, owner or admin. Editable: Change summary (required from R1), Checked by, Approved by, Under change notice. Files can be added / removed only on the draft. Once submitted, everything is locked until it is returned, recalled or released. Released files are the controlled record and never change.

#### Statuses & workflow

Revision statuses: Draft → In Review (submitted) → In Approval (check passed) → Released; or, when customer approval is required, In Approval → Approved · awaiting customer → Released (after the customer approves on a submission) or Customer rejected (frozen; fix goes out as the next revision). Returning (by checker or approver) or recalling puts it back to Draft and increases the return count. Releasing a revision supersedes the previous released one. Only one revision can be open at a time.

Document display status: Draft / In Review / In Approval / Approved · awaiting customer (from the open revision), Released, Released · Revising (released with a new revision open), Customer rejected, Obsolete.

Rules: four-eyes — checker and approver are two different people, neither is the author, and the person who checked cannot also give the approval (even as admin). With a Design team set up, checkers must be reviewers or heads and approvers must be heads.

Notifications (bell): approval-engine requests to the checker / approver of each stage; returns to the author (and to the checker when returned at approval); release to author, checker and owner; "Ready for customer approval" to author, owner and Design heads; recall to the people who were waiting.

### BOMs (/dashboard/design/boms)

Header "Bills of Materials": one engineering BOM per product item, revision-controlled like drawings; released BOMs are what Store and Purchase build from.

#### List view

New item codes requested (shown only when any exist): a collapsible panel "New item codes requested · N" listing BOM lines waiting for Store to create the Item Master code — BOM (link) and revision, New item, Specification, UOM, Requested by, Requested date.

Status chips: Active (default), Released, In Workflow, Draft, Obsolete, All. Search: "Search by BOM number, title or product item…", with a BOM count.

| Column | What it shows |
|---|---|
| BOM No. | BOM-YYYY-NNNN |
| Product item | Item code — name |
| Title | Title; GA drawing number underneath |
| Project | Project or machine |
| Released Rev | Released revision and date, or "Not released" |
| Work in Progress | Open revision (draft, in check, awaiting release) and who it is with |
| Lines | Number of lines |
| Owner | BOM owner |
| Status | Draft, In check, Awaiting release, Released, Released · revising, Superseded, Obsolete |
| (last) | View link |

Viewers see released BOMs only.

**Top button:** "+ New BOM" (hidden for viewers).

#### Where used (lower section of the list page)

Pick Item or Drawing, then pick from the list (or search for one not listed). Result: the subject; "Has its own BOM (sub-assembly)" links; a table Used in BOM (link), Revision (status), Product, Qty, Project / machine; plus Drawings and Projects lists.

#### Create form (/dashboard/design/boms/new)

One BOM per product item, single level; starts as draft R0. Viewers see a view-only warning and the Create button is disabled. Opened from a request, it links the request and copies its project and machine. "← Back" returns to the request or BOM list.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Product item (assembly) | searchable dropdown | Yes | Item Master (first 200, plus "Not in the list? Search Item Master") | Must be active in Item Master; cannot change after creation |
| Title | text | Yes | Free text | At least 2 characters |
| GA / assembly drawing | searchable dropdown | No | Design documents | Must exist |
| Description | long text | No | | |
| Project | searchable dropdown | No | PM projects | |
| Machine | searchable dropdown | No | Machines | |
| Design request | searchable dropdown | No | Active requests | |
| Checked by | searchable dropdown | No | Users with Design app, excluding me | Same four-eyes and role rules as drawings |
| Approved (released) by | searchable dropdown | No | Same | If blank, the Settings default approver is used |
| Copy lines from another BOM | searchable dropdown | No | Existing BOMs | Copies the released revision's lines (or the open one); editable afterwards |
| Lines | line editor | — | See below | Every line needs an item or a new-item name; quantity > 0; unique whole-number positions; a BOM cannot list its own product |

Line editor columns: Pos. (whole number, default 10, 20, 30…), Item (Item Master picker, or tick "New item (not in Item Master yet)" to enter a New item name (min 2 characters) and Specification), Qty (decimal > 0, default 1), UOM (default Nos, max 20), Drawing (optional design document), Make / Buy (default Buy), Remarks, and ↑ / ↓ / × buttons. Below: "+ Add line", "Renumber 10, 20, 30…", line count, and a search box to load more Item Master items.

Button: "Create BOM (draft R0)". New-item lines send a bell broadcast to Store app holders asking for item codes.

#### View page (/dashboard/design/boms/<ref>)

Header: "Bill of Materials · <product code — name>", BOM number, title, status pill; controlled revision and open revision state. Banners for viewer access, obsolete (with reason), and superseded revision.

Check & release approval panel (central approval engine, "BOM revision release"), hidden for viewers.

Left column:
- Revision selector; selected revision label, status, "returned N×", "under ECN" link, "Edit revision & lines" (draft only).
- Revision info: Change summary, Prepared by, Checked by, Released by, Released, Checker / Approver remarks.
- Lines table: Pos., Item (code — name, item status if not active; for new-item lines "New item: …", spec, "Waiting for Store to create the item code (asked <date>)"; a ⚠ release-blocker message when the line blocks release), Qty, UOM, Drawing (link + drawing revision: frozen at release for released / superseded revisions, otherwise the drawing's current released revision or "not released"), Make / Buy, Approved makes (from the Library), Sub-assembly (link to the item's own BOM), Remarks. A note counts lines that block release.
- Check results (checklist answers with cycle and reviewer).
- Multi-level explosion (Show / Hide): Level (with path), Item, Qty / assy, Total qty, UOM, Make / Buy, Drawing + rev, Sub-BOM link — exploded through each line item's own released BOM.
- Revision history: Rev, Status, Change summary (ECN), Lines, Prepared, Checked, Released (who · date, superseded date).

Right column: Details (Product item, Description, GA / assembly drawing link, Owner, Project, Machine, Design request link, Created, Open change notices); Where used (other BOMs using this product item, with revision, status, qty, title and project); Timeline with comment box (events: created, updated, submitted for check, recalled, passed / returned the check, returned from approval, released, superseded, obsoleted, reactivated, revision started / edited / discarded, commented).

#### Action buttons and when they appear

| Button | When shown | What it does |
|---|---|---|
| Submit Rn for Check | Draft open revision; author, owner, creator or admin | Panel: Checked by *, Approved (released) by *, Note to the checker. Needs at least one line and (from R1) a change summary. Goes to the approval engine |
| Check Rn | Revision in check and user may act | Panel with the BOM checklist (if one exists in the Library) — every item answered, no Not OK to pass — and check remarks (required to return). Pass / Return to Author |
| Release Rn / Return to Author | Revision awaiting release, old (pre-engine) path only | Release checks blockers; Return needs a reason |
| Recall to Draft | In check or awaiting release; author, owner or admin | Confirmation; waiting person notified |
| + New Revision | No open revision, a released revision exists, not obsolete, team member | Change summary (required), Checked by, Approved by, Under change notice (Open ECNs listing this BOM). The new draft starts with the released lines |
| Discard Rn | Draft that is not the first revision; author, owner or admin with delete right | Removes the draft and its lines |
| Export Rn (CSV) | Always (including viewers, for visible revisions) | Downloads the multi-level BOM sheet: Level, Position, Item Code, Item Name, Qty / Assy, Total Qty, UOM, Make/Buy, Drawing, Drawing Rev, Sub-BOM |
| Raise Change Request | Anyone, when a released revision exists | Opens the ECR form with this BOM pre-added |
| Mark Obsolete | Ever released, no open revision; owner or admin | Reason required |
| Reactivate | Obsolete; admin only | |
| Delete BOM | Never released and open revision is draft; owner, creator or admin with delete right | Deletes it with its draft lines |

#### Edit

- Details ("Edit"): owner, creator or admin, not obsolete. Editable: Title (min 2), Description, GA / assembly drawing, Owner (required), Project, Machine, Design request. Product item cannot change.
- Revision & lines: draft only. Change summary, Checked by, Approved by, Under change notice, and all lines through the line editor. New new-item names trigger a fresh request to Store.

#### Statuses & workflow

Draft → In check (submitted) → Awaiting release (check passed) → Released; returns and recalls go back to Draft. Release is blocked while any line has no item code, an item that is not active in Item Master, a deleted or obsolete drawing, or a drawing with no released revision. At release, each line's drawing revision is frozen, the previous released revision is superseded, author / checker / owner are notified, and a bell broadcast goes to Store ("material planning"), Purchase (P2P, "purchasing") and Production app holders ("BOM released …").

### Reviews & Approvals (/dashboard/design/reviews)

#### List view

**Internal reviews — waiting on you:** a table of my queues in workflow order — Step badge (Check drawing, Approve drawing, Check BOM, Approve BOM, Release (customer approved)), Drawing / BOM (number + title), Rev, From (author), Waiting (days). Row click opens the record. Shown to everyone.

**Approved — waiting on the customer** (team only): drawing revisions approved internally that need customer approval and are not yet on an open submission. Click opens the drawing.

**Customer submissions** (team only): status chips Open (draft + sent, default), With customer, Draft, Closed, Cancelled, All; an "Overdue only" toggle; search by submission number or customer.

| Column | What it shows |
|---|---|
| Submission | TRN-YYYY-NNNN |
| Customer | Customer name |
| Project | Project or machine |
| Drawings | Number of drawing lines |
| Sent | Sent date |
| Due | Response due date, "· overdue" |
| Waiting | Days waiting (while sent) |
| Response | Customer response date |
| Turnaround | Days from sent to response |
| Open comments | Open customer comment actions |
| Status | Draft, With customer, Closed, Cancelled |
| (last) | View |

**Top button:** "+ New submission" (hidden for viewers).

#### Create form (/dashboard/design/reviews/submissions/new)

Saved as a draft transmittal. Only Design team members can prepare one.

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Customer | searchable dropdown | Yes (or name) | CRM organisations, or "Not in the customer list" | Filters the drawing list to that customer |
| Customer name | text | Yes when no customer picked | Free text (e.g. RDSO, Lucknow) | At least 2 characters, max 255 |
| Contact name | text | No | | Max 255 |
| Contact email | email | No | | Max 255 |
| Project | searchable dropdown | No | PM projects | |
| Machine | searchable dropdown | No | Machines | |
| Cover note | long text | No | | Max 8000 |
| Drawings to send | search + chips | Yes (at least one) | Revisions approved internally and waiting on this customer (or any customer) | Only "Approved · awaiting customer" revisions; one revision per drawing; a revision already on another open submission is refused. Up to 12 available ones show as "+" quick-add buttons |

Button: "Save Draft" (opens the new submission).

#### View page (/dashboard/design/reviews/submissions/<ref>)

Header: "Customer submission", number, customer, status badge, Overdue badge; drawing count, sent date / "not sent yet", response due date, days waiting. Cancelled banner with reason.

Drawings table: Drawing, Title, Rev, Revision status, Customer response (Pending / Approved / Approved with comments / Rejected), Comment. Row opens the drawing.

Customer comment actions: table Comment (with date), Drawing (link), Assigned to, Status (Open / Done), Resolution (with who and when closed), Close button. "+ Add action" (team members, once sent and not cancelled): Drawing (or "Whole submission"), Assigned to, Customer comment * → assigned designer notified. Close (assignee, Design head or admin) needs a resolution.

Details: Customer, Contact, Project, Machine, Cover note, Prepared by, Sent, Response due (overdue), Customer responded (turnaround days), Response remarks.

Customer letter: file name and size with Open / Download; upload or replace (Design head only, once sent or closed). Allowed: .pdf .doc .docx .png .jpg .jpeg .msg .eml .zip.

Timeline: prepared, edited, sent, recorded the customer response, cancelled, attached the letter, added / closed a comment action.

#### Action buttons and when they appear

| Button | When shown | What it does |
|---|---|---|
| Send to Customer | Draft; Design head only | Sent date (not in the future). Lines re-validated. Status → With customer; response due = sent date + "Customer response due (days)" from Settings. The drawing list is locked |
| Record Customer Response | Sent; Design head only | Per pending drawing: No response yet / Approved / Approved with comments / Rejected and a comment (required unless Approved); Response date (not future, not before sent); Remarks. Responses are final |
| Edit | Draft; Design head or preparer | Same fields as create, including the drawing list |
| Cancel Submission | Draft or sent; Design head or preparer; no response recorded yet | Reason (min 3). Drawings go back to waiting on the customer |
| Delete Draft | Draft; Design head or preparer, with Drawings delete permission | Deleted; drawings stay waiting on the customer |

#### Statuses & workflow

Draft → With customer (sent) → Closed (every line has a response); Cancelled before any response. Per drawing: Approved or Approved with comments lets the revision be released (approver, owner and Design heads are notified "Customer approved … it can now be released"; with comments, an open comment action is created and assigned to the drawing owner or author). Rejected freezes the revision as Customer rejected (author and owner notified to start the next revision).

### Changes (/dashboard/design/change-notices)

Header "Changes": anyone raises an ECR against a released drawing or BOM → Design checks the impact → the change board votes → an approved ECR becomes an ECN. A section switch toggles "Change requests (ECR)" (default) and "Change notices (ECN)" (?tab=ecn).

**Top button:** "+ Raise ECR" (any user with the Design app).

#### List view — Change requests (ECR)

Chips: Undecided (default), Impact check, With change board, Approved, Rejected / Deferred / Withdrawn, All; "Raised by me" toggle. Search by ECR number or title; Source dropdown.

| Column | What it shows |
|---|---|
| ECR | ECR-YYYY-NNNN |
| Title | Title |
| Source | Source, plus NCR / CAPA number |
| Urgency | Low, Normal, High, Critical |
| Items | Number of affected drawings / BOMs |
| Raised by | Raiser |
| Status | Open (impact check), With change board, Approved, Rejected, Deferred, Withdrawn |
| Votes | Votes cast / needed |
| Days open | While undecided |
| ECN | Link to the ECN created from it |
| (last) | View |

#### List view — Change notices (ECN)

For the Design head an info strip explains ECNs normally come from an approved ECR, with a "+ New ECN" button for changes that skip the change board.

Chips: Open (draft, submitted, approved, released; default), Open — revising, Released — acknowledging, Closed, Draft / Awaiting approval, Rejected / Cancelled, All. Search by ECN number, title or description.

| Column | What it shows |
|---|---|
| ECN | ECN-YYYY-NNNN |
| Title | Title |
| ECR | Source ECR link |
| Reason | Design improvement, Customer request, Manufacturing issue, Quality issue, Cost reduction, Safety, Regulatory, Other |
| Priority | Low, Medium, High, Urgent |
| Items | Affected count, or "N / M released" once open |
| Raised by | Raiser |
| Target | Target date |
| Acknowledged | Departments acknowledged / total |
| Status | Draft, Awaiting approval, Open, Released, Closed, Rejected, Cancelled |
| (last) | View |

### Raise Change Request (/dashboard/design/change-requests/new)

#### Create form

Any user with the Design app (Production, Quality, Purchase, BD, Design). Opened from a drawing or BOM page, that item is pre-added (only if it has a released revision).

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Title | text | Yes | | At least 3 characters, max 255 |
| Source | dropdown | No | NCR, CAPA, Customer, Production (default), Purchase (material), Quality, Service / field failure, Design, Other | |
| Urgency | dropdown | No | Low, Normal (default), High, Critical | |
| NCR / CAPA | searchable dropdown | No (shown for NCR / CAPA source) | Quality module NCRs or CAPAs | |
| Source reference | text | No | e.g. customer letter no., field report no. | Max 255 |
| Reason — what is wrong today | long text | Yes | | At least 3 characters |
| Proposed change | long text | Yes | | At least 3 characters |
| Project / Machine | searchable dropdowns | No | | |
| Affected drawings & BOMs | search + list | Yes (at least one) | Released drawings and released BOMs | Each with an optional "What should change here" note |

Button "Raise ECR". Design heads are notified "New ECR".

### ECR detail (/dashboard/design/change-requests/<ref>)

#### View page

Header: ECR number, title, status and urgency pills; raised by, date, source, days open. Banners: link to the ECN once created; "Waiting for Design to check the impact…" (Open); "With the change board — N of M votes cast" with my vote (With change board); "Approved — the Design head now creates the ECN…" (approved, no ECN).

Sections: Request (Reason, Proposed change); Affected items & where used (each item with type, number link, title, released revision, note, and a where-used table: Used in BOM, Revision + status, Qty, Project / Machine); Impact (Summary, Stock affected, Open orders affected, Cost impact in ₹, Delivery impact days, Checked by — or "Not checked yet"); Change board (each member and their vote or "not voted", a votes table Member / Vote / Comment / When, and the decision with who, when and comment); Details (Source, NCR, CAPA, Source reference, Urgency, Project, Machine, Raised by, Change notice link); Timeline with comments.

#### Action buttons and when they appear

| Button | When shown | What it does |
|---|---|---|
| Record Impact / Update Impact | Open or With change board; Design team member | Impact summary * (min 3), Stock affected, Open orders affected, Cost impact (₹, number), Delivery impact (whole days), Change board members (pre-filled from Settings; add / remove people). Status → With change board. On the first impact check each board member gets a bell + Teams "Change board vote needed". Removing a member drops their vote |
| Vote Approve / Vote Reject / Vote Defer | With change board; I am on its board | Comment optional for approve, required for reject / defer. Can be changed until the decision. When everyone has voted, Design heads get a bell + Teams "Change board has voted" |
| Approve ECR / Reject ECR / Defer ECR | With change board; Design head or admin | Every board member must have voted (admin can override). Reason required for reject / defer. Raiser notified |
| Create ECN | Approved, no ECN yet; Design head | Panel: Target date, Change takes effect, Effective from / From serial no., Effectivity note, Stock on hand, Work in progress, Disposition note. Creates the ECN already in Open status with every affected item; owners of affected drawings / BOMs are notified "Revision needed under ECN-…" |
| Reopen for Board | Deferred; Design head | Back to With change board |
| Edit | Open status; raiser or Design head | Title, Source, Urgency, NCR / CAPA, Source reference, Project, Machine, Reason, Proposed change, affected items |
| Withdraw | Open or With change board; raiser or admin | Reason required |

#### Statuses & workflow

Open (impact check) → With change board → Approved / Rejected / Deferred; Withdrawn by the raiser before a decision; Deferred can be reopened. Only an approved ECR becomes an ECN (one live ECN per ECR; cancel the existing ECN to create another).

### Raise Change Notice (/dashboard/design/change-notices/new)

Direct ECN without an ECR (Design team only). Saved as a draft.

#### Create form

| Field | Type | Required | Options / source of values | Rules & validation |
|---|---|---|---|---|
| Title | text | Yes | | At least 3 characters |
| Reason | dropdown | No | 8 reasons (default Design improvement) | |
| Priority | dropdown | No | Low, Medium (default), High, Urgent | |
| Target date | date | No | | |
| Description — what is changing | long text | No | | |
| Impact — production, stock, cost, in-service units | long text | No | | |
| Project / Machine | searchable dropdowns | No | | |
| Approver | searchable dropdown | No (needed to submit) | Users with the Design app, excluding the raiser | With a team set up, must be a Design head |
| Affected documents | search + list | One drawing or BOM needed before submit | Active documents | "What changes in this document" note per row |
| Affected BOMs | search + list | As above | BOMs | Note per row |
| Change takes effect | dropdown | No | Immediately, From a date, From a serial number, From the next production order, For a specific project | |
| Effective from | date | Yes when "From a date" | | |
| From serial no. | text | Yes when "From a serial number" | e.g. RRV-0045 | Max 100 |
| Effectivity note | text | No | | |
| Stock on hand / Work in progress | dropdowns | No | Use up, Rework, Scrap, Not applicable (default) | |
| Disposition note | text | No | | |

Button "Save Draft".

### ECN detail (/dashboard/design/change-notices/<ref>)

#### View page

Header: "Engineering Change Notice", number, title, status; "From change request ECR-…" link. ECN approval panel (approval engine, for direct ECNs). Banners: "Open. N of M affected items still need a released revision raised under ECN-…"; "Released. Waiting for N of M departments to acknowledge".

Sections:
- Affected drawings: Drawing, What changes, Owner, Controlled rev, Under this ECN (revision label + state: No revision yet, Draft, In Review, In Approval, Awaiting customer, Released, Customer rejected; "After approval" before approval).
- Affected BOMs: BOM, What changes, Released rev, Under this ECN.
- Effectivity & disposition: Takes effect, Stock on hand, Work in progress, notes; "Edit" while draft, submitted or open (Design head, raiser or approver) — also lets the target date change.
- Department acknowledgements (after release): Department, Acknowledged by (or Pending), When, Remarks, Acknowledge button for allowed people (optional remarks).
- Change: Description, Impact.
- Details: Change request, Reason, Priority, Target date, Project, Machine, Raised by, Approver, Approved / Rejected by, Released, Closed, Cancelled.
- Timeline with comments (events include drawing / BOM revisions started and released under it, effectivity updated, acknowledged, closed).

#### Action buttons and when they appear

| Button | When shown | What it does |
|---|---|---|
| Edit | Draft; raiser or admin | Full form as on create |
| Submit for Approval | Draft; raiser or admin | Affected items must not have become obsolete. Status → Awaiting approval; goes to the approval engine (approver named on the ECN) |
| Approve / Reject | Awaiting approval, old path only (otherwise on the approval panel) | Approve notifies document owners to start their revisions; Reject needs a reason |
| Release ECN | Open; raiser, approver or admin | Every affected drawing and BOM must have a released revision raised under this ECN, and effectivity must be complete. Status → Released; acknowledgement rows created for Production, Purchase, Store, Quality (and Project management when a project / machine is linked); named acknowledgers are notified, otherwise a bell broadcast goes to that department's app holders; the project manager is told when no project acknowledger is named |
| Cancel ECN | Draft, submitted, or Open with nothing released under it and no revision in flight; raiser, Design head or admin | Reason required |
| Delete | Draft; raiser or admin with delete right | Deletes the draft |

#### Statuses & workflow

From an ECR: created directly as Open (approved). Direct ECN: Draft → Awaiting approval → Open or Rejected. Open → Released (all affected items released under it) → Closed (every department acknowledged; raiser notified). Cancelled is final. New drawing and BOM revisions can only be raised under an Open ECN that lists the item.

### Library (/dashboard/design/library)

Five tabs: Standards, Standard parts, Approved makes, Templates, Review checklists. Described in section 4.

### Reports (/dashboard/design/reports)

| Section | What it shows |
|---|---|
| Master Document List (ISO 9001 §7.5) | Filters: status (All active documents, Released only, Obsolete only, Everything incl. obsolete), type, discipline; "Download CSV". Columns: Doc Number, Title, Type, Discipline, Status, Controlled Rev, Released On, Checked By, Approved By, Open Rev, Open Rev Status, Pending With, Owner, Project, Machine, Store Item, Department, Customer, Customer Approval, Legacy No., Created On (open-revision columns blank for non-team users) |
| Summary KPIs | Revisions released (all time), Avg. cycle time (revision opened → released), Avg. returns per release |
| Count tables | By status, By type, By discipline, Releases — last 12 months |
| First-time-right | Customer FTR (customer drawings released with no customer rejection) and Internal FTR (revisions released without being sent back) |
| Customer approvals (team only) | Average turnaround; per customer: Transmittals, Drawings, Approved, Rejected, Avg. turnaround; per transmittal: number, customer, status (overdue), sent, response or "waiting N d", turnaround, drawings, rejected |
| Change register (ECR → ECN) | Open ECRs and average request → release days; rows: ECR (or "Direct ECN"), Title, Source, ECR status, Raised, Days to decision, ECN, ECN status, Released, Days to release |
| Design WBS status | WBS, Project, Target (and done date), Status (overdue), Slip days |
| Designer workload & on-time | Member and role, Open, Overdue, Done, On time % (from PM tasks; on time = done on or before due date) |
| Revision history per drawing | Pick a drawing: Rev, Status, Change summary, Author, Checked by, Approved by, Opened, Released (superseded), Returns, Cycle days |

### Settings (/dashboard/design/settings)

Described in section 4.

## 4. Settings / Masters

### Design Settings (/dashboard/design/settings)

Header shows "Your role" and who last changed the settings. Everyone with the tab can view; only the Design head or an admin can edit (others see a read-only note naming the head). A note explains forms, fields, statuses and workflow steps are fixed in code; this page only sets who does each step and time limits. Every save is recorded on the audit trail.

| Section | Controls | Rules |
|---|---|---|
| Design team | Rows of user + role (Design head, Reviewer (senior designer), Designer); "+ Add Member", Remove, "Save Team". Warning shown if a member lacks the Design app | Empty team = role checks off: everyone with the Design app works as a designer and acts as head. With a team: at least one head; no user twice; a non-admin head cannot remove themself as head. Anyone with the app but not on the team is a viewer (released drawings / BOMs only, can comment and raise ECRs) |
| Approvals & timing | Default approver (pre-filled approver on new documents / BOMs; "None — the author picks every time"), Review overdue after (days, 1–90, default 7), Customer response due (days, 1–365, default 14) | Default approver must hold the Design app. Check → approval stages themselves are set in Organization › Approval Workflows ("Drawing / document revision release", "BOM revision release") |
| Change board members | Multi-select of users (chips) | Pre-filled as the voting board on each ECR at impact check |
| ECN acknowledgers per department | Multi-select per department: Production, Purchase, Store, Quality, Project management | When none named, anyone holding that department's app (production, p2p, store, quality, projects) may acknowledge; admins always can |

### Library masters (/dashboard/design/library)

| Tab | What it holds | Columns | Who can change |
|---|---|---|---|
| Standards | Standards drawings are made to (RDSO, IS, EN, ISO, IEC, UIC, DIN, ASME, Customer, Internal, Other) with version | Body, Code, Version, Title (remarks), Current / Not current, Cited by (drawing count), File (Open), actions Upload / Replace file, Edit, Delete | Design head adds / edits / uploads files. Form: Body, Code *, Version / year, Title * (min 2), Current edition, Remarks. A standard cited by drawings cannot be deleted — mark it not current |
| Standard parts | Preferred Item Master items designers should pick first | Item, Item status, Discipline, Drawing (rev), Standard, Approved makes, Notes, Edit / Remove | Team members. Form: Item * (fixed after creation, one entry per item), Discipline, Drawing, Standard, Notes. Search + discipline filter |
| Approved makes | Technically approved make / part number per Item Master item (shown on every BOM line using the item, for Purchase) | Item, Make, Part no., Status (Approved, Provisional, Withdrawn), Remarks, Approved by + date, Edit / Delete | Team members add / edit (Item * fixed after creation, Make *, Make part no., Status, Remarks). Only the Design head deletes; withdraw instead to keep history |
| Templates | Controlled files: Title block, Drawing sheet, BOM sheet, Specification, Transmittal cover note, ECN notice, Other | Kind, Name, Description, File (download, size), Uploaded by + date, Download / Delete | Design head uploads (Kind, Name *, File *, Description) and deletes; everyone downloads |
| Review checklists | Checklist per document type (or BOM), optionally per discipline, answered at check | Card: name, type · discipline, updated date, Active / Inactive, numbered items; Edit, Activate / Deactivate, Delete | Design head. Form: Name * (min 2), Document type (fixed after creation), Discipline (or All disciplines), Active, items (min 2 characters each, at least one; reorder ↑ ↓, remove). One active checklist per type + discipline. Past answers keep their copied text |

Delete buttons in the Library also require the Library delete permission (creator or admin rule).

## 5. Permissions

Access starts with the "design" app on the user. Each tab is a permission sub-tab (Organization › Role & Permissions); the sub-nav hides tabs without view right, and the list endpoints check the tab right.

| Sub-tab key | Label | Actions available |
|---|---|---|
| dashboard | Dashboard | view |
| ongoing_projects | Ongoing Projects | view, edit |
| requirements | Requirements (from R&D) | view, edit (edit = send the feasibility reply) |
| project_work | Requests | view, create, edit, delete, approve, reject, export, print |
| tasks | My Work | view, edit |
| documents | Drawings | view, create, edit, delete, export, print, submit, approve, cancel |
| boms | BOMs | view, create, edit, delete, export, print, submit, approve, cancel |
| reviews | Reviews & Approvals | view, approve, reject |
| change_notices | Changes (ECR / ECN) | view, create, edit, delete, approve, reject, export, print, submit, cancel |
| library | Library | view, create, edit, delete |
| reports | Reports | view, export, print |
| settings | Settings | view, edit |

Specific checks in code:
- Submitting a drawing or BOM revision needs the "submit" action on Drawings / BOMs. Approval-engine deciders need the approve permission on that sub-tab.
- Deleting documents, discarding revisions, deleting draft submissions (governed by the Drawings delete right), deleting BOMs, ECNs and library entries need the delete right and the company delete rule (creator or admin).
- Data scope: drawings, BOMs, ECRs, ECNs, customer submissions and design requests follow the central data scope. "Assigned" includes authors, checkers and approvers of any revision, change-board members, ECN acknowledgers of released ECNs, people assigned customer comments, and the lead designer. Library, settings and lookups are organisation-wide.

Design roles (from Settings, on top of permissions):

| Role | Can do |
|---|---|
| Admin | Everything; can stand in as checker / approver (but not both signatures on one revision); reactivate obsolete documents / BOMs |
| Design head | Release drawings (approver must be a head when a team exists), release customer-approved revisions, send submissions and record customer responses, attach customer letters, decide / reopen ECRs, create ECNs from ECRs, move design requests, manage standards / templates / checklists, delete approved makes, edit Settings |
| Reviewer | Everything a designer can, plus be named checker |
| Designer | Create documents, BOMs, submissions and revisions; record ECR impact; add standard parts and approved makes |
| Viewer (has the Design app, not on the team) | See released drawings / BOMs only, comment, raise ECRs, raise design requests, export BOMs |

If no team is set up, everyone with the Design app is treated as a designer and as head.

## 6. Documents, Notifications & Integrations

### Generated documents and files

- No Word or PDF documents are generated by the Design module itself.
- CSV exports: BOM multi-level sheet (per BOM revision) and the Master Document List.
- Drawing / revision files, the customer letter, standard files and templates are stored in SharePoint (revision files under Design-media/<doc number>/<revision>/). If SharePoint storage is not configured, uploads return an error.

### Notifications (bell unless stated)

| Event | Who is told |
|---|---|
| New design request | Design heads; named lead designer ("Design request assigned") |
| Request accepted / status changed | Requester; lead designer on accept |
| Requirement revised | Lead designer and Design heads |
| Design needs input / input received | Requester / lead designer |
| Drawing or BOM revision submitted | Checker and approver through the central approval engine |
| Revision returned / recalled | Author (and checker if returned at approval) / the people who were waiting |
| Drawing released | Author, checker, owner |
| Drawing approved, waiting on customer | Author, owner, Design heads |
| Customer approved / rejected a drawing | Approver, owner, Design heads / author and owner |
| Customer comment assigned | Assigned designer |
| BOM new item codes needed | Broadcast to Store app holders |
| BOM released | Author, checker, owner; broadcast to Store, Purchase (P2P) and Production app holders |
| New ECR | Design heads |
| Change board vote needed / board has voted | Board members / Design heads — bell and Microsoft Teams |
| ECR decided | Raiser |
| ECN approved / created from ECR | Owners of affected drawings and BOMs |
| ECN released | Named acknowledgers per department (or broadcast to that department's app holders), ECN raiser, project manager when no project acknowledger is named |
| ECN closed | Raiser |

### Links to other modules

- CRM: customers (organisations), inquiries and tenders on design requests; R&D-shared requirements come from CRM inquiries / tenders.
- R&D: Requirements tab (feasibility replies to the R&D head).
- Project Management: projects and WBS elements on requests, documents, BOMs and ECNs; My Work shows PM tasks and links deliverables; WBS evidence; workload reports.
- Machines (ERP projects): machine links on documents, BOMs, requests, submissions, ECRs and ECNs.
- Store / Item Master: product items and BOM line items, new-item code requests, approved makes per item.
- Purchase and Production: receive released-BOM and released-ECN notices; Purchase uses approved makes; departments acknowledge ECNs.
- Quality: NCR and CAPA links on ECRs; Quality acknowledges ECNs.
- Organization: central approval engine (Approval Workflows) for drawing revisions, BOM revisions and direct ECNs; Role & Permissions; Departments.
- Ongoing Projects: the old Design link redirects to the company-wide Ongoing Projects page.
