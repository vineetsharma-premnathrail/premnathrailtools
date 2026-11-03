# R&D: Close a requirement without a response (2026-11-02)

## Requirement (owner, in chat)
Many CRM requirements need no R&D deliverable ("document share karna important nahi hota"). Today the only
way R&D can finish is "Respond to CRM" (remarks and/or documents). Owner wants a single button / status so
R&D can mark the requirement **Closed** without any R&D activity.

Core-flow position: Customer → BD → **R&D** (requirement intake) → Design/EHP. Size: M. No migration
(status columns are String(20) with no check constraint).

## Decisions (Manager, ERP standard)
1. New status value `closed` on `crm_rnd_requests.status` (open → closed) and on
   `rnd_requirement_revisions.status` / `rnd_requirements.status`. Label everywhere: **"Closed by R&D"** (grey #78716c).
2. Endpoint `POST /rnd/requirements/requests/{request_id}/close`, JSON `{ "reason": str }`.
   Reason is mandatory, ≥ 10 chars (audit: why no R&D work was needed). No files, no delay reason (nothing is delivered).
3. Who may close = who may respond (`ra.ensure(..., "respond")` + feature `rnd/requirements/crm_request/submit`,
   assignee rule as in `mark_responded`). Closing is allowed **before Accept** too, but then only by a reviewer
   (`ra.ensure_can_review(db, user, "close")`), because deciding "not an R&D job" is the head's call like Accept.
4. Request must be `open`. Real 409 messages for responded / closed / superseded / returned.
5. Effects: request.status="closed", response_remarks=reason, responded_by_id/responded_at set;
   revision + requirement status "closed", revision.responded_at set; AuditLog action `requirement_closed`
   (module_key rnd, entity_type rnd_req_<source>); notify requester (`rnd_request_closed`) and role event
   `crm.tor_closed` (register in `core/events/crm.py`, same shape as tor_responded).
6. After closed: respond → 409 ("R&D closed this request without a response — ask BD to re-send it if R&D
   work is needed now."); ask_details → existing "no longer open" 409; tasks / offers → 409 via
   `accept_first_message` with a hint for closed; accept / return → 409. BD re-send → new revision (existing
   logic; closed is not UNANSWERED so it keeps its status). `is_late` stays false for closed.
7. UI (R&D requirement page, status card): secondary pill **"Close without response"** next to "Respond to CRM",
   same visibility rules; when the revision is still awaiting review it is enabled only for `my_access.can_review`.
   FormSheet (width 520, icon "check"): reason textarea (required), hint: "Use this when R&D has nothing to share —
   BD continues without R&D input. BD is notified and can re-send the requirement later if R&D work is needed."
   Card title when closed: "Closed by R&D — no response needed". `RndRequestBlock` (used on the CRM side too)
   shows a closed section: "Closed by R&D — {by} · {at}" + reason.
8. Lists: R&D › Requirements status pill shows "Closed by R&D"; `status` filter accepts `closed`.

## Acceptance criteria
- AC1 Head closes an accepted open request with a 12-char reason → 200, request.status closed, revision + requirement closed, audit row, requester notified.
- AC2 Reason < 10 chars → 422 with a message saying what to write.
- AC3 Member without respond right → 403. Member with respond grant but revision still submitted → 403 (reviewer only); head may close a submitted revision.
- AC4 Closing a responded / closed / superseded request → 409 with the specific message.
- AC5 After close: respond → 409; create task → 409 (accept-first message with closed hint); BD re-send → new revision R1 submitted, R0 stays closed.
- AC6 Frontend: tsc clean; closed badge/labels in R&D list, requirement page, CRM Requirement Movement tab.
