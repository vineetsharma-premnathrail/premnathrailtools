# Store Department — Full Module Plan

> New module — nothing exists for Store today beyond the sketch in `docs/product/DEPARTMENT_MODULES_ROADMAP.md` ("Store (Inventory)" section). This doc expands that sketch into a buildable phased plan and defines the exact integration points with Purchase (`p2p` module) — see `PURCHASE_STORE_INTEGRATION.md` for the combined data-flow view once both plans exist.

## Why Store is a separate module, not a Purchase feature

Store is the **one stock ledger** that Purchase's GRN, Production, Maintenance, and Quality's incoming inspection all need to write to or read from. Building it as a Purchase sub-feature would mean re-deriving stock-on-hand from scattered PO/GRN rows every time another department needs it. Per the roadmap's suggested build order, **Store should land before or alongside Purchase Phase 4 (GRN)**, since GRN's whole purpose is to post a stock-in transaction somewhere real.

## Data model

New backend module `backend/app/modules/store/`, following the "simple module" tier (models/routes/schemas + a `service.py` for stock-movement logic — see [[premnathrail-app-design]]):

- **`store_locations`** — bin/warehouse/site (name, code, address) — supports multi-site from day one even if Premnath only has one store today, since `ship_to` already exists as a free-text field on P2P items and should eventually resolve to one of these.
- **`stock_items`** — the part master: part code (unique), description, make, UOM, category, reorder point, reorder quantity, standard cost (optional, for valuation), status (active/obsolete). This is intentionally **separate from `P2PRequestItem`** (which is a per-request line, not a catalog) — a `stock_item_id` gets linked from a P2P item only once triage/coding happens, not at request time, since a requester describing "Hydraulic Hose Assembly" in free text shouldn't be forced to pick from a part catalog they may not know exists.
- **`stock_balances`** — `(stock_item_id, location_id) → quantity_on_hand`, always derived/recomputed from `stock_transactions`, never hand-edited (the transaction log is the source of truth; balance is a materialized cache for fast reads).
- **`stock_transactions`** — the ledger: `stock_item_id`, `location_id`, `type` (`receipt`, `issue`, `transfer_in`, `transfer_out`, `adjustment`, `return`), `quantity` (signed or a separate direction field — pick signed for simpler balance math), `reference_type` (`p2p_grn`, `production_order`, `service_material`, `maintenance`, `manual_adjustment`), `reference_id`, `performed_by_id`, `remarks`, timestamp. Every stock movement in the system, from any department, is one row here — this table is Store's entire reason to exist.
- **`stock_transfers`** — a thin wrapper over two linked `stock_transactions` rows (`transfer_out` at source, `transfer_in` at destination) for the UI/audit convenience of showing one transfer record instead of two raw transactions.

## Phase 1 — Stock Master & Manual Stock-In

- CRUD for `store_locations` and `stock_items` under `/dashboard/store/items` and `/dashboard/store/locations`.
- Manual stock-in form (opening balance load, found-stock adjustment) posting directly to `stock_transactions` with `reference_type = "manual_adjustment"` — this exists so Store is usable and testable before Purchase's GRN integration (Phase 3 below) is wired.
- `require_app_access("store")` — new `AVAILABLE_APPS` entry, per [[premnathrail-app-design]]'s permission wiring section. Flag: this is department #6 on `AVAILABLE_APPS`; per the roadmap's structural warning, seriously consider converting to a DB-backed module registry now rather than after Store, since Production/Maintenance/Quality are coming next and will each want the same treatment.
- Stock list page follows the canonical list-table shape from [[premnathrail-ui-behavior]] (sticky header, glass wrapper, row-click to detail), with a low-stock indicator badge (`quantity_on_hand <= reorder_point`) using the same `STATUS_HEX`-style pill convention.

## Phase 2 — Stock Issue

- Issue form: pick a `stock_item`, quantity, destination (`reference_type` + `reference_id` — initially just `service_material` since that's the only consumer that exists today via `ServiceMaterial`), posts a `type = "issue"` transaction and decrements the cached balance.
- Guard: block (or warn, configurable) an issue that would take `quantity_on_hand` negative — a real physical stock can't go negative, but during initial rollout while opening balances are still being loaded, a hard block may be too strict; start as a warning, tighten later.
- `ServiceMaterial` (ERP module) gets a nullable `stock_item_id` + `issued_via_transaction_id` so a service-request material line can optionally be sourced from Store stock instead of purchased fresh — this is additive, doesn't change `ServiceMaterial`'s existing shape.

## Phase 3 — Purchase GRN Integration (the main integration point)

- When Purchase's `p2p_goods_receipts` (Purchase Phase 4) is saved, it calls into Store's `service.py` (e.g. `record_stock_receipt(stock_item_id, location_id, quantity, reference_type="p2p_grn", reference_id=grn.id)`) rather than Purchase writing directly into `stock_transactions` — Store owns the ledger and its invariants (balance recompute, negative-stock guard), Purchase only triggers the event. This is the one place a cross-module **function call** is acceptable instead of a pure id-reference, since it's the designated integration seam — document it clearly in both modules' code so it isn't mistaken for a boundary violation.
- Requires GRN lines to resolve to a `stock_item_id` — since a P2P request is raised as free-text item description (per the just-built SL/Item Description/Make/Part Code/UOM/Qty/Project-Inhouse/Category/Ship To column set), someone (the assigned buyer, at GRN time) needs to map/create the matching `stock_item`. This mapping step is the realistic friction point of this whole plan — worth a lightweight "link to stock item or create new" picker on the GRN line, not a hard requirement that blocks receiving if unmapped (allow GRN without a stock link, just skip the stock-transaction post in that case, and flag it for someone to reconcile later).

## Phase 4 — Stock Transfer & Cycle Count

- Transfer UI: pick source location, destination location, item, quantity — creates the linked transfer-out/transfer-in transaction pair atomically (single DB transaction, not two independent API calls).
- Cycle count / stock audit: a count sheet per location (system quantity vs. counted quantity), variance report, and a one-click "post adjustment" that creates `type = "adjustment"` transactions for each variance line, signed to correct the balance.

## Phase 5 — Reorder & Purchase Trigger

- Dashboard view: items at/below `reorder_point`, sorted by how far below.
- "Raise P2P Request" action from a low-stock item — pre-fills a new P2P request's item row (Item Description, Make, Part Code, UOM = the stock item's fields, Qty = reorder quantity, Category = the item's category) via a query param or draft-prefill, rather than the requester retyping it. This is Store → Purchase in the other direction from Phase 3's GRN hook, closing the loop: Purchase receives → Store stocks in → Store issues down → Store notices low stock → triggers a new Purchase request.
- Optional: a scheduled/background check that auto-creates a draft (not auto-submitted) P2P request when an item crosses its reorder point, surfaced as a notification rather than silently submitted — keep a human in the loop on anything that spends money.

## Phase 6 — Valuation & Reporting

- If `standard_cost` is populated (Phase 1), a stock valuation report (quantity × cost per item/location) — read-only, feeds the Accounts visibility-layer dashboard mentioned in the roadmap rather than being a ledger of its own.
- Consumption report by department/project (rolls up `stock_transactions` where `reference_type = "service_material"` grouped by the linked `ServiceMaterial.project_id`).
- Ageing report: stock with no `issue` transaction in N days, to surface dead/slow-moving stock.

## Cross-cutting, every phase

- Alembic migration per phase, same conventions as Purchase's plan.
- Every `stock_transactions` write goes through `service.py`, never a raw insert from a route handler, so the balance-recompute + negative-stock-guard logic lives in exactly one place.
- Extend `AuditLog` to `stock_items`/`stock_transactions`/`stock_transfers` the same way P2P already does.
- New pages follow `/dashboard/store/{items,locations,issue,transfer,cycle-count,reorder}` — same routing shape as [[premnathrail-app-design]] describes for other modules, with a `StoreNav` sub-nav component copy-adapted from `P2PNav`/`ErpNav`.
