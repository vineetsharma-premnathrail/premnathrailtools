# Findings — Tally PO upload

| # | Sev | Raised by | Finding | Status |
|---|---|---|---|---|
| 1 | High | security | One person (holder of `tally_import`) can create a released, receivable PO of any value with no second approver; Tally approval is only the uploader's claim. | Mitigated: every Partner gets a bell notification per batch (uploader excluded), audit entry per PO, feature defaults to PO approvers only. **Open: owner to choose Partner confirm step / value cap, or risk-accept.** |
| 2 | Medium | security | xlsx zip bomb / whole sheet held in memory, parsing blocked the event loop. | Fixed: inflated-size cap 50 MB, stop after MAX_ROWS, parsing in threadpool. |
| 3 | Medium | reviewer | `nan` / `inf` accepted as numbers. | Fixed (`math.isfinite`), test added. |
| 4 | Medium | reviewer | GST cell in Excel % format reads 0.18. | Fixed: 0 < GST < 1 is refused with how-to-fix, test added. |
| 5 | Low | reviewer | Tally PO numbers grouped / de-duplicated case-sensitively. | Fixed (upper-case key, DB check via `upper()`), test added. |
| 6 | Low | security | PDF download filename header could 500 on non-latin names; no nosniff. | Fixed: RFC 5987 `filename*`, `attachment`, `X-Content-Type-Options: nosniff`. |
| 7 | Low | reviewer | Same item twice in one PO becomes two lines. | Accepted — matches Tally exports. |
| 8 | Low | reviewer | Any IntegrityError reported as concurrent upload. | Accepted — PO number series is locked. |
| 9 | Low | security | Formula-like text in external_ref. | Open: no Excel export includes external_ref yet; escape when one does. |
