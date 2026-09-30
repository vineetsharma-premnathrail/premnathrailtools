# Design Module — Overview & Build Plan

**Module:** Design (Engineering Document Control)
**App key:** `design`
**Backend Location:** `backend/app/modules/design/`
**Frontend Location:** `frontend/src/app/dashboard/design/`
**Prepared by:** Vineet Sharma
**Date:** 29 September 2026

---

# 1. Purpose

The Design module is the controlled register for PremnathRail's engineering documents: GA and part drawings, specifications, calculations, datasheets, schematics, procedures and manuals. It implements BRD **BR-08 (Engineering Document Control)** and the BRD §8.5 flow:

```text
Document Creation → Upload → Revision → Review → Approval → Controlled Use
```

It replaces the "latest drawing is whatever is in someone's folder" problem with one rule: **only a released revision is the controlled revision**, every released revision was checked by one named person and approved by a different one, and every earlier revision is kept, marked *superseded*, and still retrievable.

Files themselves live in SharePoint (`Design-media/<doc number>/<revision>/`), same as every other module. Postgres keeps only the metadata, the workflow state and the history.

This supersedes the earlier roadmap in `old_docs/product/DESIGN_MODULE_PLAN.md`. Its three phases (repository, review/approval, ECN) are all delivered here. Its advice to carry a `discipline` column from day one is followed, so Electrical/Hydraulic documents can share these tables later instead of creating parallel ones.

---

# 2. Scope

| # | Capability | Delivered as |
|---|---|---|
| 1 | Engineering document upload | Create a document with its first revision (R0) and files. Files can be added and removed while the revision is a draft. |
| 2 | Document retrieval | Register with search and filters. Files are streamed in-app through the backend and the raw SharePoint URL is never exposed. |
| 3 | Revision history | R0, R1, R2… per document, each with its own files, change summary, checker, approver and dates. |
| 4 | Review workflow | Draft → *In Review* (named checker) → *In Approval*. The checker can return the revision to the author with a comment. |
| 5 | Approval workflow | *In Approval* (named approver) → *Released*. The previous released revision becomes *Superseded*. The approver can return it to the author. |
| 6 | Document status | The revision status plus a document-level *Active/Obsolete* flag, both visible in the register. |
| 7 | Document association | Optional links to a PM project, a machine (ERP project), a Store item (the part the drawing describes) and a department. |
| 8 | Engineering Change Notices (ECN) | Raise → Submit → Approve/Reject → Implement, covering one or more affected documents. Revisions made under an ECN link back to it. |
| 9 | Review queue | A "My Tasks" page listing revisions waiting on me as checker or approver, drafts that were returned to me, and ECNs waiting on my approval. |
| 10 | Dashboard & reports | KPIs and a Master Document List (MDL) CSV export for ISO 9001 §7.5 audits. |

**Out of scope for this release:** in-browser CAD viewing or markup (PDF and images preview in the browser, CAD files download), automatic BOM sync into Production (an ECN notifies Production and Store instead, and a human changes the BOM), and document transmittals to customers.

---

# 3. Data Model

All tables are prefixed `design_` so they can't be confused with `rnd_documents` / `quality_documents`.

### `design_documents` — one row per controlled document
| Column | Notes |
|---|---|
| `doc_number` | Unique, auto-generated: `<TYPE>-<YEAR>-NNNN`, e.g. `DWG-2026-0001`. Never editable. |
| `title`, `description` | |
| `document_type` | `ga_drawing`, `part_drawing`, `assembly_drawing`, `schematic`, `specification`, `calculation`, `datasheet`, `procedure`, `manual`, `bom`, `other`. Fixed after creation because it drives the number prefix. |
| `discipline` | `mechanical`, `electrical`, `hydraulic`, `pneumatic`, `structural`, `civil`, `instrumentation`, `general` |
| `pm_project_id` → `pm_projects`, `erp_project_id` → `erp_projects`, `store_item_id` → `store_items`, `department_id` → `departments` | All optional |
| `owner_id` → `users` | The responsible engineer. Defaults to the creator. |
| `status` | `active` or `obsolete`, plus `obsoleted_at`, `obsoleted_by_id`, `obsolete_reason` |
| `created_by_id`, timestamps, soft delete | |

### `design_document_revisions` — R0, R1, R2…
| Column | Notes |
|---|---|
| `document_id`, `revision_index` (0,1,2…), `revision_label` (`R0`…) | Unique on (document, index) |
| `status` | `draft` → `in_review` → `in_approval` → `released` → `superseded` |
| `change_summary` | Required from R1 onward (the reason for the change) |
| `ecn_id` → `design_change_notices` | Optional. Must be an *approved* ECN that lists this document. |
| `created_by_id` (author), `reviewer_id`, `approver_id` | The named checker and approver |
| `submitted_at`, `reviewed_by_id`, `reviewed_at`, `review_comment`, `approved_by_id`, `approved_at`, `approval_comment`, `released_at`, `superseded_at`, `returned_count` | `reviewed_by_id` / `approved_by_id` record who *actually* decided, in case an admin stood in |

### `design_revision_files`
One row per file on a revision: `file_role` (`primary` = the controlled PDF/print, `native` = the source CAD/Office file, `supporting`), `file_name`, `sharepoint_path`, `sharepoint_url`, `file_size`, `mime_type`, `uploaded_by_id`, soft delete. Files can only be added or removed while the revision is a draft.

### `design_events` — workflow timeline and comments
`document_id` / `revision_id` / `ecn_id` (whichever apply), `action` (`created`, `submitted`, `review_passed`, `review_returned`, `approved_released`, `approval_returned`, `recalled`, `superseded`, `obsoleted`, `reactivated`, `file_added`, `file_removed`, `comment`, `ecn_*`…), `comment`, `actor_id`, `created_at`. This is the human-readable history shown on the detail pages. The ORM-level `audit_logs` trail (via `audit_registry.py`) still captures every field change underneath it.

### `design_change_notices` + `design_change_notice_documents`
ECN: `ecn_number` (`ECN-<YEAR>-NNNN`), `title`, `reason` (`design_improvement`, `customer_request`, `manufacturing_issue`, `quality_issue`, `cost_reduction`, `safety`, `regulatory`, `other`), `priority`, `description`, `impact_assessment`, `target_date`, optional project links, `approver_id`, `status` (`draft`, `submitted`, `approved`, `rejected`, `implemented`, `cancelled`), decision and implementation stamps. The join table lists the affected documents, each with a per-document `change_description`.

---

# 4. Workflow Rules

### Revision lifecycle
```text
          submit (checker + approver named, ≥1 file)
 draft ─────────────────────────────▶ in_review ──checker passes──▶ in_approval ──approver approves──▶ released
   ▲                                     │                              │                               │
   └──── checker returns (comment) ──────┘                              │                               │ next revision released
   └──── approver returns (comment) ────────────────────────────────────┘                               ▼
   └──── author recalls (while in_review / in_approval)                                             superseded
```

| Rule | Why |
|---|---|
| Checker and approver must be two different active users with Design access, and neither may be the author. | Four-eyes control, same as the maker-checker rule in Store stock adjustments. |
| An admin may decide in place of the named checker or approver, but never on a revision they authored, and never as both checker and approver of the same revision. | Keeps the control even when an admin covers for someone. |
| Returning a revision always requires a comment. | The author needs to know what to fix. |
| A document has at most one open (unreleased) revision at a time. | Avoids two competing "next revisions". |
| A new revision can only be started from a released one, and needs a change summary. | Every change is traceable. |
| Releasing a revision supersedes the previously released one in the same transaction, with a row lock. | Guarantees exactly one controlled revision, even with a double-click. |
| Decisions lock the revision row (`SELECT … FOR UPDATE`) and return 409 if the status already moved on. | Double-submit safety. |
| Files can be changed only while a revision is a draft. A released revision's files are permanent. | Controlled records must not change under the approver's signature. |
| A document that has ever been released cannot be deleted. It can only be marked **obsolete** (reason required, and only with no revision in workflow). An admin can reactivate it. | ISO 9001 §7.5.3 retention of obsolete documents. |

### ECN lifecycle
`draft` → `submitted` → `approved` | `rejected`, then `approved` → `implemented`, with `cancelled` possible from draft or submitted.
* Submitting needs at least one affected (active) document and a named approver who is not the raiser.
* On approval, the owners of the affected documents are notified to start revisions under the ECN.
* *Implemented* can be marked only once every affected document has a **released** revision linked to this ECN. Otherwise the error lists the documents still pending. Implementation notifies Production and Store users (a notification, not an automatic BOM change).

### Who can do what (all require the `design` app)
| Action | Allowed |
|---|---|
| View register, files, history | Any Design user |
| Create document / raise ECN | Any Design user |
| Edit document details | Owner, creator, or admin (not while obsolete) |
| Edit draft revision, manage files, submit, recall | Revision author, document owner, or admin |
| Check (pass/return) | Named checker, or an admin (never the author) |
| Approve (release/return) | Named approver, or an admin (never the author or the person who checked) |
| Obsolete / delete never-released document | Owner or admin. Reactivate: admin. |
| ECN edit/submit/cancel | Raiser or admin. ECN approve/reject: named approver or admin (never the raiser). Implement: raiser, approver or admin. |

Error messages follow the app-wide rule: they say what's wrong, name the record, and say what to do next (e.g. *"DWG-2026-0004 R1 is in review with Priya — only Priya or an admin can pass or return it."*).

### Notifications
In-app + Teams via `notify_user`: checker on submit; approver when the checker passes it; author on return or release; affected document owners on ECN approval; ECN raiser on decision; Production + Store users on ECN implementation. Notification links open the document or ECN (`design_document` / `design_ecn` in `NotificationBell`).

---

# 5. API (`/api/v1/design/...`)

| Router | Endpoints |
|---|---|
| `documents.py` — `/design/documents` | `GET` list (filters: status, revision status, type, discipline, project, item, owner, search) · `POST` create (JSON: metadata + R0 checker/approver; files follow via `POST /design/revisions/{id}/files`, so a failed upload never blocks creation) · `GET /{id}` detail with revisions/files/events · `PATCH /{id}` · `DELETE /{id}` (never-released only) · `POST /{id}/obsolete` · `POST /{id}/reactivate` · `POST /{id}/revisions` (start next revision) · `POST /{id}/comments` |
| `revisions.py` — `/design/revisions` | `PATCH /{id}` (change summary, checker, approver, ECN) · `DELETE /{id}` (discard a draft R1+) · `POST /{id}/files` · `DELETE /{id}/files/{file_id}` · `GET /files/{file_id}/content` · `POST /{id}/submit` · `/recall` · `/review` (pass/return) · `/approve` (release/return) |
| `change_notices.py` — `/design/change-notices` | `GET` list · `POST` · `GET /{id}` · `PATCH /{id}` · `POST /{id}/submit` · `/approve` · `/reject` · `/implement` · `/cancel` · `DELETE /{id}` (draft) |
| `dashboard.py` — `/design` | `GET /dashboard` · `GET /my-tasks` |
| `reports.py` — `/design/reports` | `GET /summary` · `GET /master-document-list` (MDL CSV) |
| `lookups.py` — `/design/lookups` | `GET /{users,projects,machines,items,departments,documents}` — `users` lists only active Design-app holders |

All routers use `require_app_access("design")`, with `require_tab_access("design", <subtab>)` on the list endpoints (Permission Matrix subtabs: `dashboard`, `documents`, `tasks`, `change_notices`, `reports`).

---

# 6. Frontend

`DesignNav` tabs: **Dashboard · Documents · My Tasks · Change Notices · Reports**.

| Route | Page |
|---|---|
| `/dashboard/design` | KPIs (active documents, in review, in approval, released this month, open ECNs, waiting on me), plus waiting-on-me and recently released lists |
| `/dashboard/design/documents` | Register table with status pills and filters |
| `/dashboard/design/documents/new` | Create form (metadata, links, R0 checker/approver, staged files) |
| `/dashboard/design/documents/[id]` | Header + details (inline edit), revision selector, files (open/download/add/remove), workflow action bar, revision history table, timeline + comments |
| `/dashboard/design/tasks` | Waiting on me as checker / approver, returned to me, ECNs to approve |
| `/dashboard/design/change-notices` (+ `new`, `[id]`) | ECN register, create, detail with affected documents and per-document implementation status |
| `/dashboard/design/reports` | Counts by type, discipline and status, plus the MDL CSV export |

---

# 7. Registration Checklist

Backend: `AVAILABLE_APPS` (`main/models/user.py`) · `MODULES["design"]` (`core/permission_registry.py`) · `register_audited` (`core/audit_registry.py`) · model and router imports in `main.py` and `alembic/env.py` · migration creating the tables and re-inserting the `design` row into `modules` (removed earlier by `d8a1c3e5f7b9` when nothing was built on it) · CAD extensions in `utils/sharepoint.py`.

Frontend: `AppModule` union (`types/index.ts`) · `useRequireApp` union (`hooks/useAuth.ts`) · Sidebar icon and link · dashboard module card · audit-log module label · `designApi` in `lib/api.ts` · `ENTITY_LINK` in `NotificationBell.tsx`.

---

# 8. Testing

`backend/app/tests/test_design.py` covers:
* the full R0 → R1 lifecycle with supersede
* four-eyes rules (author, same checker/approver, admin stand-in)
* return and recall
* one-open-revision and draft-only file edits
* obsolete, reactivate and delete guards
* ECN approve → revision under ECN → implement guard
* module access 403

SharePoint calls are monkeypatched.
