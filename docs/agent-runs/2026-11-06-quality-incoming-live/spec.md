# Quality module live — incoming inspection slice (2026-11-06)

## Requirement (owner, in business words)
Quality check of purchased items is a separate process from Store, done by Quality people in the Quality module.
Make the Quality module ready/live with only what is needed now (incoming inspection). Core flow: Store/Purchase → **QC** → Production.

## Decisions taken by the Manager (owner did not answer; ERP-standard defaults, reversible)
1. QC is done by a separate Quality role. Store keeps counting (GRN) only; Store sees QC status read-only.
2. One incoming checklist for all flagged items = the owner's ISO format F/STR/01 (Grade as per MTC, Qty, Weight, Shape, Dimension, Appearance). Category-/item-wise plans stay possible later (Inspection Plans tab hidden for now).
3. Sampling as F/STR/01: 5 pcs per lot recorded, zero defect acceptance; on an abnormal result the sample is doubled (existing "tightened" severity).
4. Gauges calibration, NCR, CAPA, complaints, in-process, final, first article, inspection calls, supplier quality, documents: NOT live now (hidden, code kept).
5. No DB migration (alembic currently has 2 heads from another session's work).
6. Inspection report print = Excel, F/STR/01 layout (owner allowed Excel where needed).

## Live scope
Quality menu (sidebar, live section) with tabs: Dashboard, My Inspections, Inspection Lots (incoming), Masters (checklist/characteristics), Reports; Settings = gear next to bell.

## Acceptance criteria
- Given an item flagged "Quality check on receipt", when Store saves a GRN, then the qty sits in Quality stock, a lot is created with the F/STR/01 checklist attached, and Quality users are notified; Store cannot issue it.
- Given a Store-only user (no Quality access), they cannot start/record/decide a lot (403 with a real reason) but can see on the GRN that the line is "In quality check — lot <no>, status".
- Given a Quality inspector, they record the 6 parameters (OK/Not OK + value/remarks) for the sample, submit, and a decision Accept / Reject / Accept with deviation moves stock Free / Rejected (existing logic).
- The person who recorded the results cannot also give "Accept with deviation" (segregation of duties) — real error message explains who must decide.
- Quality nav shows only the live tabs; Role editor does not show phantom Quality tabs for hidden features (or the owner is told what remains).
- "Print inspection report" on a lot downloads an Excel in the F/STR/01 layout with the lot's results.
- Sidebar + Dashboard show Quality under live modules.
