# spec.md — One purchase requisition, several buyers, RFQs, vendor awards, POs and GRNs, with a requester tracker

Run: `docs/agent-runs/2026-10-31-pr-multi-buyer-split/` · Size L · Author: ba-agent · Date: 2026-10-31

## 0. Request in one paragraph, and assumptions

**Request.** One approved requisition (PR) can hold lines for different buyers. Each buyer runs their own RFQ for their own lines. One line can be split by quantity across several vendors. Each vendor gets its own PO, and each PO goes to its own approval. Each PO can be received through many GRNs. The person who raised the PR must see, on the PR, what is happening: who approved the PR, and for every line the buyer, RFQ, vendor/PO, PO approval (who and when), GRN(s) and ordered, received, accepted and pending quantity. Owner's words: "multi buyer ok, multi rfq, multi quotation, same item ek buyer par fulfill na ho, multi po, multi grn, buyer wise kaam hota hai".

**Assumptions**
- A1. Phase 1: one RFQ belongs to one PR and one buyer. A multi-PR RFQ is phase 2.
- A2. POs are made in Tally and uploaded (owner, 2026-10-30). The portal never creates a PO from scratch. Every PO goes through the central approval engine (PO approvers, then any one Partner).
- A3. A PR line has exactly one current buyer (`p2p_request_items.buyer_id`). Splitting is by vendor, not by buyer.
- A4. Wording in screens and messages uses plain business words, with no SAP terms or transaction codes.
- A5. Existing production data has real PRs, RFQs and POs. A migration and back-fill are needed.

**Interpretation to confirm (Open point 1).** "same item ek buyer par fulfill na ho" is read as "one vendor cannot supply the whole quantity, so split it across vendors". It is not read as "split one line across two buyers".

## 1. Position in the CORE flow

Store/Purchase: Store stock check → **PR → RFQ → vendor quotes → award → PO → GRN** → Finance invoice matching.

| Direction | Module | What it uses or gets |
|---|---|---|
| Upstream | BOM / Project / Service / Maintenance | The requisition source and the "charged to" link (purpose, project unit). Unchanged. |
| Upstream | Item Master | `store_item_id` on every line (rule 19). |
| Upstream | Store | Stock decision. Lines issued from stock leave the buy list. |
| Downstream | Store (GRN, stock at PO rate) | GRN against each PO. Release gate changes to the PO's own approval. |
| Downstream | Quality | GRN inspection result drives "accepted". |
| Downstream | Finance | Invoice matching against a PO. Its gate must stop using PR status (see 7.4). |
| Downstream | Production | Receives material for the project unit. Unchanged. |
| Reports | MIS, PO tracking, PO overdue reminders | They read the PR status and the header buyer. Both need review (section 11). |

## 2. The ERP standard, in short (for the owner to defend)

- **Buyer per line.** Mature ERPs give each item line a purchasing owner (a "purchasing group"). The requisition header has no single owner.
- **RFQ per buyer.** Each buyer sources their own lines. The RFQ is the sourcing document of one buyer. Vendors quote line by line.
- **Award is by quantity.** The decision "who supplies how much of this line" is the award. A split award (60 from vendor A, 40 from B) is normal. Any award that is not the lowest price needs a written reason.
- **PO per vendor.** Each PO takes only that vendor's awarded lines and quantities. Each PO has its own approval.
- **GRN per delivery.** One PO can have many deliveries.
- **Status comes from quantities.** Every line shows ordered, received, accepted and pending. The header status is derived from the lines and POs. It is never hand-set.
- **Closing is explicit.** A balance that will not be supplied is written off with a reason (short-close). It is never left hanging forever.

## 3. Verified current state (what the code does today)

| # | Fact | Where |
|---|---|---|
| 3.1 | A PR line has `buyer_id`, set from the item type. The header `assigned_buyer_id` is the first line's buyer. | `models/p2p_request_item.py`, `models/p2p_request.py` (`resolve_line_buyer_id`) |
| 3.2 | The RFQ has no buyer and no line set. `create_rfq` is PR-wide and reuses one draft per PR. It needs PR status `approved` and every line decided (no stock decision pending). | `routes/rfq.py` ~L140-198 |
| 3.3 | `submit_rfq` needs PR status `approved` and then sets the PR to `vendor_quotations`. | `routes/rfq.py` ~L404-472 |
| 3.4 | Quote lines (`VendorQuotationItem`) are line-level with `is_awarded`. The award API clears every other award on the same line, so only one vendor per line. Quote quantity is forced to the full buy quantity. | `routes/mm_quotations.py` `_apply_quote`, `award_lines` |
| 3.5 | Upload PO builds a PO from every open PR line at full quantity for one vendor. The vendor comes from an L1-L4 quote file tier, or the vendor master. It does not use awards. | `routes/rfq.py` `build_po_draft`, `upload_po` |
| 3.6 | `upload_po` locks the PR row with `FOR UPDATE NOWAIT` and returns 409 if another upload is in progress. | `routes/rfq.py` ~L912 |
| 3.7 | `_ensure_po_uploadable` allows upload only at PR status `vendor_quotations` or `vendor_selected`. | `routes/rfq.py` ~L1076 |
| 3.8 | A PO line already carries `pr_item_id` and `vendor_quotation_item_id`. `po_split.py` already has `open_qty_by_pr_item`, `ensure_qty_fits` and `rollup_pr_status`, which rolls the header up from all POs. | `po_split.py` |
| 3.9 | `_po_decided` only uses the multi-PO path when the PR has more than one live PO. With one PO, a rejection sets the PR to `rejected` and cancels all POs. An approval sets `po_approved` even when other quantity is un-ordered. | `approvals.py` L198-257 |
| 3.10 | The PO approval e-mail job takes a PR id and picks the PR's latest PO. | `routes/p2p_requests.py` L139-163 |
| 3.11 | Data scope "assigned" for RFQ and PO means the PR's header buyer only. For the PR it also covers the line buyers. | `access.py` L42-51 |
| 3.12 | The GRN gate is already per PO when the PR has more than one live PO (`po_is_released`). Otherwise it uses PR status. | `routes/goods_receipts.py` L61-84 |
| 3.13 | The Finance invoice-matching gate uses PR status (`po_approved`, `partially_received`, `received`, `closed`). | `accounts/service.py` L494, L533 |
| 3.14 | PR-level "close" is allowed only at `received` or `partially_received`. A short-close needs a reason and no GRN awaiting inspection. | `routes/p2p_requests.py` L2204-2254 |
| 3.15 | There is no "Cancel PO" route. A PO is cancelled by cancelling or rejecting the PR, or by a PO rejection in the multi-PO path. | grep of `status = "cancelled"` |
| 3.16 | Issue from stock works only while the line is `pending`. A partial issue keeps the line `sent_to_procurement` with the shortfall. `buy_qty_by_pr_item` = quantity − `issued_qty`. | `p2p_requests.py` L1962-2062, `po_split.py` |
| 3.17 | Before-PO: `create-requisition` makes a PR at `vendor_selected`, a locked RFQ with `source='before_po'` (hidden from RFQ lists), one selected quote with no quote lines, and the creator as buyer. | `routes/pre_po_receipts.py` L68-139 |
| 3.18 | The PR detail page loads `rfqList[0]` (one RFQ). It already shows chips for several POs. | `frontend/.../p2p/[id]/page.tsx` L215-226, L835-843 |
| 3.19 | `UploadPODialog` lists all buy lines with full quantity and a price each. | `components/p2p/UploadPODialog.tsx` |
| 3.20 | The RFQ e-mail lists all buy lines of the PR. | `rfq_mail.py` `_items_html` |
| 3.21 | The header-level quote evaluation endpoints (technical, commercial, `select-vendor-quotation`) exist, but no page calls them. verify: only `lib/api.ts` defines them. | `routes/rfq.py` L552-713 |
| 3.22 | The requester does not see vendor or prices on the PO block by design. | `_can_see_po_commercials`, features `purchase_order`, `prices` |

Existing status values found in code:

| Object | Values |
|---|---|
| PR | draft, submitted, returned, rejected, cancelled, approved, vendor_quotations, technical_evaluation, commercial_evaluation, vendor_selected, po_drafted, po_raised, po_approved, partially_received, received, closed |
| PR line (`fulfillment_status`) | pending, stock_issued, sent_to_procurement |
| RFQ | draft, locked |
| PO | draft, issued, acknowledged, partially_fulfilled, fulfilled, cancelled |
| PO stage (tracking page, derived) | draft, in_approval, with_vendor, partly_received, received, short_closed, closed, cancelled |
| GRN | draft, completed, reversed |
| GRN line quality | pending, passed, failed, partial, in_quality |
| Before-PO receipt | pending_po, po_created, closed, cancelled |

## 4. Scope

**In scope (phase 1)**
1. RFQ per PR and buyer, carrying a set of that buyer's lines.
2. Quotes per vendor on that RFQ, restricted to the RFQ's lines.
3. Award by quantity: a split across vendors is allowed, the sum must not exceed the open quantity, and a non-L1 award needs a reason.
4. Upload PO per vendor, built only from that vendor's awarded lines and quantities. Many POs per PR, each to its own PO approval.
5. The Purchase head reassigns a line's not-yet-ordered quantity to another buyer, with a reason.
6. PR status derived from lines and POs. Line-level withdraw and PR-level short-close with a reason.
7. Buyer worklist "My Lines".
8. Requester tracker on the PR.
9. Cancel PO and PO amendment returning quantity to open.
10. Gate fixes in the places listed in section 7.

**Out of scope**
- Multi-PR RFQ (phase 2).
- Creating a PO inside the portal (Tally only).
- Changes to the approval engine itself.
- Reminders for lines idle too long (Open point 12).

## 5. Actors, roles and permissions

The Role editor stays "module → tab → feature → action". Every new feature inherits the old tab action until a role is customised, which is the existing mechanism. Only the Manager edits the registries `permission_registry.py` and `core/features/p2p.py`.

| Actor (by permission, never a hard-coded flag) | Does |
|---|---|
| **Requester** | Sees the PR and the tracker. Cannot see vendors, prices, quotes or the Tally PDF. |
| **Line buyer** | Works only own lines: RFQ, quotes, award, Upload PO, withdraw. Sees the whole PR tracker read-only. |
| **Other buyer** | Sees the PR tracker if they own a line on it. Sees nothing of another buyer's RFQ, quotes, awards or POs. |
| **Purchase head** (holds Purchase Requisitions › Assign buyer › Edit, plus an "all" data scope) | Sees everything. Reassigns buyers. Can raise an RFQ on behalf of a buyer. |
| **PR / PO approvers** | Unchanged. The engine routes each PO to its own approvers. |
| **Store** | GRN and inspection, unchanged. Does not see quotes or prices. |
| **Admin** | Everything. |

| Module › Tab | Feature (type) | Action | Status | Used for |
|---|---|---|---|---|
| Procurement › R.F.Q | **My Lines** (sub-tab) | view | NEW | The buyer worklist. Shown only if the role has it. |
| Procurement › R.F.Q | RFQ lines (action) | edit | NEW | Add or remove lines on a draft RFQ. Raising an RFQ for another buyer also needs Assign buyer › Edit. |
| Procurement › R.F.Q | Award / split award | view, edit | existing | Set quantities per vendor. |
| Procurement › R.F.Q | Vendor quotations, Comparison, Prices | existing | existing | Unchanged. |
| Procurement › Purchase Requisitions | **Procurement progress** (section) | view | NEW | The requester tracker. |
| Procurement › Purchase Requisitions | Assign buyer | edit | existing, extended | Reassign a line's buyer (the existing "assign to" rule decides eligible buyers). |
| Procurement › Purchase Requisitions | **Withdraw / short-close lines** (action) | edit | NEW | Line withdraw. Close and short-close of the PR stays on the existing `close` feature. |
| Procurement › Purchase Orders | PO document | create | existing | Upload PO. |
| Procurement › Purchase Orders | **Cancel PO** (action) | cancel | NEW | See Open point 3. |
| Procurement › Purchase Orders | Amendments | view, create, cancel | existing | Quantity down returns quantity to open. |

**Record rules on top of the permission (deny by default):**
- A buyer may act on a line, RFQ or PO only if they are its buyer, or hold Assign buyer › Edit (the head) or are admin. Otherwise the error is 403: "This line is assigned to {buyer}. Ask the Purchase head to reassign it, or ask {buyer} to do this."
- **Data scope.** "assigned" must also include `rfqs.buyer_id`, `p2p_purchase_orders.buyer_id` and the line buyer (see 7.5).
- A draft PR stays private to its requester (unchanged).

## 6. Data

### 6.1 New and changed columns

| Table.column | Type | Required? | Source or master | Why it exists |
|---|---|---|---|---|
| `rfqs.buyer_id` | int FK users | Yes for new rows | The line buyer, or the head's pick (assign-to rule) | Owner of the RFQ. Drives data scope, My Lines, notices and the "one draft per PR and buyer" rule. Today the RFQ has no owner (data gap). |
| `rfqs.status` | adds `cancelled` | – | Set by the system | A draft RFQ that loses its last line is cancelled, not deleted, so the RFQ number and audit stay. |
| `rfqs.cancelled_reason` / `cancelled_at` | text / timestamptz | Null | System | Audit of why. |
| **`p2p_rfq_lines`** (new table) | `id`, `rfq_id` FK, `pr_item_id` FK, `store_item_id` FK, `status` active\|withdrawn, `withdrawn_reason`, `withdrawn_at`, `withdrawn_by_id`, `created_by_id`, `created_at`; unique (`rfq_id`, `pr_item_id`) | – | PR lines in "sent to procurement" with a buyer | The line set of an RFQ. Without it, quotes, comparison, e-mail and awards can only mean "all lines of the PR", which is the root defect. It carries `pr_item_id`, so phase 2 (multi-PR RFQ) needs no new table. `store_item_id` follows rule 19. |
| `p2p_vendor_quotation_items.quantity` | existing | Yes | Buyer ("vendor can supply"), default the line's open quantity, never above it | Today it is forced to the full quantity. A vendor that can supply less is the reason for splitting. |
| `p2p_vendor_quotation_items.awarded_qty` | float | Default 0 | Buyer on the Award screen | The qty-split award. `is_awarded` stays and equals `awarded_qty > 0` so the comparison page keeps working. |
| `p2p_purchase_orders.rfq_id` | int FK | Null (old and ad-hoc POs) | The RFQ it was uploaded on | Ties a PO to its RFQ. The tracker and RFQ page list their POs through it. |
| `p2p_purchase_orders.buyer_id` | int FK users | Yes for new rows | The RFQ's buyer | Owner of the PO. Drives scope, PO tracking filter and the overdue reminder (today it uses the PR header buyer). |
| `p2p_purchase_order_items.vendor_quotation_item_id` | existing | Set when the PO came from an award | The award | Links the award to the PO line. The known gap was "awards don't carry quote ids". |
| `p2p_request_items.short_closed_qty` | float | Default 0 | Buyer or head, with a reason | Quantity withdrawn before it was ordered. |
| `p2p_request_items.short_close_reason` / `short_closed_by_id` / `short_closed_at` | text / FK / timestamptz | Null | System | Audit. |
| Unique index on upper(`external_ref`) where status <> 'cancelled' | index | – | – | The Tally PO number uniqueness is only check-then-insert today. Several POs per PR make a race much more likely. |

Buyer reassignment history goes to `AuditLog` (entity `p2p_request`, action `line_buyer_changed`). No new table.

### 6.2 Derived values, never stored

For each buy line:

| Name | Formula | Meaning |
|---|---|---|
| To buy | quantity − `issued_qty` − `short_closed_qty` | Demand left for procurement. |
| Ordered | Σ quantity on live PO lines (not cancelled, any stage) | Includes drafts and POs in approval. |
| Not yet ordered | To buy − Ordered | Open quantity. Never below 0 for display. |
| Awarded, no PO | Σ over quote lines of (`awarded_qty` − PO qty linked to that quote line) | Chosen vendor, PO not uploaded. |
| Received | Σ `received_quantity` on GRN lines, GRNs not reversed | Physically counted. |
| Accepted | Σ net accepted (accepted − returned) on completed GRN lines, plus accepted service entries | Passed inspection. |
| Pending from vendor | Ordered − (the receipt figure the GRN code already uses: accepted for inspected lines, received for lines still in inspection) | Same rule as `_received_by_po_item`. |
| Written off | If the PR is closed: To buy − Accepted. Otherwise `short_closed_qty`. | What will not come. |

The tracker must not show negative values when ordered > requested (see Open point 4).

### 6.3 Line stage (badge on a line)

The badge is the stage of the **least-advanced unfinished quantity**. When part of the line is ordered and part is not, add "Partly ordered".

| Stage | When |
|---|---|
| Waiting for stock check | `fulfillment_status = pending` |
| Issued from stock | Fully issued, with issue number |
| Withdrawn | To buy = 0 because of `short_closed_qty` |
| With buyer, RFQ not started | Buy line, not on an active RFQ line |
| RFQ being prepared | Line on a draft RFQ |
| Waiting for quotes | On a locked RFQ, no vendor chosen |
| Vendor chosen, PO to upload | Awarded, no PO > 0 |
| PO in approval | A live PO of the line is in approval |
| With vendor | PO released, pending > 0, nothing received |
| Partly received | Some accepted or received, pending > 0 |
| Received | Accepted ≥ ordered and nothing left to order |
| Closed short | Written off > 0 and nothing pending |

### 6.4 RFQ stage (derived, shown on the RFQ page and list)

Draft → Out for quotes (locked, no quote yet) → Quotes in → Awarded (every active line has awards covering its open quantity) → Ordered (every active line fully on POs) → **Closed – no lines left** (all lines moved away or withdrawn). The stored `status` stays draft, locked or cancelled.

## 7. Workflow, states and who moves them

### 7.1 Header status is derived

The PR column `status` keeps its existing values, so lists, MIS, the GRN gate and the tour keep working. For approved PRs it is computed by **one function** that runs in the same transaction after every event: RFQ submit, award, PO upload, PO decision, GRN, cancel PO, withdraw, reassign, close. It is idempotent. It extends the existing `rollup_pr_status` and runs always, not only when there is more than one PO.

| Header status | Meaning with lines at different stages | Set when (first rule that matches) |
|---|---|---|
| draft, submitted, returned, rejected, cancelled | Before or outside procurement. Unchanged. | PR approval engine and requester actions. |
| `approved` | Approved, and no buyer has submitted an RFQ and there is no live PO. Lines may still be waiting for the stock decision or for RFQ work. | No live PO and no locked RFQ. |
| `vendor_quotations` | At least one RFQ is out for quotes and no PO exists yet. | No live PO and at least one locked RFQ. |
| `vendor_selected` | Used for a Before-PO requisition (the vendor is already known). Legacy elsewhere. | No live PO and all locked RFQs are `before_po`. |
| `technical_evaluation`, `commercial_evaluation` | Legacy header-level stages. Not set for new RFQs. The state lives on the RFQ. | Never by the new flow. Old rows keep them. |
| `po_drafted` | A PO returned for changes is back in draft and no other PO is in approval. | A draft PO exists and no PO is in approval. |
| `po_raised` | At least one PO is waiting for approval. This dominates, so the head and approvers see work pending. | Any live PO in approval. |
| `po_approved` | Every live PO is released and nothing has been accepted yet. Lines may still be un-ordered; the tracker shows "x of y lines ordered". | All live POs released, accepted = 0. |
| `partially_received` | Something has been accepted or a PO is part-fulfilled, and not everything is done. | Accepted > 0 and not `received`. |
| `received` | Every live PO is fulfilled **and** no buy quantity is un-ordered, awarded-without-PO or draft. | Strict rule. |
| `closed` | Explicit close or short-close, or auto-closed (all lines from stock, or all lines withdrawn with nothing bought). Never derived back. | Close action. |

Header sub-summary (derived, shown as a chip): "3 of 5 lines ordered · 2 waiting for RFQ · 1 PO in approval". The header says where the PR is at its furthest point. The chip says what is still open.

`pr.po_number`, `pr.po_value`, `pr.ordered_quantity`, `pr.received_quantity`, `pr.rfq_number` stay as legacy summaries. They are comma-joined or summed, as `rollup_pr_status` already does for `po_number`.

### 7.2 Gates that move from PR status to line, RFQ and PO state

| Action | Today | New rule |
|---|---|---|
| Create RFQ | PR `approved`, and every line decided PR-wide | The chosen lines are bought lines (`sent_to_procurement`), have this buyer, are not on another active RFQ and have not-yet-ordered quantity. Lines still waiting for the stock decision are skipped and listed as "waiting for stock check". They do not block other lines. |
| Submit RFQ | PR `approved` | RFQ is draft, has ≥ 1 active line, and the PR is at procurement stage (approved onward, not closed, cancelled or rejected). The PR is set to `vendor_quotations` only by the derive function. |
| Record or replace quotes, evaluate, award | PR status in a set | RFQ is locked, the line is active on it, and the PR is not closed, cancelled or rejected. |
| Upload PO | PR `vendor_quotations` or `vendor_selected` | RFQ is locked, has an award with remaining quantity (or the shortcut in 7.6), and the PR is not closed, cancelled or rejected. |
| Receive goods (GRN) | PO status, plus PR status when there is one PO | `po_is_released(po)` only, and the PR is not closed. |
| Finance invoice matching | PR status in a set | `po_is_released(po)` only. |

### 7.3 RFQ lifecycle and who moves it

| From → To | Who | Rule |
|---|---|---|
| (none) → draft | The line buyer, or the head for a buyer | One draft per PR and buyer. A second Create returns the existing draft (idempotent, like today). The buyer picks the lines, default all eligible. |
| draft: add or remove lines | Buyer or head | Only eligible lines. A removed line goes back to "With buyer". |
| draft → locked | Buyer | Existing submit validations (vendors or L1 file, payment terms, late delivery clause). Needs ≥ 1 active line. Sends the vendor e-mail, with only this RFQ's lines. |
| draft → cancelled | System | The last active line left (moved, withdrawn or removed). The reason is stored. |
| locked → closed (derived) | System | No active lines left. Quotes stay readable. Cannot award or upload. |

### 7.4 Award lifecycle

- The buyer sets, per line, the split: a list of (quote line, quantity, reason). Saving **replaces that line's split**. Other lines are untouched.
- Rules:
  - 0 < quantity ≤ the quote line's `quantity`.
  - Σ quantity over all quote lines of the line ≤ To buy.
  - Quantity ≥ what is already on live POs from that quote line.
  - A reason of at least 5 characters is needed for every row that is not the line's L1. L1 is the lowest landed cost among eligible quotes, as today.
  - An ineligible quote cannot be awarded: expired, rejected or disqualified.
- An award is audit-logged with the quantity.

### 7.5 PO lifecycle (existing states, new rules)

- **Upload PO.** One upload = one vendor = one PO.
  - The buyer picks a vendor that still has awarded-but-unordered quantity. The dialog shows that vendor's lines with quantity (editable down, never up) and a price per line.
  - The PO is built only from those lines. Quantity per line ≤ awarded remaining.
  - The PO's `buyer_id` is the RFQ's buyer. `rfq_id` and `vendor_quotation_item_id` are set.
  - It goes straight into PO approval, as today.
  - Tally number, PDF, ship-to store, cost centre for department PRs and the vendor block (blocked or inactive vendor) are unchanged.
- **PO approval.** Each PO has its own engine request: PO approvers, then any one Partner.
  - The buyer who uploads cannot approve (existing: `allow_self_approval=False`, distinct approvers).
  - **A PO rejection or return never rejects the PR.** A rejection cancels only that PO. A return puts only that PO back to draft.
  - After a rejection the award is kept (so the buyer can re-upload or change vendor) and is flagged "PO rejected".
  - Approval, rejection and return e-mails go by PO id, not "latest PO of the PR".
- **Cancel PO** (new).
  - Allowed only when the PO has no GRN that is not reversed and no Finance invoice. A reason is mandatory.
  - A draft or in-approval PO is withdrawn or discarded by its buyer. For an in-approval PO the engine request is withdrawn too.
  - Cancelling a released PO needs the permission "Cancel PO" and, per Open point 3, the approval engine.
  - Its lines stop counting as ordered, so the quantity returns to "awarded, no PO" or "not yet ordered". A Before-PO receipt linked to the PO reopens, as today.
  - A bell notice goes to the PO's buyer, the line buyers, the requester and the PO approvers who had it.
- **Amend PO** (existing). A quantity reduction returns the difference to open. A quantity increase must fit the open quantity (existing check). The buyer then either re-orders or withdraws the returned quantity.
- **Receive.** GRNs are per PO, unchanged. After each GRN or inspection, the derive function runs.

### 7.6 Single-vendor shortcut (RFQ without line quotes)

If the RFQ has no line quotes (quotes came as L1-L4 files or by e-mail), the buyer may pick the vendor from the quoted tiers, or from the vendor master for an e-mail RFQ. The dialog then lets them tick lines and quantities from the RFQ's lines. This path:
- keeps the existing control that any tier other than L1 needs a reason;
- records the choice on the PO lines (`vendor_quotation_item_id` null, `price_source='manual'`);
- still enforces Σ PO quantity ≤ To buy (`ensure_qty_fits`).

### 7.7 Reassign a line's buyer (head only)

- **Who:** holds Assign buyer › Edit. The "assign to" rule decides eligible buyers. A buyer cannot reassign their own line.
- **What moves:** the not-yet-ordered quantity of the line. Quantity already on a live PO stays with the PO's buyer.
- **Allowed only if** Not yet ordered > 0. Reason ≥ 5 characters.
- **Effects, in one transaction (row-locked):**
  1. `line.buyer_id` = new buyer.
  2. The line's active RFQ line on the old buyer's RFQ becomes `withdrawn`, with "moved to {new buyer} by {head}: {reason}".
  3. Awards on that line that are not yet on a PO are cleared and audit-logged. Quotes stay as history and drop out of the comparison.
  4. If the old RFQ now has no active lines, it is cancelled (draft) or becomes "Closed – no lines left" (locked).
  5. Bell notices to the old buyer, the new buyer and the requester. No Teams message.
  6. The old buyer still sees the PR, because they own an RFQ or PO on it (via 7.5 scope).
- **Buyer changed while someone is mid-way** (for example the old buyer has the Upload PO dialog open): the upload re-checks under lock and returns 409 "Line {item} was moved to {buyer} by {head} at {time}. Reload and continue with your remaining lines." Nothing is saved.
- A line with **no buyer** (item type without a buyer): it shows in "Unassigned lines" for holders of Assign buyer › Edit. It cannot go on an RFQ until it has a buyer.
- A later change of the buyer setting per item type affects new lines only. HR leaver handover is extended to open RFQs and to un-ordered lines. verify: `hr/services/lifecycle.py`.

### 7.8 Withdraw, short-close and close

- **Withdraw not-yet-ordered quantity** (line buyer or head; reason ≥ 5 characters; quantity ≤ Not yet ordered).
  - `short_closed_qty` increases.
  - Awards above the new To buy are trimmed with an audit note.
  - The requester gets a bell notice.
  - If nothing was ever bought and every line is withdrawn or from stock, the PR auto-closes with a note.
- **Close requisition.** Allowed when no PO is in draft or approval, no GRN awaits inspection, and the header is `received` or `partially_received`.
  - If everything is received, it is a plain close.
  - If balance remains, a reason is mandatory and the dialog lists, per line, what is written off (unordered and ordered-but-not-received). Live POs with balance show as short-closed in PO tracking. RFQs with no PO lines close.
- **Cancel the whole PR** (existing action) stays allowed only when there is no live PO and no GRN. Once anything is ordered, use withdraw or short-close. The error says so and names the PO.

### 7.9 Lines issued from stock

- They are not buy lines: excluded from RFQ lines, quotes, awards, PO lines and ordered quantity.
- The tracker shows "Issued from stock: {qty} {unit}, issue no. {x}, store {y}" with no RFQ or PO.
- A partial issue keeps the line for the shortfall with its buyer. Stock decisions are still made before an RFQ, because issue-from-stock only works while the line is `pending`.
- If the stock check for buyer A's lines is still pending, that does not stop buyer B's RFQ.

### 7.10 Before-PO receipts

- The creator of the requisition is its buyer, and the buyer of all its lines (`line.buyer_id` set to the creator, so My Lines shows them).
- The system RFQ (`source='before_po'`, locked) gets `buyer_id` and one RFQ line per PR line.
- Upload PO on it needs no award step: the vendor is the receipt's vendor, and the quantity is the receipt quantity for every line.
- The receipt still links to the PO on upload. It reopens on PO cancel, and closes when the PO is fully received.
- The tracker shows "Goods already received before PO on {date} (receipt {BPO-…})". These goods count as accepted only after the GRN against the approved PO.
- Header status for this PR stays `vendor_selected` until the PO exists.
- **Known gap carried over:** if Store cancels a Before-PO receipt that already has a requisition, that requisition is left open. Recommended in-scope fix (Open point 6): withdraw its RFQ lines and auto-cancel it, with a reason.

## 8. Dependencies, decisions relied on, conflicts

**Decisions relied on** (memory):
- `project_procurement_redesign` (2026-10-07): PR/PO approvers fixed in Settings, PO approval is all picked approvers then any one Partner, shared vendor master. Unchanged.
- `project_pr_line_buyers` (2026-10-27): buyer per line, and "RFQ/PO split per line buyer deferred". This spec delivers it.
- `project_po_upload_on_pr` (2026-10-30): no PO creation in the portal, Upload PO, keep portal approval. This spec lifts its known gap "one PO per PR".
- `project_tally_po_on_draft` (2026-10-27): the Tally number and PDF are mandatory before approval.
- `project_item_master_lines`: lines carry `store_item_id`. RFQ lines copy it.
- `project_rbac_redesign`, `project_feature_permissions`: deny by default, data scope, module → tab → feature → action.
- `project_partners_top_approval`: the Partner is the final PO approver.
- `project_approval_design_principle`: roles only name approvers. "Purchase head" is identified by permission, not a hard-coded flag.
- `feedback_teams_notifications`: Teams only for approvals and reminders.
- `feedback_real_error_messages`: every error states the reason and the fix.
- `feedback_word_documents`: no new generated documents here.

**Conflicts and supersessions**
- C1. `project_po_upload_on_pr` says "Upload PO at RFQ stage, one PO per PR". This spec supersedes "one PO per PR", which the same note listed as a known gap.
- C2. `project_pr_line_buyers` says the header buyer "keeps RFQ/PO tracking working". Here the header buyer becomes an information-only "main contact" and ownership moves to `rfq.buyer_id` and `po.buyer_id`.
- C3. Manager decision "Σ PO quantity per line ≤ requested − issued" versus existing behaviour. `update_po_draft` lets a returned draft raise quantity above the requisition (for vendor lot size or spares), flagged to approvers. See Open point 4.

**Impacted code (verify: grep before building).** Models and migration; `routes/rfq.py`; `routes/mm_quotations.py` (comparison, awards, split proposal use the whole PR); `quotation_compare.py`; `po_split.py`; `approvals.py` (`_po_decided`, `submit_po`, `approval_info` only knows the latest PO); `routes/p2p_requests.py` (e-mail job, reject, cancel, close, assign-buyer, `_edit_block_reason`); `access.py`; `routes/goods_receipts.py`; `accounts/service.py` (3-way gate); `po_tracking.py` (buyer, filter); `tasks/po_overdue_reminders.py` and `notify.po_delivery_overdue` (buyer); `rfq_mail.py`; `routes/pre_po_receipts.py`; `routes/mis.py`; HR lifecycle; frontend `p2p/[id]/page.tsx`, `UploadPODialog.tsx`, `rfq/[id]/page.tsx`, the comparison page, the RFQ list; `lib/api.ts`, `types/index.ts` (Manager only); PR-detail tour configs (verify: whether p2p tour configs exist); existing tests of upload-po, rollup and status gates.

**Migration and back-fill**
1. `rfqs.buyer_id` = PR header buyer, else the RFQ's creator. Before-PO RFQs = the creator.
2. `p2p_rfq_lines`: for each RFQ not on a cancelled PR, one row per PR line in `sent_to_procurement`. A legacy RFQ keeps all lines under the header buyer. Lines of other buyers show "on RFQ of {X}", and the head can reassign.
3. `awarded_qty` = quote `quantity` where `is_awarded`, else 0.
4. `po.rfq_id` = the PR's RFQ. `po.buyer_id` = RFQ buyer, else `created_by_id`.
5. `line.buyer_id` NULL back-filled from the PR header buyer for PRs already past approval. The My Lines query also treats NULL as the header buyer as a safety net.
6. Closed PRs: written off is derived as To buy − Accepted. No back-fill of `short_closed_qty`.
7. One migration, linear chain, one alembic head. Add the partial unique index on the Tally number. verify: existing duplicates first (Open point 14).

## 9. Screens: what each must show

**9.1 PR detail, new "Procurement progress" card** (requester and buyers). Placed after the lines table.

*Header strip:*
- PR approval: each approver or stage, status, who decided, when (from the engine, or the older approval records for old PRs).
- Header status pill plus the sub-summary chip.

*Table, one row per buy line, expandable. Sorted by line number ascending.*
- Item (code and name), Buyer, Stage badge, RFQ no. (with RFQ stage), PO no(s), PO approval ("Waiting for {names}" or "Approved by {name} on {date}" or "Rejected / Returned"), GRN no(s) with date, Requested, Ordered, Received, Accepted, Pending, Written off, Expected by.
- Expanding a row gives one sub-row per PO line: PO no., stage, quantity, approval who/when, and its GRNs with received and accepted quantity.
- Lines from stock and withdrawn lines are included with their own stage text.

*Not shown to a requester:* vendor name, unit price, line value, quotes, other buyers' RFQ content, the Tally PDF.
- Vendor name and prices show only to people who already see PO commercials (`_can_see_po_commercials`, features `purchase_order` and `prices`).
- PO number, stage and approval who/when do show.

*Mobile:* the same data stacked per line.

**9.2 My Lines** (sub-tab of R.F.Q). A buyer sees own lines. The head sees all, plus a Buyer filter and "Unassigned".
- Columns: PR no., line item, To buy, Not yet ordered, stage, RFQ no., required date, priority (urgent first), age since approval, charged-to, ship-to.
- Default sort PR number ascending. Filters: stage, urgent, overdue.
- Action "Raise RFQ" per PR group. In phase 1 lines of different PRs cannot be put on one RFQ. The message says so.

**9.3 RFQ page.** A lines table (add and remove while draft). A quote and comparison page limited to the RFQ's lines. An award panel with quantity inputs per vendor row and live counters "Awarded x / To buy y". The RFQ's POs listed. A closed RFQ shows greyed lines with "Moved to {buyer} on {date}: {reason}" or "Withdrawn".

**9.4 Upload PO dialog.** Vendor first (vendors with awarded remaining quantity, or the shortcut). Then lines and quantities (editable down). Then price and tax per line, Tally number and PDF, store, expected delivery, and cost centre when needed. The existing FormSheet pattern, draft banner and error box stay.

**9.5 Dialogs.** Reassign buyer, Withdraw quantity, Cancel PO and Short-close are PromptDialog or FormSheet popups through a portal. No browser dialogs. URLs use signed refs.

## 10. Acceptance criteria

*Format: Given / When / Then. Every error states the reason and how to fix it.*

### RFQ per buyer

1. **Two buyers, parallel.** Given an approved PR with lines L1 (buyer A), L2 (buyer B) and L3 (buyer A), all `sent_to_procurement`. When A creates an RFQ and B creates an RFQ. Then two RFQs exist, each with its own number, buyer and lines (A: L1, L3; B: L2), and the PR header is `approved` until one is submitted.
2. **Draft reuse.** Given A already has a draft RFQ on this PR. When A creates again. Then the same draft is returned, and no duplicate is made.
3. **Wrong buyer.** Given B is not the buyer of L1. When B tries to add L1 to an RFQ. Then 403: "L1 is assigned to A. Ask the Purchase head to reassign it, or ask A to raise the RFQ."
4. **Head on behalf.** Given the head holds Assign buyer › Edit. When they raise an RFQ for B with B's lines. Then it is created with B as buyer and the audit names the head.
5. **Stock decision pending on other lines.** Given L3 is still waiting for the stock check. When A creates an RFQ. Then L3 is skipped and listed as "waiting for stock check", and the RFQ is created with the remaining eligible lines. If no line is eligible, 409 states which lines wait and for what.
6. **No buyer.** Given a line has no buyer. When anyone tries to add it to an RFQ. Then 409 "This line has no buyer. Ask the Purchase head to assign one."
7. **Lines from stock.** Given a line was fully issued from stock. Then it is not offered for an RFQ, a quote, an award or a PO. Given partly issued, only the shortfall is offered.
8. **Submit.** Given a draft RFQ with ≥ 1 active line and valid terms. When A submits. Then the RFQ is `locked`, the vendor e-mail lists only this RFQ's lines, the PR header becomes `vendor_quotations`, and B's RFQ is untouched.
9. **Empty RFQ.** Given a draft RFQ whose last line was removed. When A tries to submit. Then 409 "This RFQ has no lines. Add a line or discard it."

### Quotes and award

10. **Quote scope.** Given RFQ-A has lines L1, L3. When a quote is recorded. Then only L1 and L3 can be priced. A price for L2 returns 422 "L2 is not on this RFQ."
11. **Split award.** Given L1 needs 100, vendor V1 quoted 100, V2 quoted 60. When A awards V1 = 40 and V2 = 60. Then both awards are saved, "Awarded 100 / To buy 100" shows, and each row beyond L1 stores its reason.
12. **Over-award.** Given To buy = 100. When A awards 70 + 50. Then 409 "Awarded 120 is more than the 100 still to buy. Reduce an award by 20."
13. **Non-L1 reason.** Given V2 is not L1 for L1's line. When A awards V2 without a reason. Then 422 names the line, the vendor and its rank, and asks why it should get the line.
14. **Award floor.** Given 40 of V1's award is already on a PO. When A lowers V1's award to 30. Then 409 "40 of this award is already on PO {no}. Cancel or amend that PO first."
15. **Ineligible quote.** Given V3's quote has expired. When A awards it. Then 409 "{V3}'s quote can't be awarded: quote expired on {date}."
16. **Permission and scope.** Given a user without Award › Edit, or B on A's RFQ. When they award. Then 403 and nothing is saved.

### Upload PO per vendor

17. **Two POs from one RFQ.** Given V1 has awards on L1 (40) and L3 (10), and V2 on L1 (60). When A uploads Tally PO T1 for V1 and T2 for V2. Then PO-1 has L1 40 and L3 10, PO-2 has L1 60. Each PO has `buyer_id` = A, the `rfq_id`, the quote-line links and its own approval request. Each approver gets only their PO's mail and bell.
18. **Header after the first PO.** Given PO-1 is in approval. Then the header is `po_raised`, B's RFQ can still be created, quoted, awarded and uploaded, and the tracker shows A's lines with PO-1 and B's lines at their own stage.
19. **Only awarded quantity.** Given V1's remaining award on L1 is 40. When the dialog is saved with L1 = 45. Then 409 "L1: 45 is more than the 40 awarded to V1."
20. **Quantity down.** Given the same. When saved with L1 = 30. Then PO-1 has 30, "awarded, no PO" shows 10 for V1, and the PR is not closed.
21. **Prices.** Given a line has no price. When uploading. Then 422 lists the unpriced items.
22. **Tally number.** Given the number is on another live PO. When uploading. Then 409 names that PO. With the unique index, two simultaneous uploads of the same number give one success and one 409.
23. **Vendor blocked.** Given the vendor was blocked in the vendor master. Then 409 and no PO.
24. **Not the owner.** Given B uploads on A's RFQ. Then 403. The head is allowed.
25. **Concurrency.** Given A and B upload at the same time on the same PR. Then both succeed, because only the involved line rows are locked. If the same line is hit, one gets 409 "Another upload on this line is in progress. Reload and check."
26. **Shortcut.** Given an RFQ with only L1-L4 files. When A picks the L2 vendor without a reason. Then 400 asks why not L1. With a reason, the PO is built from the ticked lines and quantities, and Σ PO quantity ≤ To buy.
27. **Before-PO.** Given a requisition made from a Before-PO receipt. When its buyer uploads the Tally PO. Then the PO covers all lines at the receipt quantity, the receipt becomes `po_created`, and no award step is needed.
28. **Department PR.** Given a department purchase with no cost centre. Then the dialog asks for one, and without it 422.

### PO approval, cancel and amend

29. **PO approved.** Given PO-1 is approved. Then PO-1 is released, receiving works for PO-1 only, Finance can match invoices to PO-1 while PO-2 is still in approval, and the header follows the 7.1 table.
30. **PO rejected.** Given a PO approver rejects PO-2. Then only PO-2 is cancelled, the PR is **not** rejected, its quantity returns to "awarded, no PO" with the flag "PO rejected", and the buyer and requester get a bell notice with the reason. PO-1 is untouched.
31. **PO returned.** Given a return for changes. Then that PO goes to draft and the header becomes `po_drafted` only if no other PO is in approval.
32. **Self-approval.** Given the uploading buyer is also an approver. Then they cannot approve their own PO (existing rule).
33. **Cancel PO, no GRN.** Given a released PO with no GRN or invoice. When it is cancelled with a reason (and approved if Open point 3 is chosen). Then it becomes `cancelled`, its quantity returns to open, the tracker shows the line back at "Vendor chosen, PO to upload", and the history names the reason.
34. **Cancel PO, GRN or invoice exists.** Then 409 "{PO} has goods received (GRN {no}). Reverse the GRN first, or short-close the balance instead." The invoice case has an equivalent message.
35. **Amend down.** Given an approved amendment lowers a PO line from 10 to 6 with 4 received. Then 4 returns to open, the floor stays at received, and the tracker shows Ordered 6 / Received 4 / Pending 2.
36. **Amend up beyond open.** Given the open quantity is 3 and the amendment adds 5. Then 409 "only 3 is left un-ordered on {PR}. Raise a new requisition for the extra."

### Receiving

37. **GRN per PO.** Given PO-1 and PO-2 are released. When Store records GRN-1 on PO-1 (partly) and GRN-2 on PO-2. Then each GRN shows its PO, and the tracker lists the GRN numbers under the right PO line with received and accepted quantity.
38. **Not yet released.** Given PO-2 is in approval. When Store tries a GRN on PO-2. Then 409 "PO {no} has not completed its approval yet…" and PO-1 receiving works.
39. **Header on partial receipt.** Given accepted > 0 and balance remains. Then `partially_received`. `received` appears only when all POs are fulfilled and nothing is un-ordered, awarded-without-PO or in draft.

### Reassign, withdraw, close

40. **Reassign.** Given L2 (10 units) has 4 on a PO of B and 6 not yet ordered, and an RFQ line on B's locked RFQ. When the head reassigns L2 to C with a reason. Then `L2.buyer_id` = C, B's RFQ line is `withdrawn` with the reason, B's un-ordered awards on L2 are cleared, B's PO for the 4 stays B's, the tracker shows "Buyer C (4 ordered by B)", and B, C and the requester get a bell notice. No Teams message.
41. **Nothing left to move.** Given the whole line is on POs. Then 409 "All 10 of {item} are already on PO {no}. There is nothing left to reassign."
42. **Reason missing or not the head.** Given a buyer or an empty reason. Then 403 or 422 with the fix. A buyer cannot reassign their own line.
43. **Mid-work conflict.** Given B has the Upload PO dialog open for L2 and the head reassigns L2. When B saves. Then 409 with the 7.7 message, and nothing is saved.
44. **Empty RFQ after move.** Given B's draft RFQ had only L2. Then it becomes `cancelled` with reason "no lines left". A locked one shows "Closed – no lines left", and quotes stay readable.
45. **Scope after move.** Given B owns a PO on the PR. Then B still opens the PR, and no longer sees L2 in My Lines.
46. **Withdraw.** Given Not yet ordered = 6. When the buyer withdraws 2 with a reason. Then To buy drops by 2, awards above the new To buy are trimmed, and the requester gets a bell notice. Withdrawing 7 gives 422 "Only 6 is not yet ordered."
47. **Short-close.** Given the header is `partially_received` with no PO in approval and no GRN awaiting inspection. When Close is pressed. Then a reason is required, and the dialog lists the per-line balances written off. After closing, GRN is blocked, POs with balance show as short-closed, and the requester gets a bell notice.
48. **Close blocked.** Given a PO is in approval or a GRN awaits inspection. Then 409 names it.
49. **Cancel PR.** Given a live PO exists. Then 409 "{PO} is already raised. Cancel that PO, or short-close the requisition."

### Tracker, visibility and scope

50. **Requester.** Given the requester opens their PR. Then they see the approval trail, and per line the buyer, RFQ no., PO no., PO approval status with who and when, GRN numbers, and the ordered, received, accepted, pending quantities. They see no vendor, prices or quotes.
51. **Other requester.** Given an unrelated user without scope. Then 403 on the PR and on its tracker.
52. **Line buyer.** Given buyer B opens a PR where they own a line. Then they see the whole tracker read-only, but only B's own RFQ, quotes and POs in detail.
53. **Other buyer's RFQ.** Given B opens A's RFQ by link. Then 403 "This RFQ belongs to A."
54. **Head.** Sees all RFQs, POs and lines, including Unassigned.
55. **Store user.** Opens GRN pages as today. Without the PR tab they get no tracker.
56. **Commercials.** Given the role lacks "Prices & PO values". Then prices and vendor name are blanked in the screen and in the API.
57. **Data scope.** Given a role with "assigned" scope. Then RFQs and POs where they are `buyer_id` are included, and nothing else.
58. **Draft PR.** A draft PR's tracker is empty and private.

### My Lines

59. **Own lines.** Given buyer A. Then My Lines lists only lines where A is the buyer, sorted by PR number ascending, with the not-yet-ordered quantity.
60. **Filters.** Urgent first, filter by stage, overdue.
61. **Head view.** The head sees all buyers, with a Buyer filter and "Unassigned".
62. **Permission.** Given a role without My Lines › View. Then the sub-tab is hidden and the API returns 403.

### Audit and notifications

63. **Audit.** Each of these writes a history entry with who, when and reason where required: RFQ created, line added or removed, quote recorded, award set (with quantity), award cleared, PO uploaded, PO decided, PO cancelled, amendment applied, buyer changed (from, to, quantity, reason), line withdrawn, short-close (per-line list), status rolled up.
64. **Notifications.** PO approval requests and PO overdue reminders go to Teams, as today. Everything new (RFQ submitted, reassign, withdraw, PO cancel, GRN completed for the requester) is **bell only**.
65. **Errors.** No generic messages. Every error above names the object, the rule and the fix.

## 11. Challenges: what is wrong or non-standard today, and the standard alternative

| # | Problem | Why it is wrong | Standard approach | Impact |
|---|---|---|---|---|
| 1 | The PR header status moves with the first PO. | It hides the other buyers' work and blocks them (RFQ needs `approved`, quotes need `vendor_quotations`, upload needs RFQ-stage status). | Status from quantities. Gates on the line, RFQ and PO. | Section 7. |
| 2 | `_po_decided` takes the old single-PO path unless there are ≥ 2 POs. A rejection rejects the PR. | One vendor's PO rejected kills other buyers' work. | Every PO decided on its own. The PR never inherits a PO's rejection. | Always use the per-PO path. |
| 3 | The PO approval e-mail takes the latest PO of the PR. | With several uploads in a row, the earlier PO's approvers are never mailed. | Pass the PO id. | Real defect. |
| 4 | Finance matching gates on PR status. | An approved PO A cannot be invoiced while PO B is in approval. | Gate on the PO's own release. | Cross-module fix. |
| 5 | The RFQ and PO have no owner; scope uses the header buyer. | Ownership is lost with several buyers. | `buyer_id` on the RFQ and PO, in data scope. | Section 6. |
| 6 | RFQ, comparison and e-mail span the whole PR. | A buyer would quote or e-mail the other buyers' lines. | An RFQ line set. | New table. |
| 7 | Award is one vendor per line, quantity forced to the full amount. | Cannot split. | Quote qty ≤ open, award qty split. | Section 6. |
| 8 | Two quote systems (L1-L4 files and line quotes) plus unused header-level evaluation endpoints. | Duplicate sources of truth. | Line quotes and awards are the source. The tier path is only the single-vendor shortcut. Header-level evaluation is left for old rows, not extended. | verify: UI use. |
| 9 | The upload locks the whole PR row with NOWAIT. | Two buyers uploading at once get 409. | Lock only the involved lines. | Section 10 criterion 25. |
| 10 | Short-close exists only at PR level. | A buyer cannot drop an unneeded balance of one line. | Line withdraw plus PR short-close. | Section 7.8. |
| 11 | No Cancel PO. | Quantity cannot return to open without cancelling the PR. | Cancel PO with floors. | Section 7.5. |
| 12 | The requester cannot see the buy status. Vendor commercials are hidden by design. | The owner's ask cannot be met by reusing the PO block. | A separate masked tracker feature on the PR. | New feature. |
| 13 | A requester's own edit is blocked by any RFQ row, even an idle draft. | A buyer's idle draft blocks the requester. | Keep for now. Open point 11. | Low. |

## 12. Risks

- **R1 High.** The status and gate changes touch many readers: MIS, GRN, Finance, PO tracking, the lists. Mitigation: keep the existing status values, change only the setters, and add tests per gate.
- **R2 High.** Back-filling the RFQ line sets for in-flight RFQs. Mitigation: legacy RFQs keep all lines, with a head reassign path.
- **R3 Medium.** Many POs mean many approval requests. This is by design (every PO has its own approval). A Partner may approve several POs of one PR one by one.
- **R4 Medium.** Raising PO quantity above the requisition (Open point 4).
- **R5 Medium.** HR leaver handover and the PO overdue reminder rely on the header buyer. They need the new `buyer_id` fields.
- **R6 Low.** `rfq_number`, `po_number`, `po_value` on the PR stay as legacy summaries and can look stale in old exports.
- **R7.** Phase 2 limit: `RFQ.p2p_request_id`, `VendorQuotation.p2p_request_id` and the PO header `p2p_request_id` are single-PR. A multi-PR RFQ needs those decoupled. The RFQ line table already supports it.

## 13. Suggested role split for the Manager (in order)

1. **database.** One migration: the `p2p_rfq_lines` table, `buyer_id` and cancel columns on RFQ, `awarded_qty`, PO `rfq_id` and `buyer_id`, line short-close columns, the Tally partial unique index, and all back-fills in section 8. Check `alembic heads`, and `alembic/env.py` and `main.py` imports.
2. **backend (a).** The derive function and the gate rewrite (7.1, 7.2); data scope (`access.py`); fixes for the single-PO decision path, the e-mail job by PO id, and Finance and GRN gates.
3. **backend (b).** RFQ with buyer and lines (create, add and remove lines, submit, cancel when empty, e-mail by RFQ lines); quote scope; award with quantity; upload PO per vendor and the shortcut; Before-PO adjustments.
4. **backend (c).** Reassign, withdraw, short-close, Cancel PO, amendment return of quantity; the tracker endpoint and My Lines endpoint; notices and audit.
5. **Manager only.** Permission registry and features (`core/features/p2p.py`, `permission_registry.py`), notification events, `api.ts`, `types/index.ts`, Sidebar.
6. **uiux.** Tracker card, My Lines, RFQ lines and award panel, Upload PO dialog, and the reassign, withdraw, cancel and short-close dialogs. A Playwright check on localhost.
7. **frontend.** Build from the uiux output, FormSheet, shared Select, portal dialogs, signed refs, form drafts.
8. **qa, reviewer, security.** All criteria in section 10 as pytest. Focus on data scope, a buyer acting on another buyer's line, a concurrent upload, the reassign race, and per-PO e-mails. Run `ruff --select F821` for py312.

## 14. Open points, each with my recommended answer

1. **What does "same item ek buyer par fulfill na ho" mean?** Recommended: one vendor cannot supply the whole quantity, so split by vendor (built). One line has one buyer. Ask only if the owner meant two buyers sharing one line.
2. **Should the requester see the vendor name?** Recommended: no, keep the existing rule. Show PO number, stage, approval who and when, and expected-by date. It is a single permission switch if the owner wants it.
3. **Cancelling a released PO.** Recommended: through the approval engine (a cancel type of the amendment), because a Partner approved it and the vendor was told. If time is short, ship withdraw and discard for drafts and in-approval POs plus cancel of a released PO only when there is no GRN or invoice, by a role with the new Cancel PO action, with a reason and bell notices. Add the approval step next.
4. **Raising a PO line above the requisition on a returned draft.** Recommended: keep the existing behaviour, flagged to approvers. Block it in Upload PO (the award limits it) and in amendments (already blocked). The tracker shows an amber "over-ordered" instead of a negative pending.
5. **Who may reassign?** Recommended: the Purchase head only (Assign buyer › Edit). A buyer cannot hand a line over. HR leaver handover stays.
6. **Before-PO receipts.** Recommended: the creator is buyer of all lines, no award step, and also fix the carried-over gap (Store cancels the receipt, so its requisition's RFQ lines are withdrawn and the requisition is auto-cancelled with a reason).
7. **Upload PO without line quotes (shortcut).** Recommended: allow it, record it on the PO lines with the L1 reason rule.
8. **Where does My Lines live?** Recommended: a sub-tab of the R.F.Q tab, so the Role editor matches the UI.
9. **Notify the requester on each GRN?** Recommended: yes, bell only, once per completed GRN.
10. **All lines withdrawn with nothing bought.** Recommended: auto-close the PR with a note (not cancelled), the same as the existing all-from-stock auto-close.
11. **A draft RFQ blocks requester edits.** Recommended: keep for now. A later improvement lets an empty draft RFQ not count.
12. **Reminders for lines idle too long** (no RFQ for N days). Recommended: phase 2, as a Teams reminder, with N as a setting.
13. **Approving many POs of one PR in one go.** Recommended: not now. The owner decided each PO has its own approval.
14. **Tally number unique index.** Recommended: include it in the migration. First list existing duplicates, then clean them, then create the index.
15. **In-flight RFQs that already mix buyers' lines.** Recommended: leave as one RFQ under the header buyer, and let the head reassign.
16. **Reassign after quotes are in.** Recommended: allowed. It clears only un-ordered awards and keeps the quotes as history.

**Unverified items:**
- `git status` on the p2p files.
- The `erp-business-analysis` skill.
- Whether any page uses the header-level evaluation endpoints (3.21).
- The HR lifecycle handover (7.7).
- The tour configs for the PR page.
- Which approval UI the PO approvers actually use, and whether `ApprovalPanel` is visible to a requester.

**Key files read** (all under `D:\Desktop\PremnathrailPortal-Ideal\`):
- `docs/agent-runs/2026-10-31-pr-multi-buyer-split/requirement.md`
- `backend/app/modules/p2p/routes/rfq.py`
- `backend/app/modules/p2p/routes/mm_quotations.py`
- `backend/app/modules/p2p/routes/p2p_requests.py`
- `backend/app/modules/p2p/routes/goods_receipts.py`
- `backend/app/modules/p2p/routes/pre_po_receipts.py`
- `backend/app/modules/p2p/po_split.py`
- `backend/app/modules/p2p/approvals.py`
- `backend/app/modules/p2p/access.py`
- `backend/app/modules/accounts/service.py`
- `frontend/src/components/p2p/UploadPODialog.tsx`
- `frontend/src/app/dashboard/p2p/[id]/page.tsx`