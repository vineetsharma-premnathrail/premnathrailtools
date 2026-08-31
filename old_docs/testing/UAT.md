# User Acceptance Testing (UAT) — Template

> **This is a template, not a record of a process that exists.** As of
> 2026-08-14, there is no formal UAT process in this repository — no UAT
> sign-off log, no dedicated UAT environment documented, and no history of
> completed UAT rounds found in `docs/`. This file is a lightweight starting
> point for whoever runs the first real UAT pass, per module. Copy the
> relevant module section into a tracking doc/spreadsheet/issue per release
> and fill it in — don't treat the checkboxes below as already-verified.

## How to use this template

1. Pick the module(s) touched by the release/change.
2. Copy that module's checklist into a new tracking document (or a GitHub
   Issue — see `BUG_TRACKING.md`).
3. Have an actual business user (not the developer who wrote the feature)
   walk through each item against a real (or staging) deployment.
4. Log any failure as a bug (see `BUG_TRACKING.md`) and link it next to the
   failed item.
5. Get sign-off once every item passes or has an accepted/documented
   exception.

---

## Cross-module baseline (run for every release)

- [ ] Can log in via Microsoft OAuth (`/auth/microsoft-login`) with a
      `@premnathrail.com` account.
- [ ] Login is rejected for a non-`@premnathrail.com` account.
- [ ] An inactive/deactivated user cannot access any protected page.
- [ ] Session persists across a page refresh (cookie-based session works).
- [ ] Logout actually clears the session (protected pages redirect to login
      afterward).
- [ ] Sidebar only shows the apps (`erp`, `crm`, `rnd`, `purchase`,
      `p2p`, users/admin) the logged-in user is assigned.

---

## Main / Admin (Users)

- [ ] Admin can view the full user list.
- [ ] Admin can change a user's role.
- [ ] Admin cannot deactivate their own account (should be blocked).
- [ ] Admin can deactivate another user, and that user is immediately locked
      out.
- [ ] Admin can assign/remove app access (crm/erp/rnd/purchase/etc.) for a
      user, and the change takes effect without the user needing to log out.
- [ ] Admin can grant/revoke fine-grained ERP permissions and they take
      effect.
- [ ] Non-admin user cannot reach any admin-only screen or API response
      (verify via UI, not just "the link isn't shown").
- [ ] "Sync from Azure AD" (if exposed in UI) correctly adds new tenant users
      and deactivates users no longer in the tenant.

**Sign-off:** Tester: __________ Date: __________ Result: Pass / Fail / Pass with notes: __________

---

## ERP (Projects & Service Requests)

- [ ] Create a new project with required fields; it appears in the project
      list.
- [ ] Edit an existing project; changes persist after refresh.
- [ ] Upload a project attachment; it appears and can be downloaded.
- [ ] A "private" attachment is not visible/downloadable to a user without
      the right permission.
- [ ] Create a Service Request against a project; add materials to it.
- [ ] A user without `project_create`/relevant ERP permission cannot create
      or edit — UI should not silently succeed.
- [ ] Raise a Purchase Requisition from Service Request materials (the
      ERP → Purchase handoff) and confirm it appears on the Purchase side.

**Sign-off:** Tester: __________ Date: __________ Result: Pass / Fail / Pass with notes: __________

---

## CRM

- [ ] Create an Organization, an Inquiry, and a Tender; confirm they link
      correctly to each other.
- [ ] Duplicate-prevention: attempting to create a duplicate Organization/
      Inquiry/Tender is blocked or flagged as expected.
- [ ] Log a stage change on an Inquiry/Tender and confirm it shows in
      history.
- [ ] Delete an Organization (cascade) and confirm dependent
      Inquiries/Tenders behave as expected (deleted or restorable).
- [ ] Restore a deleted record and confirm data integrity.
- [ ] Upload a document to an Organization/Inquiry (SharePoint-backed) and
      confirm it lists and can be deleted.
- [ ] Log an Activity (call/meeting/etc.), attach a photo, and confirm it
      shows correctly on both the Activity list and the related
      Organization's Activities tab.
- [ ] Create/verify a follow-up reminder fires the right in-app
      notification on the due date (see `test_followup_reminders.py` for
      the logic being verified manually here).
- [ ] A user without CRM access assigned cannot see CRM data.

**Sign-off:** Tester: __________ Date: __________ Result: Pass / Fail / Pass with notes: __________

---

## R&D

- [ ] Run a core R&D tool/calculation and confirm the result and its saved
      history entry are correct.
- [ ] Confirm a calculation snapshot is recorded (used for LaTeX
      report generation — verify special characters in inputs render
      correctly and don't break the generated document).
- [ ] A user without R&D access cannot reach R&D screens or data.

**Sign-off:** Tester: __________ Date: __________ Result: Pass / Fail / Pass with notes: __________

---

## Purchase (ERP-embedded PR lifecycle)

- [ ] Raise a Purchase Requisition from an ERP Service Request's materials.
- [ ] Approve a PR; confirm status updates and relevant users are notified.
- [ ] Reject a PR; confirm status updates and reason is recorded/visible.
- [ ] Cancel a PR.
- [ ] Receive a PR partially, then fully; confirm remaining-quantity math is
      correct at each step.
- [ ] Add a remark to a PR line item.
- [ ] Confirm item photos are view-only here (no upload/delete control on
      the Purchase side — uploads happen via the ERP route only).
- [ ] Close a fully-received PR.

**Sign-off:** Tester: __________ Date: __________ Result: Pass / Fail / Pass with notes: __________

---

## Purchase Requisition (standalone module)

> No automated test coverage exists for this module as of 2026-08-14 (see
> `TESTING.md`'s Coverage Gaps section) — manual UAT here matters more than
> usual until that's addressed.

- [ ] Create a new Purchase Requisition request directly (not via ERP
      Service Request handoff) with required fields, priority, and
      required-by date.
- [ ] Attach a document/attachment to a PR request and confirm it's
      retrievable.
- [ ] Submit a PR request through its approval chain (category →
      requirement → approver, per the recent migrations) and confirm the
      correct approver sees it.
- [ ] Approve/reject at each stage and confirm status and visibility update
      for the requester.
- [ ] Confirm required-by/priority/reason fields display correctly
      end-to-end.
- [ ] A user without the relevant permission cannot approve or create.

**Sign-off:** Tester: __________ Date: __________ Result: Pass / Fail / Pass with notes: __________

---

## Sign-off summary (fill in per release)

| Module | Tester | Date | Result | Notes / linked bugs |
|---|---|---|---|---|
| Cross-module baseline | | | | |
| Main / Admin | | | | |
| ERP | | | | |
| CRM | | | | |
| R&D | | | | |
| Purchase | | | | |
| Purchase Requisition | | | | |

**Overall release sign-off:** __________ (name) __________ (date)
