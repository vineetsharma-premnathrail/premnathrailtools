# Final report: tender quotations + org type one name (2026-11-17)

## A. Quotations on tenders
- Model/migration f3a7c9e1b5d2: crm_quotations.tender_id (FK), inquiry_id nullable, CHECK one parent. Applied on local DB.
- Backend: services/quotation_parent.py; tender twins of every inquiry quotation route; QT-TND-<no>-NN numbers;
  one accepted per parent; approval title/details say Tender; PDF/Word print Tender No.; past quotations + report dataset
  include in-scope tender quotations; delete cancels pending approval; inbox/email decision refused when parent deleted;
  products/linking.py prices tender lines with the tender's customer; visibility section tnd_detail_quotations.
- Frontend: shared QuotationsTab (parent prop), tender Quotations tab + Documents listing, ?tab=quotations, approval link
  opens tender, tour step in crmTenderDetail.ts. Mobile: approval link of a tender quotation opens the tender.
- Tests: test_crm_tender_quotations.py 20 passed; 207 related passed earlier; ruff F821 py312 clean; tsc 0; test:ui 0.
- Security: no Critical/High/Medium. LOW 1 fixed (validate_decision). Reviewer: no blocker.

## B. Customer Organization Type one name
- Domestic list now Government Department / Private Company (same as International), web + mobile + tour + docs.
- normalize_org_type on create/update/bulk import; data migration b2e6c4a8d1f7 (NOT yet applied locally: a8d3f5b7c9e1
  of another session sits before it).

## Open / not done
- Report: tender rows' Quotation No not clickable (no per-row link support).
- Tender Timeline doesn't list quotation entries. Mobile app has no tender Quotations tab.
- Not seen live in a browser.
- Push coupling: f3a7 -> a8d3 (other session, untracked) -> b2e6; d6f1 staged by another session. Push together.
