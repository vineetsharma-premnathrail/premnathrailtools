# Final report — Quality live (incoming slice) + Store F/STR prints + GRN vendor documents (2026-11-06)

## Outcome
Built, reviewed (security + rules), all findings fixed except the items listed under "Open". NOT pushed. NOT seen live in a browser.

## What changed (business words)
- GRN form: gate entry no. removed (server numbers it); user picks Tax Invoice or Delivery Challan; PR box always shows Project (or "Inhouse — no project") and Deliver to (plant unit).
- Store ISO prints as Excel in the owner's exact layout: F/STR/04 slip, 05 issue register, 02 gate inward, 06 rack-wise inventory register, 03 gate outward.
- Quality is a live module with only: Dashboard, My Inspections, Incoming Inspection, Masters, Reports (+ settings gear). Other tabs hidden; opening one by URL shows "not live yet".
- Every flagged incoming lot gets the F/STR/01 checklist (6 parameters, 5 pcs, zero defect, doubled when tightened). Store users cannot act on lots. SoD on deviation; partial accept of a failed lot follows the same deviation rules.
- Inspection report Excel (F/STR/01). GRN detail shows each line's lot status read-only.
- Quality settings › Inspection rules: First article control and NCR auto-raise, both OFF by default. With NCR off, rejected stock goes back via Store's Return to Vendor (Blocked stock leaves on the RTV).
- Role editor / Users matrix: not-live Quality tabs listed under "Not live yet" (never removed — removing stripped grants on save).

## Checks
- Backend: 205 passed (quality, GRN, pre-PO, vendor returns, store ISO registers, permission) + permission editor tests; ruff F821 py312 clean.
- Frontend: tsc clean; npm run test:ui 0 errors.

## Findings (security + reviewer) — status
- H1 partial-decision bypass — fixed. M1 grant stripping (Manager's own change) — fixed by grouping. M2 hidden presets authority — now visible under "Not live yet". M3 xlsx formula injection — fixed in quality report and store registers. L2 standard checklist protection — fixed. IDOR test on report — added.
- Blocker FAI rule / Major NCR stuck stock — fixed via settings (default off) + RTV fix.
- Minors 3–8 — fixed (links, settings/reports/manual lot types, KPI + server-side view filter, wording "Decision", sampling doubling only for F/STR/01, users matrix grouping).

## Open (before push)
1. alembic heads = 2 (b7d3f1a9c5e8 renumber migration staged as deleted but file on disk — another session's work). Must be resolved before any push.
2. Live browser check not done (owner logs in; Playwright via qa/uiux).
3. Open one generated F/STR/01 report and the Store registers in Excel.
4. L1 (low): re-recording results can rewrite the recorder (needs a first-recorded-by field later).
5. Owner question: lot Cancel only by Quality head? (recommended yes; not changed).
6. Existing roles need Quality roles re-applied to get the new Print grant; QC users need the Quality app.
7. Many touched files also carry other sessions' uncommitted hunks — commit must stage only this session's hunks (git add -p is interactive and not available; coordinate with the owner).
