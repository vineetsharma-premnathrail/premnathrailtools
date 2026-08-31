# Store Module — Overview

**Module:** Store
**Backend Location:** `backend/app/modules/store/`
**Prepared by:** Vineet Sharma
**Date:** 29 August 2026

---

# 1. Introduction

The Store module is PremnathRail's stock/inventory tracking system: a catalog of stock items, the physical storage locations that hold them, and every movement of stock in or out, recorded as an immutable transaction log. Its central design decision, and the reason the module exists in its current shape, is that **every stock movement in the system, from any department, is recorded as a single row in one shared transaction table** — the transaction log is Store's entire reason to exist, and every other view of stock (current balances, a cycle-count sheet) is derived from it rather than independently maintained.

Routes are split across three routers, all mounted under `/store`: locations (`routes/locations.py`), stock items (`routes/stock_items.py`), and transactions (`routes/stock_transactions.py`).

---

# 2. Stock Items

A **Stock Item** (`StockItem` model) is a catalog entry — a part identified by a unique `part_code`, with a description, make, unit of measure, category, reorder point and reorder quantity, standard cost, status (`active` or `obsolete`), and free-text remarks. This is deliberately a separate concept from a P2P request's line item: a `StockItem` is a standing catalog entry that exists independent of any specific purchase, whereas a `P2PRequestItem` is a free-text line on a single, one-off request. Conflating the two would mean every ad-hoc purchase request line would need to pollute the parts catalog, which is exactly what this separation avoids.

---

# 3. Storage Locations

A **Store Location** (`StoreLocation` model) is a physical place stock can be held — identified by a unique `code`, with a name, address, and an active flag. Every stock transaction and every stock balance is scoped to a specific location, so the module can answer not just "how much of this part do we have" but "how much of this part do we have, and where."

---

# 4. Stock Transactions and Balances

Every stock movement — receipt, issue, transfer in, transfer out, adjustment, or return — is recorded as a `StockTransaction` row, with a **signed quantity**: positive for a receipt, transfer-in, or return; negative for an issue or transfer-out; and either sign for an adjustment, depending on which direction the counted variance runs. Each transaction optionally records a `reference_type`/`reference_id` pair, so a movement can be traced back to whatever business action caused it (for example, a manual adjustment, or a specific PR/PO in another module), and who performed it.

A separate `StockBalance` table holds the **current quantity on hand per (stock item, location)** pair — but this is explicitly a materialized cache, always derived and recomputed from the transaction log, never hand-edited directly. The transaction log is the single source of truth; the balance table exists purely so that a current-stock lookup doesn't have to sum the entire transaction history on every read.

The transaction routes (`routes/stock_transactions.py`) expose this model as a small set of purpose-built actions rather than a generic "post any transaction" endpoint:

- **`POST /store/transactions/stock-in`** — records a receipt (always posted as a positive quantity, `reference_type: "manual_adjustment"`).
- **`POST /store/transactions/issue`** — records an issue (always posted as a negative quantity), optionally tagged with a caller-supplied `reference_type`/`reference_id` and an `allow_negative` flag for cases where an issue is deliberately allowed to push a location's balance below zero.
- **`GET /store/transactions/balances`** — returns a full cycle-count sheet for a given location: every *active* stock item, including items with **no transaction history at all yet**, shown at a balance of zero. This is a deliberate choice: a physical count sheet has to cover everything that could plausibly be sitting on the shelf, not only items the system has already seen movement for.
- **`POST /store/transactions/adjust`** — posts a cycle-count variance. The caller supplies the physically counted quantity; the route computes the signed difference against the current system balance and posts that as an `adjustment` transaction. If the counted quantity already matches the system quantity, the route rejects the call with `400` rather than posting a meaningless zero-quantity transaction.
- **`POST /store/transactions/transfer`** — moves stock between two locations for the same item, posted as a linked pair of transactions (`transfer_out` at the source, `transfer_in` at the destination) in a single call; source and destination locations must differ (`400` if they don't), and the outbound leg does not allow the source location to go negative.

---

# 5. Access Model

Every route across all three routers requires `require_app_access("store")`, with no granular sub-permission distinction between viewing, receiving, issuing, adjusting, or transferring stock — any user with Store module access can perform any of these actions.

---

# 6. What This Module Does Not Do

- The Store module does not maintain its own procurement workflow — receipts recorded here are the *result* of a purchase (from `p2p`, `purchase`, or elsewhere), not a request for one. Store has no PR/PO creation logic of its own.
- `StockBalance` rows are never intended to be edited directly; any code path that writes to `StockBalance` outside of the transaction-posting service (`app/modules/store/service.py:record_stock_transaction`) would break the "transaction log is the source of truth" guarantee this module depends on.

---

# 7. Related Documentation

- [P2P Module Overview](../p2p/overview.md) and [Purchase Module Overview](../purchase/overview.md) — the procurement pipelines whose receipts ultimately become `receipt` transactions in this module.
