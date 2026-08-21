# Business Development — Extension Plan

## Current state

Already substantially built via CRM: `Organization` (railway zones/divisions), `Inquiry` → `Quotation` → `PurchaseOrder` (customer orders), `Tender`, `InquiryTask` (cross-department, already proven reusable — see [[project-management]]), `InquiryApproval`.

## Phase 1 — Tender Gaps

- EMD/bid-bond tracking: amount, submission date, refund status — new fields on `Tender` or a small `tender_emd` sub-table if multiple EMDs per tender are possible.
- Competitor/pricing intelligence: `TenderCompetitor` already exists per the codebase survey — confirm it's actually populated/used before adding more here; extend it rather than creating a parallel table if it's underused but structurally fine.
- Win/loss analysis: outcome field + reason, rolled into Phase 2's dashboard.

## Phase 2 — Pipeline Dashboard

- Stage funnel (Inquiry → Quotation → PO), weighted forecast (probability × value per stage) — a read-aggregation dashboard, no new core entities beyond what Phase 1 adds.

## Phase 3 — Verify the Inquiry → Project Handoff

- Confirm the `Inquiry` → `Organization` `PurchaseOrder` → `erp_projects` handoff is actually wired end-to-end before adding more on top of it — a quick trace through the existing code, not a new feature. If gaps are found, that's the real Phase 3 work, scoped after the trace.

## Interconnections

| With | Relationship |
|---|---|
| [[project-management]] | `InquiryTask`'s shape (department field, cross-department assignment) is reused directly for Project Management's post-sale tasks — don't invent a second task model there |
| [[accounts]] | `PurchaseOrder.po_value` is read by Accounts for revenue rollup |
| ERP (ProjectModule) | The Inquiry-to-Project handoff (Phase 3) is the literal seam between pre-sales (CRM) and delivery (ERP) |

## Cross-cutting

- No `AVAILABLE_APPS` change needed — `crm` already exists.
- Phase 3's trace should happen before Phase 1/2 work if there's any doubt the handoff works — building a nicer pipeline dashboard on top of a broken handoff just makes the gap harder to notice later.
