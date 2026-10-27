# App hardening plan - user mistakes and bad conditions

Run: 2026-10-26-app-hardening. Size: L (app-wide, shared components, one migration).
Status: PLAN - waiting for owner approval. Nothing built yet.

## Requirement (business words)
The app must stay correct when users make normal mistakes or work in bad conditions:
double clicks, slow or lost network, session expiry, wrong input, two people on the
same record, a deploy while a tab is open. Data must never be duplicated or silently
lost; every failure shows a real reason and what to do.

## Audit summary (2026-10-26, read-only)
Already good: global "Saving..." click-blocker overlay, FormSheet busy prop, row locks
on stock, no negative stock in code, race-safe number series, approval engine
double-approve + self-approve protection, sessions/roles checked per request,
FK/unique errors become 409 with a real message, magic-byte upload check, period locks.

Gaps found:
| # | Gap | Evidence |
|---|---|---|
| G1 | No idempotency: timeout then retry, or a click inside the first 150 ms, can create a duplicate PR / GRN / issue | no Idempotency-Key anywhere; GRN only blocks over-receipt |
| G2 | Stale-edit protection on 7 tables only | core/optimistic_lock.py LOCKED_PATHS |
| G3 | 409 conflict shown as a plain banner, no Reload | lib/api.ts, lockVersion.ts |
| G4 | No error boundary, no ChunkLoadError / new-version handling | no app/error.tsx, global-error.tsx, not-found.tsx |
| G5 | FormSheet closes on Esc / backdrop and loses typed data | FormSheet.tsx:162,169 |
| G6 | 401 refresh failure hard-redirects to /login, form data lost | lib/api.ts:127-131 |
| G7 | ConfirmDialog / PromptDialog have no busy state (HR leave/expense approve unguarded) | ConfirmDialog.tsx, LeaveApprovals.tsx, ExpenseApprovals.tsx |
| G8 | No offline detection | - |
| G9 | Search: no debounce in shared select, stale responses can overwrite new ones | SearchableSelect.tsx:53-56 |
| G10 | No shared numeric input (NaN, negative, huge values) | 327 raw type=number |
| G11 | Schemas: no shared strip/blank/limit types; PR item, GRN, issue, JE, item, vendor, CRM org lack qty>0 / max_length / blank checks | schemas sample |
| G12 | 422 errors returned as raw Pydantic list, not a sentence | middleware/error_handler.py:77-95 |
| G13 | Uploads: 2 GB default limit, zero-byte files accepted, shared FileUploadField has no size check | utils/sharepoint.py:28, FileUploadField.tsx |
| G14 | Server runs in UTC; date.today() (357 calls) gives yesterday's date between 00:00 and 05:30 IST | Dockerfile has no TZ |
| G15 | Teams message sent before DB commit; message goes out even if the save rolls back | utils/notifications.py:19,82 |
| G16 | No DB CHECK on stock balance (only code guards) | store/models/stock_balance.py |
| G17 | Inactive item not rejected on store issue / transfer / sales order lines; PO PATCH has no status check | audit #8, #5 |
| G18 | Vendor code duplicate check not trimmed / case-insensitive | accounts/routes/vendors.py:112,140 |
| G19 | No warning when a rate is far from the last PO rate (typo 1500 -> 15000) | - |
| G20 | Lists load limit 10000, no pagination (performance, not correctness) | crm inquiries/orgs/followups etc. |

## Plan

### Phase 1 - Data safety (backend first, highest risk)
1.1 Idempotency (G1). New table `idempotency_keys` (user_id, key, method, path,
    status_code, response_json, created_at; unique user_id+key; rows older than 24 h
    purged by the scheduler). Middleware: a POST/PUT/PATCH/DELETE carrying
    `Idempotency-Key` that was already completed returns the stored response
    (header `Idempotent-Replay: true`); one still running returns 409 "already being saved".
    Frontend api.ts sends key = hash(method + url + body), reused for 2 minutes, so a
    double click or a retry after a timeout with the same data gets the first result back.
1.2 Stale-edit protection (G2) extended to: PR, GRN, store material issue, store item,
    P2P vendor, CRM organization, CRM inquiry, CRM quotation (lock_version column +
    LOCKED_PATHS entry). ERP / R&D modules excluded (another session is editing them).
1.3 Stock CHECK (G16): `on_hand_qty >= 0` (and reserved >= 0) as NOT VALID constraint,
    so existing rows are not re-checked and the deploy cannot fail on old data.
1.4 Teams after commit (G15): queue Teams sends and fire them in an after_commit hook;
    dropped on rollback.
1.5 Small server guards (G17, G18): inactive item rejected on issue / transfer / SO lines;
    PO PATCH refused once PO is closed/cancelled; vendor code trimmed + case-insensitive dup check.
1.6 Timezone (G14): container TZ=Asia/Kolkata (Dockerfile ENV + tzdata if missing),
    after checking that naive datetime.now() callers do not assume UTC.
One migration for 1.1-1.3, chained on the single head at build time.

### Phase 2 - Input validation and messages (backend)
2.1 Shared Pydantic types in `core/validators.py`: CleanStr (strip, not blank),
    Name (max 200), Code (strip, upper), Remarks (max 2000), Qty (>0, <= 1e9),
    Amount (>=0), Percent (0-100). Applied to the weak create/update schemas:
    PR item, GRN + lines, material issue lines, journal entry lines, item, vendor,
    CRM organization/contact. No other schema is rewritten.
2.2 Human 422 messages (G12): error handler turns each Pydantic error into
    "Quantity (line 3): must be greater than 0" with field label; `errors[]` kept for forms.
2.3 Uploads (G13): reject zero-byte files everywhere; default limit 50 MB for normal
    attachments; the chunked large-upload path (drawings, videos) keeps its large limit.
    Message says the file size and the limit.
2.4 Rate sanity (G19): PR/PO line rate more than 3x or less than 1/3 of the item's last
    PO rate -> warning in the form ("Last PO rate Rs 1,500; you entered Rs 15,000 -
    check before saving"). Warning only, never a block.

### Phase 3 - Frontend safety net (shared components, so every screen benefits)
3.1 Error pages (G4): app/error.tsx, app/global-error.tsx, app/not-found.tsx - real
    message, error ref, Reload / Back buttons, no white screen.
3.2 New version (G4): ChunkLoadError caught globally -> "A new version of the portal is
    live. Reload to continue" banner (auto-reload once if no form is open).
3.3 Unsaved-changes guard (G5): FormSheet marks itself dirty on any input inside it
    (no page changes needed); Esc / backdrop / Close on a dirty sheet asks
    "Discard changes?"; browser refresh / tab close asks while a dirty sheet is open.
3.4 Session expiry without data loss (G6): if refresh fails while a form is open, show
    "Your session ended. Sign in again in a new tab, then press Retry - your form stays here."
    (cookie is shared by tabs). Hard redirect only when nothing is open.
3.5 ConfirmDialog / PromptDialog busy (G7): onConfirm may return a promise; dialog stays
    open, buttons disabled, spinner, error shown inside. Backward compatible.
    Fix HR leave/expense approvals and the 2 real actions with busy={false}.
3.6 Offline banner (G8): "No internet connection - changes will not save until it is back".
3.7 Conflict dialog (G3): 409 stale record -> dialog "Ravi changed this record at 14:32.
    Reload to see the latest" with Reload button.
3.8 Search (G9): SearchableSelect debounces server search (300 ms) and ignores stale
    responses; shared useDebouncedSearch hook for list search boxes.
3.9 NumberField (G10): shared input - blocks NaN/negative/over-max, decimals by unit,
    accepts pasted "1,00,000". Applied to qty/rate fields of PR, PO, GRN, issue,
    SO lines and vouchers.
3.10 DateField min/max (end >= start) + FileUploadField size / zero-byte check (same limits as server).

### Phase 4 - Proof and keeping it fixed
4.1 pytest: idempotent replay, stale 409 on new tables, stock CHECK, inactive item,
    422 sentence, zero-byte / oversize upload, Teams not sent on rollback.
4.2 Playwright "break it" checklist on localhost (owner signed in): double click save,
    slow 3G, offline, Esc on dirty form, two tabs editing the same PR, stale build.
4.3 Static rule in `npm run test:ui`: flag raw type=number in transaction forms and
    FormSheet busy={false} on submit actions.
4.4 "Breaking checklist" added to the premnathrail-ui-behavior skill so new features follow it.

### Deferred (separate approval later)
- G20 server-side pagination for big lists (changes list UI; performance work).
- Stock qty Float -> Numeric (data migration on live stock).
- SharePoint orphan-file cleanup when the DB commit fails after upload.

## Team
backend-agent x2 (core middleware/validators; module guards), database-agent (one
migration), frontend-agent x2 (shared components; form adoptions), devops (TZ),
then integration, security, qa, reviewer, accessibility, uiux live check, documentation.
Registries (main.py, alembic/env.py, api.ts) edited by the Manager only.

## Owner decisions needed
D1 Identical save within 2 minutes = duplicate (returns the first result). OK?
D2 Normal attachment limit 50 MB (large drawings via chunked path). OK?
D3 Server timezone to IST. OK?
D4 Rate warning at 3x / one-third of last PO rate, warning only. OK?
