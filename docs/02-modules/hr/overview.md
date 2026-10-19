# HR & Administration Module — Overview

**Module:** HR & Administration
**App key:** `hr`
**Backend Location:** `backend/app/modules/hr/`
**Frontend Location:** `frontend/src/app/dashboard/hr/`, `frontend/src/components/hr/`
**Prepared by:** Vineet Sharma
**Date:** 7 October 2026
**Status:** Built and live in code: employee master, HR masters, joiner/mover/leaver lifecycle, holidays, leave, attendance, assets, travel, expense claims, visitors, approvals inbox, dashboard and daily reminders. Payroll stays in ADP. The access model has a known problem, described in section 3.

The screen-by-screen walkthrough (every form, filter and button) is in [end-to-end-overview.md](end-to-end-overview.md). That document is accurate except §0 and the "Lock / permissions" row of §12. Both describe a `RESTRICTED_APPS` lock in `core/module_visibility.py` that has since been removed. Section 3 of this document gives the current access position.

---

# 1. Purpose

Scope decided on 29 September 2026: **the portal owns HR. Payroll stays in ADP.**

The module answers five questions:

1. **Who works here, in which role and grade, reporting to whom?** This is the employee master and the org chart.
2. **Who joined, moved or left, and was everything done when they did?** This is the joiner / mover / leaver lifecycle with checklists.
3. **Who is at work today, who is on leave, and what is each person's balance?** This covers holidays, leave and attendance.
4. **Which company assets does each person hold?** This is the asset register: laptops, SIMs, ID cards and vehicles.
5. **Which trips, expense claims and visitors are waiting for a decision?** These are the admin services, with one approvals inbox.

| In the portal | In ADP |
|---|---|
| Employee master, statutory IDs (PAN, Aadhaar last 4, UAN, ESIC) for reference | Salary structure, payslips, PF/ESI/PT/TDS returns |
| Leave balances and requests, attendance register | Loss-of-pay calculation and salary deduction |
| Monthly attendance summary **CSV export** | Payroll import of that CSV |
| Expense claim approval and the "paid" record (date and UTR) | The actual reimbursement payment |
| Exit event, handover, account revocation | Full and final (F&F) settlement |

> **ERP standard: why HR master data and payroll are split.**
> In SAP HCM, Oracle HCM or Darwinbox, "Core HR" (organisation, people, time) is a separate component from Payroll, and many companies run them on different systems. The two kinds of data move at different speeds and need different controls. Org data changes every day and every module reads it. Every approval route, every "who is the department head" check and every login depends on it, so it has to live where the other modules are. Payroll changes once a month, carries statutory risk, and needs a specialist engine for PF, ESI, PT and TDS slabs. It is safer to buy that engine (ADP) than to build it. The interface between the two is narrow and well understood: a monthly attendance and leave summary goes to payroll, and payments come back as references.

---

# 2. How HR relates to other modules

| Other module | What flows | Direction |
|---|---|---|
| **Main / Users** | HR reads the name, email and `is_active`. HR **writes** `reporting_manager_id`, `date_of_joining`, the free-text `department` and `designation` mirror, `branch_id`, `is_active`, and the approval flags (cleared on exit). Employee documents are kept in the platform's `user_documents` table. | Both ways |
| **Auth (Microsoft login, Azure sync)** | `services/exit_guard.py`: an exited employee can't sign in, and Azure sync or the admin "Activate" action can't revive them. `services/employee_sync.is_org_locked`: login and sync don't overwrite org fields that HR owns. | HR → Auth |
| **Organization** | Departments and Plants (`branches`) are HR's org structure. They are not HR masters. `Branch.working_days` drives weekly offs. Transfer and exit edit department-head slots. | Both ways |
| **P2P** | Exit and transfer move pending PR head approvals and assigned-buyer slots to the successor. P2P approval routing matches the `User.department` text, which HR keeps in sync. | HR → P2P |
| **Projects** | `projects/routes/work.py` reads `HrEmployeeProfile`. | Projects reads HR |
| **SharePoint** | Employee documents, leave attachments and expense receipts | HR writes |
| **Audit log** | Every HR model is registered in `core/audit_registry.py` (`module_key="hr"`). | HR writes |
| **Accounts / Store / Maintenance** | **None.** There are no journal entries, payment vouchers or advance ledger. HR assets are separate from Store stock and Maintenance equipment. | — |
| **ADP** | Manual: the attendance CSV export, F&F, and claim payment | Outside the portal |

---

# 3. Roles and access

## 3.1 What the code does today

There are three gates, and the module has a problem: **the first gate makes the self-service design unusable.**

| Gate | Where | Effect |
|---|---|---|
| **Router-level `require_hr_module`** | `services/access.py`, attached to **every** HR router in `main.py` (`dependencies=[Depends(require_hr_module)]`) | Any user without the `hr` app gets 403 on **every** `/hr/*` endpoint, including My HR, Apply Leave, Check-in and Approvals. |
| **Layout `useRequireApp('hr')`** | `frontend/src/app/dashboard/hr/layout.tsx` | Without the `hr` app, the whole `/dashboard/hr/*` tree redirects to the main dashboard. |
| **Per-endpoint `require_hr` vs `get_current_user`** | Every route file | Splits "HR team" endpoints (masters, register, lifecycle, mark paid) from "self-service" ones (my leave, my claims, approve-if-you-are-the-approver). |

`User.get_apps()` (`main/models/user.py`) now returns every app for portal admins (`role == "admin"`) and Azure tenant admins, and exactly `assigned_apps` for everyone else. The old `RESTRICTED_APPS` lock and the email allow-list have been removed. The file deletion is still uncommitted in the working tree at the time of writing.

**The consequence.** `is_hr(user)` is also defined as "has the `hr` app". Because the router gate already requires the `hr` app, **everyone who can reach the module is treated as the HR team.** Today:

- An ordinary employee **can't** use self-service. Without the `hr` app, they get 403 everywhere.
- If an admin grants an employee the `hr` app so that they can apply for leave, that employee also passes `require_hr`. They can then open every profile, see PII, edit masters, mark attendance, run exits and decide **anyone's** leave or claim (`can_decide` lets HR decide everything except their own requests).
- The `hrOnly` flag in `HrNav.tsx` and the redirect from the HR Dashboard to My HR never apply, because no user without `hr` gets that far.
- The daily reminders deliberately filter recipients to `hr`-app users (`recipients &= set(hr_ids)`). Employees and managers without the app are **not** told that their document is expiring or their probation is ending.
- Submit-time approval pings still go to the reporting manager, whether or not that manager has the `hr` app. A manager without the app is pinged (bell and Teams) about a leave request they can't open.

**Practical rule until this is fixed:** grant the `hr` app **only** to the HR and admin team. For everyone else, the self-service features are built but switched off.

**To open self-service** (a code change, not covered by this document), the HR team needs a gate separate from module access. One option is to remove `require_hr_module` from the routers and relax the layout gate for `/me`, `/approvals`, `/org-chart` and `/holidays`. Another is to give `require_hr`/`is_hr` a separate test, for example a Permission Matrix right or a dedicated `hr_admin` app. Either way, `is_hr` must stop meaning "can open the module".

> **ERP standard: why ESS and HR administration are separate roles.**
> Every HR system distinguishes **Employee Self-Service (ESS)**, **Manager Self-Service (MSS)** and the **HR administrator**. ESS is given to everyone and shows only *your own* records. MSS adds *your team's* records and approvals. HR admin is the small group that can see everyone's PII and change master data. The split exists because HR data is the most sensitive data in the company: date of birth, address, Aadhaar, disciplinary letters. Data-protection practice (and India's DPDP Act, 2023) expects access to personal data to be limited to people who need it. A design in which "can apply for leave" implies "can read everyone's address" fails that test.

## 3.2 Intended roles (as designed in the code)

| Role | How it is decided | Can do |
|---|---|---|
| **HR** | `is_hr(user)`: has the `hr` app (admins always do) | Masters, profiles, documents, lifecycle, attendance marking and import, leave allotment and adjustment, assets, the visitor gate, marking claims paid, and the dashboard. Can decide **any** request, including requests that have no approver. |
| **Approver (manager)** | Is the `approver_id` on a request. This is captured **at submit time** from the requester's `User.reporting_manager_id`. | Approve or reject that request. See direct reports' monthly attendance (`GET /hr/attendance/month`). |
| **Employee** | Any logged-in user | Own profile (personal fields only), own leave, attendance, travel, claims and assets. Pre-register visitors, see holidays and the org chart, complete checklist tasks they own. |

**`can_decide` rules** (`services/access.py`):
1. Nobody decides their own request, not even HR or an admin.
2. The captured approver can decide.
3. Any HR user can decide anything, including requests with no approver. An employee with no manager goes to the HR queue.

**HR self-dealing blocks.** HR can't edit their own HR profile, adjust their own leave balance, mark or import their own attendance, raise or complete a lifecycle event about themselves, or mark their own claim paid.

**Permission Matrix.** `MODULES["hr"]` in `core/permission_registry.py` has 13 subtab keys: `dashboard`, `me`, `approvals`, `employees`, `org_chart`, `lifecycle`, `leave`, `attendance`, `holidays`, `assets`, `visitors`, `travel`, `masters`. Today these only **hide nav tabs** (`filterTabsByAccess` in `HrNav.tsx`). No HR backend route checks them. An HR user with a tab hidden can still call its API.

> **ERP standard: why the approver is captured at submit time.**
> The approver is frozen on the request when it is raised, instead of being looked up live from the org chart. This means a later re-org can't silently move a half-decided request to someone who has never seen it, and the audit trail shows who was *supposed* to decide. The cost is that a manager change does not move requests that are already pending. In the portal, only the exit handover moves them (section 6.5).

---

# 4. Data model

All tables use `TimestampMixin`. Every model is registered in `core/audit_registry.py`, so field changes reach `audit_logs`. Status and type values are **coded tuples in the model files**. They are not admin-editable, following the no-metadata-customization rule. The tables were created by migration `a7c3e5f9b2d6_add_hr_administration_module.py`.

## 4.1 People core

**`hr_employee_profiles`** (`HrEmployeeProfile`): one row per portal user (`user_id` is unique).

| Column group | Columns | Notes |
|---|---|---|
| Identity | `employee_code` (unique) | |
| Organisation | `department_id`, `designation_id`, `grade_id`, `branch_id` (plant), `shift_id`, `work_location` | Department name, designation name and plant are mirrored onto `User` by `services/employee_sync.apply_org_fields`. |
| Employment | `employment_type` (`permanent`, `probation`, `contract`, `trainee`, `intern`, `consultant`), `employment_status` (`onboarding`, `probation`, `active`, `notice`, `exited`), `probation_end_date`, `confirmation_date`, `date_of_exit`, `exit_reason` | `exited` can only be set by an Exit event, never by editing the profile. |
| PII (`PII_FIELDS`) | gender, DOB, blood group, marital status, personal email and phone, emergency contact, current and permanent address, `pan_number`, `aadhaar_last4`, `uan_number`, `esic_number` | Returned only to HR and to the employee themself. **The full Aadhaar number is never stored.** |
| Control | `org_fields_locked` (default **true**), `notes` (HR-only), `created_by_id`, `updated_by_id` | When locked, Azure login and sync don't overwrite department, designation or manager. |

**The reporting manager and date of joining are not on the profile.** `User.reporting_manager_id` and `User.date_of_joining` are the single source of truth.

> **ERP standard: why the employee master is a separate record from the login.**
> In SAP, the *person* (infotype 0001/0002) and the *system user* (SU01) are different objects linked to each other. A person exists before they have a login (a joiner), and after the login is gone (a leaver whose records must be kept for years). The portal follows the same idea in a lighter form. `users` is the login and `hr_employee_profiles` is the HR record. The lifecycle can start a joining before the account exists, and an exit disables the login while the record stays.

**Masters** (`models/masters.py`):

| Table | Key columns | Rules |
|---|---|---|
| `hr_grades` | `code` (unique), `name`, `level` (higher = more senior) | Deleting a grade that is in use returns 409 ("Deactivate instead"). |
| `hr_designations` | `name` and `code` (both unique), `department_id`, `grade_id` (default grade) | Renaming a designation updates `User.designation` for every holder. |
| `hr_shifts` | `code`, `start_time`, `end_time`, `grace_minutes` (default 10), `working_hours`, `is_night`, `branch_id` (null = all plants) | An end time before the start time means a night shift. Shifts drive late marking. |
| `hr_leave_types` | see 4.2 | Can't be deleted. |
| `hr_checklist_templates` | `event_type`, `category`, `title`, `default_owner_user_id`, `sort_order` | Copied onto new lifecycle events. |

## 4.2 Time

| Table | Purpose | Key columns |
|---|---|---|
| `hr_holidays` | Holiday calendar | `holiday_date`, `name`, `holiday_type` (`national`, `festival`, `restricted`, `optional`), `branch_id` (null = all plants), `year`. Unique on (date, plant, name). |
| `hr_leave_types` | Leave policy per type | `code`, `annual_quota`, `is_paid`, `carry_forward`, `max_carry_forward`, `allow_half_day`, `requires_document_after_days`, `gender_restriction`, `max_consecutive_days`, `sort_order` |
| `hr_leave_balances` | One row per user × type × **calendar year** | `opening` (carried forward), `allotted`, `adjusted`, `used`. **`available` is computed** as opening + allotted + adjusted − used. |
| `hr_leave_requests` | `LV-YYYY-NNNN` | dates and sessions (`full`, `first_half`, `second_half`), `days`, reason, attachment, `status` (`pending`, `approved`, `rejected`, `cancelled`), `approver_id`, decision fields |
| `hr_attendance` | **One row per user per day** (unique) | `status` (`present`, `absent`, `half_day`, `on_leave`, `holiday`, `weekly_off`, `on_duty`, `work_from_home`), `check_in`, `check_out`, `shift_id`, `source` (`manual`, `self`, `regularization`, `leave`, `import`), `marked_by_id`. "Not marked" is computed and never stored. |
| `hr_attendance_regularizations` | `AR-YYYY-NNNN` correction request | `requested_status`, the check-in and check-out times, `reason`, `status`, `approver_id`, decision fields |

> **ERP standard: why balances are stored as buckets, not a single number.**
> A balance of "12" can't be audited. Splitting it into *opening* (carried from last year), *allotted* (this year's entitlement), *adjusted* (manual corrections, each with a reason in the audit log) and *used* (the sum of approved leave) means any balance can be explained line by line when an employee disputes it. SAP's time quotas work the same way: entitlement, deduction and correction are separate postings.

## 4.3 Lifecycle

**`hr_lifecycle_events`** (`LC-YYYY-NNNN`): `event_type` (`joining`, `confirmation`, `transfer`, `promotion`, `exit`), `user_id` (nullable: a joining can start before the account exists, so `candidate_name` and `candidate_email` identify the person), `status` (`draft`, `in_progress`, `completed`, `cancelled`), `effective_date`, **from/to snapshots** (department, plant, designation, grade, manager), exit fields (`exit_type`: resignation, termination, retirement, absconding, contract_end, death; `resignation_date`, `last_working_day`, `notice_period_days`, `exit_reason`), `handover_to_id`, `completion_summary` (JSON of everything the completion changed), completion and cancel stamps.

**`hr_checklist_items`**: `event_id`, `template_id`, `category` (`hr`, `it`, `admin`, `finance`, `manager`, `store`, which are labels only), `title`, `owner_user_id`, `status` (`pending`, `done`, `not_applicable`), `done_by_id`, `done_at`, `remarks`.

## 4.4 Admin services

| Table | Number | Key columns |
|---|---|---|
| `hr_assets` | `AST-NNNN` (editable; only exact `AST-<digits>` codes count toward the series) | category (laptop, desktop, mobile, sim, tablet, monitor, vehicle, id_card, access_card, furniture, tool, other), make, model, serial, purchase date and cost, vendor, invoice, warranty, plant, `status` (`in_stock`, `issued`, `under_repair`, `retired`, `lost`), `condition`, `current_holder_id`, `is_deleted` |
| `hr_asset_assignments` | — | Issue and return history: `user_id`, `issued_on`, `expected_return_on`, the condition on issue and on return, `returned_on`, `received_by_id` |
| `hr_travel_requests` | `TR-YYYY-NNNN` | purpose, from and to cities, depart and return dates, `travel_mode`, `accommodation_required`, `advance_required` (information only), `estimated_cost`, `project_reference`, `status` (`pending`, `approved`, `rejected`, `cancelled`, `completed`), `approver_id` |
| `hr_expense_claims` | `EXP-YYYY-NNNN` | `travel_request_id` (optional), `title`, `total_amount`, `status` (`draft`, `submitted`, `approved`, `rejected`, `paid`, `cancelled`), `approver_id`, `paid_on`, `payment_reference`, `paid_by_id` |
| `hr_expense_claim_items` | — | `expense_date`, `category` (travel, lodging, food, local_conveyance, fuel, phone, other), `amount`, and the receipt URL, path and filename (SharePoint) |
| `hr_visitors` | `VIS-YYYY-NNNN` | visitor name, company, phone, email, `id_proof_type`, **`id_proof_last4` only**, purpose, `host_user_id`, plant, expected time, check-in and check-out times, badge, vehicle, items carried, number of persons, `status` (`expected`, `checked_in`, `checked_out`, `cancelled`) |

---

# 5. Number series

| Series | Format | Scope |
|---|---|---|
| Lifecycle event | `LC-YYYY-NNNN` | Yearly |
| Leave request | `LV-YYYY-NNNN` | Yearly (IST year) |
| Attendance correction | `AR-YYYY-NNNN` | Yearly |
| Travel request | `TR-YYYY-NNNN` | Yearly |
| Expense claim | `EXP-YYYY-NNNN` | Yearly |
| Visitor | `VIS-YYYY-NNNN` | Yearly |
| Asset | `AST-NNNN` | Never restarts. Can be overridden with any code. |

The series use the shared `next_sequential_id` helper. Assets use their own numeric-safe helper.

---

# 6. Workflows

## 6.1 Working calendar (used by leave and attendance)

`services/calendar.py` holds the rules that both leave and attendance use:

- All dates are **IST**.
- **Weekly off** is read from the plant's `Branch.working_days` text (for example "Mon-Sat"). If the text can't be read, Sunday is the only weekly off.
- An employee's plant is the profile plant, or else `User.branch_id`.
- **Days off** are weekly offs plus active **National** and **Festival** holidays for all plants or the employee's plant. **Restricted** and **Optional** holidays are not days off: employees take them as leave.

## 6.2 Leave

```text
HR: Allot year (once a year, manual) ─► balances: opening (carry-forward) + allotted
        │
Employee: Apply ─► live preview (days counted, balance, approver, rule errors)
        │          approver = reporting manager now; no manager → HR queue
        ▼
     PENDING ──approve (manager or HR)──► APPROVED ──cancel (only before from_date)──► CANCELLED
        │                                     │  used += days; attendance rows written as on_leave / half_day (source=leave)
        ├──reject (reason required)──► REJECTED
        └──cancel (owner or HR)──────► CANCELLED
```

- **Allot year** (`POST /hr/leave/balances/allot`): an employee who joined in an earlier year gets the full quota. One who joins this year gets quota × months ÷ 12; the joining month counts if they joined on or before the 15th, and the result rounds down to 0.5. Carry-forward types get `opening = min(last year's available, max_carry_forward)`. Gender-restricted types are skipped when the gender doesn't match or isn't recorded. The action is **safe to re-run**: it never touches `used` or `adjusted`.
- **Adjust** (`POST /hr/leave/balances/adjust`): ± days in 0.5 steps, with a reason required. The balance can't go negative. The adjustment is audited and the employee is notified.
- **Validation order** on apply: type is active → same calendar year → half day allowed → at most 366 days → to date on or after from date → days > 0 → gender restriction → maximum consecutive days → document required above N days → no overlap with own pending or approved leave → (paid types) enough balance after pending requests are counted.
- **Sandwich rule is an HR setting, default OFF** (decided 2026-10-07). HR → Settings → Leave → "Sandwich rule" (`leave_sandwich_rule`, `hr/settings.py`, on the shared settings framework). **Off (default):** only working days are charged; weekly offs and holidays inside a leave are free. **On:** an off or holiday that falls *between* two leave days of the same request is charged as a full day (Friday + Monday leave on a Mon–Fri plant = 4 days); offs/holidays at the start or end of a request are never charged. The setting applies to new requests and to pending requests when they are approved (days are re-counted on approve); already-approved leave is not re-counted (`services/leave.py`).
- **On approve**: days are re-counted (in case a holiday was added since), the balance is re-checked, and attendance clashes are checked. If the employee is already marked present on any of those days, the approval fails with 409.
- **Cancelling approved leave** is allowed only before `from_date`. It does `used -= days` and removes the leave attendance rows. After the leave has started, the employee is told to ask HR to correct attendance and adjust the balance.
- HR can **apply on behalf** of an employee (`user_id` on `POST /hr/leave/requests`).

> **ERP standard: why leave writes attendance, and attendance blocks leave.**
> Payroll needs **one** record per person per day. If leave and attendance were kept separately, a day could be both "present" and "on leave", and payroll would pay it twice or deduct it twice. Approving leave therefore *posts* to the attendance register, and the register refuses a clash. Leave-sourced attendance rows are protected, so nobody can overwrite them by hand. This is the same "one posting, one ledger" rule as Store stock.

> **ERP standard: anti-sandwich.**
> Under a "sandwich rule", a Sunday between Friday and Monday leave is charged as leave. Indian companies decide this as a matter of policy, so the portal makes it a single HR setting (decided 2026-10-07, default **off** = count only working days, which is kinder to employees and simpler to explain). Switching it on is a coded rule applied to every request the same way. It must never be imitated by HR adjusting balances by hand. The setting is company-wide, not per leave type; a per-type rule would be a later code change.

## 6.3 Attendance

**Where rows come from** (`source`):

| Source | How |
|---|---|
| `self` | The employee clicks **Check in / Check out** on My Attendance. This is a web click, with no GPS or device. |
| `manual` | HR marks a day in the Daily register, one at a time or in bulk. |
| `import` | HR uploads a CSV, such as a biometric export: template → dry run → import. CSV only, at most 5 MB and 20,000 rows. Codes: P, A, HD, OD, WFH, H, WO. |
| `leave` | Written by leave approval. **Protected**: nobody can edit it by hand. |
| `regularization` | Written by an approved correction request |

- **Late marking**: a check-in after shift start plus grace counts as late. This needs a shift on the profile.
- **Edit rules**: HR can't mark their own attendance. A future date can only be On duty, WFH or Absent. `on_leave` can never be set by hand. Check-out must be after check-in, except on night shifts.
- **Monthly summary** shows Present, Half day, Absent, Leave, On duty, WFH, Holiday, Weekly off, Not marked, Late, and **Present-equivalent** (P + OD + WFH + 0.5 × HD). The **CSV export** is the hand-off to ADP.
- **Correction (regularization)**: the employee picks a past day, the correct status (Present, Half day, On duty or WFH), times and a reason. The date must be **within 60 days**, can't be a full-day leave, and can have only one pending request. The request is approved or rejected by the manager or HR. Approval overwrites the attendance row.

> **ERP standard: why corrections go through a request, not an edit.**
> Attendance drives pay. If an employee or manager could edit the register directly, nobody could later tell a genuine correction from a convenient one. A regularization request leaves a trail: who asked, why, who approved, and what the row said before. The 60-day window matches the usual payroll cut-off logic, which stops a month that ADP has already paid from being reopened. A full-day leave can't be "regularized" away, because the leave has to be cancelled through the leave workflow, which also restores the balance.

## 6.4 Lifecycle: joiner, mover, leaver

```text
DRAFT ──start──► IN_PROGRESS ──complete──► COMPLETED (frozen)
  │                  │
  └──────cancel──────┴──────► CANCELLED (reason required, frozen)
```

| Type | Use for | Default checklist | What **Complete** does |
|---|---|---|---|
| **Joining** | A new hire or a rehire | 7 items (HR ×3, IT ×2, Admin, Manager) | If the candidate wasn't in the portal yet, **Link user** first (found by email after their first Microsoft sign-in or a "Sync Azure Users"). Creates or updates the profile with status `probation` or `active`, and sets DOJ, manager, department, designation, grade and plant. The account is re-activated **only** for an exited rehire. |
| **Confirmation** | Probation → confirmed | none | Needs status `probation` or `onboarding`. Sets `active` and the confirmation date. Type `probation` becomes `permanent`. |
| **Transfer** | Department, plant or manager change | 3 items | Applies the new values. The completion panel lets HR remove approval roles that don't carry over, decide the old department-head slot (keep, remove, or give to the successor), and move pending **P2P** approvals to the successor. |
| **Promotion** | New designation or grade | none | Applies the new designation and grade. |
| **Exit** | A leaver | 8 items | See 6.5 |

- On creation, active templates for the event type are copied as **pending** checklist items. The owner is the template's default owner. A **Manager**-category item with no default owner goes to the employee's manager. Any other item without an owner is unassigned, and HR assigns it.
- Owners are notified only when the event moves to **In Progress**. Non-HR owners see their tasks under "Your onboarding / offboarding tasks" on the Lifecycle and Approvals pages.
- Only **Exit** is blocked by pending items. The other types can be completed with items still open.
- The `from_*` fields are snapshotted automatically, so the event records the before-and-after.

> **ERP standard: why org changes go through events, not profile edits.**
> SAP calls these "personnel actions" (hiring, org reassignment, leaving). Every change to *where a person sits* is an event with an effective date, a before-and-after snapshot and a checklist. A plain profile edit would change the department but leave behind the approval roles, pending approvals, assets and system access that went with the old position. That is why the profile form **refuses** to set `exited`, and why transfers have a completion panel. The event carries the side effects that the edit would miss.

## 6.5 Exit and how it revokes access

1. **Create** the Exit event: the profile status becomes `notice`. Cancelling the event sets it back to `active`.
2. **Impact preview** (`GET /hr/lifecycle/events/{id}/impact`) lists everything that hangs off the leaver: reportees, department-head slots, approval flags, pending approvals where they are the approver, P2P head approvals and buyer slots, owned checklist tasks and templates, held assets, and their own open requests and claims.
3. **Blockers** (409 unless HR chooses "Complete anyway" and gives a reason): pending checklist items, and **HR assets not returned**.
4. A **handover person is required** when there is anything to hand over.
5. **Complete** runs in one transaction:
   1. Direct reportees get the handover person as their new manager. Each reportee is notified.
   2. Department-head slots go to the handover person if they are in the same plant. Otherwise the slots are cleared.
   3. Pending leave, corrections, travel and claims where the leaver is the approver go to the handover person.
   4. P2P: pending head approvals and the "assigned buyer" on open PRs go to the handover person.
   5. The leaver's open checklist tasks and template ownerships go to the handover person.
   6. The leaver's **own** pending leave, corrections and travel, and their draft claims, are auto-cancelled. Submitted and approved claims are kept with a warning: **settle in F&F in ADP**.
   7. All approval flags are cleared: `is_department_head`, `is_project_head`, `is_plant_head`, `is_purchase_head`, `is_director`, `is_partner`, `is_finance_manager`.
   8. The profile is set to `exited`, with the date of exit and exit reason.
   9. **The portal account is deactivated** (`user.is_active = False`) and **every live session is revoked** (`exit_guard.revoke_user_sessions`). From then on, Microsoft login refuses the user with a message naming the exit date (`auth.py` → `is_exited`). "Sync Azure Users" and the admin "Activate" action can't revive them. The only way back is HR completing a new **Joining** event.

**Not done by the portal:** disabling the **Azure / Microsoft 365** account (mailbox, Teams, OneDrive) is a manual IT task. It belongs on the IT checklist item.

> **ERP standard: why the exit does the handover, not the people.**
> When someone leaves, the dangerous failures are silent: a PR waiting for an approver who no longer exists, reportees with no manager, a department with no head, a laptop nobody collected, or a login that still works. A good HR system treats the leaver event as the trigger for *all* of these, with a preview first so HR sees the blast radius. Revoking access is an audit control (SOX and ISO 27001 both expect timely de-provisioning), which is why the session revocation and the login block happen in the same transaction as the status change and do not depend on someone remembering to do them.

## 6.6 Admin services

**Assets**

```text
create → IN_STOCK ──issue──► ISSUED ──return──► IN_STOCK / UNDER_REPAIR / RETIRED
            │                   └──mark lost──► LOST (assignment auto-closed)
            ├──► UNDER_REPAIR ──► IN_STOCK / RETIRED
            ├──► RETIRED ──► IN_STOCK
            └──► LOST ──► IN_STOCK
```

The holder is notified on issue and return. A return in "damaged" condition defaults to Under repair. Deleting an asset is a soft delete, and it is blocked while the asset is issued. **Any asset still held blocks an exit.**

**Travel**

```text
PENDING ──approve (manager or HR)──► APPROVED ──mark completed (HR)──► COMPLETED
   ├──reject (reason) → REJECTED (final: raise a new request)
   └──cancel (owner) → CANCELLED  (an approved trip can be cancelled only before departure)
```

The From and To cities must differ: local conveyance goes straight on a claim. "Advance needed" is **information only**. Approved and completed trips show a "Claim expenses" link.

**Expense claims**

```text
DRAFT ──submit──► SUBMITTED ──approve (manager or HR)──► APPROVED ──mark paid (HR)──► PAID
                     └─reject (reason)─► REJECTED ──edit & resubmit──► SUBMITTED
DRAFT / REJECTED / SUBMITTED ──cancel/withdraw (owner)──► CANCELLED
```

Any line **above ₹500 needs a receipt** before the claim can be submitted. **Mark paid** records the paid date and a payment reference (UTR, NEFT or cheque). The money moves outside the portal. HR can't mark their own claim paid.

**Visitors**

```text
EXPECTED ──check in (HR)──► CHECKED_IN ──check out (HR)──► CHECKED_OUT
    └ cancel (HR, host or creator) → CANCELLED
Walk-in (HR) → CHECKED_IN directly
```

Employees pre-register visitors and are always the host. HR runs the gate board. Only the last 4 characters of an ID proof are stored. The host is notified when the visitor arrives.

> **ERP standard: why "approved" and "paid" are separate states.**
> Approval is a *business* decision ("this expense was legitimate"). Payment is a *treasury* event ("money left the bank"). Keeping them apart, with a payment reference required on the second, means an approved-but-unpaid list exists, and someone owes the employee money. It also means every "paid" claim can be traced to a bank line. In a full ERP, "paid" would be posted by Accounts from a payment voucher. Here it is recorded by HR, because the reimbursement runs through ADP or the bank.

## 6.7 Approvals inbox

`/dashboard/hr/approvals` puts five sections on one page: leave, attendance corrections, travel, expense claims, and "your onboarding / offboarding tasks". A user sees the items where they are the approver. HR also sees items with no approver. A user's own requests never appear. Every rejection needs a reason. Each area serves its list from its own `/pending-for-me` or `/approvals` endpoint.

---

# 7. Notifications and reminders

All notifications go through `notify_user`. **Teams is opt-in (`teams=True`) and is used only for "waiting for you" approvals and reminders.** Everything else is bell-only.

| Event | To | Channel |
|---|---|---|
| Leave, correction, travel or claim submitted (or claim resubmitted) | The captured approver | Bell + **Teams** |
| Approved or rejected | Requester | Bell |
| Approved leave or travel cancelled, claim withdrawn | Approver / decider | Bell |
| Balance adjusted, leave applied on behalf | Employee | Bell |
| Claim paid | Claimant | Bell |
| Asset issued or returned | Holder | Bell |
| Visitor registered, arrived or cancelled | Host | Bell |
| Checklist task assigned (event started, item added, owner changed) | Item owner | Bell |
| Exit: manager changed / handover | Each reportee / the handover person | Bell |
| Lifecycle event completed | All HR users | Bell |

**Daily scheduled job: `hr_reminders` at 09:00 IST** (`backend/app/tasks/hr_reminders.py`, registered in `main.py`):

| Reminder | Trigger | Recipients | Channel |
|---|---|---|---|
| `hr_document_expiring` | `user_documents.expiry_date` exactly 30 days away, 7 days away, or today | Employee + HR. "HR Only" documents go to HR only. **The list is then filtered to `hr`-app users**, so in practice only HR is notified (section 3.1). | Bell + **Teams** |
| `hr_probation_ending` | Profile status `onboarding` or `probation`, with a probation end date within 7 days | HR + reporting manager + employee, **filtered to `hr`-app users**. Sent once per probation end date. | Bell + **Teams** |

Deduplication is one notification per recipient, entity and type per day (or per probation end date), so a scheduler restart doesn't send twice. An employee with **no manager** generates no approval ping. Their request sits in the HR queue and appears on the HR dashboard.

---

# 8. API endpoints

All routes are under `/api/v1` with the tag `HR`. **Every router also carries `require_hr_module`** (section 3.1). In the tables, "HR" means `Depends(require_hr)`, and "user" means `get_current_user` plus any rule enforced inside the handler.

**Employees** (`routes/employees.py`, `/hr/employees`)
| Method and path | Gate |
|---|---|
| `GET /hr/employees` (list of all users joined to profiles; filters and paging) | HR |
| `GET /hr/employees/me`, `PATCH /hr/employees/me` (personal fields only) | user |
| `GET /hr/employees/me/documents`, `GET …/me/documents/{id}/content` (excludes "HR Only") | user |
| `GET /hr/employees/directory`, `GET /hr/employees/org-chart` (no PII) | user |
| `GET /hr/employees/{user_id}`, `PATCH /hr/employees/{user_id}` | HR |
| `GET/POST /hr/employees/{user_id}/documents`, `GET …/{doc_id}/content`, `DELETE …/{doc_id}` | HR |

**Masters** (`routes/masters.py`, `/hr/masters`): all HR
`GET /lookups` · `GET/POST /grades`, `PATCH/DELETE /grades/{id}` · `GET/POST /designations`, `PATCH/DELETE /designations/{id}` · `GET/POST /shifts`, `PATCH/DELETE /shifts/{id}`

**Holidays** (`routes/holidays.py`, `/hr/holidays`)
| Method and path | Gate |
|---|---|
| `GET /hr/holidays/branches`, `GET /hr/holidays` | user |
| `POST /hr/holidays`, `POST /bulk` (at most 200 rows), `POST /copy` (copy a year), `PATCH /{id}`, `DELETE /{id}` | HR |

**Leave** (`routes/leave.py`, `/hr/leave`)
| Method and path | Gate |
|---|---|
| `GET /types` | user |
| `POST /types`, `PATCH /types/{id}` | HR |
| `GET /balances/me` | user |
| `GET /balances`, `POST /balances/allot`, `POST /balances/adjust` | HR |
| `GET /requests/me`, `GET /requests/pending-for-me`, `POST /requests/preview`, `POST /requests` (multipart; `user_id` = on behalf, HR only) | user |
| `GET /requests` | HR |
| `GET /requests/{id}`, `POST/GET /requests/{id}/attachment` | user (own, approver or HR) |
| `POST /requests/{id}/approve`, `/reject`, `/cancel` | user + `can_decide` / owner rules |

**Attendance** (`routes/attendance.py`, `/hr/attendance`)
| Method and path | Gate |
|---|---|
| `GET /me/today`, `POST /me/check-in`, `POST /me/check-out`, `GET /me/month` | user |
| `GET /month?user_id` | self, direct manager, or HR |
| `GET /lookups`, `GET /register`, `PUT /entries`, `DELETE /entries/{id}`, `PUT /register/bulk` | HR |
| `GET /import/template`, `POST /import?dry_run=` | HR |
| `GET /summary`, `GET /summary/export` (CSV for ADP) | HR |
| `POST /regularizations`, `GET /regularizations/me`, `GET /regularizations/pending-for-me` | user |
| `GET /regularizations` | HR |
| `POST /regularizations/{id}/approve`, `/reject`, `/cancel` | user + `can_decide` / owner rules |

**Lifecycle** (`routes/lifecycle.py`, `/hr/lifecycle`)
| Method and path | Gate |
|---|---|
| `GET /meta`, `GET /events/counts`, `GET /events`, `GET /users/{user_id}/events` | HR |
| `GET /my-tasks` | user |
| `POST /events`, `PATCH /events/{id}`, `POST /events/{id}/cancel`, `POST /events/{id}/link-user` | HR |
| `GET /events/{id}` | user (HR, or a checklist owner with HR-only fields hidden) |
| `GET /events/{id}/impact` (alias `/exit-impact`), `POST /events/{id}/complete` | HR |
| `POST /events/{id}/items`, `DELETE /items/{id}` | HR |
| `PATCH /items/{id}` (done, N/A, reopen, remark; owner change is HR only) | user (owner or HR) |
| `GET/POST /templates`, `PATCH/DELETE /templates/{id}` | HR |

**Assets** (`routes/assets.py`, `/hr/assets`)
| Method and path | Gate |
|---|---|
| `GET /lookups/branches`, `GET /mine`, `GET /mine/history` | user |
| `GET /meta`, `GET /by-user/{user_id}`, `GET ""`, `GET /{id}`, `POST ""`, `PATCH /{id}`, `DELETE /{id}` | HR |
| `POST /{id}/issue`, `POST /{id}/return`, `POST /{id}/status` | HR |

**Travel** (`routes/travel.py`, `/hr/travel`)
| Method and path | Gate |
|---|---|
| `GET /mine`, `GET /approvals`, `POST ""`, `GET /meta`, `GET /{id}`, `PATCH /{id}` (pending only) | user |
| `GET ""` | HR |
| `POST /{id}/approve`, `/reject`, `/cancel` | user + `can_decide` / owner rules |
| `POST /{id}/complete` | HR |

**Expense claims** (`routes/expenses.py`, `/hr/expenses`)
| Method and path | Gate |
|---|---|
| `GET /meta`, `GET /mine`, `GET /travel-options`, `GET /approvals`, `POST ""`, `GET /{id}`, `PATCH /{id}` | user |
| `GET ""` | HR |
| `POST/PATCH/DELETE /{id}/items[/{item_id}]`, `POST/DELETE/GET /{id}/items/{item_id}/receipt` | user (owner while draft or rejected; viewers by rule) |
| `POST /{id}/submit`, `/approve`, `/reject`, `/cancel` | user + `can_decide` / owner rules |
| `POST /{id}/mark-paid` | HR (not own claim) |

**Visitors** (`routes/visitors.py`, `/hr/visitors`)
| Method and path | Gate |
|---|---|
| `GET /mine`, `POST ""`, `GET /{id}`, `PATCH /{id}`, `POST /{id}/cancel` | user (host or creator; HR for any) |
| `GET /board`, `GET ""`, `POST /{id}/check-in`, `POST /{id}/check-out` | HR |

**Dashboard** (`routes/dashboard.py`): `GET /hr/dashboard`, HR only.

---

# 9. Frontend pages

Every page sits under `layout.tsx` (`useRequireApp('hr')`), with `HrNav` above the header. My HR pages also show the `MyHrTabs` pill row.

| Route | Page | Intended audience |
|---|---|---|
| `/dashboard/hr` | Dashboard: headcount, joiners and exits, on leave today, attendance today, pending approvals, open lifecycle events, assets issued, visitors inside, documents expiring, probation ending, claims to pay. Non-HR users are redirected to My HR. | HR |
| `/dashboard/hr/me` | My HR profile with "Edit My Details" and own documents | Everyone |
| `/dashboard/hr/me/leave`, `/me/attendance`, `/me/travel`, `/me/claims`, `/me/claims/[id]`, `/me/assets` | Self-service leave (`LeaveApplyForm`), attendance (check in and out, month calendar, request correction), travel, claims, and assets (read-only) | Everyone |
| `/dashboard/hr/approvals` | Approvals inbox (`components/hr/approvals/*`) | Everyone |
| `/dashboard/hr/org-chart` | Reporting tree with no PII | Everyone |
| `/dashboard/hr/holidays` | Holiday calendar. HR can add, bulk add, copy a year, edit and deactivate. | View: everyone. Edit: HR. |
| `/dashboard/hr/employees`, `/[id]`, `/[id]/edit` | Employee list. The detail page has Profile, Documents, Lifecycle, Leave, Attendance and Assets tabs. The profile form is also here. | HR |
| `/dashboard/hr/lifecycle`, `/new`, `/[id]` | Event list, new event form, and event detail with `ChecklistPanel` and `CompletionPanel` | HR (checklist owners can open events) |
| `/dashboard/hr/leave` | Requests and Balances tabs (allot, adjust, apply on behalf) | HR |
| `/dashboard/hr/attendance` | Daily register, Employee month, Monthly summary (CSV), Import, Corrections | HR |
| `/dashboard/hr/assets`, `/[id]` | Asset register and asset detail with issue and return | HR |
| `/dashboard/hr/visitors` | HR gets the gate board and register. Everyone else gets My Visitors with pre-register. | Both |
| `/dashboard/hr/travel`, `/travel/claims/[id]` | Travel requests and Expense claims tabs, claim detail, mark paid | HR |
| `/dashboard/hr/masters` | Designations, Grades, Shifts, Leave Types, Checklist Templates | HR |

"Everyone" is the intended audience. Today it reaches only users who hold the `hr` app (section 3.1).

---

# 10. Known gaps

**Access**
1. **No separation between self-service and the HR team** (section 3.1). The router gate requires `hr` for everything, and `is_hr` also means "has `hr`". The module can't be rolled out to all employees without exposing everyone's PII and HR powers.
2. Permission Matrix subtabs only hide nav tabs. No HR endpoint enforces them.
3. Reminders are filtered to `hr`-app users, so employees and managers aren't told about expiring documents or probation ending. Meanwhile, approval pings reach managers who may not be able to open the module.

**Leave and attendance**
4. **No accrual engine.** Leave is allotted once a year by a manual "Allot year". There is no monthly or quarterly accrual, no year-end carry-forward or lapse job, and no encashment.
5. **Earned leave under the Factories Act is not implemented.** Section 79 of the Factories Act, 1948 gives adult workers 1 day of earned leave per 20 days worked in the previous calendar year, once they have 240 days of attendance. The balance carries forward up to 30 days, and leave refused on application must be carried. The portal's fixed annual quota ignores days actually worked. An "EL" type configured with a flat quota is not compliant for workers. This needs a rule that reads last year's `hr_attendance` (Present-equivalent days) when allotting.
6. **No overtime and no real shift management.** There is one shift per profile, used only for late marking. There is no rotation or roster, no OT hours, no OT approval and no OT export for payroll. Factories Act §59 requires double wages for hours over 9 a day or 48 a week, and that calculation needs OT recorded at source.
7. **No statutory registers.** Form 12 (adult workers register), Form 14 (leave with wages register) and Form 25 (muster roll) are not produced. The data mostly exists in profiles, leave and attendance. What is missing is the formatted output, and the Word-document rule applies.
8. Changing a manager doesn't move pending requests (only an exit handover does). Editing a holiday doesn't recalculate approved leave.
9. There is no biometric or device integration (CSV import only). Web check-in has no geo-fence.

**Lifecycle**
10. **No exit no-dues.** An exit checks only HR assets and checklist items. It does not check Store issues to the person, travel advances, open expense claims (it only warns), Accounts dues, or library and tool-crib items. There is no no-dues certificate document. F&F happens in ADP with no structured hand-off.
11. Transfers move pending P2P approvals but not pending HR approvals.
12. Checklist categories are labels: there is no team-based routing ("IT team"). Confirmation and Promotion have no default checklist.
13. Disabling the Azure / Microsoft 365 account is manual.

**Admin services**
14. Approval is single-level everywhere, with no finance step for claims, no grade-wise expense limits and no per-diem. The only rule is the receipt requirement above ₹500.
15. A travel advance is a number only, with no disbursement or settlement against the claim.
16. Assets have no attachments, depreciation or overdue-return reminders. Visitors have no badge printing or photo, and no edit UI (the API exists).

> **ERP standard: why statutory registers belong in the system that records the data.**
> A factory inspector asks for Form 12, Form 14 and Form 25 for any past month, on the day of the visit. If they are kept by hand alongside the portal, they will disagree with it, and the inconsistency itself becomes the finding. A register generated from the same `hr_attendance` and `hr_leave_balances` rows that payroll used is consistent by construction. The same reasoning drives the Factories Act earned-leave rule: entitlement depends on days *actually worked*, so it has to be computed from attendance, not typed in.

---

# 11. What this module does not do

- **Payroll**: no salary, payslips, PF/ESI/PT/TDS, loss-of-pay calculation or F&F settlement. These stay in ADP. The portal only exports the attendance summary and records payment references.
- **Recruitment**: no requisitions, candidate pipeline or offer letters. A Joining event starts once the person has been hired.
- **Performance and training**: no appraisals, KRAs, competency or training records.
- **Accounting**: no journal entries for claims or advances.
- **Plant equipment**: that is Maintenance. HR assets are employee-issued items only.

---

# 12. Related documentation

- [HR end-to-end overview](end-to-end-overview.md): every screen, field and button. Ignore its §0 and the "Lock / permissions" row in §12 (the removed `RESTRICTED_APPS` lock).
- [Platform overview](../platform/overview.md): the `User` model, Azure login and sessions
- [P2P overview](../p2p/overview.md): approval slots that exit and transfer hand over
- [Maintenance overview](../maintenance/overview.md): plant equipment, kept separate from HR assets
- [Changelog](../../09-operations/changelog.md)
