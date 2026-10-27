# Requirement - PO create from finished RFQs, quantity increase, Before-PO receipts

Date: 2026-10-27. Size: **L** (Procurement + Store, new tables, approvals/money). Core flow: Store/Purchase (PR -> RFQ -> vendor comparison -> PO -> approval -> GRN).

## Asked (owner, Hindi/English, paraphrased)
1. Procurement -> Purchase Orders: no top "+ Create PO" button. The list shows only requisitions whose RFQ and vendor comparison are finished and vendors are selected; each row has a **Create PO** button (never "Continue PO").
2. On Create PO the buyer may **increase the quantity** of a line versus the requisition (vendor asks for a larger lot / extra spares). Lines cannot be added; quantity cannot go below the requisition quantity.
3. Once the PO is created: **Download PO** and **Send for approval** are separate actions.
4. After approval the PO shows in Store -> Inward -> GRN as available for GRN (already exists: GRN "Upcoming" list = approved POs with quantity outstanding; verified, kept).
5. New Store tab **Before PO**: material that arrives before its PO is accepted here; Procurement then sees it as "PO still to be made" and creates the PO for it.

## Decisions taken (ERP-standard, logged for the owner)
- D1 Ready-for-PO list = RFQ locked AND (lines awarded on the comparison OR vendor selected). Requisitions still quoting/evaluating are hidden. Once a draft PO exists the requisition leaves this list; the draft is opened from **Tracking** (stage Draft).
- D2 Quantity: PO line qty >= requisition qty still to buy for that line (minus what other live POs of the same line already order). Increase is recorded in the PR audit trail ("qty raised from X to Y").
- D3 Draft save is separate from Send for approval. Unpriced lines may be saved; Send for approval still requires every line priced.
- D4 Before-PO receipt is placed under **Store -> Inward** (next to GRN), not under Inventory: it is an inward document. Reuses the GRN tab permission (no new permission module).
- D5 Before-PO receipt does **not** post stock. Stock is posted only by the GRN against the approved PO (stock at PO rate, with QC), so valuation and 3-way match stay correct. The receipt shows the material as "held - PO pending".
- D6 Procurement "Create PO" on a Before-PO receipt creates the PO directly for that vendor and those items (no RFQ round). Internally a requisition (+ a closed direct RFQ) is created so the normal PO approval engine (approvers + a Partner) and GRN gating apply unchanged. PR approval is skipped because the goods are already received; the PO approval is the money control. Audit note names the receipt.
- D7 When the GRN against that PO completes, the receipt closes automatically.
- D8 Before-PO lines carry `store_item_id` (Item Master), vendor from the vendor master.

## Protected at launch
Large set of files modified by another session (see `git status` at start), incl. `frontend/src/lib/api.ts`, `types/index.ts`, `useAuth.ts`, `permission_registry.py`. New API client goes in a new file; registries touched only by small anchored edits by the Manager.

Alembic head at launch: `c4e8b2a6d9f1`.
