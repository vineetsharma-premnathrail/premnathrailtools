# Tally PO on the PO draft + stock on the PR form (2026-10-27)

## Requirement (owner)
1. PR form shows, per line, whether the item is in stock and how much each store / plant holds.
2. The PO is created in the portal; on the PO draft the Tally PO upload is mandatory before PO approval.
3. The separate "Upload Tally POs" option on Purchase Orders is removed.
4. After PO approval the PO moves to goods receipt (GRN).

## Decisions
- Tally PO = Tally PO number + Tally print (PDF), uploaded together on the draft (section "4. Tally PO").
  Stored on the PO (`external_ref` + `document_*`); no migration. One Tally number per live PO (case-insensitive).
- Re-upload allowed while the PO is a draft (wrong file / Tally PO revised after "return for changes"); locked once in approval.
- `submit_po_draft` refuses without the Tally PO (server-side, not only UI). Permission: PO document › Create.
- Bulk Excel Tally import removed (routes template/preview/commit/attach, dialog, api methods, `tally_import` feature).
  Only the PDF view route of already-uploaded Tally POs remains. This also closes the open High finding of
  run 2026-10-27-tally-po-upload (one person creating a receivable PO without approval).
- PR stock: `GET /p2p/requests/stock-availability?item_ids=` — free qty (on hand − reserved) per plant / store,
  quantities only, all plants (stock at another unit can be transferred instead of bought). PR-tab Create permission.
- Point 4 already worked: GRN only receives POs whose approval is done (goods_receipts `_PO_APPROVED_PR_STATUSES`).

## Residual
- Legacy `POST /p2p/requests/{id}/create-po` (no UI caller, used by many tests) still submits without a Tally PO.
