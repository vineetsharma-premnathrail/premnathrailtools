# Plan

Head at launch: `c4e8b2a6d9f1`.

| Step | Owner | Files |
|---|---|---|
| 1 Intake, decisions, spec | Manager | requirement.md, spec.md |
| 2 Tables + one migration | database-agent | store/models/pre_po_receipt.py, alembic/versions/<new> |
| 2 APIs + PO qty rule + tests | backend-agent | p2p/routes/rfq.py, p2p/schemas/purchase_order.py, p2p/routes/goods_receipts.py (close hook), p2p/routes/pre_po_receipts.py, store/routes/pre_po_receipts.py, store schemas, tests |
| 2 Screens | frontend-agent | p2p purchase-orders page + new page, POReadyList, BeforePOPendingList, lib/prePoApi.ts, store/before-po page + form, StoreNav, p2pPurchaseOrders tour |
| 3 Registries | Manager | main.py include_router, alembic/env.py model import |
| 4 Integration checks | Manager / integration-agent | tsc, test:ui, pytest, ruff py312, alembic heads |
| 5 Review wave | security, qa, reviewer | read-only |
| 6 Release gate | Manager asks owner | nothing pushed without explicit yes |

BA/architecture agents skipped: the Manager wrote the spec directly from the code read (decisions D1-D8) to keep the contract fixed for parallel builders.
