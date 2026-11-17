# Tender quotations (price bid on a tender)

Owner request 2026-11-17: "add karo quotation in tender".

Core flow: Customer -> BD (CRM tender) -> priced offer -> (later) order/project.

## Problem
crm_quotations.inquiry_id is NOT NULL; quotation routes exist only under /crm/inquiries/{id}.
A tender's price bid has no document, no revision history, no approval.

## Decisions (Manager, ERP standard)
- Same quotation document for both parents (no separate "price bid" module):
  crm_quotations gets tender_id (FK crm_tenders), inquiry_id becomes nullable,
  CHECK exactly one parent. Same lines, item-wise or lump-sum pricing (already exists),
  revisions, central approval engine (BD Head -> Director -> Partner limits), Word doc.
- Tender quote number: QT-TND-<tender suffix>-NN so it never clashes with an inquiry's QT-<suffix>-NN.
- One accepted quotation per parent (per tender, per inquiry).
- Permissions: same Inquiries & Tenders > Quotations feature (view/create/edit/submit/delete/print); tender
  data scope + Edit scope instead of the inquiry's.
- Visibility: new section tnd_detail_quotations ("Quotations tab") on tender detail.
- Out of scope (later): BOQ item no. column, price lock after bid submission, competitor L1/L2, won -> order.

## Files at launch already modified by another session (CRM edit-scope work, staged, not committed)
workflow.py, quotation_status.py (service), tenders.py, inquiries.py, schemas/inquiry.py, schemas/tender.py,
access.py, InquiryDetailPanel.tsx, TenderDetailPanel.tsx, changeRights.ts, api.ts, types/index.ts,
test_crm_quotations.py, crmQuotationForm.ts. Touch only our own hunks.
