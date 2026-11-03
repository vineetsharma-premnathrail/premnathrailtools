# RBAC extension — current state and plan (2026-11-03)

Status: **PLAN, waiting for owner approval.** Nothing built.

## Requirement (owner)
Control access Module → Tab → Section → Component → Action → Field → Record, all set in
Organization › Role & Permissions (never hardcoded "creator only" rules in code). See the
owner's spec pasted in chat 2026-11-03.

## Current state (verified in code)
| Level | Status | Where |
|---|---|---|
| Module / Tab / 11 actions | Done, deny by default, backend on every route | core/permission_registry.py, core/permissions.py |
| Features (sub-tab / section / action / sensitive) | Done, inherit tab until customised | core/features/*.py |
| Sensitive data stripped in API | Partial: Procurement prices, CRM prices, Store stock value, R&D BOM cost, Production, Quality. Finance 0, HR 1 | p2p/pricing.py, crm/access.py, store/services/stock_values.py |
| Section / column hide | Screen only (by design, ADR 0005); dropdown values server-checked | core/visibility.py (UNCOMMITTED, other session) |
| Field Hidden / Read-only / Editable | Missing | — |
| Data scope 6 levels per module per role + user override | Done | core/data_scope.py |
| Edit / Delete only own | Hardcoded: delete-own app-wide; edit-own only CRM; HR visitor/expense ad hoc; other modules edit anything in view scope | permissions.py ensure_can_delete, crm/routes/inquiries.py _can_modify |
| Export / import / print use scope | 27 of 44 route files reference scope; ~10 to audit (7 others are R&D calculators, untouchable) | store job_work/item_import/bin_stock, p2p vendors/mm_quotations, accounts receivables/co_controlling, hr attendance_periods, main documents, rnd requirement_work |
| Bulk-action permissions | Missing | — |
| Explicit deny | Not present (roles add only) — keep it that way | — |
| SoD | Exists: access-risk page, SodMitigation, access reviews | main/models/grc.py |
| Matrix labels = real tabs | Mismatches (CRM: Inquiries+Tenders one feature, Technical Offers shown as action, order/spelling, Info/Overview missing) | core/features/crm.py + sweep |

## Blocker
All files this touches are uncommitted work of another session (role-visibility run 2026-11-02,
visibility.py edited today 15:59). Build phases wait until that work is committed.

## Phases
- **Phase 0 (now, read-only, no file conflicts):** BA spec, architecture design, export/import/print scope audit report.
- **Phase 1 — Edit / Delete scope (P0):** per role per module View / Edit / Delete scope (+ user override); one central check; CRM, delete-own, HR owner rules moved onto it. One migration. Defaults = today's behaviour.
- **Phase 2 — Field Hidden / Read-only (P1):** extend visibility catalogue with fields; server refuses changes to read-only fields (real error) and strips hidden sensitive fields. First screens: GRN, PR, PO, Inquiry, Quotation.
- **Phase 3 — Sensitive data (P2):** HR salary/PAN/Aadhaar/bank, Finance amounts/margins, internal remarks — API + Excel + Word.
- **Phase 4 — Export/import/print scope fixes (P3):** fix what Phase 0 audit finds.
- **Phase 5 — Bulk actions (P4):** feature-level bulk action only where a bulk button exists.
- **Phase 6 — Matrix labels = real tabs:** CRM first, then all modules; "always visible" note.

## Not doing (and why)
- Explicit deny: union + SoD is the ERP standard; deny makes "why no access?" undebuggable.
- Backend enforcement for non-sensitive hidden sections/columns: screen hide is enough; security = sensitive switches.
- Per-tab data scope; role-chosen plants (Branch assignment covers multi-plant).
- Status rules (approved/posted docs locked) stay in code: data integrity, not permission.
