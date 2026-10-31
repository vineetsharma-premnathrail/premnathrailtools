# Findings — PR multi-buyer split (2026-10-31)

## Build-time (fixed during build)
| Sev | Finding | Fix |
|---|---|---|
| High | app.main failed to import without RFQItem import (database) | Manager added import in main.py + env.py |
| Medium | test fixtures built RFQs without RFQItem → 32 failures (A) | B fixed p2p_po_helpers + fixtures |
| Medium | GRN gate lost "approval" wording + closed-PR gate (C) | D fixed |
| Medium | approval emails without po_id (C) | B passes po_id |
| Medium | PO overdue reminder went to header buyer (D) | Manager: RFQ buyer first |
| High | Store receipt cancel did not cancel its requisition (B) | Manager wired cancel_requisition_for_receipt |
| Medium | RFQ list hid PRs once any RFQ existed (frontend-1) | Manager: list from My Lines "to quote" |
| — | test_p2p_pr_purpose_item_types::test_new_requisition_refuses_item_type… fails | Pre-existing: fails on HEAD too (verified in a clean worktree). Not this run. |

## Security review
| Sev | Finding | Decision |
|---|---|---|
| Medium M1 | Buyer can reassign another buyer's line to self (pr_lines.py reassign: no all_lines check, no self check) | FIX: require can_work_all_lines; refuse new_buyer == actor unless admin/all_lines |
| Medium M2 | Header buyer / wider scope reads other buyers' RFQ, quotes, comparison, export, PDFs (rfq.py GET/list/attachment/PO doc; mm_quotations reads; rfq_invites reads) | FIX: drop _bought_by from RFQ/PO assigned scope; owner check on RFQ detail reads for purchase-team users who are not owner/all_lines/admin |
| Medium M3 | rfq_invites add/send/resend/remind/upload quote files lack owner check | FIX: ensure_rfq_owner in all five |
| Low L1 | Reassign target may be any PR viewer incl. the requester; short-close lacks purchase app gate | FIX |
| Low L2 | Tracker shows PO-approval comments to requester; vendor names of other buyers' POs to every purchase user | FIX: blank PO-step comments when vendor hidden; vendor only to PO owner / all_lines / admin / approvers |
| Low L3 | _po_of_rfq lets another RFQ owner reach rfq_id-less old POs | FIX: require creator or all_lines |
| Low L4 | submit_po_draft / close checks before lock; quote add/replace without lock | FIX |
| Low L5 | No separate "RFQ lines" feature (spec §5) | Accepted: RFQ Edit + owner rule covers it |

## Code review (reviewer-agent)
| Sev | Finding | Decision |
|---|---|---|
| High H1 | Re-quote after PO rejected/cancelled → FK violation (vq.items.clear() vs PO line vendor_quotation_item_id) mm_quotations.py:120 | FIX: update quote lines in place by pr_item_id; null FK on cancelled PO lines before deleting a line |
| High H2 | Draft PO (returned/withdrawn) cannot be discarded → qty stuck as ordered | FIX: buyer-owned "Discard draft PO" (draft only, reason, audit, bell, rollup) + button |
| Medium M1 | rfq_invites mutations lack owner check | = Security M3, FIX |
| Medium M2 | HR leaver handover doesn't move RFQ.buyer_id | FIX |
| Medium M3 | My Lines computes progress for all PRs before paging | FIX: SQL pre-filter / batch |
| Medium M4 | Legacy mixed RFQ: header buyer can't upload for other line buyers' lines; wrong "reassigned" message | FIX: legacy RFQ items (created before split) → RFQ owner may upload; reword |
| Low L1 | PR page shows newest PO, approver decides pending PO | FIX: purchase_order = pending PO the viewer can decide |
| Low L2 | No "PO rejected" flag on kept award | FIX: line_progress flag + label |
| Low L3 | Dead request-quotations / select-vendor routes + wrappers | FIX: remove (Manager removes api.ts wrappers) |
| Low L4 | Draft RFQ that loses last line not cancelled | Accepted: empty draft can't be submitted, clear message |
| Low L5 | submit_po_draft status check before lock | = Security L4, FIX |
| Low L6 | Urgent filter client-side | FIX: server param `urgent` |
| Low L7 | Draft qty floor message wording | FIX |

## QA (qa-agent) — e2e story + UAT (uat.md)
| Sev | Finding | Decision |
|---|---|---|
| Medium | PO rejection bell had no reason; requester got nothing (spec 30) | FIXED (Manager): approvals._tell_po_buyer_and_requester — bell to RFQ buyer/uploader + requester with reason, reject and return |
| High | Plain buyer with legacy role could reassign lines | Fixed by fix-2 (Sec M1); regression test in e2e |
| — | Expired quote award check | Added during run (mm_quotations), test green |
| Low | Spec 28: department PR without cost centre not refused at upload | Accepted for phase 1: dialog asks for it; server validates when sent (unchanged behaviour) |
| Low | Spec 23: blocked vendor 400 vs 409 | Accepted: existing behaviour + test |
