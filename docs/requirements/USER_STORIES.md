# User Stories

Grouped by module. See [FUNCTIONAL_REQUIREMENTS.md](FUNCTIONAL_REQUIREMENTS.md) for the requirements each story traces to.

## ERP / Service Module

- As a **service/engineering user**, I want to create a Service Request against a Project, so that a customer's service need is tracked from a single source of truth. (FR-ERP-5)
- As a **service user**, I want to update an SR's status as work progresses (open → acknowledged → assigned → scheduled → in_progress → work_completed → review → closed), so that everyone can see where the job stands. (FR-ERP-6)
- As a **service user**, I want to mark an SR `on_hold` or `pending_parts`, so that the reason for a stall is visible instead of the SR looking abandoned. (FR-ERP-6)
- As a **service user**, I want to add material line items to an SR and mark them received as they physically arrive, so that procurement status is visible independent of the PR's own lifecycle. (FR-ERP-8)
- As a **service user**, I want to raise a Purchase Requisition directly from an SR's material list, so that I don't have to re-enter the same items in a separate system. (FR-ERP-9)
- As a **service user**, I want to attach photos/documents to an SR or to a specific material, so that field evidence (e.g. a damaged part) is captured alongside the record. (FR-ERP-10)
- As a **service user**, I want to resend the client notification email for an SR, so that a customer who missed the original email still gets notified. (FR-ERP-11)
- As a **service user**, I want to record warranty claim details on an SR, so that warranty-covered work is distinguishable from billable work. (FR-ERP-12)
- As a **project manager**, I want to soft-delete a Project or SR and recover it later from a recycle bin, so that accidental deletions aren't permanent. (FR-ERP-2, FR-ERP-7)
- As an **admin/manager**, I want to see the audit history of a Project or SR, so that I can answer "who changed this and when." (FR-ERP-3)
- As a **user with `project_delete` permission**, I want delete actions restricted to people explicitly granted that permission, so that regular users can't accidentally destroy project records. (FR-ADM-4)

## CRM Module

- As a **sales user**, I want to create an Organization and its Contacts, so that all my correspondence with a customer is centralized. (FR-CRM-1, FR-CRM-4)
- As a **sales user**, I want to see an Organization's related inquiry and tender counts on its detail page, so that I immediately know how active that account is. (FR-CRM-2)
- As a **sales user**, I want to log an Inquiry (lead) and move it through stages, with a history of stage changes, so that I can track how a lead is progressing and when. (FR-CRM-5)
- As a **sales user**, I want to generate a Minutes-of-Meeting document (DOCX or PDF) directly from an Inquiry, so that I don't have to manually write up meeting notes in a separate tool. (FR-CRM-7)
- As a **sales/tender user**, I want to track a Tender through its own stage history, recording authority, portal, submission/opening dates, and award outcome, so that the full tender lifecycle is documented in one place. (FR-CRM-8, FR-CRM-9)
- As a **sales user**, I want to log free-text Notes and Activities against CRM entities, so that informal context isn't lost between meetings. (FR-CRM-10, FR-CRM-11)
- As a **sales user**, I want to attach documents to any CRM entity, stored in SharePoint, so that quotes/contracts live with the record they relate to. (FR-CRM-12)
- As a **sales manager**, I want to bulk-import existing leads/organizations, so that historical CRM data doesn't have to be entered one record at a time. (FR-CRM-13)
- As a **sales manager**, I want a CRM dashboard summarizing demand, so that I can spot trends without opening every record. (FR-CRM-14)

## R&D Module

- As an **engineer**, I want to run a braking-performance calculation for a given railway vehicle configuration, so that I don't have to do the math by hand or in an untracked spreadsheet. (FR-RND-1)
- As an **engineer**, I want to run hydraulic, Qmax, load-distribution, tractive-effort, vehicle-performance, and spline calculators from the same portal, so that all engineering computations share one tool and one history. (FR-RND-2 – FR-RND-7)
- As an **engineer**, I want my past calculations saved to a history view, so that I can revisit or re-derive an old result without recomputing it from scratch. (FR-RND-8)

## Purchase Module (SR-tied)

- As a **service user**, I want raising a PR from my SR's materials to automatically carry over the item list, so that I don't duplicate data entry between ERP and Purchase. (FR-PUR-1)
- As a **purchase/approver user**, I want to approve, reject, or cancel a submitted PR, so that spend is controlled before a PO is placed. (FR-PUR-3)
- As a **purchase user**, I want the PR's status to automatically reflect partial/full receipt as the requesting service user marks materials received, so that I don't have to manually sync two records. (FR-PUR-4)
- As a **purchase user**, I want to close a PR only once it is fully received, so that open procurement obligations can't be silently dropped. (FR-PUR-5)
- As a **purchase user**, I want to update per-item vendor/PO details on a PR line item, so that item-level procurement detail isn't lost in a single PR-level record. (FR-PUR-6)
- As a **manager**, I want to see who approved/rejected/closed a PR and when, via its audit trail, so that procurement decisions are traceable. (FR-PUR-8)

## Purchase Requisition Module (standalone)

- As **any department user** with access to this module, I want to raise a Purchase Requisition directly, without needing an associated Service Request, so that non-service procurement needs (e.g. office supplies, capital equipment) have a proper channel. (FR-PRQ-1)
- As a **requester**, I want to specify department, priority, category, requirement type, required-by date, and reason on my PR request, so that the approver has enough context to decide quickly. (FR-PRQ-2)
- As an **approver**, I want to approve, reject (with a reason), or cancel (with a reason) a PR request, so that the requester understands why a decision was made. (FR-PRQ-8)
- As a **procurement lead**, I want to assign a PR request to a specific buyer, so that ownership of sourcing is clear. (FR-PRQ-4)
- As a **buyer**, I want to request quotations and record a vendor comparison, then select a vendor, so that the sourcing decision is documented before a PO is cut. (FR-PRQ-5)
- As a **buyer**, I want to create a Purchase Order against the selected vendor and record its value, so that the commercial commitment is captured. (FR-PRQ-6)
- As a **buyer/receiver**, I want to record goods receipt incrementally (ordered vs. received quantity, GRN number, receipt date), so that partial deliveries are tracked accurately rather than as one all-or-nothing event. (FR-PRQ-7)
- As a **requester**, I want to attach supporting files to my PR request or to individual line items, so that quotes/specs travel with the request. (FR-PRQ-10)

## Users / Admin Module

- As an **employee**, I want to sign in with my existing Microsoft 365 account, so that I don't need to manage yet another password. (FR-ADM-1)
- As an **admin**, I want to see every user's role, assigned modules, and ERP permissions in one list, so that I can manage access without touching the database directly. (FR-ADM-2)
- As an **admin**, I want new admins to automatically gain access to every module, so that I don't have to remember to assign each module individually when promoting someone. (FR-ADM-3)
- As a **user**, I want to receive both an in-app notification and a Microsoft Teams activity-feed alert for events relevant to me, so that I don't have to keep the portal open to notice updates. (FR-ADM-5)
- As a **manager/admin**, I want a consistent audit endpoint across Projects, SRs, CRM entities, and PR Requests, so that "who changed what" is answerable the same way everywhere in the system. (FR-ADM-6)

Related: [USE_CASES.md](USE_CASES.md), [ACCEPTANCE_CRITERIA.md](ACCEPTANCE_CRITERIA.md).
