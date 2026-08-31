# CRM Module — Overview

**Module:** CRM
**Backend Location:** `backend/app/modules/crm/`
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

The CRM module is where PremnathRail's business-development side of the organization lives: the customer/railway organizations it deals with, the inquiries and tenders those organizations raise, the quotations sent back in response, and the day-to-day activity — calls, meetings, site visits — that a business-development team generates while chasing that work. Where the Service & Commissioning module (`erp`) tracks what happens to a machine *after* it has been sold and installed, CRM tracks everything that happens *before* that point — from first customer contact through to the point a customer purchase order is in hand and a project can be created downstream.

CRM is a whole-module-access application: unlike ERP's granular per-record permission strings (`project_edit`, `sr_delete`, and so on), any user granted access to the `crm` app can create and view CRM records; edit and delete are further restricted to the record's own creator (or an admin), but there is no finer-grained permission list beyond that distinction.

---

# 2. Organizations and Contacts

An **Organization** is a customer, typically a railway zone, division, or PSU, that PremnathRail does or could do business with. Each organization can carry multiple **contacts** — the individual people at that organization a PremnathRail employee actually deals with.

Organizations support the same lifecycle discipline the rest of the portal uses for master data: duplicate-name and duplicate-GST-number checks on creation (`409` rather than silently creating a near-duplicate record), a live search-by-name lookup so a user can check for an existing organization before creating a new one, soft delete with a recycle bin and restore, and a full audit trail per organization. Deleting an organization cascades its soft-delete to the Inquiries and Tenders raised against it, so a removed customer doesn't leave orphaned pipeline records behind. A detail view surfaces each organization's contacts alongside a running count of its inquiries and tenders, giving a business-development user a single screen to judge how active a relationship is.

---

# 3. The Inquiry → Tender → Quotation Pipeline

CRM's central purpose is to track a piece of potential business from the moment it is first heard about through to the point it either converts into a project or is lost. Two parallel entry points feed this pipeline, because railway procurement genuinely happens through two different channels:

- An **Inquiry** is a customer-initiated request — a railway division or PSU reaches out directly, without going through a formal tender process.
- A **Tender** is a formal, published railway tender that PremnathRail chooses to participate in.

Both are tracked with their own auto-generated, human-readable universal ID (`INQ-YYYYMMDD-####` and `TND-YYYYMMDD-####` respectively) and their own forward-moving **stage** vocabulary, recorded as a timestamped timeline rather than a single overwritten status field, so that the history of how a piece of business actually progressed is preserved rather than lost:

- **Inquiry stages** (15 steps): `Customer Requirement → Design → R&D → Costing → Management Approval → Quotation Submission → Purchase Order → Project → Manufacturing → Inspection → Dispatch → Installation → Commissioning → Warranty → Service`. This single vocabulary deliberately spans the entire life of the business relationship, not just the CRM-owned portion of it — later stages (Manufacturing, Dispatch, Commissioning) describe work that physically happens in other departments, but the stage log gives CRM a way to keep visibility on where a piece of business stands even after it has left CRM's own hands.
- **Tender stages** (12 steps): `Tender Published → Documents Downloaded → Participate Decision → Design Started → Costing Completed → Technical Offer Prepared → Commercial Offer Prepared → Management Approval → Bid Submitted → Technical Qualified → Financial Opened → Awarded / Lost`.

Changing an Inquiry's or Tender's current stage — whether through the main edit form or a dedicated stage-log entry — automatically appends a timeline entry and, for Inquiries, fires an in-app notification, so that moving a piece of business forward is never a silent edit.

Underneath both Inquiries and Tenders sits a set of workflow sub-entities that carry the pipeline's working detail: **tasks** (cross-department work items assigned against a specific Inquiry or Tender), **approvals** (a gate that records who approved or rejected a step, auto-stamping the approver and timestamp), **quotations** (the commercial offer sent to the customer), **discussions** (a running internal conversation thread), and, for Tenders specifically, **competitor tracking**. A CRM **Purchase Order** sub-entity records the customer's own PO once business is won — a naming collision worth calling out explicitly: this is the customer's PO placed *on* PremnathRail, an entirely different thing from the internal procurement purchase orders created inside the `p2p` and `purchase` modules. The two are unrelated data.

---

# 4. Activities and Minutes-of-Meeting Export

An **Activity** is the day-to-day unit of business-development work: a call, a meeting, or a site visit, optionally carrying photo attachments and linked back to the Organization, Inquiry, or Tender it relates to. Activities are where CRM captures the human side of a relationship rather than only its formal pipeline state.

Two features make Activities more than a simple log:

- **Follow-up reminders.** An Activity with a `next_followup` date set and a status of `Open` is not just a passive record — a scheduled background job checks daily and pushes an in-app notification to the owning user both one day before and on the day of the follow-up, so that a promised call-back doesn't silently slip. This runs as a daily background job rather than firing instantly on save, which is a deliberate trade-off: it means a follow-up date set in the past won't retroactively notify, but it keeps the reminder mechanism simple and predictable.
- **Minutes-of-Meeting (MOM) export.** An Inquiry's activity/discussion history can be exported as a structured Minutes-of-Meeting document, in either Word (`.docx`) or PDF format, giving a business-development user something professional and shareable to send internally or to a customer after a meeting, without having to manually retype what was already recorded in the system.

Notes are a lighter-weight sibling of Activities — free-text notes attached to an organization or a pipeline record, without the meeting/call structure, follow-up reminders, or attachments an Activity carries.

---

# 5. Technical Offer Request and Secure Document Sharing

CRM's document library (`routes/documents.py`) stores tender and quotation-related files — RFQs, tender notices, BOQs, technical specifications, drawings, cost sheets, quotations, purchase documents, and approval documents — against an Inquiry or Tender, backed by the same SharePoint integration the rest of the portal uses. Every upload is validated and stored through the shared `app/utils/sharepoint.py` layer described in [Microsoft Graph Integration](../../05-integration/microsoft-graph.md), and every document is soft-deleted (with a best-effort, non-fatal SharePoint-side delete) rather than destroyed outright, so a removed document can still be traced in the audit trail.

A specific case this document library and the Technical Offer Request flow both had to solve is sharing a document with someone who has **no account in the portal at all** — most commonly, an external vendor being sent a Technical Offer Request as part of preparing a tender response. Earlier in the project this was handled by handing out a raw SharePoint link directly; that approach was replaced this session with signed, backend-issued document-share links: a link that is scoped to one specific file, carries its own expiry, and is verified by the backend on every access rather than relying on whatever access a raw SharePoint URL would silently grant to anyone who obtained it. The full mechanism — how the signature is constructed, how expiry is enforced, and how it fits alongside the backend-proxied `/content` routes the rest of the application uses for authenticated in-app viewing — is documented in [Microsoft Graph Integration](../../05-integration/microsoft-graph.md), Section 3.7, and its cross-referenced SharePoint document.

---

# 6. Bulk Import

Because CRM is frequently the first module a business-development user interacts with, and because organizations were realistically going to have pre-existing data sitting in spreadsheets before the portal existed, CRM provides a dedicated, admin-only bulk-import capability (`routes/bulk_import.py`) covering Organizations, Inquiries, Tenders, and Activities. Each import endpoint accepts a CSV upload, resolves or creates the records it references (matching contacts, and resolving an owning user by email address), and bulk-creates rows with the same auto-generated universal IDs a normal single-record creation would produce — so a bulk-imported Inquiry is indistinguishable, going forward, from one created by hand through the UI.

---

# 7. Dashboard

A single dashboard endpoint (`routes/dashboard.py`) gives a business-development user or manager an at-a-glance summary: total organizations, inquiries, and tenders; open and overdue follow-ups; today's activities; tenders currently active or submitted; a recent-notes count; and the five most recent organizations, inquiries, and tenders. This is intentionally a read-only summary view — it does not introduce any business logic of its own beyond aggregating what the rest of the module already tracks.

---

# 8. What This Module Does Not Do

- CRM does not track what happens to a machine once it is installed and commissioned — that begins with a Project record in the Service & Commissioning (`erp`) module, and CRM's Inquiry stage log deliberately hands off to it at the `Project` stage.
- CRM's internal "Purchase Order" sub-entity records a customer's PO placed *on* PremnathRail; it has no relationship to the internal procurement purchase orders in `p2p` or `purchase`, and the two must not be conflated when reading code or data.
- CRM does not implement its own document storage — every file lives in SharePoint via the shared Microsoft Graph integration, and CRM never exposes a raw SharePoint URL to the browser.

---

# 9. Related Documentation

- [Microsoft Graph Integration](../../05-integration/microsoft-graph.md) — SharePoint storage, backend-proxied file access, and the signed document-share link design used for external Technical Offer Request recipients.
- [Platform Module](../platform/overview.md) — the shared authentication, authorization, and audit-logging layer CRM is built on.
- [Service & Commissioning Overview](../service-commissioning/overview.md) — where a won piece of CRM business continues its life after conversion to a Project.
