# Acceptance Criteria

Given/When/Then criteria for the system's most important flows. Complements [USE_CASES.md](USE_CASES.md) and [FUNCTIONAL_REQUIREMENTS.md](FUNCTIONAL_REQUIREMENTS.md).

## Authentication

**AC-1: Sign in via Microsoft SSO**
- Given an unauthenticated visitor
- When they open the portal
- Then they are redirected to `/login`, and choosing to sign in initiates the Microsoft SSO flow (`GET /microsoft-login` → `GET /callback`) with no password field ever shown.

**AC-2: Session-based identity**
- Given a user has completed Microsoft SSO
- When the frontend loads any dashboard page
- Then it calls `GET /auth/me` to establish identity and populate `role`/`assigned_apps`/`erp_permissions`/`apps`, without the user re-entering credentials.

## Module & Permission Access

**AC-3: Module access restricted to assigned apps**
- Given a non-admin user whose `assigned_apps` does not include `crm`
- When they navigate to `/dashboard/crm/...`
- Then `useRequireApp('crm')` redirects them to `/dashboard`.

**AC-4: Admins get every module automatically**
- Given a user with `role === 'admin'`
- When their `apps` list is computed via `get_apps()`
- Then it contains all of `erp, rnd, crm, purchase, p2p`, regardless of their stored `assigned_apps`.

**AC-5: ERP permission-gated actions**
- Given a non-admin user without `project_delete` in `erp_permissions`
- When they attempt to delete a Project
- Then the delete control is hidden client-side, and a direct `DELETE /projects/{id}` call is expected to be rejected server-side (confirm server-side enforcement matches client-side; this should be verified explicitly by QA, not assumed from the frontend check alone).

## Service Requests

**AC-6: New SR defaults to open**
- Given a service user creates a Service Request via `POST /service-requests`
- When no `status` is supplied
- Then the SR's `status` defaults to `"open"`.

**AC-7: SR status update**
- Given an SR with status `assigned`
- When an authorized user calls `PATCH /service-requests/{id}` with `status: "in_progress"`
- Then the SR's status field is updated to `"in_progress"` and an `AuditLog` entry is created recording the change.

**AC-8: Duplicate notification emails are suppressed**
- Given an SR whose `created_notification_sent` flag is already `true`
- When the creation flow is triggered again (e.g. due to a retry)
- Then no second creation email is sent to the client.

**AC-9: Material marked received updates receiving_status**
- Given a `ServiceMaterial` row with `receiving_status: "pending"`
- When `POST /service-requests/{sr_id}/materials/{mat_id}/receive` is called
- Then `receiving_status` becomes `"received"` (or `"partial"` if only part of the quantity arrived, per the shared `pending|partial|received` enum).

**AC-10: Soft-deleted SR is recoverable**
- Given an SR is deleted via `DELETE /service-requests/{id}`
- When an authorized user views `GET /service-requests/recycle-bin/list`
- Then the SR appears in that list, and `POST /service-requests/{id}/restore` returns it to normal visibility with `is_deleted: false`.

## Purchase Requisitions (SR-tied)

**AC-11: Raising a PR from an SR carries over materials**
- Given an SR with two material line items
- When `POST /service-requests/{sr_id}/raise-pr` is called
- Then a new `PurchaseRequisition` is created with status `"submitted"`, and both `ServiceMaterial` rows are updated with the new `pr_id`/`pr_number`/`pr_status`.

**AC-12: PR status advances automatically on receipt**
- Given a PR with status `"po_raised"` and two linked materials, one marked received
- When the second material is also marked received via the SR materials endpoint
- Then the PR's status automatically becomes `"received"` (via `_sync_material_pr_fields`), without a direct PATCH to the PR's status field.

**AC-13: PR cannot be created independent of an SR**
- Given the Purchase (SR-tied) module
- When searching for a direct "create PR" endpoint not nested under a Service Request
- Then none exists — the only creation path is `POST /service-requests/{sr_id}/raise-pr`.

## Purchase Requisition (standalone module)

**AC-14: Standalone PR request created without any SR**
- Given a requester with `p2p` module access
- When they submit a new PR request with department, priority, category, requirement type, required-by date, and reason, and no `service_request_id`/`project_id` reference
- Then the request is created successfully with status `"submitted"`.

**AC-15: Rejection requires a reason**
- Given a PR request with status `"submitted"`
- When an approver calls `POST /{id}/reject`
- Then the request's status becomes `"rejected"` and `rejected_reason` is populated (verify the field is actually required by the endpoint's validation, not merely optional — flagged for QA to confirm against `p2p_requests.py`'s schema).

**AC-16: Receipt tracking computes pending quantity**
- Given a PR request with `ordered_quantity: 100` and `received_quantity: 60` after one `update-receipt` call
- When the `pending_quantity` property is evaluated
- Then it returns `40`.

**AC-17: PR request has no recycle bin**
- Given a closed or cancelled PR request
- When looking for a delete/recycle-bin/restore endpoint for this module
- Then none exists in `p2p_requests.py` — confirming NFR-RET-3's gap is real, not a documentation oversight.

## CRM

**AC-18: Inquiry stage change is logged**
- Given an Inquiry with `current_stage: "qualification"`
- When `POST /inquiries/{id}/stages` is called with a new stage
- Then the Inquiry's `current_stage` updates and a corresponding row is appended to its stage-log history, retrievable via `GET /inquiries/{id}/stages`.

**AC-19: MoM generation returns a downloadable document**
- Given an Inquiry with recorded meeting content
- When `POST /inquiries/{id}/mom-docx` (or `mom-pdf`) is called
- Then a DOCX (or PDF) file is generated and returned/stored, without error, for an Inquiry that has the minimum required fields populated.

**AC-20: Organization detail shows related counts**
- Given an Organization linked to 3 Inquiries and 1 Tender
- When `GET /organizations/{id}/detail` is called
- Then the response includes `inquiry_count: 3` and `tender_count: 1`.

## Notifications & Audit

**AC-21: Teams notification sent alongside in-app notification**
- Given an event that triggers a notification (e.g. SR assignment)
- When the notification is created
- Then both an in-app `Notification` row is inserted and a Microsoft Teams activity-feed push is attempted via Graph API, deep-linking to the relevant dashboard page.

**AC-22: Audit endpoint reflects field-level changes**
- Given a Project's `status` field is changed from `active` to `on_hold`
- When `GET /projects/{id}/audit` is called
- Then the response includes an entry with `field_name: "status"`, `old_value: "active"`, `new_value: "on_hold"`, and the performing user's identity/timestamp.

## File Attachments

**AC-23: Disallowed file type is rejected**
- Given a user attempts to upload a `.svg` or `.html` file as an attachment
- When the upload request reaches `sharepoint.py`'s validation
- Then it is rejected due to the dangerous-extension blocklist, regardless of the declared content-type.

**AC-24: Spoofed extension is caught by magic-byte check**
- Given a file renamed to have an allowed extension (e.g. `.pdf`) but whose actual binary signature does not match a PDF
- When the upload is processed
- Then `_verify_magic_bytes()` rejects it.

**AC-25: Large file uses chunked upload**
- Given a file larger than the simple-upload threshold (per code, files up to ~4MB use simple upload)
- When it is uploaded
- Then the backend automatically switches to a chunked/resumable Graph API upload session in 10MB increments, supporting files up to 2GB.

---

Cross-references: [SRS.md](SRS.md), [FUNCTIONAL_REQUIREMENTS.md](FUNCTIONAL_REQUIREMENTS.md), [NON_FUNCTIONAL_REQUIREMENTS.md](NON_FUNCTIONAL_REQUIREMENTS.md), [USER_STORIES.md](USER_STORIES.md), [USE_CASES.md](USE_CASES.md).
