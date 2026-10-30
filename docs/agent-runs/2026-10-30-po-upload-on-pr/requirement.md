# Procurement: PO creation removed, Upload PO on the requisition (2026-10-30)

## Owner's words
"procurement ok only upload button by pr" — remove PO creation completely (Create PO button and
forms); keep only an Upload PO button on the Purchase Requisition; authorised users upload the PO
document against the PR; the uploaded PO stays in the PR timeline/history.

Core-flow position: Store/Purchase (PR → RFQ → **PO** → GRN → Finance 3-way match).

## Decisions (asked in chat, owner answered)
| Question | Owner's answer |
|---|---|
| What does the GRN receive against after an upload? | Upload builds a PO record from the PR lines (Tally PO no. + PDF + vendor + line prices). GRN, tracking, Finance keep working. |
| Portal PO approval after a Tally PO is uploaded? | **Keep** — the uploaded PO goes into the normal PO approval (approvers, then a Partner). |
| RFQ / quote comparison? | Keep. Only PO creation is removed. |

## Decisions taken by the Manager (ERP-standard default)
- Upload PO is allowed while the PR is at RFQ stage (`vendor_quotations` / `vendor_selected`), one PO per PR.
- Vendor = an RFQ quote tier (L1 default, other tier needs a reason); emailed RFQs without quote files pick from the vendor master.
- A PO returned for changes is still corrected on its draft page and sent again (that is editing, not creation).
- Before-PO receipts: "Create PO" became "Create requisition"; uploading the Tally PO on that PR links the receipt.
- Every uploaded Tally PDF is kept on its own history entry (AuditLog.attachment_url), so a re-upload never hides the older file.
- Removed routes: `POST /p2p/rfqs/{id}/po-draft`, `POST /p2p/rfqs/{id}/split-pos`, `POST /p2p/requests/{id}/create-po`; `pre-po-receipts/{id}/create-po` → `create-requisition`.

## Known gap (follow-up)
- Split POs (one PR → several vendors from the line award) cannot be uploaded; one Tally PO per requisition.
- Store can still cancel a Before-PO receipt that already has a requisition; that requisition is then left open.
