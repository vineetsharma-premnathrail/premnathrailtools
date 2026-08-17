# Purchase Module — Roadmap

> ✅ **Partially implemented via a separate module.** The buyer-assignment → RFQ → vendor-selection → PO → receipt-tracking shape described in Phases 1–4 below now exists, but as a *separate, standalone* module (`backend/app/modules/p2p/`, frontend `dashboard/p2p/` + `dashboard/purchase/p2p-requests/`), not as an extension of the SR-linked `purchase` module this doc describes. See `docs/product/PRODUCT.md` ("Business Processes" → 3b) for the actual lifecycle. The `purchase` module's own `vendors/orders/rfqs/grn/invoices` frontend routes are still empty placeholders — worth deciding whether to build them out here or converge onto the standalone module instead of doing both.

## Current state (as of Aug 2026)

The `purchase` module (`backend/app/modules/purchase/`) only covers **Purchase
Requisitions (PR)**, raised from a Service Request's Materials tab:

`submitted → approved → po_raised → partially_received/received → closed`
(with `rejected`/`cancelled` off-ramps).

What exists:
- `PurchaseRequisition` + `PurchaseRequisitionItem` — snapshot of requested materials, qty only, no cost.
- Each item now carries a `remarks` text field (editable from the PR detail page) and a read-only photo gallery — the photos themselves are still only added/removed from the ERP Service Request's Materials tab (see [ARCHITECTURE.md](../architecture/ARCHITECTURE.md#purchase-module)).
- `vendor` and `po_number`/`po_date` are free-text fields typed in after the fact — no vendor master, no generated PO document.
- Receiving is recorded on the ERP side (`ServiceMaterial.receiving_status`) and mirrored back onto the PR — no formal Goods Receipt Note.
- No costing, no budget tracking, no invoice/payment tracking, no reporting dashboard.
- Clean boundary already established: `purchase` never imports `erp` route/service code, only references `project_id`/`service_request_id` by id, and mirrors `pr_number`/`pr_status` onto `ServiceMaterial`. New entities below should keep this pattern.

**Note:** `docs/product/PRODUCT.md` lists "Accounting/finance module (exists in SAP)" as an explicit non-goal. Phase 5 below (invoice/payment tracking) brushes against that boundary — confirm scope before building it; the plan keeps it as *visibility only*, not AP automation.

## Phase 1 — Vendor Master

- New `vendors` table: name, contact person, phone/email, address, GSTIN, category (materials/services/both), payment terms, status (active/blacklisted).
- Add `vendor_id` FK to `PurchaseRequisition`, keep `vendor` as a denormalized name snapshot for history.
- Vendor CRUD pages (list, detail, create/edit) under `/dashboard/purchase/vendors`.
- `require_app_access("purchase")` reused; no new permission tier needed yet.

## Phase 2 — Formal Purchase Order

- New `purchase_orders` + `purchase_order_items` tables: `pr_id` (nullable — allows ad-hoc POs later), `vendor_id`, line items (material, qty, unit price, tax %, line total), delivery terms, status (`draft → issued → acknowledged → partially_fulfilled → fulfilled → cancelled`).
- PO PDF generation using the existing Premnath letterhead convention (`premnath-letterhead` skill / R&D report pipeline as reference).
- Approval matrix: value-based thresholds (e.g. Purchase Officer → Purchase Manager → Director above ₹X), configurable, reusing the `AuditLog` pattern already in `purchase_requisitions.py`.

## Phase 3 — Costing & Budget Tracking

- Add `unit_price`, `currency`, `tax_rate`, `line_total` to PO items (PR stays qty-only, as documented today).
- GST breakdown (CGST/SGST/IGST), HSN codes per material line — India-specific, ties into `Project.client_gst`.
- Lightweight `project_budget` (budgeted amount, committed amount from open POs, spent amount from closed POs) — surfaced on the Project page in `erp`, populated via the same cross-module id-reference pattern.

## Phase 4 — Goods Receipt Note (GRN)

- Formal `goods_receipt_notes` + items: PO reference, delivery challan number, received/rejected/damaged quantities, inspection remarks.
- `ServiceMaterial.receiving_status` becomes a read mirror driven by GRN entries (same mirror-field pattern already used for PR status), instead of being the primary record.
- Rejection reasons feed vendor performance (Phase 6).

## Phase 5 — Invoice Tracking (visibility only, not AP)

- `vendor_invoices`: PO + GRN reference, invoice number, amount, due date, payment status (unpaid/partial/paid) — status only, no payment processing.
- 3-way match flag: PO qty/amount vs. GRN qty vs. invoice qty/amount, surfaced as a warning, not a hard block.
- **Confirm with finance/SAP owner before building** — this is the phase most likely to overlap with the stated non-goal.

## Phase 6 — Reporting & Dashboard

- Purchase dashboard: open PRs by status, POs awaiting vendor acknowledgment, overdue deliveries, spend by vendor/project/month.
- Vendor scorecard: on-time delivery %, rejection rate, PR-to-PO cycle time.
- Excel export for handoff to finance/leadership.

## Phase 7 (stretch) — RFQ / Multi-Vendor Quotation

- Compare quotes from multiple vendors before PO issuance, for high-value purchases.
- Optional vendor self-service portal — significant scope, only pursue if there's clear demand.

## Cross-cutting, every phase

- Alembic migration per phase, following the existing `pre_purchase_migration_*` backup convention.
- Extend `AuditLog` (entity_type) and `notify_user`/`broadcast_notification` to new entities the same way PRs already use them.
- Keep the module-boundary rule: new tables reference `erp`/other modules by id only, never import their route/service code.
