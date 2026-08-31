# Service & Commissioning — Testing

**Module:** Service & Commissioning
**Backend Location:** `backend/app/modules/erp/`
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

This document sets out what should be tested for the Service & Commissioning module, prioritized around the areas this session's audit found to be fragile or actively wrong: the status-transition sequence, the ownership-plus-permission gate, attachment permission checks, and the recycle-bin restore permission. It is written as a target for test coverage, not a report of tests that already exist — treat every item below as a to-do unless the codebase's test suite is checked and found to already cover it.

---

# 2. Status Transition Coverage

1. **The corrected sequence.** Assert that `WORKFLOW_STEPS` in `frontend/src/app/dashboard/erp/service-requests/[id]/page.tsx` contains exactly `open, acknowledged, assigned, scheduled, in_progress, pending_parts, on_hold, work_completed, review, closed`, in that order, and does **not** contain a `resolved` step — this is a direct regression test for the bug found and fixed this session.
2. **`cancelled` as a side exit.** Assert that a Service Request with `status: "cancelled"` renders the "Cancelled" banner rather than being plotted as a step within the ten-step stepper, and that `activeIdx` (the index lookup against `WORKFLOW_STEPS`) is `-1` for a cancelled SR rather than throwing or silently rendering step 1.
3. **Non-sequential transitions are allowed.** Assert that `PATCH /erp/service-requests/{id}` with `status` accepts a jump from, say, `open` directly to `closed`, and a backward move from `in_progress` back to `assigned` — the backend does not enforce sequential ordering, so a test that only exercises the "happy path" forward sequence would miss a regression that accidentally added ordering enforcement (or removed the ability to move backward, which the business relies on for correcting mis-set statuses).
4. **`closed_at` side effects.** Assert that setting `status` to `closed` stamps `closed_at`, and that moving a previously-closed SR to any other status clears `closed_at` again.
5. **Locked SRs reject all edits.** Assert that `PATCH` against an SR with `is_locked = True` returns HTTP 423 regardless of the caller's ownership or permission.

---

# 3. Ownership + Permission Gate Coverage

This is the highest-value area to test, given it was the subject of a real bug this session (see `permissions.md` §4).

1. **Backend matrix.** For each of `_can_edit`/`_can_delete`-gated endpoint (SR edit, SR delete/restore, SR attachment upload/delete, material add/update/delete/receive, material photo upload/delete, raise-PR), test all four combinations of {is creator: yes/no} × {holds permission string: yes/no}, plus the admin bypass, and assert:
   - Creator **and** permission → 200/201.
   - Creator **without** permission → 403.
   - Permission **without** being creator → 403.
   - Neither → 403.
   - Admin, regardless of the above → 200/201.
2. **Frontend button-visibility parity.** For each page under `frontend/src/app/dashboard/erp/service-requests/` that shows an edit/delete affordance, assert that the button's visibility condition matches the backend matrix above exactly — i.e. it checks both ownership and the permission string together, never either alone. This is a direct regression test for the bug fixed this session, where several pages checked only one half of the rule.
3. **Project (machine) asymmetry is intentional, and tested as such.** For `project_edit`/`project_delete`, assert the permission string alone is sufficient regardless of who registered the machine — and add an explicit test asserting this is *not* also gated on ownership, so a future "fix" that copies the SR pattern onto Projects (where it does not apply) is caught rather than silently accepted.

---

# 4. Attachment Upload/Delete Permission Checks

1. Assert attachment upload on a Project requires `project_edit`; on a Service Request, requires ownership + `sr_edit`.
2. Assert attachment delete on a Project requires `project_delete`; on a Service Request, requires ownership + `sr_delete`.
3. Assert a private Project attachment is excluded from `GET /erp/projects/{id}/attachments` for a user who is not the uploader, not an admin, and not in the attachment's shared users/departments/designations — and included for a user who is in any one of those three sharing lists.
4. Assert `/content` and `/preview` on a private attachment independently re-run the same visibility check as the list endpoint (`_can_view_attachment`), so a user who cannot see the attachment in the list also cannot fetch its bytes directly by guessing an attachment ID.
5. Assert `/content` never returns or embeds a raw SharePoint URL in its response — only proxied bytes with a `Content-Disposition` header — matching this session's fix.
6. Assert deleting an attachment succeeds even when the underlying SharePoint delete call fails (the route intentionally swallows that failure and proceeds with the DB delete) — verify this doesn't leave an orphaned SharePoint file undetected in monitoring, even though the API contract tolerates it.

---

# 5. Recycle Bin Restore Permission — Regression Test for the 2026-08-29 Gap

Before this session, restore-permission gating for the recycle bin had a specific, worth-tracking gap: the Restore button on `dashboard/erp/recycle-bin` was shown based on the permission string alone (`hasErpPermission(user, 'project_delete')` / `hasErpPermission(user, 'sr_delete')`), which is correct for Projects (no ownership concept applies there) but is **not** a full match for Service Requests, whose backend `restore_service_request` route is gated through `_can_delete()` — ownership **and** `sr_delete`. A non-owner who holds `sr_delete` will see a clickable Restore button for a Service Request they didn't create, and receive a 403 when they click it.

Add a regression test that specifically exercises this scenario end-to-end:

1. User A creates and then deletes Service Request X.
2. User B, who holds `sr_delete` but did not create SR X, opens the Recycle Bin page.
3. Assert the Restore button **is currently shown** to User B for SR X (documenting the known frontend/backend mismatch as of this writing) **and** that clicking it results in a 403 from `POST /erp/service-requests/{id}/restore` — i.e. the test should currently pass by confirming the mismatch exists, so that whichever side (frontend visibility or backend rule) is eventually chosen as correct, this test starts failing and forces a conscious decision rather than the drift going unnoticed.
4. Run the equivalent scenario for a deleted Project and confirm no such mismatch exists there (User B, holding `project_delete` but not having registered the machine, can both see and successfully use Restore) — this is the intended behavior for Projects and should stay a passing assertion, not a flagged gap.

This test doubles as documentation: whoever resolves the inconsistency (either by adding an ownership check to `restore_service_request`'s frontend gate, or by explicitly deciding SR restore should not require ownership) will see this test start failing in exactly the direction that tells them what changed.

---

# 6. Materials / Purchase Requisition Hand-off

1. Assert raising a PR from an SR only ever includes materials with `pr_id IS NULL`, and that materials already linked to an earlier PR are excluded from a second raise-PR call on the same SR.
2. Assert raising a PR with zero eligible materials returns a 400 with a clear message rather than creating an empty PR.
3. Assert marking a material received syncs the linked PR's item, and that a PR only flips to `received` once every one of its items is fully received — not on the first item.

---

# 7. Related Documentation

- [Overview](overview.md)
- [Permissions](permissions.md)
- [Workflows](workflows.md)
- [UI](ui.md)
