# Use Cases

Detailed use cases for the system's most consequential workflows. Grounded in actual route names and status enums — see [FUNCTIONAL_REQUIREMENTS.md](FUNCTIONAL_REQUIREMENTS.md).

---

## UC-1: Escalate a Service Request through its lifecycle

**Actors**: Service user (primary), Project/Service manager, Customer (receives notification email, no login).

**Preconditions**: A Project exists; the actor has `erp` in their `apps` and, if editing, appropriate `erp_permissions`.

**Main flow**:
1. Actor creates a Service Request against a Project (`POST /service-requests`), status defaults to `open`.
2. As the SR is triaged, actor sets status `acknowledged`, then `assigned` to a technician (`PATCH /service-requests/{id}`).
3. Actor schedules the visit, setting status `scheduled`, then `in_progress` once work begins on-site.
4. Actor adds required material line items (`POST /service-requests/{sr_id}/materials`) if parts are needed.
5. If a part must be purchased, actor raises a PR directly from the material list (`POST /service-requests/{sr_id}/raise-pr` — see UC-2 for downstream flow).
6. Once parts and labor are complete, actor sets status `work_completed`.
7. A reviewer sets status `review`, then `closed` once satisfied.
8. On creation and on closure, a client notification email is sent automatically (guarded by `created_notification_sent`/`closed_notification_sent` flags to avoid duplicates); actor can also manually `POST /service-requests/{id}/resend-client-email`.

**Alternate flows**:
- **A1 — Parts delay**: at step 3/4, if a required part is unavailable, actor sets status `pending_parts` instead of progressing; returns to `in_progress` once the linked material is marked received (`POST /materials/{mat_id}/receive`).
- **A2 — Work stalled for other reasons**: actor sets status `on_hold` at any point before `work_completed`; no automatic re-entry condition exists in code — actor manually resumes by setting the next appropriate status.
- **A3 — Warranty work**: at any point, actor records `warranty_status`/`warranty_claim_number` on the SR to flag it as warranty-covered rather than billable.

**Exception flows**:
- **E1 — Cancelled**: at any point before `closed`, actor sets status `cancelled`, ending the lifecycle without completion.
- **E2 — Invalid status value**: because SR `status` is stored as an unvalidated string server-side (see [SRS.md](SRS.md) §5), a malformed API call could set an out-of-lifecycle value with no server-side rejection. This is a known gap, not a designed exception path — flagged for the team.

**Postconditions**: SR reaches `closed` or `cancelled`; full status history is inferable only from `AuditLog` entries (`GET /service-requests/{id}/audit`), since there is no dedicated status-history table observed.

---

## UC-2: Raise and process a Purchase Requisition from a Service Request

**Actors**: Service user (raises PR), Approver (approves/rejects), Purchase user (fulfils).

**Preconditions**: An SR exists with at least one material line item.

**Main flow**:
1. Service user calls `POST /service-requests/{sr_id}/raise-pr`, creating a `PurchaseRequisition` (status `submitted`) carrying over the SR's materials; the SR's `ServiceMaterial` rows are updated with `pr_id`/`pr_number`/`pr_status` mirror fields.
2. Approver reviews the PR (priority, category, requirement type, purchase reason) and calls `POST /{pr_id}/approve`, moving status to `approved`.
3. Purchase user places the order and updates PR items with vendor/PO info (`PATCH /{pr_id}/items/{item_id}`); status advances to `po_raised`.
4. As goods arrive, the service user marks individual materials received on the SR side (`POST /service-requests/{sr_id}/materials/{mat_id}/receive`); the Purchase module's `_sync_material_pr_fields` logic automatically advances the PR's status to `partially_received` and then `received` once all items are in.
5. Once `received`, Purchase user calls `POST /{pr_id}/close`, ending the lifecycle.

**Alternate flows**:
- **A1 — Rejected**: at step 2, approver calls `POST /{pr_id}/reject` instead of approve; PR ends in `rejected`, and the SR's mirrored `pr_status` reflects this so the service user knows to re-plan.
- **A2 — Cancelled after approval**: at step 3, if the need disappears, Purchase user calls `POST /{pr_id}/cancel` (allowed from `approved`/`po_raised` per the model's lifecycle comment).

**Exception flows**:
- **E1 — Attempt to close before fully received**: `POST /{pr_id}/close` should be rejected by the service layer if status isn't yet `received` — verify this guard exists in `purchase/service.py`; if it doesn't, this is a gap to raise.

**Postconditions**: PR reaches `closed`, `rejected`, or `cancelled`; SR's `ServiceMaterial.pr_status` mirror stays consistent with the PR's true status; full history available via `GET /{pr_id}/audit`.

---

## UC-3: Raise and process a standalone Purchase Requisition

**Actors**: Requester (any department, module-access-permitting), Approver, Buyer.

**Preconditions**: Actor has `p2p` in their `apps`; no Service Request involvement required.

**Main flow**:
1. Requester creates a PR request (department, priority, category, requirement type, required-by date, purchase reason) — status `submitted`.
2. Approver reviews and calls `POST /{id}/approve` → status `approved`. (Or `reject` with `rejected_reason` — see Alternate A1.)
3. Procurement lead calls `POST /{id}/assign-buyer`, assigning a buyer and recording `assignment_date`.
4. Buyer calls `POST /{id}/request-quotations`, recording `rfq_number` and collecting `quotation`/`quotation_date` per vendor into `vendor_comparison`.
5. Buyer calls `POST /{id}/select-vendor`, setting `selected_vendor`.
6. Buyer calls `POST /{id}/create-po`, recording `po_value`; status advances to `po_raised`.
7. As goods are delivered, buyer/receiver calls `POST /{id}/update-receipt` one or more times, recording `received_quantity`, `grn_number`, `receipt_date`, `receiving_remarks`; `receipt_status` and the computed `pending_quantity` property reflect partial vs. full receipt; PR status advances to `partially_received` then `received`.
8. Buyer calls `POST /{id}/close` once fully received.

**Alternate flows**:
- **A1 — Rejected at approval**: approver calls `POST /{id}/reject`, recording `rejected_reason`; PR ends in `rejected`.
- **A2 — Cancelled**: requester or approver calls `POST /{id}/cancel` at any point before closure, recording `cancelled_reason`.
- **A3 — Attachments**: at any step, requester or buyer can attach supporting files (quotes, specs) to the PR request or to a specific line item (per migration `d4e8b2c7a913_add_pr_request_attachment_item_id.py`).

**Exception flows**:
- **E1 — No buyer assigned**: if steps 4–7 are attempted before step 3, the intended behavior (block vs. allow) was not confirmed in code review — flagged for the team to clarify whether `assign-buyer` is a hard prerequisite.

**Postconditions**: PR request reaches `closed`, `rejected`, or `cancelled`; full audit trail via `GET /{id}/audit`. Note this module has no soft-delete — a closed/cancelled/rejected record is not removable via the API as observed.

---

## UC-4: Track a sales Inquiry from lead to Minutes of Meeting

**Actors**: Sales user, Sales manager (reviews stage history).

**Preconditions**: An Organization exists (or is created alongside the Inquiry).

**Main flow**:
1. Sales user creates an Inquiry under an Organization (`POST /inquiries`), recording `universal_id`, budget/probability, and initial `current_stage`/`status`.
2. As the deal progresses, sales user records a new stage via `POST /inquiries/{id}/stages`, which appends to the stage-log history (`GET /inquiries/{id}/stages` to view it) — the Inquiry's `current_stage` field is updated alongside.
3. After a customer meeting, sales user generates a Minutes of Meeting document directly from the Inquiry (`POST /inquiries/{id}/mom-docx` or `.../mom-pdf`).
4. Sales manager reviews the Organization's detail page, which surfaces `inquiry_count`/`tender_count` to gauge account activity (`GET /organizations/{id}/detail`).

**Alternate flows**:
- **A1 — Inquiry converts to a Tender**: no direct "convert" API was found in the reviewed routes; a Tender appears to be created as a separate record. If a lead-to-tender conversion workflow is expected, this should be clarified/confirmed with the team, since the current model treats Inquiries and Tenders as parallel entities linked only via the shared Organization.
- **A2 — Soft-delete**: sales user (or manager) soft-deletes a stale Inquiry (`DELETE /inquiries/{id}`), recoverable via `GET /inquiries/recycle-bin/list` + `POST /inquiries/{id}/restore`.

**Postconditions**: Inquiry has a full stage-change history and, optionally, generated MoM documents; audit trail available via `GET /inquiries/{id}/audit`.

---

Related: [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md), [USER_STORIES.md](USER_STORIES.md).
