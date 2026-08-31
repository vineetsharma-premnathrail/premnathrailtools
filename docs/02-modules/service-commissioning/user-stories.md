# Service & Commissioning — User Stories

**Module:** Service & Commissioning
**Backend Location:** `backend/app/modules/erp/`
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

This document collects the module's requirements as user stories, in the standard "As a [role], I want [goal], so that [reason]" format. Stories are grouped by the three personas who use this module day to day: the service engineer/coordinator who raises and works Service Requests, the admin or department head who manages the machine registry and cross-cutting access, and the purchase team member who receives a Purchase Requisition raised out of a Service Request's materials. Stories are adapted from `old_docs/requirements/USER_STORIES.md` where still accurate, and corrected against the current code where the old document's status sequence was out of date (it referenced `open → acknowledged → assigned → scheduled → in_progress → work_completed → review → closed`, omitting `pending_parts`/`on_hold` from the sequence and not distinguishing `cancelled` as a side exit — see `workflows.md` for the corrected sequence).

---

# 2. Service Engineer / Coordinator

- As a **service engineer**, I want to create a Service Request against a specific registered machine, so that a customer's service need is tracked from a single source of truth rather than an email or phone call.
- As a **service coordinator**, I want to move a Service Request through its status sequence — reported, acknowledged, assigned, scheduled, in progress, work completed, review, closed — so that anyone looking at the request can see exactly where the job stands without asking me.
- As a **service engineer**, I want to mark a Service Request `pending_parts` or `on_hold` with the underlying reason visible, so that a stalled job doesn't look abandoned or forgotten.
- As a **service engineer**, I want to cancel a Service Request outright when the work will never be completed, so that it's clearly distinguished from a job that's merely paused.
- As a **service engineer**, I want to record the failure mode, root cause, and resolution on a Service Request, so that recurring issues on the same machine are diagnosable from history rather than tribal knowledge.
- As a **service engineer**, I want to add material/spare-part line items to a Service Request as I discover what's needed, so that the parts list builds up naturally as I diagnose the problem.
- As a **service engineer**, I want to raise a Purchase Requisition directly from the Service Request's material list, so that I don't have to re-key the same items into a separate system.
- As a **service engineer**, I want to mark materials as received — even partially — as they physically arrive at site, so that procurement status is visible independently of whatever the Purchase Requisition's own status says.
- As a **service engineer**, I want to attach photos and documents to a Service Request or to a specific material, so that field evidence (a damaged part, a completed repair) is captured alongside the record permanently.
- As a **service coordinator**, I want to resend the client notification email for a Service Request, so that a customer who missed the original "request received" or "request closed" email is still notified.
- As a **service engineer**, I want to record warranty claim details (status, claim number, approved amount) on a Service Request, so that warranty-covered work is clearly distinguished from billable work at invoicing time.
- As a **service coordinator**, I want to soft-delete a Service Request I created by mistake and recover it later from the recycle bin, so that an accidental deletion isn't permanent.

---

# 3. Admin / Department Head

- As an **admin**, I want to register a new machine with a unique serial number and its warranty/AMC/commissioning dates, so that the organization has one authoritative record of every asset it services.
- As a **department head**, I want to search and filter the machine registry by status, application type, or client company, so that I can find a specific machine quickly without scrolling through the entire list.
- As an **admin**, I want a machine's serial number to be rejected as a duplicate at creation time, so that the registry never silently accumulates two records for the same physical asset.
- As an **admin**, I want deleting a machine to also move its associated Service Requests to the recycle bin, so that I never end up with orphaned service history for a machine that no longer exists in the active registry.
- As a **department head**, I want to see the full audit history of a machine or a Service Request — every field changed, by whom, and when — so that I can answer "who changed this and when" without asking around.
- As an **admin**, I want delete and restore actions restricted to users who both created the record and hold the matching permission (or are an admin), so that a regular user can't accidentally, or deliberately, destroy or resurrect a record they don't own.
- As a **department head**, I want to attach a document to a machine and mark it private to specific users, departments, or designations, so that sensitive commercial or technical documents aren't visible to every ERP user by default.
- As an **admin**, I want a basic reports view summarizing Service Request volume and status breakdown, so that I have a quick pulse-check on service activity — while understanding, as of this writing, that this view is intentionally thin (no filters, no export) and not yet a full reporting tool.

---

# 4. Purchase Team

- As a **purchase team member**, I want a Purchase Requisition raised from a Service Request's materials to automatically carry over the item list, requester, and department, so that I don't have to re-enter data that already exists in the service ticket.
- As a **purchase team member**, I want to be notified in-app and by email the moment a Purchase Requisition is raised out of ERP, so that I don't have to poll the Purchase module to discover new work.
- As a **purchase team member**, I want the Purchase Requisition's received quantities to update automatically as the service engineer marks materials received on the originating Service Request, so that I don't have to manually keep two records in sync.
- As a **purchase team member**, I want to be notified again once every item on a Purchase Requisition has been fully received, so that I know it's ready to close without having to check each line item myself.
- As a **purchase team member**, I want a Service Request's materials that are already linked to an earlier Purchase Requisition to be excluded when a second requisition is raised later, so that I never receive a duplicate requisition for the same items.

---

# 5. Related Documentation

- [Overview](overview.md)
- [Requirements](requirements.md)
- [Workflows](workflows.md)
