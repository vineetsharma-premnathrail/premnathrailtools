# Plan — PR multi-buyer split (2026-10-31)

Size L. Alembic head at launch: d0f4d65f9d55. No P2P file was modified at launch.

## Open points from spec.md §14 — Manager decisions
| # | Decision |
|---|---|
| 1 | One line = one buyer; split is by vendor qty (built). |
| 2 | Requester does not see vendor/prices (existing commercials rule); sees PO no., stage, approval who/when, expected-by. |
| 3 | Phase 1: withdraw/discard draft or in-approval PO by its buyer; cancel a released PO only with no GRN/invoice, new Cancel PO action, reason + bell. Approval step for released-PO cancel = follow-up. |
| 4 | Keep existing behaviour; Upload PO limited by award; tracker shows amber "over-ordered", never negative. |
| 5 | Reassign = Purchase head only (Assign buyer › Edit). |
| 6 | Before-PO: creator = buyer of all lines, no award step; receipt cancel → withdraw RFQ lines + auto-cancel PR with reason. |
| 7 | Shortcut upload without line quotes allowed, L1 reason rule. |
| 8 | My Lines = sub-tab of Purchase Requisitions (feature purchase_requisitions.my_lines) — the rows are PR lines; matches architecture. |
| 9 | Requester bell on each completed GRN. |
| 10 | All lines withdrawn, nothing bought → auto-close with note. |
| 11 | Keep draft-RFQ edit block. |
| 12 | Idle-line reminders → phase 2. |
| 13 | No bulk PO approval. |
| 14 | Tally number partial unique index in migration, after duplicate check (local DB). |
| 15 | In-flight mixed RFQs stay under header buyer; head can reassign. |
| 16 | Reassign after quotes allowed; clears only un-ordered awards. |

## Waves
1. database (models + one migration) ∥ backend-a (derive + gates + per-PO decisions/emails/finance gate) — after architecture design.
2. backend-b (RFQ lines, quotes scope, award qty, upload per vendor, Before-PO) ∥ backend-c (reassign, withdraw, short-close, cancel PO, tracker, My Lines).
3. Manager registries (permissions/features, api.ts, types); frontend.
4. integration → review wave (security, qa, reviewer, a11y) → fixes → release gate.
