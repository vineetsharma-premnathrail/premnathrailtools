# Findings: typing assist

| ID | Sev | Raised by | What | Status |
|---|---|---|---|---|
| H1 / S-M1 | High | reviewer + security | The AppLock password with "Show" on became eligible, so it was learned and stored in localStorage | Fixed: WeakSet of fields ever seen as password, plus the Show/Hide toggle rule |
| M1 / S-M2 | Med | reviewer + security | PAN, IFSC and account no. were kept in field history because their labels sit in wrapper spans | Fixed: label-text hints, a wider SENSITIVE_HINT, and `isSecretLike` value guard |
| M2 / S-L3 | Med | reviewer + security | Tab could turn code-like text into a vocabulary word ("PEW-78") | Fixed: no completion on digits or after `-` `/` `.`, a code-field rule, Tab needs 3+ letters |
| M3 | Med | reviewer | A stale chip could write at the wrong offset (IME, programmatic change) | Fixed: each edit carries its `expect` text, plus a compositionend refresh |
| M4 | Med | reviewer | A chip could exceed maxLength and lost Ctrl+Z | Fixed: maxLength guard, execCommand insertText first |
| M5 | Med | reviewer | The assist was active inside combobox/picker inputs | Fixed: aria-autocomplete, combobox and `.ui-select-typein` are skipped |
| M6 | Med | reviewer | Esc was swallowed when only history chips showed | Fixed |
| L1 | Low | reviewer | The machine hint was mapped to /dashboard/erp, which has no search box | Fixed: now /dashboard/projects/all |
| L2-L6 | Low | reviewer | Devanagari tokenizing, learning on blur, 200-character lookback, re-renders, listbox a11y | Fixed |
| S-L4 | Low | security | /similar loaded every row on each call | Fixed: 60 s candidate cache, q capped at 80 |
| S-L5 | Low | security | Vocabulary cache key did not carry the scope level | Fixed: `_scope_marker`, 50 entries |
| S-L6 | Low | security | Learned words stayed after logout | Fixed: cleared on logout or user change |
| V1 | Low | security | Machines also need the erp/projects app check | Fixed |
| R-B | Low | reviewer | Substring bonus on 3-character queries; cold-cache stampede | Fixed: 4+ characters at a word boundary; per-key lock |

Open (accepted design limits): personal words and history are per browser (no DB table, because the alembic chain is broken by other sessions). The only way back after turning suggestions off is Alt+Shift+T.

Checks (Manager re-run): pytest typing_assist 27 passed; ruff F821 py312 clean; tsc 0 errors; test:ui 0/0 (builder run). The route is live on local :8000 (401 without a token).
NOT SEEN LIVE yet.
