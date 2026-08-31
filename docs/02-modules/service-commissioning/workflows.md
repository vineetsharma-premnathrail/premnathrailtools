# Service & Commissioning — Workflows

**Module:** Service & Commissioning
**Backend Location:** `backend/app/modules/erp/`
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

This document describes the real, current step-by-step flows the module enforces: the Service Request status lifecycle, the Materials sub-flow that runs inside a Service Request, and the Project/Machine lifecycle. It is written from the actual source, not from an idealized design — in particular, the Service Request status sequence below was corrected during this session's audit, after the frontend's workflow stepper (`frontend/src/app/dashboard/erp/service-requests/[id]/page.tsx`) was found to reference a `resolved` status that does not exist anywhere in the code. The sequence documented here is the one now defined in that file's `WORKFLOW_STEPS` constant.

---

# 2. Service Request Status Lifecycle

## 2.1 The Linear Sequence

A Service Request's `status` field moves through the following ten-step linear sequence, in order:

1. **open** ("Reported") — the request has just been raised.
2. **acknowledged** — a service coordinator has seen and accepted the request.
3. **assigned** — a specific engineer/team has been assigned to it.
4. **scheduled** — a visit or work window has been scheduled.
5. **in_progress** — work is actively underway.
6. **pending_parts** — work is stalled waiting on a spare part or material.
7. **on_hold** — work is stalled for any other reason (customer availability, site access, decision pending, etc.).
8. **work_completed** — the physical/technical work is done.
9. **review** — the completed work is being reviewed before formal closure.
10. **closed** — the request is fully closed.

This sequence is rendered in the Service Request detail page as a horizontal stepper. Each step's visual state (done / active / upcoming) is computed purely from the index of the current status within this fixed array — there is no separate "workflow engine" or state-transition table on the backend. The backend's `PATCH /erp/service-requests/{id}` endpoint accepts any string in the `status` field; it is the frontend's `WORKFLOW_STEPS` constant, and the value sets documented here, that define what a "valid" status actually is.

Reaching `closed` triggers two side effects on the backend: the request's `closed_at` timestamp is stamped, and a client-facing "closed" notification email is queued as a background task (see `requirements.md` REQ-17). If a previously-closed request is re-opened to any other status, `closed_at` is cleared.

## 2.2 Cancelled — A Side Exit, Not a Step

**cancelled** is not part of the linear sequence above. It is a separate terminal state that a Service Request can be moved into from any point in the flow, representing a request that will not be completed at all (as opposed to `on_hold`, which represents a request that is merely paused). The detail page renders `cancelled` distinctly from the numbered stepper: instead of showing step progress, it shows a plain "Cancelled" banner explaining that the request is no longer moving through the normal workflow. This distinction — cancelled as a side exit rather than an eleventh step — is deliberate and was the specific point of confusion this session's audit resolved.

## 2.3 Who Can Change Status

Changing status is just a `PATCH` with a new `status` value, subject to the same ownership-plus-permission rule (`sr_edit`, or admin) that governs every other edit to the Service Request — see `permissions.md`. There is no separate "who can approve a status transition" concept; if a user is allowed to edit the Service Request at all, they are allowed to set its status to any value, including skipping steps or moving backward. The UI's stepper allows clicking any non-active step to jump directly to it (subject to a confirmation dialog), it does not enforce strictly sequential progression.

---

# 3. Materials Sub-Flow

The Materials tab on a Service Request tracks parts/spares needed to complete the work, independently of the SR's own status.

1. **Add a material.** A user with edit rights on the SR adds a line item: name, part number, model number, description, estimated budget, reason, quantity, and unit. A newly added material defaults to a `pending` status unless the caller specifies otherwise.
2. **Optionally raise a Purchase Requisition.** At any point, the user can raise a PR covering every material on the SR that is not yet linked to a PR (`POST /erp/service-requests/{sr_id}/raise-pr`). This is optional and can be done more than once over the life of an SR — for example, adding a second batch of materials later and raising a second PR for just that batch, since the endpoint only ever picks up materials with no `pr_id` set. Materials already linked to an earlier PR are left untouched.
3. **Purchase department notified.** Raising a PR notifies the Purchase department both in-app (`broadcast_notification`, scoped to the `purchase` app) and by a best-effort background email to `settings.PURCHASE_EMAIL`.
4. **Receiving.** As materials physically arrive, they are marked received — in whole or in part — via `POST /erp/service-requests/{sr_id}/materials/{mat_id}/receive`. If a material is linked to a PR, this receipt is synced onto the PR's own line item automatically; once every item on a PR has been fully received, the PR itself is advanced to `received` and Purchase is notified again that it is ready to close. This receiving status is tracked independently of, and does not drive, the parent Service Request's own status — an SR can sit in `pending_parts` even after every material on it has been received, until a user manually advances the SR's status.
5. **Photos.** Image attachments can be added directly to a material line item (for example, a photo of a damaged part), restricted to image content types.

---

# 4. Project / Machine Lifecycle

A machine ("Project" in the code, reflecting the module's original naming) is registered once and then tracked for the rest of its operational life against the organization.

1. **Registered.** A machine is created with a unique serial number and its identifying details (model, application type, client company, site). This is the starting point — there is no separate "draft" state.
2. **In service.** For the bulk of a machine's life, it sits in an active status while Service Requests are opened and closed against it. Warranty, extended warranty, and AMC (Annual Maintenance Contract) coverage are tracked as date ranges and status fields on the machine record (`warranty_start_date`, `warranty_end_date`, `extended_warranty` / `extended_warranty_end`, `amc_status`, `amc_end_date`), rather than as a workflow state — a machine can be simultaneously "in service" and "under warranty," "in service" and "AMC expired," and so on. The `commissioning_date` field records when the machine was first put into operational service, independent of when it was registered in the portal.
3. **Decommissioned.** A machine can be marked with a terminal status once it is taken out of service; this is a value on the same `status` field used throughout the machine's life, set via the ordinary edit endpoint rather than a dedicated decommission action.
4. **Deleted / recycle bin.** Separately from its operational status, a machine can be soft-deleted (moved to the recycle bin) at any point in its lifecycle by a user holding `project_delete`. This cascades to soft-delete every Service Request still linked to it. Restoring the machine from the recycle bin restores those Service Requests as well. See `permissions.md` for a noted inconsistency in how machine restore is gated compared to Service Request restore.

---

# 5. Related Documentation

- [Overview](overview.md)
- [Requirements](requirements.md)
- [Permissions](permissions.md)
- [UI](ui.md)
