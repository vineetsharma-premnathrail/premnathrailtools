# Reports (MIS) & Documents Modules — Plan

**Modules:** Documents (cross-module document register) and Reports (report library, management MIS dashboard, scheduled report emails)
**Backend Location:** `backend/app/modules/documents/` and `backend/app/modules/reports/` (to be created). The managed-document engine stays where it is, in `backend/app/modules/main/` (model, service, generic routes).
**Frontend Location:** `frontend/src/app/dashboard/documents/` (empty scaffold folders already exist: `list`, `approvals`, `templates`, `reports`) and `frontend/src/app/dashboard/reports/` (empty scaffold folders: `library`, `custom`)
**Prepared by:** Vineet Sharma
**Date:** 7 October 2026
**Status:** Plan only. Nothing is built yet. This is phase **P4 — Reports & polish** in `docs/MODULE_DETAILED_PLAN.md` §2, and covers §23 (Documents & Reports) and §48 (Documents & Reports settings). It must respect decision **D4**: generated documents are managed Word documents of record. "Save & Edit in Word" is the primary action and PDF is a secondary download.

---

# 1. Purpose

These two modules hold nothing of their own. They are **read-only windows over data that other modules already own**. They answer three questions the portal can't answer in one place today:

1. **Which documents have we issued, and which is the current version?** Today each quotation, MOM, letter, handover certificate, inspection report, test certificate, deviation approval and 8D report lives only on its own record's page. Nobody can see "every Word document of record across the company" in one list. This is the **Documents register**.
2. **Which reports exist, and which may I open?** Each module has its own reports page (P2P MIS, Production, Quality, Maintenance, Design, Finance, ERP service). They are found by knowing the module. This is the **Report library**.
3. **How is the business doing this month?** Partners and heads need one screen with the order book, RRVs in build by stage, purchase spend, stock value, quality NCRs, maintenance downtime and receivables. They also need it emailed to them on a schedule without having to log in. This is the **MIS dashboard** and **scheduled reports**.

The core design decisions are:

- **No duplicate storage.** The Documents register reads the existing `managed_documents` / `managed_document_events` tables and the SharePoint files they point to. It never copies a document, its metadata or its versions into a second table.
- **MIS is computed from transactional data, never re-keyed.** Every MIS number is a query over the records people already create (RRV builds, POs, stock ledger, NCRs, work orders, AR transactions). Nobody types a monthly figure into the MIS.
- **No report builder.** Reports and tiles are coded, following the no-metadata-customization rule (D8). The empty `reports/custom` folder is **not** used (see §12, Q5).

## 1.1 ERP-standard notes (why it is built this way)

**Why a single document register?** ISO 9001 clause 7.5 ("control of documented information") requires the company to be able to show, for any document it issued, the current version, who changed it and when, and that superseded versions are not used by mistake. SAP DMS, Oracle and Dynamics all do this with *one* register and per-module links. They don't keep one register per module. Premnath Rail's rule R6 says the same: one Item Master, one Store ledger, one document-control register. The portal already has the engine (one `managed_documents` table for every module, a `DocumentAdapter` per record type). What is missing is the **register view**. If each module built its own "documents" list, an auditor asking "show me every test certificate issued in August" would get a different answer from each screen, and the definition of "current version" would drift between modules. One register means one answer.

**Why MIS from transactional data and not re-keyed?** A re-keyed MIS (someone fills an Excel or a form each month) has three standard failures:
1. It is late, because it waits for the person who compiles it.
2. It is wrong in ways nobody can trace, because a typed number has no drill-down to the records behind it.
3. It hides process problems. If a PO is not raised in the system, a re-keyed spend figure still looks complete, so nobody notices the missing PO.

When MIS is a query, a missing number exposes a missing transaction, and that pressure pushes people to record work in the system. This is why every tile in §6 has a "Source" column and a drill-down link to the module screen that owns the records. It is also why tiles whose source does not exist yet show **"Not available — <module> not built"** instead of a manual-entry field (see §2.3).

**Why permission per report follows the source module.** A report is a view of a module's data. If the MIS showed receivables to someone who has no Accounts access, the MIS would become a back door around the Permission Matrix. So each report and each MIS tile is checked against the **source module's** app access and Permission Matrix subtab, not against a separate "MIS permission". The MIS app key only controls whether you see the dashboard page at all.

**Why "Word document of record" matters for the register.** Under D4 the latest Word version in SharePoint *is* the issued document, and the PDF is rendered from it. So the register links to the SharePoint file and to the owning record. It never stores a frozen PDF, because that frozen PDF would silently go out of date the moment someone edits the Word file.

---

# 2. What already exists, and how these modules relate to it

## 2.1 Managed documents (the Documents register's only data source)

| Existing concept | Where | Relationship to Documents |
|---|---|---|
| `ManagedDocument` (`managed_documents`): `entity_type`, `entity_id`, `source_revision`, `title`, `docx_item_id`, `docx_path`, `docx_web_url`, `created_by_id`, timestamps. Older rows for the same entity are kept as history, and the newest row is the active one. | `backend/app/modules/main/models/managed_document.py` | **The register's rows.** It is read-only from Documents. There is no `module`, `status` or `document_number` column. These are derived (see §4.1). |
| `ManagedDocumentEvent` (`managed_document_events`): `generated`, `regenerated`, `uploaded`, `edit_access`, with the real user | same file | Gives "last portal action" and the real author. Word Online saves are **not** events. They exist only as SharePoint versions. |
| `DocumentAdapter` registry: `register()`, `adapter_for()`, `DocumentTarget` (revision, title, folder, builder) | `backend/app/modules/main/services/managed_documents.py` | The register uses the registry to know which `entity_type`s exist, which app owns each, and (after a small extension, §4.1) the module label, type label, record link and a coarse list-permission check. |
| Generic routes `/managed-documents/{entity_type}/{entity_id}` (state + versions, create, changes, edit, docx, upload) | `backend/app/modules/main/routes/documents.py` | **Reused unchanged** by the register's detail drawer. The register does not add a second set of edit or download endpoints. |
| `ManagedDocumentPanel.tsx` | `frontend/src/components/shared/` | **Reused** in the register's detail drawer, so history, changes, "Save & Edit in Word" and PDF behave exactly as they do on the record page. |
| `docx_letterhead` / `docx_diff` utilities | `backend/app/utils/` | Not touched. Builders and the change comparison already use them. |

Document types registered today (each one is an adapter):

| `entity_type` | Module (`app`) | Document | Registered in |
|---|---|---|---|
| `crm_quotation` | crm | Quotation | `crm/routes/workflow.py:325` |
| `crm_activity_mom` | crm | Minutes of meeting | `crm/routes/activities.py:381` |
| `erp_project_letter` | erp | Project letter | `erp/routes/projects.py:707` |
| `production_rrv_handover` | production | RRV handover certificate | `production/routes/rrv_builds.py:975` |
| `quality_inspection_report` | quality | Inspection report | `quality/routes/records.py:99` (loop over `_KINDS`) |
| `quality_test_certificate` | quality | Test certificate | same |
| `quality_deviation_approval` | quality | Deviation approval | same |
| `quality_8d_report` | quality | 8D report | same |

**Not managed documents yet:** the PO, GRN and issue slip (named in D4 / P4), and the CRM technical offer (which has its own `technical_offer_docx.py` but no adapter). The R&D calculation reports are mostly PDF builders, and only `spline` has a `docx_builder`. These appear in the register automatically as soon as their module registers an adapter. Building them belongs to the owning module, not to this plan.

**Other file stores that are *not* managed documents** and stay out of the register in Phase 1: P2P attachments, Quality documents tab (uploads), Maintenance attachments, Design drawing register (`design_document` — its own controlled register under D6), HR `user_document`, PM project documents. These are uploaded evidence, not system-generated documents of record. See §12, Q2.

## 2.2 Existing reports and dashboards (the Report library's catalogue)

| Module | Endpoint(s) | Guard today | Frontend page | Export |
|---|---|---|---|---|
| P2P / Purchase | `GET /p2p/mis/summary`, `GET /p2p/mis/export` | `_require_mis_access`: purchase app, purchase head, director, Partner or admin | `p2p/mis/page.tsx` (react-chartjs-2 `Bar`) | XLSX with charts |
| Production | `GET /production/dashboard`, `GET /production/reports` | `require_tab_access("production", "dashboard" / "reports")` | `production/reports/page.tsx` | — |
| Quality | `GET /quality/dashboard`; inspection report / 8D PDFs | `require_app_access("quality")` (no tab check on dashboard) | `quality/reports/page.tsx` | — |
| Maintenance | `GET /maintenance/dashboard`, `GET /maintenance/reports/summary`, `GET /maintenance/reports/export` | tab access, plus `reports:export` for export | `maintenance/reports/page.tsx` | XLSX |
| Design | `GET /design/dashboard`, `GET /design/reports/summary`, `GET /design/reports/master-document-list` | tab access `design:reports` | `design/reports/page.tsx` | master document list |
| Finance | `GET /accounts/reports/{trial-balance, gl-ledger, day-book, profit-and-loss, balance-sheet, cash-flow, ap-aging, ar-aging, variance-analysis, monthly-pack, year-end}`, `GET /accounts/inventory/stock-value` | `require_app_access("accounts")` only | `finance/reports/page.tsx` | — |
| ERP Service | (client-side over service requests) | `erp` app | `erp/reports/page.tsx` (`Bar`, `Doughnut`) | — |
| CRM | `GET /crm/dashboard` (counts and recent lists only) | `require_app_access("crm")` | CRM dashboard | — |
| HR | `GET /hr/dashboard` (`hr/services/dashboard.py:build_dashboard`), `GET /hr/attendance/summary(/export)` | hr app | HR dashboard, attendance | XLSX (attendance) |
| Electrical / Hydraulic / R&D | `GET /electrical/dashboard`, `/hydraulic/dashboard`, `/rnd/dashboard` | tab access | module dashboards | — |
| Store | **none.** `GET /store/stock/balances` and `/transactions` are lists, not reports. | — | — | — |

**Chart conventions to follow** (from `p2p/mis/page.tsx` and `erp/reports/page.tsx`):
- Use `react-chartjs-2` (`Bar`, `Doughnut`) with `ChartJS.register(...)` at module top. Register only the elements used.
- Use the fixed categorical palette from `erp/reports/page.tsx` (`CATEGORICAL`, assigned by position and never re-cycled), the `STATUS_COLOR` set (good / warning / serious / critical), `INK_MUTED` and `GRID`.
- Use a `ChartCard` / `Section` wrapper with theme tokens from `@/lib/theme` (`TEXT`, `GLASS`, `SHADOWS`, `BORDER`, `BRAND`).
- Errors come from `extractErrorMessages`. Dates use `DateField`.

The MIS page reuses these. It does not introduce a new chart library.

## 2.3 Source data that does not exist yet (flags)

| MIS item / §23 report | What is missing | What the plan does meanwhile |
|---|---|---|
| **Order book** | **There is no Sales module.** `backend/app/modules/sales` does not exist, and `frontend/src/app/dashboard/sales/*` is empty scaffolding. There is no Sales Order and no order value. | Phase 1 shows an **indicative** order book from CRM: inquiries and tenders whose `current_stage` is "Purchase Order" or later (inquiry) or "Awarded / Lost" with an award (tender), valued at the latest **accepted quotation** total. The tile is labelled *"Indicative — from CRM stages; replaced by Sales Orders when Sales is built (P3)"*. See Q1. |
| **Receivables** | AR exists (`accounts/reports.get_ar_aging`), but there is no **customer invoice from handover** yet (P3 item). AR only contains whatever Finance keys in manually. | The tile is shown with the note *"Covers invoices entered in Finance; handover → invoice link not built yet."* |
| **Cost per RRV vs quoted** (§23) | There is no RRV cost roll-up (P3 "RRV cost report") and no Sales Order value. | Out of the catalogue until P3. It is listed in the library as **"Planned"**. |
| **BOM release status per project (Mech/E/H/P)** (§23) | There is no Engineering BOM backend module (`frontend/.../engineering/*` is empty). Design has BOM revisions, and Electrical/Hydraulic have their own BOMs. | Phase 2 library entry is built from the Design register plus E/H BOM release states only if the §9 roll-up has shipped. Otherwise it is "Planned". |
| **Shortage vs open PO per RRV** (§23) | Production has material requirements and shortages (`production/schemas/insights.py`). P2P PO lines are not linked to RRV builds (PM standalone, D2, and no PO↔build link). | Phase 2: shortage per item vs open PO qty per item (item-level, not RRV-level). RRV-level waits for the link. |
| **Warranty failures by item** (§23) | `backend/app/modules/service/models` is empty. ERP service requests exist, but have no failed-item field. | "Planned". Flag to the Service module owner. |
| **Vendor performance** (§23) | P2P has PO dates and GRNs. On-time delivery needs a promised date per PO line vs the GRN date. | Phase 2 if PO lines carry a delivery date. To be confirmed in P2P (currently being edited by another session). |
| **Stock value, slow / non-moving, negative stock** | Stock value exists (`accounts/services/inventory.stock_value_summary`). Store has **no** reports endpoint. | Stock value uses the existing service. Slow/non-moving and negative stock are new read-only queries over the stock ledger, added under `reports/services/sources/store.py` (Phase 2). |

---

# 3. Users and roles

Two new app keys are added to `AVAILABLE_APPS`: **`documents`** and **`reports`**. The Permission Matrix (`core/permission_registry.py`) still decides what is inside each one.

| Role | Typical person | What they see |
|---|---|---|
| **Partner** (`is_partner`) | Partners (D1, the top approval level) | The MIS dashboard and all reports **for the modules they have access to**. Following the P2P MIS precedent, Partners and directors get the `reports` app implicitly (no assignment needed). They do **not** bypass source-module access. See Q3 for whether Partners should see every tile regardless. |
| **Department head / manager** | Purchase head, production head, QA head, accounts head | The report library (their modules' reports), the MIS tiles for their modules, and scheduling of reports to themselves and their team. |
| **Document controller / QA** | QA / MR (ISO management representative) | The Documents register across every module they have access to. Phase 3: owns controlled documents (SOPs and policies). |
| **Any user with a module** | Everyone | The Documents register filtered to the module apps they hold. The library shows only reports they could open from the module anyway. |
| **Admin** | IT | Everything, plus all users' report schedules. |

Permission registry entries:

```text
MODULES["documents"] = { subtabs: register, controlled (Phase 3), approvals (Phase 3), templates (Phase 3) }
MODULES["reports"]   = { subtabs: mis, library, schedules }
```

Standard actions apply: `view`, `export`, `create` / `edit` / `delete` (for schedules), and `approve` (controlled documents).

**Row-level rule (the important one):**
- A Documents register row is visible only if the user holds the adapter's `app` **and** passes the adapter's new `can_list(user)` check. For quality kinds, that is `can_view_tab(user, "quality", <tab>)` using the existing `_KINDS` tab map.
- Opening or editing still goes through the existing `/managed-documents/...` routes, which call `adapter.load(..., modify)`. So the register cannot widen access, even if `can_list` is wrong.
- A report or MIS tile is visible only if `user` passes the **source** module's app access and `can_view_tab(source_module, source_subtab)`.

---

# 4. Data model

The Documents register adds **no table** in Phases 1–2. Reports adds two tables (schedules and runs). Phase 3 controlled documents adds one table. All new tables use `TimestampMixin`, are registered in `core/audit_registry.py`, and use coded tuples for status and type values (D8).

## 4.1 Documents register: derived fields (no new table)

Extend `DocumentAdapter` in `main/services/managed_documents.py` with **optional** fields that have back-compatible defaults, so existing `register(...)` calls keep working untouched:

| New adapter field | Default | Used for |
|---|---|---|
| `module_label: str` | `adapter.app.title()` | Module filter and column |
| `type_label: str` | `entity_type` humanised | Type filter and column ("Test certificate") |
| `link: Callable[[int], str] \| None` | `None` (falls back to the frontend `ENTITY_LINK` map) | "Open record" link |
| `can_list: Callable[[User], bool] \| None` | `None` (means app access is enough) | Row filter without loading each entity |
| `revisions: Callable[[Session, list[int]], dict[int, int]] \| None` | `None` (staleness shown as "unknown") | **Batch** current-revision lookup, so the list can flag stale documents without N `load()` calls |

Each module adds these fields to its own `register(...)` line when convenient. The register works without them.

Derived columns in the list:

| Column | Derived from |
|---|---|
| Module, Type | adapter `module_label`, `type_label` |
| Entity | `ManagedDocument.title` (already "Quotation QT-…-r1", "Inspection report IL-…") plus link |
| Author | `created_by_id` → user name |
| Created / last portal action | `created_at`; latest `ManagedDocumentEvent` (`generated` / `regenerated` / `uploaded`) and its user |
| **Status** | **Current** (newest row for the entity and `source_revision` = current revision), **Stale** (newest row but the record was revised after; this needs `revisions`), **Superseded** (an older row for the same entity) |
| Edited in Word? | **Not in the list.** Word Online saves are only in SharePoint. The detail drawer loads them through the existing `GET /managed-documents/{type}/{id}` (versions and changes). See Q4 for an optional nightly cache. |

Query notes:
- Add an index `ix_managed_documents_created_at` (a small migration). This is the only schema change to an existing table, and it only adds an index.
- Superseded rows are hidden by default ("Show superseded" toggle). The default list is the active document per entity, using `DISTINCT ON (entity_type, entity_id) … ORDER BY id DESC` (Postgres).

## 4.2 `ReportSchedule` (`report_schedules`)

| Field | Notes |
|---|---|
| `report_key` | A key from the coded catalogue (§4.4). It is validated against the catalogue, not an FK. |
| `params` | JSON, e.g. `{"period": "month", "branch_id": 2}`. It is validated by the catalogue entry's own params schema. |
| `frequency` | `daily`, `weekly`, `monthly` |
| `day_of_week` (weekly), `day_of_month` (monthly; `last` allowed), `send_time` | Asia/Kolkata. Must be on a 15-minute grid. |
| `format` | `xlsx`, `docx`, `pdf`. The default is `xlsx` (§48). It is limited to what the catalogue entry can render. |
| `channels` | Subset of `email`, `teams`. Teams sends a reminder-type message with a link, never the file. |
| `owner_id` | The creator. Only the owner, an admin or `reports:schedules:edit` can change it. |
| `is_active`, `last_run_at`, `last_status`, `last_error` | |

Child table `ReportScheduleRecipient`: `schedule_id`, `user_id`. Recipients are **portal users only**. There is no free-text external email in Phase 2, because a report must not leave the permission system (see Q6).

## 4.3 `ReportScheduleRun` (`report_schedule_runs`)

`schedule_id`, `period_key` (e.g. `2026-10`, `2026-W41`, `2026-10-07`), `status` (`sent`, `partial`, `failed`, `skipped`), `recipients_sent`, `recipients_skipped` (JSON list of `{user_id, reason}`), `error`, `started_at`, `finished_at`.

There is a **unique constraint on (`schedule_id`, `period_key`)**. This makes the job idempotent: a restart, a second worker or a manual "Send now" for the same period does not double-send. `BackgroundScheduler` runs in-process, so multiple workers would otherwise duplicate the send.

## 4.4 Report catalogue (code, not a table)

`backend/app/modules/reports/catalogue.py` holds a tuple of `ReportSpec` entries:

```python
ReportSpec(
    key="maintenance.downtime",           # stable, used by schedules
    title="Maintenance downtime & MTTR",
    module="maintenance", subtab="reports",   # permission source
    href="/dashboard/maintenance/reports",    # where it opens
    description="...", status="live" | "planned",
    exporter=Callable[[Session, dict, User], tuple[bytes, str, str]] | None,  # (bytes, filename, content_type) for schedules
    params_model=PydanticModel | None,
)
```

Exporters call **existing** builders wherever they exist (maintenance export, P2P MIS export, HR attendance export, accounts `get_*` functions rendered to XLSX). New builders are written only where none exists. A report without an exporter appears in the library but can't be scheduled.

## 4.5 Phase 3: `ControlledDocument` (`controlled_documents`), number `<CAT>-NNN`

This covers §23 "general (non-engineering) controlled documents — SOPs, policies, templates". Engineering drawings stay in Design (D6).

| Field | Notes |
|---|---|
| `doc_number`, `title`, `category` | Category is a coded tuple: `sop`, `policy`, `form`, `template`, `work_instruction`, `manual` |
| `owner_department_id`, `owner_id` | |
| `revision` | Bumped on each approved change |
| `status` | `draft` → `in_review` → `approved` → `obsolete` |
| `effective_date`, `review_due_date` | `review_due_date` = approval + review period (§48, 12 months by default) |
| `approved_by_id`, `approved_at`, `obsolete_reason` | |

It registers a `DocumentAdapter` (`entity_type="controlled_document"`, `app="documents"`), so the **same** Word lifecycle (generate on letterhead, edit in Word Online, versions, changes, PDF) applies, and it shows up in the same register. No second document engine is built.

---

# 5. Workflows

## 5.1 Finding a document (Phase 1)

```
User opens Documents › Register
   │  filters: module, type, entity text, status (Current/Stale/Superseded), author, date range
   ▼
List (server-paginated, filtered by app + adapter.can_list)
   │
   ├─► "Open record"  → module page (adapter.link / ENTITY_LINK)
   └─► Row drawer     → ManagedDocumentPanel (existing): versions, changes since generated,
                        "Save & Edit in Word" (primary), Download .docx, Download PDF (secondary)
```

The register never offers "Create Word" for a record that has none. Creation stays on the record page, where the user has the context.

## 5.2 MIS dashboard (Phase 1)

```
GET /reports/mis?period=month&ref=2026-10-07&branch_id=…
   │  for each tile the user may see (source module app + tab):
   │      call the tile's source function inside try/except
   │      → {key, value(s), trend?, drill_href, as_of, note?}  or  {key, error: "<real reason + fix>"}
   ▼
Tiles the user may not see are omitted (not shown as zero).
One failing source never blanks the whole dashboard (real-error rule).
```

## 5.3 Scheduled report email (Phase 3)

```
06:30 IST APScheduler job "report_schedules" (registered next to existing jobs in main.py)
   │  for each active schedule due now (frequency/day/time):
   │     period_key → INSERT report_schedule_runs (unique) ─ conflict? skip (already sent)
   │     for each recipient:
   │        re-check permission AS THE RECIPIENT (app + tab) ─ fail → skipped with reason, owner told
   │        render with exporter(db, params, recipient)   ← data scoped to the recipient, not the owner
   │        email via _send_graph_mail(extra_attachments=[file])
   │        teams channel? → notify_user(..., teams=True)  "Weekly MIS ready — open" (link only)
   │     run.status = sent / partial / failed (+ real error)
   ▼
Owner sees run history on the schedule; a failed run notifies the owner (bell + Teams, reminder-type).
```

Rendering **as each recipient** matters. A schedule owned by the purchase head and sent to a buyer must not show the buyer branches or tabs they can't see. If a report can't be scoped per recipient, the exporter renders once and the job skips every recipient who lacks full access.

---

# 6. Metrics (MIS dashboard tiles)

Period selector: `This month` (default per §48), `Last month`, `This quarter`, `FY to date`, `Custom`. Branch (plant) filter where the source supports it.

| Tile | Definition | Source (existing unless marked) | Permission source | Drill-down |
|---|---|---|---|---|
| **Order book** *(indicative)* | Count and value of open customer orders: CRM inquiries at stage ≥ "Purchase Order" and < "Warranty", plus awarded tenders, at latest accepted quotation total, minus handed-over RRVs | CRM inquiries/tenders + quotations (**new lean query**). It is replaced by Sales Orders when Sales exists. | `crm` app | CRM pipeline |
| **RRVs in build by stage** | Open RRV builds (`PRODUCTION_RRV_OPEN_STATUSES`) grouped by `current_stage_key` over `PRODUCTION_RRV_STAGES`, plus on-hold and overdue counts | Production RRV builds (query over model constants; reuses the stage tuple) | `production:dashboard` | Production › RRV builds |
| **Purchase spend** | PO value approved in the period, by category, vs previous period; open PO value | P2P MIS (`p2p/routes/mis.py` summary logic) | `_require_mis_access` rule (purchase app / head / director / Partner) | P2P › MIS |
| **Stock value** | Total stock value and by category; count of unvalued items with the existing note | `accounts.services.inventory.stock_value_summary` (exists as a service) | `store` **or** `accounts` app (Q3) | Finance › Inventory |
| **Quality NCRs** | Open NCRs by severity (critical / major / minor), NCRs awaiting approval, overdue CAPAs, month rejection rate | Quality dashboard KPIs (`quality/schemas/dashboard.py:QualityDashboardKpis`) | `quality:dashboard` (note: the quality dashboard route itself has no tab check today) | Quality › Dashboard |
| **Maintenance downtime** | Breakdown downtime hours, MTTR, availability %, machines down now | Maintenance reports summary (`maintenance/routes/reports.py:report_summary`) | `maintenance:reports` | Maintenance › Reports |
| **Receivables** | Total outstanding and ageing buckets (0–30 / 31–60 / 61–90 / 90+) | `accounts.reports.get_ar_aging` (exists as a service) | `accounts` app | Finance › Reports › AR ageing |

Optional tiles for Phase 2: Payables ageing (`get_ap_aging`), Headcount (`hr/services/dashboard.build_dashboard`), PM compliance %, Design documents awaiting approval.

**How each tile calls its source (collision-safe rule).** Where the source is already a **service function** (`stock_value_summary`, `get_ar_aging`, `build_dashboard`), MIS imports and calls it. Where the logic lives **inside a route function** (P2P MIS, Quality dashboard, Maintenance summary, Production dashboard), Phase 1 does **not** refactor the other module's route, because those files are being edited by other sessions (§13). Instead:
1. The preferred approach is to ask the owning module to extract a `build_summary(db, ...)` service function when it next touches that file, and MIS switches to it.
2. Until then, MIS keeps a **thin read-only query** in `reports/services/sources/<module>.py` that reuses the module's model constants (status and stage tuples). Each source file has a header comment naming the route it mirrors. A test asserts the MIS number equals the module's own endpoint for a fixture dataset, so the two can't silently diverge.

---

# 7. API design

All routers are tagged and included in `main.py` with the `/api/v1` prefix.

| Router file | Endpoints |
|---|---|
| `documents/routes/register.py` | `GET /documents/register?module=&entity_type=&q=&status=&author_id=&date_from=&date_to=&include_superseded=&page=&page_size=` returns the paginated list (§4.1). `GET /documents/register/facets` returns the module and type options and authors **the user can see**, for the filters. `GET /documents/register/export` returns XLSX of the current filter (`documents:register:export`). |
| *(reused, unchanged)* `main/routes/documents.py` | `/managed-documents/{entity_type}/{entity_id}` (state, create, changes, edit, docx, upload), used by the drawer |
| `reports/routes/library.py` | `GET /reports/library` returns catalogue entries the user can open, grouped by module, with `status` live/planned and `schedulable`. |
| `reports/routes/mis.py` | `GET /reports/mis?period=&ref=&date_from=&date_to=&branch_id=` returns tiles (§5.2). `GET /reports/mis/export` returns a one-sheet-per-tile XLSX (Phase 2). |
| `reports/routes/schedules.py` | `GET/POST /reports/schedules`, `GET/PATCH/DELETE /reports/schedules/{id}`, `POST /{id}/send-now` (current period, idempotent), `GET /{id}/runs` |
| `documents/routes/controlled.py` (Phase 3) | CRUD, `POST /{id}/submit`, `/approve`, `/reject`, `/obsolete`, `/new-revision` |

Access control:
- `require_app_access("documents")` / `("reports")` + `require_tab_access(...)` on each router, following the Maintenance pattern. Partners and directors pass the `reports` app check the way they pass `_require_mis_access`.
- Row and tile filtering is done **in the service** with `can_view_tab` / `can_perform` from `core/permission_registry.py`.
- Every 403 and 409 uses the real-error rule, for example: "You can't schedule 'Receivables ageing' to Rahul: he has no access to Finance. Remove him or ask an admin to grant Finance › Reports."

---

# 8. Frontend

| Route | Page |
|---|---|
| `documents/page.tsx` | Redirect to `documents/list` |
| `documents/list/page.tsx` | **Register.** It has a filter bar (module, type, status chips, author searchable-select, date range with `DateField`, text search), a table, and a row drawer with `ManagedDocumentPanel` (existing, `canModify` from the record's own rules) plus "Open record". The status chip uses the existing badge style: Current (green), Stale (amber, "record revised after this was generated"), Superseded (grey). |
| `documents/approvals/`, `documents/templates/` | Phase 3 (controlled documents: approvals inbox; templates = `category = template`) |
| `documents/reports/` | **Not used.** Remove the empty folder, because document reports live in the Report library. See Q5. |
| `reports/page.tsx` | **MIS dashboard.** Tile grid (KPI tiles plus `Bar` for RRVs by stage and spend by category, and a stacked `Bar` for AR ageing). Each tile has an "as of" stamp, an "Indicative" badge where §2.3 applies, a per-tile error banner, and a drill-down link. |
| `reports/library/page.tsx` | **Report library.** Cards grouped by module, showing title, description, "Open" (module page), and "Schedule" if schedulable. Planned reports are greyed with the reason (e.g. "needs Sales module"). |
| `reports/schedules/page.tsx` (new folder), `[id]` | My schedules list, a form (report, params, frequency, day/time, format, channels, recipients multi-select chips), and run history. |
| `reports/custom/` | **Not used** (no report builder, D8). Remove the empty folder. |

Components in `frontend/src/components/reports/` and `components/documents/`: `ReportsNav.tsx`, `DocumentsNav.tsx` (copied from `MaintenanceNav`, with a `TABS` array, `subtabKey`, `filterTabsByAccess`, `NotificationBell`, `TourButton`), `MisTile.tsx`, `ChartCard.tsx` (lifted from `p2p/mis/page.tsx` into `components/shared/` **only if** P2P is not mid-edit; otherwise copy it), `DocumentStatusBadge.tsx`, `ScheduleForm.tsx`.

UI rules that apply to every page:
- The nav renders above the header.
- The "← Back" button uses the `secondaryBtnStyle` pill at the top-right of the header row.
- Use `ConfirmDialog` / `PromptDialog` and never browser dialogs (for example, deleting a schedule).
- Error banners show the backend's real message.
- Forms follow `premnathrail-ui-behavior` for searchable selects, multi-select chips and dates.
- Charts use the palette and `ChartJS.register` conventions in §2.2.
- Documents follow D4: "Save & Edit in Word" is primary, and PDF is secondary.

---

# 9. Wiring checklist

**Backend**
- [ ] `modules/documents/{routes,schemas,services}/__init__.py` and `modules/reports/{models,routes,schemas,services}/__init__.py`
- [ ] Add `"documents"` and `"reports"` to `AVAILABLE_APPS` in `main/models/user.py:10`. **That file is modified by another session right now**, so re-read it before editing.
- [ ] Add `MODULES["documents"]` and `MODULES["reports"]` to `core/permission_registry.py` (**currently modified by another session**)
- [ ] Extend `DocumentAdapter` with optional fields (§4.1). This is back-compatible. Then add `module_label` / `type_label` / `link` / `can_list` / `revisions` to the 5 `register(...)` call sites, **one module at a time and only when that module's files are not mid-edit**.
- [ ] Import `ReportSchedule`, `ReportScheduleRecipient`, `ReportScheduleRun` (and `ControlledDocument` in Phase 3) in **both** `backend/alembic/env.py` and `main.py`, and include the routers in `main.py`
- [ ] `register_audited(...)` for the new models in `core/audit_registry.py`
- [ ] Alembic migration: the two report tables, the `managed_documents.created_at` index, and seeded `modules` rows for `documents` and `reports` with a DELETE in `downgrade()`. Chain off the **current** head. Today that is `e7c4a1b9d2f5`, but run `alembic heads` immediately before creating the file, because several sessions add migrations.
- [ ] Register the `report_schedules` job in the `main.py` startup handler (Phase 3), at a slot that doesn't clash with the existing 06:00–09:45 jobs
- [ ] Add a `send_scheduled_report_email` in `utils/email.py`. It uses `_send_graph_mail(extra_attachments=...)`. **`utils/email.py` is modified by another session.**
- [ ] `backend/app/tests/test_documents_register.py` (permission filtering, status derivation, superseded) and `test_reports_mis.py` (tile permission, tile error isolation, parity with module endpoints), plus `test_report_schedules.py` (idempotent run, per-recipient permission re-check)

**Frontend**
- [ ] Add `'documents' | 'reports'` to the `AppModule` union in `types/index.ts` and the literal union in `hooks/useAuth.ts` (`useRequireApp`)
- [ ] Sidebar entries (`components/Sidebar.tsx`) and landing cards (`app/dashboard/page.tsx`)
- [ ] `documentsApi` and `reportsApi` in `lib/api.ts` (**modified by another session**), next to the existing `managedDocumentsApi`, plus interfaces in `types/index.ts`
- [ ] `ENTITY_LINK` entries for any `entity_type` without one (`crm_quotation`, `crm_activity_mom`, `erp_project_letter`, `production_rrv_handover`, `quality_*`) in `components/erp/NotificationBell.tsx`. Better: move the map to `lib/entityLinks.ts` so the register and the bell share it.
- [ ] Tour configs `lib/tour/configs/documents*.ts`, `reports*.ts`, registered in `lib/tour/registry.ts` (**`lib/tour` has 34 modified files from other sessions**)

**Docs**
- [ ] `docs/02-modules/reports-documents/overview.md` once built, and a changelog entry

---

# 10. Notifications

Notifications use the existing `notify_user` / `broadcast_notification`. Teams is opt-in with `teams=True` and is used **only for reminder-type and approval messages** (the standing rule).

| Type | Recipients | When | Teams? |
|---|---|---|---|
| `report_scheduled_ready` | Each schedule recipient who chose the Teams channel | Scheduled report sent (link to the report page, no file) | **Yes.** It is a reminder-type message. |
| `report_schedule_failed` | Schedule owner | Run `failed`, or `partial` with skipped recipients (with each reason) | Yes (reminder to fix) |
| `report_schedule_recipient_dropped` | Schedule owner | A recipient lost access, so they were skipped | Bell only |
| `controlled_document_review_due` (Phase 3) | Document owner | 30 days before `review_due_date`, then weekly | Yes (reminder) |
| `controlled_document_approval_pending` (Phase 3) | Approver | Submitted for approval | Yes (approval) |
| `controlled_document_approved` (Phase 3) | Owner | Approved | Bell only (approved stays bell-only) |

The documents register itself raises no notifications. Generating or editing a document is notified, if at all, by the owning module.

---

# 11. Phased delivery

**Phase 1: Register and MIS (read-only)**
- Module wiring (§9) for `documents` and `reports`
- Optional `DocumentAdapter` fields
- Documents register with filters, status derivation, drawer reuse and XLSX export
- Report library (catalogue with live and planned entries)
- MIS dashboard with the seven tiles (§6), using existing services and thin source queries, with per-tile permission and error isolation
- Tests (permission filtering, parity with module endpoints)

*Exit criterion:* a Partner opens one page and sees the order book (indicative), RRVs by stage, spend, stock value, NCRs, downtime and receivables, each clicking through to its module. A QA user lists every test certificate issued in a month, opens the current Word version, and sees which ones are stale.

**Phase 2: More reports**
- Store reports (slow/non-moving, negative stock), shortage vs open PO (item-level), and vendor performance (if PO lines carry a promised date)
- MIS XLSX export and optional tiles
- Ask module owners to extract route logic into services, and switch MIS sources to them
- Optional SharePoint "last edited" cache (Q4)
- Guided tours

**Phase 3: Scheduled reports and controlled documents**
- `report_schedules` + runs, the APScheduler job, email with attachment and a Teams reminder link
- Per-recipient permission re-check
- Controlled documents (SOP, policy, form, template) with approval and review-due reminders, reusing the Word lifecycle and §48 settings (categories, approvers, review period)

**After P3 source modules ship:** replace the indicative order book with Sales Orders, add cost per RRV vs quoted, BOM release per project, RRV-level shortage vs PO, and warranty failures by item. No MIS redesign is needed. Each one is a new catalogue entry or tile source.

---

# 12. Open questions

1. **Order book before Sales exists.** Is an *indicative* order book from CRM stages (≥ "Purchase Order") valued at the accepted quotation acceptable, clearly labelled? Or should the tile stay "Not available" until the Sales module is built? **Recommendation:** show it as indicative. Management needs the number now, and the label stops it being mistaken for booked orders.
2. **Register scope.** Phase 1 lists only **system-generated managed documents**. Should uploaded attachments (P2P, Quality, Maintenance, PM, HR) also appear, as a second "Attachments" tab? They are evidence, not documents of record, and they have five different tables. **Recommendation:** not in Phase 1. Revisit after controlled documents.
3. **Partner visibility.** Should Partners see **every** MIS tile regardless of their module assignments, as top approval level, or follow source-module access like everyone else? Also: should the stock value tile be visible to `store` users, or only `accounts` (because it shows money)? **Recommendation:** Partners see all MIS tiles (read-only, aggregate level only; drill-down still needs module access). Stock value goes to `accounts` + Partners.
4. **"Edited in Word" in the list.** Word Online saves exist only in SharePoint. Should a nightly job cache `last_modified_at` / `last_modified_by` / `version_count` on `managed_documents` (3 nullable columns) so the register can filter "edited after generation"? **Recommendation:** yes in Phase 2. It is a cache, not a second store, and it can always be rebuilt from SharePoint.
5. **Empty scaffold folders.** Can `frontend/src/app/dashboard/reports/custom` (report builder) and `documents/reports` be deleted? A custom report builder conflicts with D8 (no metadata customization).
6. **External recipients.** Should scheduled reports ever go to people without a portal login (e.g. an outside auditor or a bank)? **Recommendation:** no. Portal users only, so every send is permission-checked.
7. **Controlled-document approval chain.** For SOPs and policies, who approves: the owning department head only, or the department head followed by a Partner (D1)? Is the ISO MR the document controller?
8. **PDF snapshot on issue.** D4 says the latest Word version is the record. For documents sent to customers (quotation, test certificate), should the register also show *which* SharePoint version was sent? That needs an "issued" event written by the owning module when it emails or prints, and is a small addition to `ManagedDocumentEvent.action`.

---

# 13. Collision notes (parallel sessions)

`git status` on 7 October 2026 shows other sessions with large uncommitted changes in `accounts` (50 files), `projects` (40), `design` (39), `quality` (20), `maintenance` (18), `crm` (15), `store` (11), `p2p` (9), `main` (8), and in the shared files `main.py`, `alembic/env.py`, `core/permission_registry.py`, `core/audit_registry.py`, `main/models/user.py`, `utils/email.py`, `frontend/src/lib/api.ts`, `frontend/src/types/index.ts` and `frontend/src/lib/tour/*`.

Rules for building this plan:

1. **New code goes in new folders** (`modules/documents`, `modules/reports`, `components/documents`, `components/reports`). They don't collide.
2. **Shared registries** (`AVAILABLE_APPS`, `permission_registry`, `audit_registry`, `main.py`, `env.py`, `api.ts`, `types/index.ts`, tour registry): re-read each file immediately before editing, make append-only edits, and commit only this session's hunks (`git add -p`). Do not reformat these files.
3. **Alembic:** run `alembic heads` right before creating the migration. If there are two heads, stop and coordinate rather than adding a merge migration blind.
4. **Don't refactor other modules' route files** (`p2p/routes/mis.py`, `quality/routes/dashboard.py`, `production/routes/*`, `maintenance/routes/reports.py` are all modified right now). MIS uses thin read-only source queries plus parity tests (§6) until each owner extracts a service.
5. **`DocumentAdapter` extension** in `main/services/managed_documents.py` must be back-compatible (optional fields only), so the five existing `register(...)` calls in crm, erp, production and quality (all mid-edit) keep working without being touched. Add the extra fields to those call sites later, one module at a time.
6. **`quality/reports/documents.py` and `quality/routes/records.py` are modified** (Quality Phase 2 is in flight). New quality document kinds may appear. The register picks them up automatically from the adapter registry, so no change is needed here.
7. **Model import sync:** if any model in this plan is renamed or dropped later, fix both `alembic/env.py` and `main.py` imports in the same commit, or the deploy crashes.
