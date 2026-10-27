# Spec - PO create from finished RFQs, quantity increase, Before-PO receipts

Read `requirement.md` first (decisions D1-D8). This file is the build contract: names below are fixed so the database, backend and frontend builders work in parallel.

## 1. Data model (database-agent) - store module
File `backend/app/modules/store/models/pre_po_receipt.py`; ONE migration, `down_revision = "c4e8b2a6d9f1"`.

`StorePrePoReceipt` -> table `store_pre_po_receipts`
| column | type | why |
|---|---|---|
| id | int pk | |
| receipt_number | String(50) unique, index, not null | "BPO-<seq>" document number the store quotes to Procurement |
| vendor_id | int FK vendor master table, nullable, index | Procurement makes the PO to this vendor; Finance matches the invoice |
| vendor_name | String(255) not null | shown in lists; kept if vendor renamed |
| received_date | Date not null | when the goods physically came in |
| store_location_id | int FK store_locations, nullable | where the goods are held |
| delivery_challan_number, vendor_invoice_number | String(100) nullable | vendor paperwork received with the goods |
| remarks | Text nullable | |
| status | String(20) not null default `pending_po` | `pending_po` -> `po_created` -> `closed`; or `cancelled` |
| p2p_request_id | int FK p2p_requests nullable, index | requisition created behind the PO (D6) |
| purchase_order_id | int FK p2p_purchase_orders nullable, index | the PO made for this receipt |
| created_by_id | int FK users nullable | |
| cancelled_by_id FK users, cancelled_at DateTime, cancel_reason Text | nullable | cancel needs a reason |
| created_at/updated_at | TimestampMixin | |

`StorePrePoReceiptItem` -> table `store_pre_po_receipt_items`
| id pk | receipt_id FK store_pre_po_receipts ondelete CASCADE, index | store_item_id FK store_items **not null**, index (rule 19) | item_name String(255) not null | unit String(20) | quantity Float not null (>0, CheckConstraint) | remarks Text |
Relationship `StorePrePoReceipt.items` (cascade all, delete-orphan, order_by id).

## 2. Backend API (backend-agent), all under `/api/v1`
### Store side - new router file `backend/app/modules/store/routes/pre_po_receipts.py`, prefix `/store/pre-po-receipts`, permission = Store tab `grn` (same gate style as the GRN routes / other store routes; view for GET, create for POST/cancel). Deny by default.
- `GET ""` query `status?` -> `list[PrePoReceiptResponse]`, ordered by receipt_number asc (rule 14).
- `POST ""` body `PrePoReceiptCreate {vendor_id:int, received_date:date, store_location_id?:int, delivery_challan_number?, vendor_invoice_number?, remarks?, items:[{store_item_id:int, quantity:float>0, remarks?}] (min 1)}`. item_name/unit copied from Item Master; vendor_name from vendor master; blocked/inactive vendor refused with a real message. Duplicate store_item_id lines refused.
- `GET "/{id}"` -> one.
- `POST "/{id}/cancel"` body `{reason: str (required)}` - only while `pending_po`.
### Procurement side - new router file `backend/app/modules/p2p/routes/pre_po_receipts.py`, prefix `/p2p/pre-po-receipts`, permission = Procurement `purchase_orders` tab (view for list, create for create-po).
- `GET "/pending"` -> receipts with status `pending_po` (same response shape).
- `POST "/{id}/create-po"` -> creates (D6): a P2PRequest (requester = receipt creator, purpose/category valid for stock purchase, status straight to `po_drafted`, lines = receipt lines with store_item_id, `fulfillment_status="sent_to_procurement"`), a locked direct RFQ (status `locked`, single quotation, vendor = receipt vendor) and a draft PO via the same code path/rules as `rfq.create_po_draft` (vendor block, approved-supplier check, info-record price proposal, terms). Sets receipt `status=po_created`, `p2p_request_id`, `purchase_order_id`. Audit on the PR: "Created from Before-PO receipt BPO-.. (goods already received on <date>)". Returns `{rfq: RFQResponse, po: P2PPurchaseOrderResponse}` so the UI opens `/dashboard/p2p/purchase-orders/new?rfq=<ref>&po=<ref>`. 409 with a real message if not `pending_po`.
- GRN completion (goods_receipts.py, where a GRN becomes `completed`): if the PO belongs to a receipt and the PO is fully received, set the receipt `closed`.
### `PrePoReceiptResponse`
`id, receipt_number, vendor_id, vendor_name, received_date, store_location_id, store_location_name, delivery_challan_number, vendor_invoice_number, remarks, status, p2p_request_id, p2p_number, purchase_order_id, po_number, po_status, created_by_id, created_by_name, created_at, cancel_reason, items:[{id, store_item_id, item_code, item_name, unit, quantity, remarks}]`. Signed refs: follow how existing responses expose `id_ref` (if they do) so the frontend can build record links.

### PO draft changes (backend-agent, `p2p/routes/rfq.py` + `p2p/schemas/purchase_order.py`)
- `P2PPurchaseOrderItemPricingPayload`: `unit_price: float | None = Field(default=None, gt=0)` (D3: draft save allowed with unpriced lines), new `quantity: float | None = Field(default=None, gt=0)`.
- `update_po_draft`: when `quantity` given, enforce `quantity >= min_quantity` where min = requisition line qty still to buy (`pr_item.quantity - issued_qty`) minus the qty of the same `pr_item_id` on other non-cancelled POs (floor 0); line without pr_item_id: min = current qty. Error: "<item>: quantity can't be below <min> <unit> — that is what the requisition asks for. You can only increase it." Record increases in the PR audit summary. Recompute line_total and total_value.
- PO response items gain `min_quantity: float | None` (same rule) so the UI shows the floor.
- `submit_po_draft` must still refuse unpriced lines with a real message (check it does).

## 3. Frontend (frontend-agent)
New API client file `frontend/src/lib/prePoApi.ts` (types + calls for both routers) - do not touch `lib/api.ts` / `types/index.ts`.
1. `app/dashboard/p2p/purchase-orders/page.tsx`: remove the top "+ Create PO" button from every view (and the `PO_CREATE_BTN` usage there). Views: `Create PO` (finished RFQs), new `Before PO` (receipts waiting for a PO, shown to users with purchase_orders create), Approvals, Tracking, Open Items.
2. `components/p2p/POReadyList.tsx` (D1): only `status==='locked'` AND (`awarded_line_count>0` OR `p2p_status==='vendor_selected'`) AND `p2p_status!=='po_drafted'`. Row button always "Create PO". Awarded -> SplitPoDialog; vendor selected (old L1 flow) -> CreatePODialog via onCreate. Update stat chips / empty text / filters to match (drop the "Draft PO started" stage filter).
3. New `components/p2p/BeforePOPendingList.tsx`: table Receipt No., Vendor, Received on, Items (count + first names), Challan/Invoice, row "Create PO" button -> ConfirmDialog ("Create a PO to <vendor> for these N items?") -> `create-po` -> navigate to the PO page with rfq + po refs.
4. `app/dashboard/p2p/purchase-orders/new/page.tsx` (draft PO page):
   - Qty column editable on a draft (number input, min = `min_quantity`), hint "Can be increased above the requisition quantity, not reduced. Items can't be added." Line total and PO value follow the edited qty.
   - Footer on a draft: `Save` (saves prices/qty/dates, stays draft), `Download PO` (downloads the generated Word PO - reuse what ManagedDocumentPanel already offers; save first), `Send for approval` (save, then submit; confirm through ConfirmDialog). Non-draft: `Download PO` + existing View approval status/Close.
   - Section "4. Approval" text updated to the new buttons.
5. Store: new page `app/dashboard/store/before-po/page.tsx` + `components/store/BeforePOReceiptForm.tsx` (FormSheet popup standard, PM "Create Task" style): list with stat chips (PO pending / PO created / Closed), search, table sorted by receipt no. asc, row click opens a detail popup (portal) with lines, linked PR/PO numbers and Cancel (PromptDialog for reason) while `pending_po`. "+ Before PO receipt" create form: Vendor (searchable, vendor master), Received date, Store location, Challan no., Invoice no., Remarks, item lines (Item Master searchable picker - reuse the picker the GRN/issue forms use - qty, remarks; + add line icon button in the row). Banner text: "Goods recorded here are held in store and are NOT in stock yet. Stock is added by the GRN once Procurement's PO is approved."
6. `components/store/StoreNav.tsx`: add tab "Before PO" in the **Inward** group after "GRN & Inspection", `subtabKey: 'grn'`.
7. Tours: update `lib/tour/configs/p2pPurchaseOrders.ts` (po-create-btn step removed, Before PO view step) and add/extend the store GRN tour config if one exists for inward.

## Acceptance criteria
- AC1 Given a PO list, there is no "+ Create PO" button anywhere on the Purchase Orders page.
- AC2 Create PO view lists only locked RFQs with awarded lines or a selected vendor and no draft PO yet; every row button reads "Create PO".
- AC3 On a draft PO, raising a line qty saves and updates line total + PO value; lowering below the requisition qty is refused by the server with the real message; no way to add a line.
- AC4 Draft PO page has separate Save, Download PO, Send for approval; Send refuses unpriced lines with their names.
- AC5 Approved PO appears in Store -> GRN -> Upcoming (unchanged behaviour, regression check).
- AC6 Store user records a Before-PO receipt (vendor from master, Item Master lines); it lists as "PO pending"; no stock is posted.
- AC7 Procurement sees it under Purchase Orders -> Before PO, clicks Create PO -> a draft PO for that vendor and those items/qty opens; receipt becomes "PO created" and leaves the pending list.
- AC8 That PO goes through normal approval; after approval it is in GRN Upcoming; completing the GRN for the full qty closes the receipt.
- AC9 Every new route denies users without the tab permission (403) and get-by-id respects it.

## Addendum 2026-10-27 (owner, round 2): notification, no RFQ, invoice/challan files
Owner: "Before-PO receipt -> notification to Procurement that goods arrived and a PO is to be made. Nothing goes through RFQ; it goes straight to a PO that shows it came from store and how much was delivered; invoice and challan are attached."

Decisions:
- D9 Notification: event `p2p.pre_po_receipt_recorded` (registered by Manager in core/events/p2p.py, bell, kind assignment, audience = holders of purchase_orders create) fired when Store saves a receipt. Also notify directly the line buyers resolved from the items' types (skip duplicates). Title "Material received before PO: <BPO no.> from <vendor> — make its PO"; link `/dashboard/p2p/purchase-orders?view=before_po`.
- D10 No RFQ visible: the internal requisition/RFQ stay only as plumbing for the PO approval engine. New column `p2p_rfqs.source` String(20) nullable; value `before_po` on the auto RFQ. Every RFQ list/count (RFQ tab, PO ready list, dashboards using rfq list) excludes `source='before_po'`. The PO page for such a PO shows "From store — Before-PO receipt <no.>" instead of an RFQ number.
- D11 Files: new table `store_pre_po_receipt_attachments` (id, receipt_id FK CASCADE index, doc_type String(20) not null in `invoice|challan|other`, filename, content_type, size, storage fields following P2PRequestAttachment's pattern (SharePoint/local), uploaded_by_id, timestamps). Store can attach when recording or later; Procurement can attach from the PO page. Allowed while status != cancelled. Delete only by the uploader while receipt is `pending_po`/`po_created`. Size/type rules as the existing PR attachments.
- D12 PO page "Received before PO" section: receipt no., received date, store, challan no. + invoice no., per line delivered qty vs PO qty, attachment list (view/download) + "Attach invoice" / "Attach challan" buttons.

API (all `/api/v1`):
- `POST /store/pre-po-receipts/{id}/attachments` multipart `file`, form `doc_type` (store grn create) -> receipt.
- `DELETE /store/pre-po-receipts/{id}/attachments/{att_id}` (store grn create, uploader only).
- `GET /store/pre-po-receipts/{id}/attachments/{att_id}/content` (store grn view).
- `POST /p2p/pre-po-receipts/{id}/attachments` multipart (purchase_orders create or edit) -> receipt.
- `GET /p2p/pre-po-receipts/{id}/attachments/{att_id}/content` (purchase_orders view).
- `GET /p2p/pre-po-receipts/by-po/{po_id}` (purchase_orders view) -> receipt or `null`.
- Receipt response gains `attachments: [{id, doc_type, filename, content_type, size, uploaded_by_name, created_at}]`.
- One migration on head `b6e2d8f4a1c7` (verify head again before writing): attachments table + `p2p_rfqs.source`.
