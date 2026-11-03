# Final report — R&D "Close without response" (2026-11-02)

Outcome: built, reviewed, all checks green, NOT pushed (owner's yes needed). No migration.

## Files (this session only)
Backend: crm/services/requirement_movement.py (mark_closed, is_late, re-send guard exception), rnd/services/requirements.py
(labels, require_closable, on_closed, 409s), rnd/routes/requirements.py (POST /rnd/requirements/requests/{id}/close, row lock,
reason ≤ 2000), rnd/models/requirement.py + crm/models/rnd_request.py (status constants/comments), core/events/crm.py (tor_closed),
tests/test_rnd_intake.py (7 new tests).
Frontend: components/crm/RndRequestBlock.tsx (badge, closed section, RndRequestCloseSheet), rnd/requirements/[source]/[id]/page.tsx
(Close without response pill, closed title, wrap), types/rndIntake.ts, types/index.ts (RndRequestStatus), lib/api.ts (closeRequest),
tour configs rndRequirementDetail.ts, rndDashboard.ts, crmInquiryDetailPage.ts, crmTenderDetail.ts.

## Checks
pytest test_rnd_intake + test_crm_tor_no_document + test_cov_crm_quotations_rnd: 50 passed; earlier wider run 73 passed.
ruff F821 py312 clean. tsc 0 errors. npm run test:ui 0 errors.

## Review wave
security-agent: no Critical/High; Low-1 (no row lock) fixed with with_for_update; Low-2 (reason unbounded) fixed max 2000 + textarea maxLength.
reviewer-agent: High-1 (BD could not re-send an unchanged requirement after a close) fixed in ensure_requirement_changed + test;
Medium-1 (is_late true for late close) fixed; Low wording/comment items fixed.

## Not done
- Live Playwright check: dev servers were not running; owner must start/sign in. Screens unseen: R&D requirement page status card
  (1366/390), close sheet, CRM Requirement Movement closed section.
- What's New entry: frontend/src/lib/changelog.ts is modified by another session (protected), entry not added.
