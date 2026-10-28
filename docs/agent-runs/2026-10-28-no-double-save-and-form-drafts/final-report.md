# No double save + unsaved form data survives refresh (2026-10-28)

## Requirement (owner)
App-wide: a save repeated after a network issue / double click must not create a duplicate; data typed into a
form that did not save must come back after a refresh.

## Design
- Double click: already blocked app-wide (lib/requestActivity.ts blocks the screen during a write).
- Retry after a lost reply: `Idempotency-Key` on every POST/PUT/PATCH (lib/idempotency.ts + api.ts interceptor).
  Key = fingerprint of method + URL + data; reused only while the first attempt is unanswered / ended without an
  app reply (network error, timeout, gateway 408/502/503/504, 401 refresh, server still busy). Pending keys kept
  in localStorage (survive refresh), cleared on sign-out / session end.
- Server: app/middleware/idempotency.py (pure ASGI) + table idempotency_records (migration e4b9a2c7d1f3).
  Per user (JWT sub), stores 2xx JSON/text replies 24 h and replays them; failed saves and file replies free
  the key; 409 idempotency_in_progress while the first runs (frontend waits); in-progress rows older than
  5 min are reclaimed; fails open if the table is missing.
- Drafts: lib/formDraft.ts `useFormDraft` + components/shared/DraftBanner.tsx, localStorage per user, 3 days,
  untouched forms not kept, files stripped (banner says re-attach), cleared after save / Discard / sign-out.
  Wired into ~75 create forms across Store, Quality, Maintenance, Finance, Design, Production, Projects, P2P,
  HR, Organization, CRM (org, tender), Products, ERP, R&D, Hydraulic, Electrical.

## Not covered (follow-up)
- Files of other sessions (uncommitted): InquiryForm, ActivityForm, InquiryDetailPanel forms, sales/orders/new.
- Popups that reset themselves on open / inline list-page dialogs listed in agent reports (HR masters, holidays,
  travel, visitor, departments, address rows, store bins, CRM masters, sales pricing, finance small dialogs).
- Finance vendor form (bank details + PAN) deliberately left out; employee PAN/Aadhaar/UAN/ESIC excluded.

## Checks
- Backend: test_idempotency.py 6 passed; full suite 2505 passed, 5 failed — all 5 pre-existing (same with
  this session's organizations.py reverted): crm_lifecycle org delete, crm_quotations deleted-inquiry, crm
  data scope x2, default data scope.
- Frontend: tsc clean; test:ui 2 pre-existing errors (RndProjectMembers, SlicerBar).
- Reviewer findings fixed: gateway-timeout and long-wait key loss (High), stuck in-progress row, file replies,
  drafts on session end, 3-day draft age, drafting after clear, neutral network wording, URLSearchParams.
- NOT SEEN LIVE (no Playwright in agent sessions).
