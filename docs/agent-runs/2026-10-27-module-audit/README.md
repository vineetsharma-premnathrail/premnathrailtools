# Module audit 2026-10-27 (read-only, 12 agents)

Every finding was checked in the code by an agent; items marked "verify" depend on intent or prod config.
Nothing was changed. Files were audited as on disk (incl. other sessions' uncommitted work).

| # | Module | High | Medium | Low | Total | File |
|---|---|---|---|---|---|---|
| 1 | Service portal | 7 | 12 | 8 | 27 | 01-service-portal.md |
| 2 | CRM | 9 | 12 | 8 | 29 | 02-crm.md |
| 3 | Sales + Products | 2 | 12 | 8 | 22 | 03-sales-products.md |
| 4 | Procurement | 2 | 13 | 9 | 24 | 04-procurement.md |
| 5 | Store | 5 | 12 | 10 | 27 | 05-store.md |
| 6 | Finance | 3 | 11 | 9 | 23 | 06-finance.md |
| 7 | HR | 1 | 7 | 7 | 15 | 07-hr.md |
| 8 | Production + Quality | 4 | 8 | 8 | 20 | 08-production-quality.md |
| 9 | Design / Electrical / Hydraulic | 4 | 12 | 9 | 25 | 09-design-ehp.md |
| 10 | R&D + Project Management | 5 | 12 | 4 | 21 | 10-rnd-pm.md |
| 11 | Maintenance | 4 | 9 | 11 | 24 | 11-maintenance.md |
| 12 | Organization / Users / Approvals / Auth | 4 | 10 | 14 | 28 | 12-organization-core.md |
| | **Total** | **50** | **130** | **105** | **285** | |

## Cross-module patterns (fix once, helps everywhere)
1. **Data scope gaps.** Pickers, contacts, reports, exports, lookups and broadcasts skip `apply_scope`. These appear in CRM, Service, Procurement, Store, Maintenance, Sales, Design and the Cockpit.
2. **Approval bypasses.**
   - Self-approval: R&D tasks, hydraulic and electrical BOMs, service entries.
   - Non-admins can make themselves approvers: delegations, department or plant head, approval flags, settings toggles.
   - Approvals outside the engine: SR→PR, ECR, R&D tasks.
3. **Duplicate documents from double-clicks or reruns.** No row lock and no "on order" netting: PO from a PR, PR from MRP, Planning, Maintenance spares and WOs; SOs per inquiry; opening stock import; PEW numbers; BOM versions.
4. **Broken handoffs in the core flow.**
   - SR→PR→Store→Finance: no item link, no billing, no reserve.
   - SO cancel→Order Project.
   - Return→dispatch or service.
   - WO output without issue.
   - Electrical and Hydraulic BOM→Production with unreleased lines.
5. **Money and currency.** USD treated as ₹ (CRM, Sales); Float money (CRM, Store quantities, vendor prices); discount after GST.
6. **Rule 14 everywhere.** Most lists load newest first and are silently cut at 500, 1000 or 2000 rows.
7. **Admin check inconsistency.** `role == "admin"` vs `is_admin_user` (Azure admins), in many modules.

## Suggested order
- Wave 1 (security/money, ~2 days): the High items in Organization (1-4), CRM (1-3, 9), Procurement (1-2), Finance (1-2), and Service (3, 5).
- Wave 2 (core-flow data integrity):
  - Service 1, 2, 4, 6, 7.
  - Store 1-5.
  - Production 2-4.
  - Sales 1-2.
  - Design 1-4.
  - Maintenance 1-4.
  - R&D 1-5.
- Wave 3: Medium items per module, then the Rule-14 sort/paging sweep and admin-check unification.
