# HR & Administration — End-to-End Overview

> As of 2026-10-06. This describes what the code actually does today, not the target design.
> Payroll is **out of scope** — it stays in ADP. The portal records statutory IDs and payment references only.

---

## 0. Read this first — current access status

| Fact | Where |
|---|---|
| `hr` is in `RESTRICTED_APPS`, so **every** HR API route (including self-service) returns 403 for anyone who is not an Azure tenant Global Admin | `backend/app/core/module_visibility.py` |
| `User.get_apps()` strips `hr` for non-Azure-admins, even portal admins | `backend/app/modules/main/models/user.py` |
| The whole `/dashboard/hr/*` tree is wrapped in `useRequireApp('hr')` | `frontend/src/app/dashboard/hr/layout.tsx` |

**Effect:** the "self-service for every employee" pages (My HR, Approvals, Org Chart, Holidays) exist in code but nobody except Azure admins can reach them today.
**To open the module:** remove `"hr"` from `RESTRICTED_APPS`. Note that `layout.tsx` will still require the `hr` app, so ordinary employees would also need `hr` assigned in Users & Roles — or the layout gate has to be relaxed for self-service pages.

---

## 1. Module map

```
HR & Administration
├── People core ........ Employees, HR Profile, Org Chart, Masters
├── Time ............... Holidays, Leave, Attendance (+ Corrections)
├── Lifecycle .......... Joining, Confirmation, Transfer, Promotion, Exit (+ checklists)
├── Admin services ..... Assets, Travel, Expense Claims, Visitors
├── Self-service ....... My HR (Profile, Leave, Attendance, Travel, Claims, Assets, Visitors)
├── Approvals .......... One inbox for leave / corrections / travel / claims / checklist tasks
└── Dashboard .......... Live KPIs for HR
```

### 1.1 Top nav tabs (`frontend/src/components/hr/HrNav.tsx`)

| Tab | Route | Who sees it |
|---|---|---|
| Dashboard | `/dashboard/hr` | HR only (others redirected to My HR) |
| My HR | `/dashboard/hr/me` | Everyone |
| Approvals | `/dashboard/hr/approvals` | Everyone |
| Employees | `/dashboard/hr/employees` | HR only |
| Org Chart | `/dashboard/hr/org-chart` | Everyone |
| Lifecycle | `/dashboard/hr/lifecycle` | HR only |
| Leave | `/dashboard/hr/leave` | HR only |
| Attendance | `/dashboard/hr/attendance` | HR only |
| Holidays | `/dashboard/hr/holidays` | Everyone |
| Assets | `/dashboard/hr/assets` | HR only |
| Visitors | `/dashboard/hr/visitors` | HR only (employees reach it via My HR) |
| Travel & Claims | `/dashboard/hr/travel` | HR only |
| Masters | `/dashboard/hr/masters` | HR only |

"HR only" = the user has the `hr` app. On top of that, the Permission Matrix (`tab_access.hr`, subtab keys in `backend/app/core/permission_registry.py`) can hide individual tabs.

### 1.2 My HR sub-tabs (`frontend/src/components/hr/MyHrTabs.tsx`)
Profile · Leave · Attendance · Travel · Expense Claims · My Assets · Visitors

---

## 2. Roles — who can do what

There are only three effective roles. There is **no separate "manager" role** and **no finance/accounts role** in HR.

| Role | How it is decided | Can do |
|---|---|---|
| **HR** | `hr` in `user.get_apps()` (`services/access.py` → `require_hr`, `is_hr`) | Everything: masters, profiles, lifecycle, attendance marking, leave allotment, assets, visitor gate, mark claims paid. Can decide **any** request (override). |
| **Approver (manager)** | Being the `approver_id` on a request. Captured at submit time from the requester's `User.reporting_manager_id` | Approve/reject that request. View direct reports' attendance month. |
| **Employee** | Any logged-in user | Own profile (personal fields only), own leave/attendance/travel/claims/assets, pre-register visitors, view holidays & org chart, complete checklist tasks they own. |

**Golden rules (`can_decide`):**
1. Nobody decides their own request — not even HR or admin.
2. The captured approver can decide.
3. Any HR user can decide anything — including requests with **no** approver (employee has no manager → goes to the HR queue).

**HR self-dealing blocks:** HR cannot edit their own HR profile, adjust their own leave balance, mark/import their own attendance, raise or complete a lifecycle event about themselves, or mark their own claim paid.

---

## 3. People core

### 3.1 Employees list — `/dashboard/hr/employees` (HR)
- Lists **every portal user** (left-joined to HR profile), 50/page, sortable.
- **Stat cards (click = filter):** Active people · With HR profile · Profile missing.
- **Filters:** search (name/email/code), Department, Designation, Plant, Employment status, Employment type, Profile (has/missing), Account (active/deactivated/all).
- **Columns:** Employee · Code · Department · Designation (+grade) · Plant · Manager · Joined · Status · View / Create profile.

### 3.2 Employee detail — `/dashboard/hr/employees/[id]` (HR)
Tabs: **Profile · Documents · Lifecycle · Leave · Attendance · Assets**

| Tab | What it shows / does |
|---|---|
| Profile | Employment, Personal, Emergency contact, Statutory IDs (Aadhaar masked), HR notes |
| Documents | Upload / open / delete employee documents (SharePoint). Types: ID Proof, PAN, Aadhaar, Passport, Offer/Appointment/Relieving/Experience letter, Certificates, Bank details, Warning, etc. Visibility: Confidential / Internal / **HR Only** (hidden from employee). Max 25 MB, expiry badge |
| Lifecycle | Timeline of events + quick buttons: + Transfer, + Promotion, + Confirmation, + Exit (or "+ Rehire (joining)" after an exit) |
| Leave | Balance cards per type + requests for the year |
| Attendance | Read-only month calendar |
| Assets | Assets held now + history. "All must be returned before exit." |

### 3.3 Create / Edit HR profile — `/dashboard/hr/employees/[id]/edit` (HR)

| Section | Inputs | Rules |
|---|---|---|
| Employment & Organisation | Employee Code, Date of Joining, Employment Type, Employment Status*, Department, Designation, Grade, Reporting Manager, Plant, Shift, Work Location, Probation End, Confirmation Date, Date of Exit, Exit Reason | Code unique. Probation end required if status = probation. Dates not before DOJ. Manager: not self, active, **no reporting loops**. Status can **never** be switched to/from `exited` here — exits go through Lifecycle. Picking a designation auto-fills its default grade. |
| Personal | Gender, DOB, Blood Group, Marital Status, Personal Email, Personal Phone, Current & Permanent Address | DOB in past, phone/email validated |
| Emergency Contact | Name, Relation, Phone | — |
| Statutory IDs | PAN (`AAAAA9999A`), Aadhaar **last 4 only**, UAN, ESIC | Reference only — payroll is in ADP |
| HR Notes & Settings | Internal notes, **"HR owns department, designation, manager and plant"** (`org_fields_locked`, default ON) | When ON, Azure login / "Sync Azure Users" will not overwrite these fields |

**Side effect:** saving mirrors Department name → `User.department`, Designation name → `User.designation`, Plant → `User.branch_id` (`services/employee_sync.py::apply_org_fields`). This keeps older modules (especially P2P approval routing, which matches `User.department` text) working.

**Single source of truth:** Reporting manager and DOJ live on the `users` table, not the HR profile.

### 3.4 My HR → Profile — `/dashboard/hr/me` (everyone)
- Shows own full record (minus HR notes).
- **"Edit My Details"** — only: personal email/phone, blood group, marital status, addresses (with "Same as current"), emergency contact. Anything else → 403.
- Own documents list (excluding "HR Only").

### 3.5 Org Chart — `/dashboard/hr/org-chart` (everyone)
- Tree built from `reporting_manager_id`; no PII. Excludes inactive/exited.
- Search, department filter, Expand/Collapse all. Nodes show "N direct · M total".
- People with no manager and no reports go into a "standalone" group. HR gets links to employee records.

### 3.6 Masters — `/dashboard/hr/masters` (HR)
Every master has: search, "Show inactive", Add, Edit, Deactivate/Activate, Delete (blocked with 409 while in use → "Deactivate instead").

| Master | Fields | Notes |
|---|---|---|
| **Designations** | Name*, Code*, Department, Default Grade, Description, Active | Rename updates `User.designation` for all holders |
| **Grades** | Code* (E2), Name*, Level* (0–100, higher = senior), Description, Active | — |
| **Shifts** | Code*, Name*, Start*, End*, Grace (min, default 10), Work Hours, Plant (blank = all), Active | End < Start ⇒ night shift (auto). Used for late marking |
| **Leave Types** | Code*, Name*, Annual quota, Order, Paid, Half days allowed, Carry forward, Max carry forward, Document after (days), Max days at a stretch, Gender restriction, Active | No delete. Unpaid ⇒ quota 0 |
| **Checklist Templates** | Event type, Category, Title*, Default owner, Order, Description, Active | Copied onto new lifecycle events (see §5) |

Departments and Plants come from the **Organization** module (not HR masters).

---

## 4. Time management

### 4.1 Working calendar (`services/calendar.py`) — the rules everything uses
- All times in **IST**.
- **Weekly off:** read from the plant's `Branch.working_days` text ("Mon-Sat"). If unreadable → Sunday only.
- Employee's plant = profile plant, else `User.branch_id`.
- **Day off holidays** = active **National** and **Festival** holidays for all plants or the employee's plant.
- **Restricted / Optional** holidays are *not* days off — employees take them as leave.

### 4.2 Holidays — `/dashboard/hr/holidays` (view: everyone, edit: HR)
- Filters: Year, Plant ("My plant" / every plant / all-plant only / specific), Type, Show inactive.
- **HR actions:**
  - **+ Add Holiday:** Date*, Name*, Type (National/Festival/Restricted/Optional), Plant (blank = all), Description.
  - **Bulk add:** up to 200 rows; duplicates skipped and reported.
  - **Copy year:** copies same day/month; Festival/Restricted/Optional are flagged "needs review" (festival dates move).
  - Edit, Deactivate, Delete.
- ⚠ Changing a holiday does **not** recalculate already-approved leave.

### 4.3 Leave

**Data:** `hr_leave_types` → `hr_leave_balances` (per user × type × year) → `hr_leave_requests` (`LV-YYYY-NNNN`).
`Available = opening (carried) + allotted + adjusted − used` (computed).

#### Step 1 — HR loads balances (Leave → Balances tab)
- **Allot year:** Year, "Pro-rate for joiners" (default ON), leave-type chips (none = all).
  - Joined earlier year → full quota. Joined this year → quota × months/12 (joining month counts if joined on/before 15th), rounded down to 0.5. Joining next year → skipped.
  - Carry-forward types: `opening = min(last year's available, max_carry_forward)`.
  - Safe to re-run — never touches `used` or `adjusted`.
  - Gender-restricted types skipped if gender doesn't match / not recorded.
- **Adjust balance:** Employee*, Leave type*, Year, Days ± (0.5 steps)*, Reason*. Cannot go negative. Audited, employee notified.
- No monthly accrual and no scheduler — allotment is a manual yearly action.

#### Step 2 — Employee applies (My HR → Leave → "+ Apply Leave")
**Form (`LeaveApplyForm.tsx`):** Leave type*, From*, Session (Full / First half / Second half; multi-day: Full / From second half), To, End session (Full / Till first half), Reason*, Contact during leave, Supporting document (becomes required when the rule says so).

**Live preview** shows: days counted, balance (and pending), who will approve, which holidays/weekly offs are "Not counted", and any rule errors.

**Validation rules (in order):** type active → same calendar year → half day allowed → ≤366 days → to ≥ from → days > 0 → gender restriction → max consecutive days → document required above N days → no overlap with own pending/approved leave → (paid types) enough balance after pending requests.

**Day counting follows the sandwich setting** (HR → Settings → `leave_sandwich_rule`, default OFF): when OFF, weekends and holidays inside a leave are never charged; when ON, weekly offs/holidays that fall between two leave days are counted as leave.

HR can also **"+ Apply on behalf"** from the Leave tab.

#### Step 3 — Approval (Approvals page)
```
            submit                    approve (manager or HR)
Employee ──────────► PENDING ───────────────────────────────► APPROVED
                        │  reject (reason required)              │ cancel (only before start date)
                        ▼                                         ▼
                     REJECTED                                 CANCELLED
                        ▲
   cancel (owner/HR) ───┘ from PENDING → CANCELLED
```
- **Single level.** Approver = reporting manager at submit time; no manager → HR queue.
- **On approve:** days re-counted (in case a holiday was added), balance re-checked, attendance clash checked (409 if employee already marked present on those days). Then `used += days` and attendance rows are written as `on_leave` / `half_day` (source = `leave`).
- **On cancel of approved leave:** only before `from_date`. `used -= days`, leave attendance rows removed. After start → "Ask HR to correct your attendance and adjust your balance".
- Changing someone's manager later does **not** move their pending requests (only a Lifecycle exit handover does).

#### HR Leave page — `/dashboard/hr/leave`
- **Requests tab:** filters (search, status, type, date range); columns Request · Employee · Leave · Dates · Days · Status · Approver; actions File / Approve / Reject / Cancel.
- **Balances tab:** Employee · Type · Carried · Allotted · Adjusted · Used · Pending · Available · Adjust.

### 4.4 Attendance

**Data:** `hr_attendance` — one row per employee per day.
Statuses: Present, Absent, Half day, On leave, Holiday, Weekly off, On duty, Work from home. ("Not marked" is computed, never stored.)

**Where rows come from (`source`):**

| Source | How |
|---|---|
| `self` | Employee clicks **Check in / Check out** on My Attendance (web click, no GPS/device) |
| `manual` | HR marks in Daily register (single or bulk) |
| `import` | HR uploads CSV (biometric export) |
| `leave` | Written automatically by leave approval — **protected**, nobody can edit it manually |
| `regularization` | Written by an approved correction request |

**Late marking:** check-in after shift start + grace. Needs a shift on the profile.

#### HR Attendance page — `/dashboard/hr/attendance` (5 tabs)
1. **Daily register** — date picker, status chips, per-row Mark/Edit, **bulk mark** selected rows (approved-leave rows skipped).
2. **Employee month** — calendar for one person; click a day to edit.
3. **Monthly summary** — Present, Half day, Absent, Leave, On duty, WFH, Holiday, Weekly off, Not marked, Late, **Present-equivalent** (= P + OD + WFH + 0.5×HD). **Export CSV** (for ADP).
4. **Import** — Download template → Validate (dry run) → Import. Columns: email or employee_code, date, status (P/A/HD/OD/WFH/H/WO), check_in, check_out, remarks. CSV ≤5 MB / 20,000 rows.
5. **Corrections** — regularization requests list with Approve / Reject.

**Edit modal rules:** HR can't mark own attendance; future dates only On duty/WFH/Absent; `on_leave` can never be set manually; check-out after check-in (unless night shift).

#### My Attendance — `/dashboard/hr/me/attendance`
- **Today card:** status, shift timing, Check in / Check out buttons, "Late by N min / On time".
- **Month calendar.** Click a past day → **Request correction**.

#### Attendance correction (regularization) flow — `AR-YYYY-NNNN`
- **Form:** Date*, Correct status* (Present / Half day / On duty / WFH), Check-in (required for Present/Half day), Check-out, Reason*.
- Rules: date in past/today, within **60 days**, not a full-day leave, one pending request per date.
- `PENDING → APPROVED` (overwrites the attendance row) / `REJECTED` (reason required) / `CANCELLED` (owner/HR, pending only).

---

## 5. Employee Lifecycle — `/dashboard/hr/lifecycle` (HR)

Five event types, numbered `LC-YYYY-NNNN`:

| Type | Use for | Default checklist |
|---|---|---|
| **Joining** | New hire or rehire (onboarding) | 7 items (HR×3, IT×2, Admin, Manager) |
| **Confirmation** | Probation → confirmed | none |
| **Transfer** | Department / plant / manager change | 3 items |
| **Promotion** | New designation / grade | none |
| **Exit** | Resignation, termination, retirement, absconding, contract end, death | 8 items |

### 5.1 State machine
```
DRAFT ──start──► IN_PROGRESS ──complete──► COMPLETED (final)
  │                   │
  └─────cancel────────┴──────► CANCELLED (final, reason required)
```
- "Save as draft" or "Create & start checklist".
- Checklist owners are notified only when the event moves to **In Progress**.
- Completed/cancelled events are frozen. A rehire after exit = a **new Joining** event.

### 5.2 New event form — `/dashboard/hr/lifecycle/new`

| Type | Inputs |
|---|---|
| Joining | Toggle "Not in the portal yet" (Full name*, Work email) or "Already has a portal account" (Employee*). Date of joining, Department, Plant, Designation, Grade, Reporting manager, Remarks |
| Confirmation | Employee*, Confirmation date, Remarks |
| Transfer / Promotion | Employee*, Effective from, New department / plant / designation / grade / manager (fill only what changes), Successor (optional), Remarks |
| Exit | Employee*, Exit type, Resignation date, **Last working day***, Notice (days), Handover to (successor), Exit reason, Remarks |

The system snapshots the employee's current position into `from_*` fields automatically.

### 5.3 What "Complete" does

**Joining**
1. *Link user* first (if the candidate wasn't in the portal): find by email after their first Microsoft sign-in or after "Sync Azure Users".
2. Completion inputs: Employment type, Employee code, Probation ends.
3. Creates/updates HR profile → status `probation` (if probation/trainee/intern or probation date given) else `active`. Sets DOJ, manager, dept/designation/grade/plant. Re-activates the account **only** for an exited rehire.

**Confirmation** — needs status probation/onboarding → sets `active`, confirmation date; type `probation` → `permanent`.

**Transfer / Promotion**
- Applies the new dept/plant/designation/grade/manager.
- Completion panel lets HR: remove approval roles that don't carry over (Department Head / Project Head / Plant Head), decide the old department-head slot (Keep / Remove / Give to successor), and move pending **P2P** approvals to the successor.
- ⚠ Pending **HR** approvals (leave etc.) are **not** moved on transfer — only P2P.

**Exit** — the big one, all in one transaction.
- On **create**: profile status → `notice`. On cancel → back to `active`.
- **Blockers** (409 unless "Complete anyway" + reason): pending checklist items, unreturned HR assets.
- **Handover person required** if the leaver has reportees, heads a department, has pending approvals, owns checklist tasks, etc. HR sees all this first in the **Impact preview**.
- On completion:
  1. Direct reportees → new manager = handover person (they are notified).
  2. Department head slots → handover person (only if same plant), else removed.
  3. Pending leave / corrections / travel / claims where the leaver is approver → handover person.
  4. P2P: pending head approvals and "assigned buyer" on open PRs → handover person.
  5. Leaver's open checklist tasks and template ownerships → handover person.
  6. Leaver's own pending leave/corrections/travel and draft claims → auto-cancelled. Submitted/approved claims are kept with a warning: **settle in F&F in ADP**.
  7. All approval flags cleared (`is_department_head`, `is_project_head`, `is_plant_head`, `is_purchase_head`, `is_director`, `is_md`, `is_finance_manager`).
  8. Profile → `exited`, date of exit, exit reason.
  9. Portal account **deactivated** + all sessions revoked. Exited users cannot log back in via Microsoft login or Azure sync (`services/exit_guard.py`).

### 5.4 Checklists
- On event creation, active templates for that type are copied as **pending** items.
- **Owner** = template's default owner; for category **Manager** with no default → the employee's (new or old) manager; otherwise **unassigned** (HR assigns per item).
- Categories (HR, IT, Admin, Finance, Manager, Store) are labels only — no automatic routing by role/department.
- **Item actions:** ✓ Done · N/A (remark required) · Reopen · Remark · change owner (HR) · Remove (HR, not on done items).
- Owners (even non-HR users) see their tasks in **"Your onboarding / offboarding tasks"** on the Lifecycle and Approvals pages, and can open the event with HR-only fields hidden.
- Only **Exit** is blocked by pending items; other types can complete with items open.

### 5.5 Lifecycle list page
- 5 count cards (open per type, click = filter), My checklist tasks widget, search, type & status filters.
- Columns: Event No · Type · Employee/Candidate · Effective · Checklist progress · Status · Raised.

---

## 6. Administration services

### 6.1 Assets — `/dashboard/hr/assets` (HR) · `/dashboard/hr/me/assets` (employee, read-only)

**Data:** `hr_assets` (code `AST-NNNN`) + `hr_asset_assignments` (issue/return history).
Categories: Laptop, Desktop, Mobile, SIM, Tablet, Monitor, Vehicle, ID Card, Access Card, Furniture, Tool, Other.

```
create → IN_STOCK ──issue──► ISSUED ──return──► IN_STOCK / UNDER_REPAIR / RETIRED
            │                   └──mark lost──► LOST (assignment auto-closed)
            ├──► UNDER_REPAIR ──► IN_STOCK / RETIRED
            ├──► RETIRED ──► IN_STOCK
            └──► LOST ──► IN_STOCK
```
- **Add/Edit asset:** Asset code (blank = auto), Name*, Category, Make, Model, Serial/IMEI, Purchase date, Cost ₹, Warranty until, Condition, Vendor, Invoice no., Plant, Remarks.
- **Issue:** Issue to*, Issued on, Expected return, Condition, Remarks. Employee gets a bell notification.
- **Return:** Returned on, Condition on return, Send to (In stock / Under repair / Retired — "damaged" auto-picks Under repair), Remarks.
- Register page: stat cards (Total, In stock, Issued, Under repair, Lost/retired), filters (search, category, status, plant, holder), "return overdue" flag.
- Delete = soft delete, blocked while issued.
- **Exit link:** any asset still held = exit blocker.

### 6.2 Travel requests — HR: `/dashboard/hr/travel` · Employee: `/dashboard/hr/me/travel`

`TR-YYYY-NNNN`
- **Form:** Purpose*, From*, To* (must differ — local conveyance goes straight on a claim), Depart*, Return, Mode (Air, Train, Bus, Own/hired car, Company vehicle, Other), Estimated cost ₹, Advance needed ₹, Project/reference, Accommodation required.
```
PENDING ──approve (manager/HR)──► APPROVED ──mark completed (HR)──► COMPLETED
   │ reject (reason) → REJECTED (final — raise a new request)
   └ cancel (owner) → CANCELLED   (approved trips can be cancelled only before departure)
```
- Edit only while pending. Single-level approval.
- "Advance needed" is **information only** — no disbursement or settlement in the portal.
- Approved/completed trips show **"Claim expenses"** → links to an expense claim.

### 6.3 Expense claims — Employee: `/dashboard/hr/me/claims` · HR: Travel & Claims → Expense claims tab

`EXP-YYYY-NNNN`, with line items.
1. **+ New Claim:** Title*, Claim date, Linked trip (optional — only own approved/completed trips) → creates a **Draft**.
2. **Add lines:** Date, Category (Travel/tickets, Lodging, Food, Local conveyance, Fuel, Phone/data, Other), Description, Amount, Receipt (image/PDF ≤10 MB, stored in SharePoint).
3. **Rule:** any line above **₹500 needs a receipt** before submit. No grade-wise limits or per-diem.
```
DRAFT ──submit──► SUBMITTED ──approve (manager/HR)──► APPROVED ──mark paid (HR)──► PAID
                     │ reject (reason) → REJECTED ──edit & resubmit──► SUBMITTED
DRAFT / REJECTED / SUBMITTED ──cancel/withdraw (owner)──► CANCELLED
```
- **Mark paid:** Paid on, Payment reference* (UTR/NEFT/cheque). The money is paid **outside the portal** (bank/ADP); the portal only records it. HR cannot mark their own claim paid.
- Employee stat cards: Drafts/to fix, Awaiting approval ₹, Approved-not-paid ₹, Paid ₹.

### 6.4 Visitors — `/dashboard/hr/visitors`

`VIS-YYYY-NNNN`. One page, two views:
- **HR / reception:** "Today's board" (Expected · Inside now · Checked out) + "All visits" register with filters.
- **Employee:** "My Visitors" + "+ Pre-register Visitor" (employee is always the host).

**Register form:** Visitor name*, Company, Phone, Email, Persons, Purpose, Host* (HR only), Plant, Walk-in checkbox (HR only → Badge no., ID proof type, ID last 4), else Expected date/time, Vehicle no., Items carried, Remarks.
Only the **last 4 characters** of an ID proof are stored.
```
EXPECTED ──check in (HR)──► CHECKED_IN ("Inside") ──check out (HR)──► CHECKED_OUT
    └ cancel (HR / host / creator) → CANCELLED
Walk-in (HR) → CHECKED_IN directly
```
Host gets a bell notification when the visitor arrives.

---

## 7. Approvals inbox — `/dashboard/hr/approvals` (everyone)

One page, sections hide when empty:

| Section | Approve does | Reject |
|---|---|---|
| Leave requests | Deducts balance, marks attendance as on leave | Reason required |
| Attendance corrections | Overwrites that day's attendance | Reason required |
| Travel requests | Approves trip | Reason required |
| Expense claims (with lines & receipts) | Approves claim — **does not pay** | Reason required |
| Your onboarding / offboarding tasks | Mark checklist item done | — |

You see items where you are the approver; HR also sees items with no approver. Your own requests never appear.

---

## 8. HR Dashboard — `/dashboard/hr` (HR)

Live, IST-based. Warning banner if employees have no HR profile.

**KPI tiles:** Headcount · Joiners this month · Exits this month · On leave today · Attendance today (present/headcount, absent, not marked) · Pending approvals (and how many have no manager) · Open lifecycle events · Assets issued · Visitors inside · Documents expiring (30 days) · Probation ending (30 days) · Claims to pay (₹).

**Cards:** pending approvals by type, on leave today, today's attendance chart, open lifecycle events, joiners & exits, headcount by status/department/plant, probation ending, documents expiring, visitors inside, asset status.

---

## 9. Notifications

Bell for everything; **Teams only for "waiting for you" approval requests** (project rule).

| Event | To | Channel |
|---|---|---|
| Leave submitted | Approver | Bell + **Teams** |
| Correction submitted | Approver | Bell + **Teams** |
| Travel submitted | Approver | Bell + **Teams** |
| Claim submitted / resubmitted | Approver | Bell + **Teams** |
| Leave/correction/travel/claim approved or rejected | Requester | Bell |
| Approved leave/travel cancelled, claim withdrawn | Approver/decider | Bell |
| Leave balance adjusted, leave applied on behalf | Employee | Bell |
| Claim paid | Claimant | Bell |
| Asset issued / returned | Holder | Bell |
| Visitor registered for you / arrived / cancelled | Host | Bell |
| Checklist tasks assigned (event starts / item added / owner changed) | Item owner | Bell |
| Exit: manager changed | Each reportee | Bell |
| Exit: handover | Handover person | Bell |
| Lifecycle event completed | All HR users | Bell |
| Document expiring (30 / 7 / 0 days) | Employee + HR (HR-only docs → HR) | Bell — daily 09:00 job |
| Probation ending (≤7 days) | HR + manager + employee | Bell — daily 09:00 job |

If an employee has **no manager**, no one is pinged — the request just sits in the HR queue and shows on the HR dashboard.

---

## 10. Connections to other modules

```
                 ┌───────────── Azure AD / Microsoft 365 ─────────────┐
                 │ users created on first sign-in / "Sync Azure Users" │
                 └──────────────────────┬──────────────────────────────┘
                                        ▼
┌──────────────┐   dept / plant   ┌──────────────┐   reporting_manager_id,     ┌────────────────┐
│ Organization │ ───────────────► │  HR module   │ ◄── DOJ, is_active, flags ─►│ Main (users)   │
│ Department,  │ ◄── head slots ─ │              │ ── mirrors dept/desig/plant │ auth, sessions │
│ Branch(Plant)│   (transfer/exit)│              │ ── exit_guard blocks login ─►│                │
└──────────────┘                  └──────┬───────┘                              └────────────────┘
                                         │ exit / transfer handover
                                         ▼
                                  ┌──────────────┐        ┌──────────────┐       ┌──────────────┐
                                  │ P2P (PRs)    │        │ SharePoint   │       │ ADP (payroll)│
                                  │ approvals,   │        │ receipts,    │       │ manual: CSV  │
                                  │ buyer slots  │        │ leave docs,  │       │ export, F&F, │
                                  └──────────────┘        │ emp. docs    │       │ claim payment│
                                                          └──────────────┘       └──────────────┘
```

| Module | Direction | What flows |
|---|---|---|
| **Main / Users** | both ways | HR reads name, email, `is_active`, manager, DOJ. HR **writes** manager, DOJ, dept/designation/plant text mirror, `is_active`, approval flags. `user_documents` table holds employee documents. |
| **Auth** | HR → Auth | `exit_guard`: exited users can't sign in; Azure sync / admin "Activate" can't revive them. `is_org_locked`: login & Azure sync don't overwrite HR-owned org fields. |
| **Organization** | both ways | Departments & Plants are HR's org structure. `Branch.working_days` drives weekly offs. Transfer/exit edits department head slots. Provisioning respects the org lock. |
| **P2P** | HR → P2P | Exit/transfer moves pending PR head approvals and assigned-buyer slots to the successor. P2P approval routing relies on `User.department` text, which HR keeps in sync. |
| **Projects** | Projects reads HR | `projects/routes/work.py` reads `HrEmployeeProfile`. |
| **SharePoint** | HR → SP | Expense receipts, leave attachments, employee documents. |
| **Audit log** | HR → Audit | Approvals, balance changes, imports, lifecycle completions, document uploads. |
| **Accounts / Store / Maintenance** | **none** | No journal entries, no payment vouchers, no advance ledger. HR assets are separate from Store inventory and Maintenance assets. "Store" is only a checklist label. |
| **ADP (payroll)** | manual | Attendance summary CSV export, F&F settlement, claim payment happen outside the portal. |

---

## 11. Known gaps (decide if/when to build)

**Access**
1. The whole module is locked to Azure admins (§0). Self-service pages would also need the `hr` app because of the layout gate.

**Leave / attendance**
2. No monthly accrual or year-end scheduler — HR must run "Allot year" manually.
3. Changing a manager doesn't move that person's pending requests.
4. Editing a holiday doesn't recalculate approved leave.
5. No biometric/device integration — CSV import only; web check-in has no geo-fence.

**Lifecycle**
6. On transfer, pending HR approvals aren't moved (only P2P).
7. Checklist items are assigned to fixed people only — no "IT team" / "Store team" routing. Confirmation & Promotion have no default checklist.
8. Exit only checks HR assets — not Store issues or advances. Disabling the Azure account is a manual IT task.

**Admin services**
9. Approval is single-level everywhere (manager or HR). There is no finance step for claims.
10. Travel advance is a number only. There is no disbursement or adjustment against the claim.
11. No grade-wise expense limits or per-diem rules. The only rule is a receipt above ₹500.
12. Assets: no attachments, depreciation or link to Store/Maintenance. There are no overdue-return reminders.
13. Visitors: no badge printing or photo, and no edit UI (the API exists).
14. Nobody is notified when a request has no manager, or when a claim is approved but unpaid. HR sees these only on the dashboard.

---

## 12. Key files

| Area | Backend (`backend/app/modules/hr/`) | Frontend (`frontend/src/`) |
|---|---|---|
| Access | `services/access.py` | `app/dashboard/hr/layout.tsx`, `components/hr/HrNav.tsx` |
| Employees | `routes/employees.py`, `services/employees.py`, `services/employee_sync.py` | `app/dashboard/hr/employees/**`, `components/hr/employee/*` |
| Masters | `routes/masters.py`, `models/masters.py` | `app/dashboard/hr/masters/page.tsx`, `components/hr/masters/*` |
| Holidays / calendar | `routes/holidays.py`, `services/calendar.py` | `app/dashboard/hr/holidays/page.tsx` |
| Leave | `routes/leave.py`, `services/leave.py` | `app/dashboard/hr/leave`, `me/leave`, `components/hr/leave/LeaveApplyForm.tsx` |
| Attendance | `routes/attendance.py`, `services/attendance.py` | `app/dashboard/hr/attendance`, `me/attendance`, `components/hr/attendance/*` |
| Lifecycle | `routes/lifecycle.py`, `services/lifecycle.py`, `services/exit_guard.py` | `app/dashboard/hr/lifecycle/**`, `components/hr/lifecycle/*` |
| Assets | `routes/assets.py` | `app/dashboard/hr/assets/**`, `me/assets`, `components/hr/admin/AssetDialogs.tsx` |
| Travel / Claims | `routes/travel.py`, `routes/expenses.py`, `services/expenses.py` | `app/dashboard/hr/travel/**`, `me/travel`, `me/claims/**`, `components/hr/admin/{TravelDialogs,ClaimDetail}.tsx` |
| Visitors | `routes/visitors.py` | `app/dashboard/hr/visitors/page.tsx`, `components/hr/admin/VisitorDialogs.tsx` |
| Dashboard | `routes/dashboard.py`, `services/dashboard.py` | `app/dashboard/hr/page.tsx` |
| Approvals | (each area's `/pending-for-me` / `/approvals`) | `app/dashboard/hr/approvals/page.tsx`, `components/hr/approvals/*` |
| Reminders | `backend/app/tasks/hr_reminders.py` | — |
| Lock / permissions | `backend/app/core/module_visibility.py`, `backend/app/core/permission_registry.py` | `lib/tabAccess.ts` |
