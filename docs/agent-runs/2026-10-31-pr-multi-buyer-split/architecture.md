# Architecture (frozen contract for builders) — PR multi-buyer split, phase 1

Source: architecture-agent report 2026-10-31, reconciled with spec.md by the Manager. Where this file and
spec.md differ, THIS FILE wins. All paths under backend/app/modules/p2p unless stated.

## 0. Decision
- `p2p_requests.status` stays stored. Approval states unchanged. After approval it is a roll-up summary written
  ONLY by `po_split.rollup_pr_status(..., force=True)`. No procurement gate reads `pr.status` any more except
  `is_procurement_open(pr)`.
- PR line = unit of work. RFQ = one PR + one buyer + explicit lines (`rfq_items`). Award carries `awarded_qty`.
  Upload PO = one vendor, chosen lines + qty. Σ live PO qty per PR line ≤ quantity − issued_qty − short_closed_qty,
  enforced under the PR row lock (FOR UPDATE NOWAIT) — `ensure_qty_fits` after the lock.
- Ordered / released / accepted / pending computed from PO + GRN lines (never stored).
- Engine PO rejection cancels ONLY that PO; PR is never rejected by a PO decision (D-6, Manager confirmed: owner
  said every PO has its own approval).
- Old header-level evaluation routes (rfq.py ~480-713: POST/PATCH /vendor-quotations, start-technical/commercial,
  technical/commercial-evaluation, select-vendor-quotation) → 410 with "This step was replaced by line quotations
  and the quotation comparison (award per line). Record quotes on the RFQ's Quotations tab."
- Cancel of a RELEASED PO and released-PO cancel approval = follow-up (not phase 1). PO rejection / return already
  return qty.

## 1. Data model (database-agent) — ONE migration, down_revision = current single head (d0f4d65f9d55 at launch)
| Table | Column | Notes |
|---|---|---|
| rfqs | buyer_id int FK users ON DELETE SET NULL, nullable | ix_rfqs_buyer_id; ix (p2p_request_id, buyer_id) |
| **rfq_items** (new, model `RFQItem` in models/rfq_item.py) | id PK; rfq_id FK rfqs CASCADE; pr_item_id FK p2p_request_items; store_item_id FK store_items nullable; quantity float not null; withdrawn_at timestamptz null; withdrawn_reason text null; TimestampMixin | uq (rfq_id, pr_item_id); ix pr_item_id. `RFQ.items` relationship cascade all,delete-orphan order_by id. Active line = withdrawn_at IS NULL |
| p2p_vendor_quotation_items | awarded_qty float nullable | is_awarded kept == awarded_qty > 0 |
| p2p_request_items | short_closed_qty float NOT NULL server_default '0'; short_closed_reason text; short_closed_by_id FK users SET NULL; short_closed_at timestamptz | |
| p2p_purchase_orders | rfq_id int FK rfqs SET NULL nullable, indexed | |
| p2p_purchase_orders | guarded partial unique index uq_p2p_po_live_external_ref on upper(external_ref) WHERE status <> 'cancelled' AND external_ref IS NOT NULL | create ONLY if no duplicates exist (query first), else print notice and skip; must never crash deploy. Verify the column name `external_ref` exists in the model first. |

Backfill (set-based, idempotent) in upgrade():
1. rfqs.buyer_id = COALESCE(pr.assigned_buyer_id, rfq.created_by_id).
2. rfq_items = each RFQ's PR buy lines (fulfillment_status <> 'stock_issued' and quantity−COALESCE(issued_qty,0) > 0),
   quantity = that expression, store_item_id from the line; plus any (vq.rfq_id, vqi.pr_item_id) already quoted. ON CONFLICT DO NOTHING.
3. awarded_qty = quantity where is_awarded (fallback line buy qty if quantity null).
4. po.rfq_id from vendor_quotation_id → vq.rfq_id, else the PR's only RFQ when exactly one.
5. p2p_request_items.buyer_id = pr.assigned_buyer_id where null and PR status not in (draft, submitted, returned).
downgrade() reverses. Imports: Manager adds RFQItem to alembic/env.py + main.py.

## 2. Helpers (backend-A owns; everyone codes against these exact names)
In `po_split.py`:
```python
PROCUREMENT_OPEN_STATUSES = ("approved","vendor_quotations","technical_evaluation","commercial_evaluation",
                             "vendor_selected","po_drafted","po_raised","po_approved","partially_received","received")
def is_procurement_open(pr) -> bool
def effective_buyer_id(item, pr) -> int | None          # item.buyer_id or pr.assigned_buyer_id
def can_work_all_lines(user) -> bool                    # admin or feature p2p:purchase_requisitions:all_lines:edit
def lock_pr(db, pr_id) -> P2PRequest                    # FOR UPDATE NOWAIT + populate_existing, re-select items populate_existing; 409 on lock
buy_qty_by_pr_item(pr)                                   # now also minus short_closed_qty
rollup_pr_status(db, pr, *, force=False)                 # extended: runs always with force; zero-PO case
```
In new `line_progress.py`:
```python
@dataclass LineProgress: pr_item_id, buy_qty, short_closed_qty, ordered_qty, released_qty, accepted_qty,
    rejected_qty, open_to_order, pending_receipt, state, state_label
def line_progress(db, pr) -> dict[int, LineProgress]    # batched queries, no N+1
```
state ∈ awaiting_stock_decision, issued_from_stock, to_quote, quoting, awarded, po_in_approval, with_vendor,
partly_received, received, short_closed. Labels plain English. open_to_order never < 0 (flag over_ordered).

rollup with no live POs: everything short-closed/stock and nothing open → `closed` (auto, note); any locked RFQ → `vendor_quotations`; else `approved`.
With POs: any in approval → po_raised; any draft → po_drafted; all fulfilled and nothing open/awarded-without-PO → received; any accepted → partially_received; else po_approved.

## 3. Status read/write changes (who changes which)
| Location | Change | Owner |
|---|---|---|
| models/p2p_request.py comment | rewrite: post-approval = roll-up | database |
| po_split.py `_MANAGED_PR_STATUSES` add approved; buy_qty; rollup | | A |
| pre_po.py po_line_min_quantity → max(0, min(item.quantity, remaining)); qty_raised_lines respects short_closed | | A |
| approvals.py `_po_decided`: engine scheme → always `_split_po_decided` (only that PO, forced rollup); `approval_info` prefer PO request the viewer can decide; `can_act_now` loop all live POs; add `pending_po_requests(db, pr_id)`; PO approval emails by PO id | | A |
| access.py RFQ assigned scope = buyer_id (+ existing); PO assigned also rfq_id IN (rfqs where buyer_id=user) | | A |
| rfq.py create_rfq / submit / draft reuse per (PR,buyer) / build_po_draft(lines=…) / _ensure_rfq_po_uploadable / remove direct pr.status sets / 410 old evaluation routes / _send_po_for_approval force rollup | | B |
| mm_quotations.py gates `is_procurement_open` + rfq locked; quotes only on rfq_items; award with qty | | B |
| quotation_compare.py, rfq_mail.py use rfq.items | | B |
| pre_po_receipts.py: Before-PO RFQ buyer_id=user + RFQItem per line; receipt cancel → PR auto-cancel with reason when no live PO | | B |
| app/tasks/rfq_reminders.py: RFQ locked + PR open + some open line; notify rfq.buyer_id or created_by | | B |
| po_amendments.py (routes or module that adds PR lines ~155-180): take lock_pr | | B |
| p2p_requests.py: approve_po / reject accept po_id (409 if several pending and none given; 404 if not on PR); cancel PR blocked while any live PO in approval; assign_buyer gate is_procurement_open; _route_lines_on_approval fills item.buyer_id; auto-close also when all short-closed; close writes remaining open_to_order into short_closed_qty | | C |
| goods_receipts.py `_po_approval_block_reason` engine PO → po_is_released; `_sync_po_and_pr_status` forced rollup; requester bell on completed GRN | | D |
| po_tracking.py buyer = coalesce(rfq.buyer_id via po.rfq_id, po.created_by_id, pr.assigned_buyer_id) | | D |
| accounts/service.py ~494-534 3-way match gate → po_split.po_is_released(db, po) | | D |
| store/services/reorder.py on_order: open PRs count line open_to_order | | D |

## 4. API contract
Every route: deny by default; load parent, `ensure_pr_in_scope`; children filtered by parent id (mismatch → 404/422);
"own lines only" unless `can_work_all_lines`. New routes sync `def`. No await between lock and commit.

- **POST /p2p/rfqs** `RFQCreate {p2p_request_id, requires_technical_evaluation=false, pr_item_ids?: int[], buyer_id?: int}`.
  buyer default = user; other buyer needs can_work_all_lines. Lines default = buyer's eligible lines (sent_to_procurement,
  open_to_order>0); none and can_work_all_lines → open unassigned lines (claimed: set item.buyer_id). Lines waiting for
  stock decision don't block other lines. Reuse the (PR,buyer) draft, replacing its items. Response RFQResponse +
  buyer_id, buyer_name, items[{id, pr_item_id, store_item_id, item_code, item_name, unit, quantity, open_qty, withdrawn_at, withdrawn_reason}].
  Errors exactly as spec/§3.1 of the report (real reason + fix).
- **PATCH /p2p/rfqs/{id}/lines** (draft only) `{pr_item_ids: int[]}` replace the line set — same eligibility.
- **Line quotations** existing POST/PUT `/p2p/rfqs/{id}/line-quotations[/{vq_id}]`: rfq locked, PR open, RFQ buyer or all_lines; only rfq_items lines (422 "'{item}' is not on RFQ {no} — quote only the lines this RFQ asked for."); vqi.quantity default = rfq_item.quantity, buyer may lower (vendor can supply less), never above.
- **POST /p2p/rfqs/{id}/awards** `{awards:[{pr_item_id, vendor_quotation_item_id, quantity: float|null, reason?}]}`.
  null = whole remaining to this vendor (clears the line's other awards on this RFQ — old semantics); >0 = split;
  0 = withdraw (refused if on a live PO). Σ awarded on line ≤ open_to_order + qty already ordered from this RFQ's awards;
  award ≥ qty already on live POs from that quote line; ≤ vqi.quantity; non-L1 reason ≥5 chars. Under lock_pr.
  Response = comparison payload + per line awarded_total, open_qty.
  (verify the existing award route path in mm_quotations.py and keep it; add quantity to its payload.)
- **POST /p2p/rfqs/{id}/upload-po** multipart unchanged (tally_po_no, details, file). details
  `{vendor_quotation_id?, vendor_tier?, selection_reason?, vendor_id?, ship_to_location_id, expected_delivery?, delivery_terms?, cost_center_id?, lines:[{pr_item_id, quantity?: >0, unit_price>0, tax_rate?}] min 1}`.
  Vendor: vendor_quotation_id → lines must be its awarded lines, qty ≤ awarded − already on live POs from that vqi (default the remainder), PO lines carry vendor_quotation_item_id.
  RFQ has awards but no vendor_quotation_id → 422 naming the awarded vendors. Else legacy tier / vendor-master path, qty ≤ open_to_order.
  Each line in rfq_items (active) and effective buyer == rfq.buyer_id or all_lines (403 "'{item}' is now bought by {name} (reassigned) — they upload its PO.").
  Sets po.rfq_id. Omitted lines simply not on PO. "already has PO" 409 removed; new 409 "Nothing is left to order on RFQ {no} — every line is on a PO or short-closed."
  IntegrityError on Tally index → 409 existing "already on {po}" text.
- **POST /p2p/requests/{pr_id}/lines/{item_id}/reassign-buyer** `{buyer_id, reason(min5)}` — purchase_requisitions:edit + feature buyer:edit + assignee rule BUYER_RULE_KEY. Under lock_pr. item.buyer_id=new; its active rfq_items on the OLD buyer's RFQs get withdrawn_at/reason "Moved to {new} by {head}: {reason}"; un-ordered awards on that line cleared (audited); audit `line_buyer_reassigned`; bell to old+new buyer + requester (bell only). Only un-ordered qty moves. Errors: nothing left to order; already the buyer; no Procurement access; reason missing.
- **POST /p2p/requests/{pr_id}/lines/{item_id}/short-close** `{quantity?: >0 (default all open_to_order), reason(min5)}` — feature purchase_requisitions.close:edit; line buyer or all_lines. short_closed_qty += qty; awards above new buy trimmed (audited); audit `line_short_closed`; requester bell; forced rollup (may auto-close).
- **GET /p2p/my-lines** `?buyer_id&all&state&search&p2p_request_id&skip=0&limit=100(≤500)` — purchase_requisitions:view + feature purchase_requisitions.my_lines:view; other buyer / all → all_lines:view. Through scope_prs; PR in PROCUREMENT_OPEN_STATUSES. Response `{rows, total, skip, limit, counts:{state:n}}`, row =
  `{pr_item_id, p2p_request_id, p2p_number, pr_status, priority, required_date, requester_name, purpose_label, charged_to, item_code, item_name, unit, buy_qty, short_closed_qty, ordered_qty, released_qty, accepted_qty, open_to_order, pending_receipt, state, state_label, buyer_id, buyer_name, rfqs:[{id, rfq_number, status}], pos:[{id, po_number, stage, stage_label}], last_activity}`.
  Default rows with open_to_order>0 or pending_receipt>0. Sort p2p_number asc, line id asc. No prices.
- **GET /p2p/requests/{pr_id}/tracker** — requester-or-purchase + ensure_pr_in_scope. No money fields. vendor_name only when `_can_see_po_commercials(user)` else null.
  `{p2p_request_id, p2p_number, status, status_label, progress:{lines, lines_done, ordered_pct, received_pct},
    pr_approval:{status, submitted_at, completed_at, steps:[{sequence, stage_name, approver_name, status, decided_by_name, decided_at, comment, via}]}|null (legacy: from pr.approvals),
    lines:[{pr_item_id, item_code, item_name, unit, quantity, issued_qty, short_closed_qty, short_closed_reason, buyer_id, buyer_name, fulfillment_status, ordered_qty, accepted_qty, rejected_qty, pending_qty, state, state_label, over_ordered,
      rfqs:[{rfq_id, rfq_number, status, buyer_name, quote_count}],
      pos:[{po_id, po_number, vendor_name, quantity, stage, stage_label, expected_delivery, approval:{…same}|null, grns:[{grn_id, grn_number, received_date, status, received_qty, accepted_qty, rejected_qty}]}]}]}`
  Steps from ApprovalRequest/ApprovalRequestStep batched (like po_tracking._approval_status_by_po); PO stage from po_tracking.stage_of.
- approve_po / reject payloads gain `po_id?`.

## 5. Concurrency
PR row = single serialization point (lock_pr) for upload-po, awards, reassign, short-close, close, amendments adding lines.
ensure_qty_fits after the lock. SharePoint upload before the lock; emails in background tasks.

## 6. Permissions / registries (Manager)
core/features/p2p.py (purchase_requisitions): `my_lines` subtab {view}; `all_lines` action {view, edit} explicit-only
(owner ticks it on Purchase Head role). Main.py/env.py: RFQItem import; routers pr_lines, my_lines.
api.ts: rfqApi.create opts {pr_item_ids, buyer_id}, rfqApi.setLines, p2pApi.tracker, reassignLineBuyer, shortCloseLine, myLines, approvePo/reject po_id; remove dead evaluation wrappers. types/index.ts additions.

## 7. File ownership (one owner per file)
| Role | Files |
|---|---|
| database | models/rfq.py, NEW models/rfq_item.py, models/p2p_request_item.py, models/vendor_quotation.py, models/purchase_order.py, models/p2p_request.py (comment only), NEW backend/alembic/versions/<rev>_p2p_multi_buyer_rfq_lines.py |
| backend-A | po_split.py, pre_po.py, approvals.py, access.py, NEW line_progress.py |
| backend-B | routes/rfq.py, routes/mm_quotations.py, quotation_compare.py, rfq_mail.py, routes/pre_po_receipts.py, schemas/rfq.py, schemas/mm_purchasing.py, schemas/purchase_order.py, app/tasks/rfq_reminders.py, po_amendments file(s) |
| backend-C | routes/p2p_requests.py, schemas/p2p_request.py, NEW routes/pr_lines.py, NEW routes/my_lines.py, NEW schemas/pr_lines.py |
| backend-D | routes/goods_receipts.py, po_tracking.py, app/modules/accounts/service.py (~494-534 only), app/modules/store/services/reorder.py |
| frontend-1 | app/dashboard/p2p/[id]/page.tsx, NEW components/p2p/PrTracker.tsx, components/p2p/UploadPODialog.tsx, app/dashboard/p2p/rfq/new/page.tsx, lib/tour/configs/p2pRequestDetail.ts |
| frontend-2 | NEW app/dashboard/p2p/my-lines/page.tsx, NEW components/p2p/ReassignLineDialog.tsx, NEW components/p2p/ShortCloseLineDialog.tsx, app/dashboard/p2p/rfq/[id]/** (lines + award qty), lib/mmPurchasingApi.ts, components/p2p/P2PNav.tsx |
| Manager | main.py, alembic/env.py, core/features/p2p.py, permission_registry, lib/api.ts, types/index.ts |
