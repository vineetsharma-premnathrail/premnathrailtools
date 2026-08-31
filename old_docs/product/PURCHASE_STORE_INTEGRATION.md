# Purchase ↔ Store Integration

Companion to `PURCHASE_DEPARTMENT_MODULE_PLAN.md` and `STORE_DEPARTMENT_MODULE_PLAN.md`. Read both first — this doc only covers the seam between them: what data crosses the boundary, in which direction, at which phase, and via which mechanism.

## The full loop

```
Requester raises P2P request (any department)
        │
        ▼
Purchase: approve → RFQ → vendor select → PO issue
        │
        ▼
Purchase: GRN (goods receipt)  ───────────────►  Store: stock-in transaction
        │                                              │
        │                                              ▼
        │                                     Store: stock-out (issue) to
        │                                     Production / Service / Maintenance
        │                                              │
        ▼                                              ▼
Purchase: P2PRequest.receipt_status          Store: quantity_on_hand drops,
mirrors the GRN outcome (existing            crosses reorder_point
mirror-field pattern)                                  │
                                                         ▼
                                              Store: "Raise P2P Request" action,
                                              pre-fills a new request ──────┐
                                                                            │
        ◄───────────────────────────────────────────────────────────────────┘
  loop closes: a new P2P request is raised, restarting the cycle
```

## Integration point 1 — GRN → stock-in (Purchase Phase 4 / Store Phase 3)

- **Direction**: Purchase → Store.
- **Mechanism**: a function call from Purchase's GRN save path into Store's `service.py` (e.g. `store.service.record_stock_receipt(...)`) — the one deliberate exception to the "reference other modules by id only" rule, because Store must enforce its own ledger invariants (balance recompute, negative-stock guard) and a bare id-reference can't do that; Purchase needs to know the receipt actually succeeded before marking the GRN line as posted.
- **Data crossing**: `stock_item_id`, `location_id` (from `ship_to` if it's been formalized into a `store_locations` reference by then, else defaults to a single default location), `quantity`, `reference_type="p2p_grn"`, `reference_id=grn.id`.
- **Prerequisite friction point**: GRN lines are recorded against free-text P2P item descriptions, but Store needs a `stock_item_id`. Someone (the assigned buyer, at GRN time) must map the GRN line to an existing `stock_item` or create a new one. Do **not** block receiving on this mapping — let a GRN post without a stock link and flag it for later reconciliation, since blocking physical goods receipt on a data-entry step is exactly the kind of friction that gets the whole module bypassed in practice.
- **What mirrors back**: `P2PRequest.receipt_status`, `received_quantity`, `pending_quantity` stay exactly as they are today (already implemented, already a read-mirror pattern) — no change needed here, they just continue to reflect GRN entries same as before; Store's stock-in is an *additional* effect of saving a GRN, not a replacement for the existing receiving fields on `P2PRequest`.

## Integration point 2 — low stock → new P2P request (Store Phase 5)

- **Direction**: Store → Purchase.
- **Mechanism**: pure UI/data pre-fill, **not** a function call — Store never creates a `P2PRequest` row directly. A "Raise P2P Request" button on a low-stock item navigates to `/dashboard/p2p/new` with the item's fields passed as a draft (query params or a short-lived draft record), and a human still reviews and submits. This keeps the existing P2P approval flow as the single entry point for anything that spends money, per the plan's "keep a human in the loop" note.
- **Data crossing**: `stock_items.description → item_name`, `stock_items.make → make`, `stock_items.part_code → part_code`, `stock_items.uom → unit`, `stock_items.reorder_quantity → quantity`, `stock_items.category → category`. Exactly the SL/Item Description/Make/Part Code/UOM/Qty/Category columns already on the P2P item form — no new fields needed on the P2P side for this hook to work.
- **Optional automation**: a scheduled job can *draft* (never auto-submit) a P2P request when an item crosses `reorder_point`, surfaced as a notification via the existing `notify_user` mechanism — same non-negotiable "human submits" rule applies.

## Integration point 3 — issue-side consumption visibility (Store Phase 2 / Phase 6)

- **Direction**: Store → reporting, informational only, no direct write-back to Purchase.
- Store's consumption report (by department/project, rolling up `stock_transactions` where `reference_type="service_material"`) feeds Purchase's Phase 6 dashboard as one more input to "spend by project," alongside PO spend — two different numbers (stock consumption value vs. PO spend) that should be shown side-by-side, not merged into one figure, since PO spend already includes items that may still be sitting unissued in Store.

## Shared entities — don't build twice

| Entity | Owner | Consumers |
|---|---|---|
| `vendors` | Purchase (Phase 1), split ownership with Vendor Development | Purchase POs |
| `stock_items` | Store (Phase 1) | Purchase GRN mapping, Production material issue (future), Maintenance spares (future) |
| `AuditLog` | `main` module (existing) | Both — extend, don't fork |
| `notify_user`/`broadcast_notification` | `main` module (existing) | Both |

## Build sequencing (combining both plans' phase numbers)

Recommended order, following the master roadmap's "Store first" guidance but interleaved so Purchase isn't blocked waiting on Store's later phases:

1. **Store Phase 1** (stock master + manual stock-in) — usable standalone, no Purchase dependency.
2. **Purchase Phase 1** (vendor master) — usable standalone, no Store dependency. Can run in parallel with step 1.
3. **Purchase Phase 2** (formal PO) — depends on step 2 only.
4. **Store Phase 2** (stock issue) — depends on step 1 only; can also run in parallel with steps 2-3.
5. **Purchase Phase 4 + Store Phase 3 together** (GRN ↔ stock-in) — this is the one phase that must be planned and built as a single unit across both modules, since it's the integration point requiring the function-call exception above. Do not let one team build Purchase's GRN screen and another build Store's receipt API independently and try to wire them after the fact.
6. **Store Phase 5** (reorder → P2P trigger) — depends on step 5 existing (needs real stock-in/out data to compute reorder crossings meaningfully).
7. Everything else (Purchase Phases 3/5/6/7, Store Phases 4/6) can follow in any order — none of them block each other or the integration seam.
