# Purchase Department — Full Module Plan

> Supersedes the phase list in `docs/product/PURCHASE_MODULE_PLAN.md` for planning purposes (that file stays as a historical record of the original PR-only scope). This doc plans the Purchase **department**, not just the `purchase` code module — it covers the already-built `p2p` request lifecycle, the vendor/PO/GRN layers (now built), and exactly how Purchase hands off to Store (see `STORE_DEPARTMENT_MODULE_PLAN.md` and `PURCHASE_STORE_INTEGRATION.md`).

## Design reference: mapping SAP MM concepts onto what's built here

Premnath doesn't run SAP MM for this workflow, but SAP MM's shape (PR → RFQ → PO → GR → Invoice Verification, with a Material Master and Vendor Master underneath) is the industry-standard procurement lifecycle, and it's a useful checklist for what a "complete" purchase module covers versus what this one deliberately keeps thin. Use this table to see exactly which SAP MM piece each part of `p2p`/`vendor`/`store` corresponds to, and where this implementation is intentionally lighter.

| SAP MM concept | This portal's equivalent | Status | Deliberately lighter than SAP |
|---|---|---|---|
| Material Master (MM01) | `store.StockItem` (part code, description, UOM, reorder point) | ✅ Built (Store module) | No multiple valuation areas, no batch/serial management, no alternative-unit conversions |
| Vendor Master (FK01) | `vendor.Vendor` | ✅ Built | No vendor sub-range, no vendor-specific price agreements, no purchasing-org-level vendor scoping (single company assumed) |
| Purchase Requisition (ME51N) | `P2PRequest` + `P2PRequestItem` | ✅ Built | No account-assignment category split (cost center/internal order/asset) — P2P items are qty-only, costed at the PO layer instead, a deliberate simplification (see Phase 3 below) |
| Request for Quotation (ME41N) | `P2PRequest.rfq_number`/`quotation`/`vendor_comparison` (free-text) | ⚠️ Partial | Real SAP RFQ sends a formal quote request to N vendors and stores each vendor's price as a comparable row — this portal has one free-text summary field. Formalizing this is Phase 7 below |
| Quotation Comparison (ME49N) | Manual, off-portal (buyer compares and free-types the summary) | ❌ Not built | Phase 7 — a `p2p_rfq_quotes` table, one row per vendor quoted, would make this a real comparison rather than a typed note |
| Purchase Order (ME21N) | `P2PPurchaseOrder` + `P2PPurchaseOrderItem` | ✅ Built | No PO output/print determination framework, no release strategy (approval matrix is Phase 2's stretch item, not yet built), no schedule lines (single delivery date per line) |
| Goods Receipt (MIGO) | `update-receipt` route on `P2PRequest` → posts to `store.StockTransaction` | ✅ Built | No movement-type framework (101/102/103 etc.) — just `receipt`/`issue`/`transfer_in`/`transfer_out`/`adjustment`; no over/under-delivery tolerance percentages, receiving is manual-quantity-entry only |
| Invoice Verification / 3-Way Match (MIRO) | — | ❌ Not built | This is Phase 5 below. SAP's 3-way match (PO qty/amount vs. GR qty vs. invoice qty/amount) is exactly the shape Phase 5 should copy — see the refined phase below |
| Valuation (Standard Price / Moving Average) | `StockItem.standard_cost` (a single field, not a live-updating valuation) | ⚠️ Partial | No moving-average recalculation on receipt, no price-variance-to-GL posting (out of scope — that's SAP FI territory per the Accounts plan's non-goal) |
| Stock Overview (MMBE) | `store` item list + balances | ✅ Built | Single-plant model (no multi-plant/multi-storage-location matrix in the stock item screen itself, though `StoreLocation` exists for multi-location balances) |

The two rows worth acting on are **RFQ formalization** (Phase 7) and **Invoice Verification / 3-way match** (Phase 5) — both already existed as stubs in this plan; the table above just makes precisely which SAP MM shape they should copy explicit.

## Where things actually stand today

Two backend modules currently share the "Purchase" name space — keep this distinction in every phase below:

- **`backend/app/modules/purchase/`** — the *original* module, scoped only to Purchase Requisitions raised from an ERP Service Request's Materials tab. Frontend: `dashboard/purchase/`.
- **`backend/app/modules/p2p/`** — the *standalone* request module any department can raise a request from. Frontend: `dashboard/p2p/` (+ a read-only mirror at `dashboard/purchase/p2p-requests/`). This is the module carrying the full built lifecycle below.

**Converged as planned**: `p2p` is the one department-facing request module; Vendor and Purchase Order are real linked entities (not free-text columns) as of Phases 1–2 below.

## ✅ Phase 1 — Vendor Master (BUILT)

`backend/app/modules/vendor/` — `vendors` table shared with Vendor Development (transactional fields owned by Purchase: name, contact, GSTIN, category, payment terms; qualification fields owned by Vendor Development: `qualification_status`, `is_avl`, `last_audit_date`/`score`). CRUD at `/dashboard/purchase/vendors`. **Hard gate already enforced**: `P2PPurchaseOrder` creation is rejected (409) if the vendor's `qualification_status != "qualified"`.

## ✅ Phase 2 — Formal Purchase Order (BUILT)

`P2PPurchaseOrder` + `P2PPurchaseOrderItem` (`backend/app/modules/p2p/models/purchase_order.py`), `PO-{YEAR}-{NUM}` numbering, status lifecycle `draft → issued → acknowledged → partially_fulfilled → fulfilled` (or `cancelled`). The P2P "Create PO" action creates a real linked PO record (not just free-text fields) and mirrors `po_number`/`po_date`/`po_value` back onto `P2PRequest` for display. **Not yet built**: PO PDF generation, and the value-based approval matrix (Buyer → Manager → Director thresholds) — both remain open, see "Remaining work" below.

## ⚠️ Phase 3 — Costing & Budget Tracking (PARTIAL)

PO items already carry `unit_price`/`tax_rate`/`line_total` (computed server-side). **Not yet built**: GST breakdown (CGST/SGST/IGST split, HSN codes), and project-level `project_budget` (budgeted/committed/spent) — P2P/PO data exists to compute the "committed" and "spent" halves today, only the "budgeted" input and the rollup view are missing.

## ✅ Phase 4 — Goods Receipt Note (GRN) → Store (BUILT)

`P2PRequestItem.stock_item_id` links a request line to Store's catalog (nullable, non-blocking — see `PURCHASE_STORE_INTEGRATION.md`). The `update-receipt` route computes the delta received and posts a `receipt` transaction to `store.StockTransaction` via `record_stock_receipt()` for every mapped item, with `store_location_id` required only when at least one item is mapped. `P2PRequest.receipt_status`/`received_quantity` remain read mirrors as planned.

## ❌ Phase 5 — Invoice Verification (3-Way Match) — NOT BUILT, refined scope

This is the highest-value remaining phase and should copy SAP MIRO's shape directly:

- New `p2p_vendor_invoices`: `purchase_order_id` FK, invoice number, invoice date, amount, due date, payment status (`unpaid`/`partial`/`paid`) — **status only, no payment processing or GL posting**, per `PRODUCT.md`'s SAP non-goal (see `ACCOUNTS_MODULE_PLAN.md`'s concept-mapping table for the same boundary).
- **3-way match, computed exactly like SAP's MIRO variance check**: compare (a) PO ordered qty/amount, (b) cumulative GRN received qty (already computable from `P2PRequest.received_quantity` / linked GRN stock transactions), (c) invoice qty/amount. Surface the three numbers side by side with a computed variance %, same as the SAP guide's "PO Qty: 500 | GR Qty: 485 | Invoice Qty: 485 → Match!" pattern.
- **Tolerance, not hard block**: SAP MM's real behavior is a configurable tolerance (e.g. price variance ≤5%, qty variance ≤2%) that auto-passes within tolerance and flags for manual review outside it — copy that exact two-tier behavior (auto-approve vs. flag) rather than either always-blocking or never-checking.
- **Confirm with finance/SAP owner before building** — flagged as the phase most likely to creep into ledger territory; the tolerance/variance *display* is fine, anything that becomes a payment trigger is not.

## ✅ Phase 6 — Reporting & Dashboard (BUILT)

`/dashboard/purchase/dashboard` — open PRs, pending approval, awaiting PO, overdue deliveries, POs awaiting acknowledgment, total PO spend, qualified-vendor ratio, low-stock count (from Store), top vendors by spend. **Not yet built**: formal vendor scorecard (on-time delivery %, GRN rejection rate, cycle time) and Excel export.

## ⚠️ Phase 7 (stretch) — Multi-Vendor RFQ Comparison — refined scope

Per the concept table above, copy SAP ME41N/ME49N's shape:
- New `p2p_rfq_quotes`: `p2p_request_id` FK, `vendor_id` FK, quoted unit price per item (or a simple total), delivery time, payment terms offered — one row per vendor quoted, replacing the current single free-text `vendor_comparison` field.
- A comparison view showing all quotes for a request side by side (price, delivery, terms), same shape as the SAP guide's comparison table, with the lowest/best highlighted — not an auto-decision, the buyer still picks.
- Build only once more than one department is actively comparing quotes — low urgency today.
- Optional vendor self-service portal remains explicitly out of scope (significant scope, pursue only on clear demand).

## Remaining work summary (for quick planning)

| Item | Phase | Effort |
|---|---|---|
| PO PDF generation | 2 | Small — reuse existing letterhead pipeline |
| Value-based approval matrix | 2 | Medium |
| GST/HSN breakdown on PO items | 3 | Small |
| `project_budget` (budgeted input + rollup) | 3 | Medium |
| Invoice Verification / 3-way match | 5 | Medium-Large — needs finance sign-off first |
| Vendor scorecard | 6 | Small |
| Excel export | 6 | Small |
| RFQ formalization (`p2p_rfq_quotes`) | 7 | Medium |

## Cross-cutting, every phase

- Alembic migration per phase, following the defensive-column-check + `batch_alter_table` conventions in [[premnathrail-app-design]] — never assume a clean autogenerate diff on this schema.
- Extend `AuditLog` and `notify_user`/`broadcast_notification` to every new entity the same way `P2PRequest` already uses them.
- Keep the module-boundary rule: new Purchase tables reference `erp`/`store`/other modules by id only, never import their route/service code (see `PURCHASE_STORE_INTEGRATION.md` for exactly which ids cross the boundary).
