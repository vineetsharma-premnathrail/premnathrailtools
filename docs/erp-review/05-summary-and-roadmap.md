# Phase 5 — Summary and Fix Roadmap

This document consolidates Phases 0–4:
- [00-inventory.md](00-inventory.md): what the system contains
- [01-inputs-and-views.md](01-inputs-and-views.md): about 470 screen-level findings
- [02-workflows.md](02-workflows.md): 246 workflow gaps
- [03-data-model.md](03-data-model.md): about 90 data findings
- [04-security-report.md](04-security-report.md): 39 security findings

Duplicate findings from different phases have been merged into **66 consolidated issues** (C-01 … C-66). Each one lists its source IDs, so the detail and the `file:line` evidence can be traced back. Review date: 2026-09-29, working tree including uncommitted changes.

---

## 1. Executive summary (for management)

**What the portal is.** One web application, also used inside Microsoft Teams, that covers most of the company's back office:
- Organization setup
- Service requests
- CRM (inquiries and tenders)
- Purchasing (requisition → quotation → purchase order → goods receipt)
- Store
- Quality
- Project Management
- R&D engineering calculators
- Finance

It has 137 screens, 478 server functions and 110 database tables. Staff sign in with their company Microsoft account.

**What is in good shape.**
- The foundations are sound. Sign-in, session tokens and document numbering are built correctly.
- Files are stored on SharePoint and never exposed directly.
- There is no sign of the most common attack types (database injection, command injection).
- Most screens follow a consistent design, and error messages are generally clear.
- The purchasing chain from requisition to stock receipt works end to end.

**The main risks, in business terms.**

1. **One urgent security hole.** A field on the R&D Spline report can be abused by any R&D user to read the server's secret keys. With those keys, someone could sign in as any person, including an administrator. The fix is small and should ship **this week**. The keys must then be changed.
2. **Approvals can be bypassed.** In purchasing:
   - a person can approve their own requisition;
   - the purchase team can mark a request "approved" without the Director or MD;
   - purchase orders are approved **without any value on them**, so an invoice for any amount "matches".

   In Finance, one person can create, post and pay an invoice alone. In Store, a person can approve their own stock adjustment. These are the classic conditions for fraud and should be closed **this month**.
3. **Some records have no history.** Quality (NCRs, CAPAs, complaints), Store movements and Organization changes, such as who is a department head, keep no audit trail, and Quality records can be permanently deleted. For a rail supplier that may be audited against ISO 9001 or ISO 22163, this is a compliance exposure.
4. **Access settings don't do what admins think.** The new "Permission Matrix" only hides menu tabs; the screens and data behind them are still reachable. People who leave the company keep access until an admin manually runs a sync, and logging out on a shared PC can silently fail.
5. **Several screens can't finish their job.** For example:
   - Finance managers can't see the Close Period button.
   - Customer invoices with a discount can't be posted, which blocks month-end.
   - Bank accounts created on screen can't make payments.
   - Supplier scorecards can't be saved.
   - Store staff can't record goods receipts unless they also have purchasing rights.
6. **Modules don't talk to each other yet.**
   - A won CRM deal doesn't create a project or an invoice.
   - Quality inspections aren't linked to goods received, so rejected material isn't blocked from stock.
   - Project budgets can't be compared with purchase spend.

**What we recommend.**

| When | What | Rough effort (one developer) |
|---|---|---|
| **This week** | Close the R&D security hole and change the keys. Stop self-approval and status overrides in purchasing. Fix the 7 screens that can't finish their job. Correct 4 production settings. Prevent an upcoming database change from deleting two tables. | ~1 week |
| **This month** | Enforce value and segregation-of-duties rules in purchasing, finance and store. Add audit trails to Quality, Store and Organization. Stop leavers keeping access and fix logout. Protect against cross-site attacks. Fix approvers who are notified but can't open the screen. | ~3–4 weeks |
| **Next quarter** | Make the Permission Matrix real on the server. Link Quality to goods receipt and stock. Hand CRM wins over to projects and invoices. Add cancel and reversal for store documents. Add proper status workflows, stock valuation and printable documents (PO, issue slip, inspection report). | ~2–3 months |

**Bottom line.** The system is usable and well-structured, but it is **not yet safe to rely on for financial or quality controls**. The "This week" and "This month" items remove the serious risks at modest cost, and should be done before the purchasing and finance modules are relied on for audit-relevant work.

---

## 2. Consolidated issue table

Severity:
- **Critical**: system takeover
- **High**: a control can be bypassed, a screen can't complete its job, or data is lost
- **Medium**: a real defect with a workaround or a limited blast radius
- **Low**: hardening or polish

Effort: **S** < 1 day · **M** 1–3 days · **L** > 3 days. Personas: [BA] Business Analyst · [ARCH] Architect · [SEC] Security · [USER] End User.

### Critical and High

| ID | Module | Persona | Category | Severity | Issue → fix | Effort | Source IDs |
|---|---|---|---|---|---|---|---|
| C-01 | R&D | [SEC] | Injection | **Critical** | Spline PDF report compiles unescaped LaTeX, so server files (`.env`, `SECRET_KEY`) can be read. **Fix:** escape the fields, add `-no-shell-escape` and `openin_any=p`, drop the lualatex fallback, **rotate secrets** | S | S-01, P1-RND-3 |
| C-02 | P2P | [SEC][BA] | Approval control | High | Requester can pick themselves as every head and self-approve, and the heads are optional on the backend. **Fix:** require all 3 heads with the matching flag, reject requester = head, one slot per call | S | S-02, P1-P2P-4/5, P2-P2P-15, F0-3 |
| C-03 | P2P | [SEC][BA] | Approval control | High | PR/PO PATCH can set any status (skipping Director/MD), and an ad-hoc PO needs no approval. **Fix:** remove `status`/approver fields from the PATCH schemas; only dedicated transitions change status | S | S-03, P1-P2P-15, P2-P2P-16/17, P3-STOR-34 |
| C-04 | P2P / Finance | [BA][SEC] | Financial control | High | POs are approved with no prices, and the 3-way match accepts any invoice. **Fix:** require line prices before submit; match on GRN qty × PO price; check approval and cumulative cap | M | S-04, P1-P2P-3, P2-P2P-27, P1-FIN-12/13, P3-INT-31 |
| C-05 | Finance | [SEC] | Segregation of duties | High | Posting, payment and reversal need only the app, so one user can do all of them. **Fix:** role gate plus maker ≠ checker | M | S-05 |
| C-06 | Platform | [SEC] | Access control | High | Permission Matrix only hides nav tabs, and `data_access_scopes` is never enforced. **Fix:** router-level `require_tab_access` and page guards in every module | L | S-06, F0-6/7, X1-5, P1-CRM-5, P1-PM-2, P2-USR-10 |
| C-07 | Platform | [SEC] | CSRF | High | Bodiless POSTs (approve, approve-po, sync, restore) can be triggered cross-site under `SameSite=None`. **Fix:** Origin check for unsafe methods plus a required custom header | M | S-07 |
| C-08 | ERP | [SEC] | IDOR | High | Any ERP user can delete any material photo (the check is skipped for a non-existent `sr_id`). **Fix:** scope by `sr_id` + `mat_id`; always load the SR | S | S-08, P1-ERP-47, P2-ERP-33 |
| C-09 | Store | [SEC][BA] | Inventory control | High | Self-approved adjustments, unrestricted manual stock entry and uncapped returns. **Fix:** draft → approve by a store manager (≠ creator); restrict manual entry; cap returns | M | S-09, P1-STO-22/34/38, P2-STO-11/15 |
| C-10 | Users | [SEC] | Leaver access | High | No scheduled Azure sync, sync re-activates deactivated users, and deactivation doesn't revoke sessions. **Fix:** nightly sync, respect local deactivation, revoke sessions | M | S-10, P2-USR-15/16, P1-ORG-47 |
| C-11 | Auth | [SEC] | Session | High | Logout fails once the 15-minute token has expired, so shared PCs stay signed in. **Fix:** logout by refresh cookie without needing an access token | S | S-11, P2-USR-19, P1-ORG-72 |
| C-12 | Quality / Org / Store | [BA][SEC] | Audit trail | High | No audit rows, and Quality/Organization records are hard-deleted. **Fix:** shared audit helper on every mutation; soft delete with `deleted_by_id` | M | S-12, P3-STOR-43/47/51, P2-QA-17/18 |
| C-13 | Data | [ARCH] | Migrations | High | The next `alembic --autogenerate` will emit `DROP TABLE feedback, crm_product_categories`. **Fix:** import both models in `env.py` **and** guard `a1c3e7f92b48` with `has_table` | S | P3-MIG-17, P3-MIG-1, F0-8 |
| C-14 | P2P | [BA] | Notifications | High | The PO-submit path the UI actually uses notifies nobody, and approvals don't notify the next approver. **Fix:** call the existing notify/email helpers in `submit_po_draft` and `approve_po` | S | P1-P2P-27, P2-P2P-21 |
| C-15 | P2P / Store | [USER] | Access mismatch | High | Heads and approvers without `p2p`/`purchase` are notified but redirected or refused; GRN pages need `store` while the API needs `purchase`; notifications have no link. **Fix:** align the page gates with the backend rules; add notification links | M | P1-P2P-1/6/30, P2-P2P-14/19/22, F0-11 |
| C-16 | Finance | [USER] | Blocking bug | High | `/auth/me` omits `is_finance_manager`, so finance managers can't close a period or approve variances. **Fix:** add the field to `CurrentUserResponse` | S | F0-5, P1-FIN-1, P1-ORG-54 |
| C-17 | Finance | [BA] | Blocking bug | High | An AR invoice with a discount can never be posted (unbalanced journal), which blocks month close. **Fix:** add a discount journal line; allow cancelling a pending invoice | S | P1-FIN-5/6 |
| C-18 | Finance | [USER] | Blocking bug | High | The bank account form has no GL account field, so payments are impossible and the error points to a field that doesn't exist. **Fix:** add the field | S | P1-FIN-7 |
| C-19 | Quality | [USER] | Blocking bug | High | Supplier scorecard create always fails: no Vendor Name field. **Fix:** add a vendor picker | S | P1-QA-37 |
| C-20 | ERP | [BA] | Blocking bug | High | SR edit returns 422 when an expected date is empty. **Fix:** send `null`, not `''` | S | P1-ERP-55 |
| C-21 | Store / P2P | [BA][ARCH] | Stock integrity | High | GRN matches items by name text; with no location it posts no stock but still completes; a double submit posts stock twice. **Fix:** `item_id` on PO/GRN lines, location NOT NULL, row lock on inspect | M | P2-STO-1/23, P3-INT-30, S-26, P3-STOR-33 |
| C-22 | Quality | [BA] | Process gap | High | Two unconnected inspection systems; no quarantine; rejection disposition does nothing. **Fix:** link `quality_inspections` to the GRN, add a hold location, drive dispositions (RTV / scrap / rework) | L | P2-QA-1/3/4, P1-QA-14/18 |

### Medium

| ID | Module | Persona | Category | Severity | Issue → fix | Effort | Source IDs |
|---|---|---|---|---|---|---|---|
| C-23 | Store | [BA] | Process gap | Medium | Posted issues, returns, transfers, adjustments and GRNs can't be cancelled or reversed. **Fix:** a reversal endpoint that posts opposite ledger rows | M | P2-STO-16, P1-STO-31/37 |
| C-24 | Store | [BA] | Blocking bug | Medium | A reservation blocks the issue it was made for. **Fix:** allow the issue to consume its own reservation | S | P1-STO-41 |
| C-25 | Platform | [BA] | Data loss on edit | Medium | Clearing a field on edit is silently ignored (ERP, CRM, Store, Quality). **Fix:** send `null` for cleared fields; the backend must accept explicit nulls | M | X1-1, P1-ERP-24, P1-CRM-11, P1-STO-7, PAT-B |
| C-26 | Platform | [BA] | Truncation | Medium | Hard list caps and no paging: users 100, CRM 200, ERP reports 50 SRs, ledger 500. **Fix:** server pagination plus totals | M | X1-2, P1-ORG-41, P1-CRM-6, P1-ERP-60 |
| C-27 | Platform | [BA] | Status discipline | Medium | Free "any → any" status in ERP, Quality, PM and CRM. **Fix:** per-entity allowed-transition maps enforced in the backend | L | X1-4, P2 §1.2, P2-ERP-1, P2-QA-8/9 |
| C-28 | CRM | [ARCH][BA] | Configuration mismatch | Medium | Three conflicting stage lists, and the validated stage endpoint is unused. **Fix:** a single stage list served by the backend; the FE uses `POST /stages` | M | P1-CRM-31, P2-CRM-1/2 |
| C-29 | CRM | [BA] | Integration | Medium | A won inquiry or tender hands off to nothing. **Fix:** "Convert to project / AR invoice" action | L | P2-CRM-34 |
| C-30 | ERP / P2P | [BA] | Integration | Medium | Raise PR skips heads, defaults to OTH (no buyer) and hard-codes priority; PR status never syncs back. **Fix:** reuse the P2P create validation; add a `service_request_id` FK; sync status | M | P1-ERP-38, P2-ERP-11/12/13, P3-STOR-36/37 |
| C-31 | P2P | [ARCH] | Hardcoded configuration | Medium | Auto-buyer emails are hard-coded, with no active check and no buyer for OTH. **Fix:** an admin-editable table; skip inactive users; warn when no buyer is found | S | F0-4, P3-INT-12 |
| C-32 | P2P | [SEC][ARCH] | Audit identity | Medium | Purchase Head/Director/MD approvals are stored as names only, on the PR, not the PO. **Fix:** add `*_approved_by_id` columns; store PO approval on the PO | S | P3-STOR-31/32, P3-INT-2, F0-10 |
| C-33 | Platform | [SEC] | Configuration | Medium | Every request arrives from `127.0.0.1`, so the rate limit is shared by everyone or disabled. **Fix:** `TRUSTED_PROXIES=127.0.0.1`; refuse to start if `TRUSTED_LOCAL_DEV` is set in production | S | S-13 |
| C-34 | CRM | [SEC] | Data exposure | Medium | Documents shared through a TOR can be read by any user by id. **Fix:** check recipients | S | S-14, P1-CRM-67 |
| C-35 | PM | [SEC][BA] | Approval control | Medium | Anyone can decide any approval (including their own), delete a project or edit a budget; approving a change request has no effect. **Fix:** approver check, `decided_by_id`, PM/sponsor role | M | S-15, P1-PM-1/41, P2-PM-6/7 |
| C-36 | Auth | [SEC] | OAuth hardening | Medium | Login state is in memory and not browser-bound, with no PKCE; `?token=` login; multi-worker breaks. **Fix:** signed state cookie + PKCE, DB/Redis state, remove `?token=` | M | S-16, S-39, P2-USR-20 |
| C-37 | Auth | [SEC] | Identity | Medium | Users are matched by case-sensitive email, not `azure_id`. **Fix:** match on `azure_id` first | S | S-17, P3-INT-22, P2-USR-5 |
| C-38 | Users | [SEC] | Admin governance | Medium | Sync promotes admins but never demotes; there is no role UI; access changes aren't audited. **Fix:** `role_source`, a role editor, per-field access audit | S | S-18/19, P2-USR-8/11/12, P1-ORG-53 |
| C-39 | Platform | [SEC] | Uploads | Medium | `.exe` accepted when sent as `image/png`. **Fix:** require both the extension and the content type to be allowed | S | S-20 |
| C-40 | Email | [SEC] | HTML injection | Medium | Unescaped greeting and title in client and vendor emails. **Fix:** `escape()` every value | S | S-21, P2-ERP-34, P2-P2P-25 |
| C-41 | Configuration | [SEC] | Fail-open defaults | Medium | Insecure cookie default, weak key accepted outside production, empty domain allows every account, public `/docs`. **Fix:** invert the defaults; disable docs in production | S | S-22/23, F0-13 |
| C-42 | Auth | [SEC] | Token binding | Medium | JWT is resolved by user id only, so it maps to a different person after a renumbering restore. **Fix:** check the email claim; add session revocation to the restore runbook | S | S-24, P3-INT-19 |
| C-43 | P2P | [BA] | Cancel cascade | Medium | Cancel after PO approval is allowed; a cancelled or rejected PR leaves the PO live and invoiceable. **Fix:** block or cascade; refuse invoices | S | S-25, P2-P2P-4/5 |
| C-44 | P2P | [ARCH] | Concurrency | Medium | Concurrent approvals can leave a PR stuck; duplicate PO drafts. **Fix:** `for_update=True` on approve paths; duplicate guard | S | P2-P2P-10/11, S-26 |
| C-45 | ERP | [SEC] | Attachment privacy | Medium | Private-document delete has no visibility check; SR attachments have no privacy at all. **Fix:** apply `_can_view_attachment` | S | S-27, P1-ERP-18 |
| C-46 | Email | [SEC] | Mail permission | Medium | Mail is sent "as the clicking user", which needs tenant-wide send-as. **Fix:** one service mailbox plus an Exchange Application Access Policy | M | S-28, P3-INT-16 |
| C-47 | Data | [ARCH] | Schema drift | Medium | Fresh and upgraded DBs differ (134 nullability, 147 defaults, DB-only unique indexes, 16 orphan columns). **Fix:** one reconciliation migration, and declare the partial indexes in the models | M | P3-MIG-4…14 |
| C-48 | Data | [ARCH] | Referential integrity | Medium | About 51 id columns have no FK, including user ids inside JSON. **Fix:** add FKs (with `ondelete`) in phases; validate JSON id lists on write | M | P3-INT-20/21, Appendix A |
| C-49 | Data | [ARCH] | Numeric precision | Medium | 94 money and quantity columns are Float. **Fix:** migrate to `Numeric(18,2)`/`(18,4)` | L | P3-STOR-45, P3-MIG-14, P1-FIN-31 |
| C-50 | Data | [BA] | Soft delete | Medium | Recycle-bin SRs can still be modified; Finance can invoice a deleted customer. **Fix:** add `is_deleted` filters at the listed loaders | S | P3-INT-26/27, S-36 |
| C-51 | Data | [ARCH] | File storage | Medium | Same-name uploads overwrite; deleted attachments leave files; soft-deleted documents lose their files. **Fix:** unique file names (id prefix), store the drive item id, delete files on hard delete only | M | P3-STOR-6/7/8 |
| C-52 | Data | [BA] | Timezone | Medium | Business dates use server-local `date.today()`, so records made 00:00–05:30 IST get the wrong day. **Fix:** a single `today_ist()` helper | S | P3-STOR-9 |
| C-53 | Store / Finance | [BA] | Valuation | Medium | No stock valuation: the ledger has no cost. **Fix:** unit cost on the ledger, moving-average update on receipt | L | P3-STOR-44, P2-STO-6 |
| C-54 | Users / Org | [BA] | Joiner/mover/leaver | Medium | New users get an empty dashboard and no request flow; login overwrites department; movers keep head flags; leavers' approvals aren't reassigned. **Fix:** access-request flow, reassignment tool, stop overwriting admin-edited fields | M | P2-USR-1/2/6/14/18, P3-INT-5, P1-ORG-37 |
| C-55 | Platform | [USER] | Error messages | Medium | 27 loads swallow the server's reason, and about 20 show only "Validation error"; several screens stay on "Loading…" forever. **Fix:** use `extractErrorMessages` everywhere; always clear loading in `finally` | M | Phase 1 §1.1, P1-ERP-41, P1-CRM-1, PAT-A |
| C-58 | PM | [USER][BA] | Process gap | Medium | Project status can't be changed; there is no closure procedure; 4 tabs are placeholders. **Fix:** a status control with a transition map and a closure checklist | M | P1-PM-12, P2-PM-1/3 |
| C-59 | Quality | [BA] | Process gap | Medium | NCR can close with open CAPAs; the complaint → CAPA link is broken; links are typed as raw ids. **Fix:** closure rules, a `complaint_id` filter/field, record pickers | M | P2-QA-8/9/13, P1-QA-29/33 |
| C-61 | Platform | [BA] | Documents | Medium | No PR/PO print, issue slip, transfer challan, inspection report or audit export. **Fix:** printable templates for the paper-facing documents | L | X1-8, P1-STO-32 |
| C-66 | Data | [ARCH] | Unknown tables | Medium | `crm_inquiry_approvals` and `crm_inquiry_tasks` appear in the production dumps with no model. **Fix:** confirm in production; model them or drop them | S | P3-MIG-18 |

### Low

| ID | Module | Persona | Category | Severity | Issue → fix | Effort | Source IDs |
|---|---|---|---|---|---|---|---|
| C-56 | Platform | [USER] | UI standard | Low | About 15 deletes have no confirmation; 1 `window.confirm` (branch delete). **Fix:** ConfirmDialog everywhere | S | Phase 1 §1.1, P1-ORG-16 |
| C-57 | Platform | [USER] | UI standard | Low | 6 non-standard Back buttons, several missing, and error states without nav. **Fix:** a shared header component | S | Phase 1 §1.1 |
| C-60 | CRM | [USER] | Navigation | Low | Products, categories, payment terms and follow-ups have no nav link. **Fix:** add them to CrmNav | S | X1-7, P1-CRM-56 |
| C-62 | Data | [ARCH] | Numbering | Low | Text `MAX()` breaks at 10,000 per series; CRM quotation numbers come from `count()`. **Fix:** a numeric sequence column or ORDER BY length; lock the quotation number | S | P2 §1.6, P3-STOR-41, P2-CRM-14 |
| C-63 | Data | [ARCH] | Retention | Low | Audit, notification and session tables are never purged; audit `entity_id` isn't indexed. **Fix:** retention job plus indexes | S | P3-STOR-10/53 |
| C-64 | Security | [SEC] | Hardening | Low | Spoofable audit IP, presence-only OWASP pre-check, `/rnd/history` ungated, open staff directory, raw error text, 10 GB body limit, no token `typ`, logout cookie attributes, TOR sent by any CRM user | S | S-29…S-35, S-37, S-38 |
| C-65 | ERP | [BA] | Misleading UI | Low | Recycle bin promises a 10-day purge that doesn't exist; "Total Billed" is always ₹0. **Fix:** implement the purge or change the text; add a cost UI or hide the figure | S | P1-ERP-52/64, P2-ERP-20/29 |

---

## 3. Fix roadmap

### Now (this week, about 1 developer-week)

The goal: remove the takeover risk, the approval bypasses, and the bugs that stop work.

| Order | Item | Effort |
|---|---|---|
| 1 | **C-01** Spline LaTeX fix → deploy → **rotate `SECRET_KEY`, the Azure client secret and the DB password** (rotating the key signs everyone out once) | S |
| 2 | **C-02, C-03** Stop self-approval and status overrides in P2P | S |
| 3 | **C-08** ERP photo IDOR | S |
| 4 | **C-13** Model imports + guarded `feedback` migration, *before anyone runs autogenerate* | S |
| 5 | **C-11** Logout without an access token | S |
| 6 | **C-14** Notify on PO submit and approval | S |
| 7 | **C-16, C-17, C-18, C-19, C-20** The five blocking screen bugs | S each |
| 8 | **C-33, C-41** Production settings: `TRUSTED_PROXIES=127.0.0.1`, `SECURE_COOKIES=true`, `DOMAIN_EMAIL`, `environment=production`, no `TRUSTED_LOCAL_DEV`, docs disabled | S |
| 9 | **C-39, C-40** Upload AND-check; escape email values | S |

### Next (this month, about 3–4 developer-weeks)

The goal: make the financial, stock and access controls trustworthy, and give them an audit trail.

- **Controls:**
  - C-04: PO value and a proper 3-way match
  - C-05: finance maker-checker
  - C-09: store approvals
  - C-35: PM approvals
  - C-43: cancel cascade
- **Security:**
  - C-07: CSRF Origin check
  - C-10: leaver access
  - C-34: TOR document scope
  - C-37: match on `azure_id`
  - C-38: admin governance
  - C-42: JWT email binding
  - C-45: attachment privacy
- **Integrity:**
  - C-12: audit trail for Quality, Store and Organization, plus soft delete
  - C-21: GRN item link, location required, row lock
  - C-32: approval ids
  - C-44: concurrency
  - C-50: soft-delete filters
  - C-52: IST dates
- **Usability:**
  - C-15: approver access and notification links
  - C-24: reservation fix
  - C-25: clear-on-edit
  - C-26: pagination
  - C-30: ERP Raise PR
  - C-31: buyer table
  - C-55: error messages
  - C-56, C-57: dialogs and Back buttons

### Later (next quarter)

The goal: close the process gaps between modules and pay down structural debt.

- **Access model:** C-06 (a real server-side Permission Matrix, or remove the parts that aren't enforced).
- **Process:**
  - C-22: Quality ↔ GRN ↔ stock
  - C-23: store reversals
  - C-27: status state machines
  - C-28: CRM stages
  - C-29: CRM hand-off
  - C-58: PM closure
  - C-59: Quality closure rules
  - C-61: printable documents
  - C-54: joiner/mover/leaver flows
- **Data:**
  - C-47: schema reconciliation migration
  - C-48: FKs
  - C-49: Numeric money
  - C-51: file storage
  - C-53: valuation
  - C-62: numbering
  - C-63: retention
  - C-66: unknown tables
- **Platform:**
  - C-36: OAuth state, PKCE and multi-worker
  - C-46: service mailbox
  - C-60, C-64, C-65: cleanup
- **Process for the team:** add `pip-audit`/`npm audit` to CI (dependencies weren't assessed in this review). Add a test that every non-public route has an auth dependency (C-64 / S-30).

---

## 4. Quick wins (high impact, under a day each)

| ID | Why it matters | Where |
|---|---|---|
| C-01 | Removes the only system-takeover path | `rnd/tools/spline/api.py:25-37`; `services/pdf_service.py:61-72` |
| C-02 | Stops self-approval of requisitions | `p2p_requests.py:286-296,189-194`; `p2p/schemas/p2p_request.py:87-92` |
| C-03 | Stops skipping Director/MD sign-off | `p2p_requests.py:477-505`; `purchase_orders.py:127-160` |
| C-08 | Stops cross-user evidence deletion | `erp/routes/service_requests.py:880-896` |
| C-13 | Prevents an accidental `DROP TABLE` in the next migration | `alembic/env.py:18-102`; `a1c3e7f92b48_add_feedback.py:26` |
| C-16 | Unblocks every non-admin finance manager (one field) | `main/schemas/auth.py:20-30` |
| C-18 | Unblocks payments for banks created in the UI | `FE finance/masters/page.tsx:211,281-296` |
| C-19 | Unblocks supplier scorecards | `FE quality/supplier-quality/new/page.tsx:45-54` |
| C-20 | Unblocks service-request edits | `FE components/erp/ServiceRequestForm.tsx:173-180` |
| C-11 | Stops shared-PC sessions from surviving logout | `main/routes/auth.py:501-520` |
| C-14 | Approvers learn a PO is waiting | `p2p/routes/rfq.py:763-798`; `p2p_requests.py:564-594` |
| C-33 / C-41 | Settings only, no code | production `.env` |
| C-40 | Stops phishing through company emails | `utils/email.py:136,149,354,387,435,483` |
| C-39 | Stops executables being uploaded | `utils/sharepoint.py:150-155` |
| C-24 | Makes reservations usable | `store/services/stock_ledger.py:19,70-76` |

---

## 5. Notes on method and limits

- **Read-only.** No code was changed, no migration was run, and no exploit was executed. The only database access was a read-only `compare_metadata` run against the **local** dev database (session forced read-only). Production settings (`.env`) aren't in the repo, so the configuration-dependent findings (C-33, C-41, C-46) need checking on the server.
- **Evidence.** Every finding cites `file:line`. Anything marked "(inferred)" in the phase documents was reasoned from code and not reproduced. The headline findings in each phase were re-checked directly in the code before inclusion.
- **Not covered:**
  - dependency CVEs (A06);
  - penetration testing of the deployed site;
  - Azure and SharePoint tenant configuration (app permissions, conditional access);
  - performance under load;
  - the Teams app package.
- **Snapshot.** The review includes uncommitted work (the Permission Matrix tab enforcement and the "Procurement" rename). Findings about it describe the code as it stands on 2026-09-29.
