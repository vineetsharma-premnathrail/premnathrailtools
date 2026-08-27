# Low-Level Design (LLD) — Premnathrail Portal

> Implementation-level classes, functions, modules, and logic. Companion to [ARCHITECTURE.md](ARCHITECTURE.md) (system-level) and [COMPONENT_DIAGRAM.md](COMPONENT_DIAGRAM.md) (HLD) — this document goes one level deeper into how a single module is actually structured, using ERP Service Requests as the worked example since it's the most fully documented lifecycle.

## 1. Layered Module Pattern

Every backend module under `backend/app/modules/<name>/` follows the same layer separation (see `README.md` Code Organization):

```
models/       Database schema only (SQLAlchemy), no methods
schemas/      Pydantic request/response validation
repositories/ SQL queries only, no business logic
services/     Business rules, validation, orchestration
routes/       Request parsing, response formatting, error handling
```

Not every module has all five layers — see §2 for what actually exists per module (some routes call the repository directly, skipping a `services/` layer).

## 2. Module Inventory (Actual, as of this writing)

| Module | models | schemas | repositories | services | routes | Notes |
|---|---|---|---|---|---|---|
| `main` | ✅ | ✅ | ✅ | ✅ | ✅ | Auth, users, audit, notifications, feedback, API keys |
| `crm` | ✅ | ✅ | ✅ | ✅ | ✅ | Full layering, plus `reports/` (quotation PDF) |
| `erp` | ✅ | ✅ | ❌ | ❌ | ✅ | Routes query models directly — no repository/service split |
| `rnd` | ✅ | ✅ | ✅ | ✅ | ✅ | Plus `tools/` (per-calculator logic) |
| `purchase` | ✅ | ✅ | ❌ | ❌ | ✅ | Plus `reports/`; same flat pattern as `erp` |
| `p2p` | ✅ | ✅ | ❌ | ❌ | ✅ | Flat pattern |
| `service` | ✅ | ✅ | ✅ | ✅ | — (`api/`) | ⚠️ Distinct from `erp` — purpose not resolved in existing docs, worth confirming with a stakeholder whether this is legacy/in-progress |
| `design`, `electrical`, `store`, `vendor` | ✅ | ✅ | — | — | ✅ | ⚠️ Have real model/schema/route files despite `PRODUCT.md`/`DEPARTMENT_MODULES_ROADMAP.md` listing these departments as "planned, not built" — **doc/code drift**, flag for a stakeholder to reconcile |
| `hr` | — | — | — | routes only | Minimal — a single `routes/hr.py` |

**Action item**: the `design`/`electrical`/`store`/`vendor`/`service` discrepancy above should be reconciled in `PRODUCT.md` and `DEPARTMENT_MODULES_ROADMAP.md` — this LLD reflects what's actually on disk, which is ahead of what the product docs claim.

## 3. Worked Example: ERP Service Request

### 3.1 Model (`erp/models/service_request.py` — inferred from schema/routes, not independently re-verified line-by-line)

Key fields: `id`, `project_id` (FK), `status` (`SRStatus` enum), `priority`, `deleted_at` (soft delete), timestamps. Related: `ServiceMaterial` (one-to-many), attachments (SharePoint references).

### 3.2 Status State Machine

```
open → acknowledged → assigned → scheduled → in_progress
  → pending_parts → on_hold → work_completed → review → closed
(cancelled reachable from any state)
```

### 3.3 Route Layer (`erp/routes/service_requests.py`)

Since `erp` has no `services/`/`repositories/` split, routes handle: request parsing → direct SQLAlchemy query/mutation → `AuditLog` write → response schema serialization, all in one function. Key endpoints:

- `POST /{sr_id}/raise-pr` — creates a `PurchaseRequisition` (in `purchase` module) from the SR's `ServiceMaterial` list; cross-module write inside a single request/transaction
- `POST /{sr_id}/materials/{mat_id}/receive` — marks a material received; mirrors status back onto the linked PR (cross-module read + write)

### 3.4 Schema Layer (`erp/schemas/service_request.py`)

Separate `Create`/`Update`/`Response` Pydantic models per standard FastAPI pattern; `Response` includes nested `ServiceMaterial` list and computed fields (e.g. days-open).

### 3.5 Cross-Module Coupling Note

The `raise-pr` and `receive` endpoints above are the two concrete places where `erp` directly touches `purchase` model state without going through a public API boundary — both modules live in the same process (modular monolith), so this is a direct import, not an HTTP call. If either module is ever split into a separate service (see `ARCHITECTURE.md` "Future migration to microservices"), these two call sites are exactly where a real API contract would need to be introduced.

## 4. Worked Example: CRM Inquiry → Quotation

`crm` has the full five-layer split, so trace one flow through it:

1. **Route** (`crm/routes/inquiries.py`) — parses request, calls service
2. **Service** (`crm/services/`) — validates business rules (e.g. stage transition legality), orchestrates repository calls, writes `AuditLog`, appends a stage log entry
3. **Repository** (`crm/repositories/`) — raw SQLAlchemy queries only
4. **Model** (`crm/models/inquiry.py`) — table definition, no logic
5. **Report generation** (`crm/reports/quotation_pdf.py`) — takes a `Quotation` id, renders PDF outside the request/service/repo chain (called from a route as a terminal action)

## 5. Cross-Cutting Concerns (Applied at Every Layer Boundary)

- **Auth**: `get_current_user` dependency injected at route level (see [THREAT_MODEL.md](../security/THREAT_MODEL.md))
- **Authorization**: `require_app_access(app_name)` / `has_erp_permission()` at route level, before service/repository is reached
- **Audit**: `AuditLog(...)` calls at service (or route, for flat modules) level after a successful mutation — not automatic, must be added per new endpoint (see [THREAT_MODEL.md §3 Tampering](../security/THREAT_MODEL.md) gap)
- **Soft delete**: `deleted_at` column check filtered into repository/route queries — confirmed for `erp`/`crm`; not confirmed for `purchase`/`p2p`/`rnd` (see [SECURITY.md](../security/SECURITY.md))

## 6. Known Gaps in This Document

- `erp`/`purchase`/`p2p` internals summarized from routes/schemas, not a full line-by-line trace of every function — treat §3 as representative, not exhaustive
- `design`/`electrical`/`store`/`vendor`/`service`/`hr` modules exist on disk but aren't covered in worked-example depth here — add a section per module as each is confirmed live (see §2 action item)

---
*Last updated: 2026-08-27. Update this document when a module's layering changes (e.g. `erp` gains a `services/` layer) or when a new cross-module coupling point is introduced.*
