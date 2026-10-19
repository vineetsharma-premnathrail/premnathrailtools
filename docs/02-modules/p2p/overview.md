# Procurement (P2P) Module — Overview

**Module:** Procurement / Procure-to-Pay (app keys `p2p` and `purchase`)
**Backend Location:** `backend/app/modules/p2p/`
**Frontend Location:** `frontend/src/app/dashboard/p2p/` (GRN pages under `dashboard/store/grn/`)
**Prepared by:** Vineet Sharma
**Last refreshed:** 7 October 2026 (against the working tree, including the uncommitted MD → Partner rename and the Quality vendor-block hook)

---

# 1. Introduction

P2P is PremnathRail's **only** procurement pipeline. Every purchase starts as a **Purchase Requisition (PR)** — a `P2PRequest` row — and ends with goods in store and a matched vendor invoice in Accounts:

```
PR ─► PR approval ─► stock check ─► issue from stock / send to procurement ─► RFQ (L1–L4)
   ─► vendor quotations ─► [technical eval] ─► commercial eval ─► PO draft (L1 vendor)
   ─► PO approvers picked ─► PO approval ─► GRN + inspection ─► stock ─► invoice (3-way match) ─► close
```

**History you need to know:**
- The old `purchase` module (PRs raised only from a Service Request) and the old `vendor` module **have been removed from the backend**. Service-Request PRs are now ordinary `P2PRequest` rows (see §6), and the vendor master lives in Accounts (`accounts/models/vendor.py`). `docs/02-modules/purchase/overview.md` and `docs/02-modules/vendor/overview.md` describe code that no longer exists.
- On the Users page there is one **Procurement** module (`p2p`) with a **Purchase Team** option (`purchase`) — commit `82733fa`. `purchase` is an access level, not a separate module.

---

# 2. Roles

| Role | How someone gets it | What it allows |
|---|---|---|
| Requester | `p2p` app (Procurement) | Raise PRs, view own PRs, cancel own PR before PO, upload attachments to own PR |
| Purchase Team / buyer | `purchase` app (Procurement → Purchase Team) | See and process every PR: stock decisions (send to procurement), RFQ, quotations, evaluation, PO draft, PO approver picking, GRN, close, MIS |
| Auto-assigned buyer | Category → email map in `P2P_CATEGORY_AUTO_BUYERS` | Named buyer on the PR; receives stock-routing notices |
| PR approvers | Picked on the New PR form, one person per role (any active user) | Approve / reject that PR; being picked grants access to that PR even without the app |
| **Store Manager (per PR)** | The person picked in the PR's `store_manager` approval slot | **Only** person (besides admin) who can issue that PR's lines from store stock |
| PO approvers (named) | Picked on the **RFQ page** per role (`set-po-approvers`) | Approve / reject the PO for their role |
| Director | `is_director` user flag | One Director's approval is required on every matrix PO |
| Purchase Head / Director / Partner | `is_purchase_head` / `is_director` / `is_partner` flags | Legacy chain for pre-matrix PRs (`project_type` NULL) only |
| Admin | `role = admin` | Override PR approval (not on own PR), issue from stock, edit a locked RFQ, reject anything |

> **ERP why — separate requester and buyer.** The person who needs the material should not choose the vendor or the price; the buyer should not decide what the business needs. Splitting the PR (need) from the RFQ/PO (sourcing) is the core segregation of duties in every P2P process.

---

# 3. PR status machine

```
                    ┌──────────── reject (any assigned PR approver / admin) ───────────┐
submitted ── all PR approval slots signed ──► approved                                 ▼
    │                                           │  stock routing; lines decided     rejected
    │                                           │  (issue from stock / procurement)    ▲
    │                    every line issued ─────┼──► closed (auto)                     │
    │                                           │                                      │
    │                    RFQ submitted/locked   ▼                                      │
    │                                    vendor_quotations ──(RFQ needs tech eval)──► technical_evaluation
    │                                           │                                      │
    │                                           ▼                                      ▼
    │                                    commercial_evaluation ◄───────────────────────┘
    │                                           │  select a commercially approved quotation
    │                                           ▼
    │                                    vendor_selected
    │           (PO draft also allowed from vendor_quotations)
    │                                           ▼
    │                                     po_drafted ── submit (priced, approvers picked) ──► po_raised
    │                                                                                        │ reject (PO role / admin)
    │                                                     all PO roles + one Director signed ▼
    │                                                                                    po_approved
    │                                                                   GRN accepted < ordered │ GRN accepted = ordered
    │                                                                                  partially_received ─► received
    │                                                                                                          │ close (Purchase)
    └── cancel (requester / Purchase) from any state except po_raised, partially_received,                    ▼
        received, closed, rejected, cancelled ──► cancelled                                                  closed
```

Every transition is a dedicated endpoint that checks its starting state and returns **409** otherwise. `PATCH /p2p/requests/{id}` only edits header fields (project label, required date, requirement type, priority, remarks) and **400s if the payload names `status`, an approver slot or `project_type`**.

Each PR line also has its own **fulfilment status**: `pending` → `stock_issued` | `sent_to_procurement`, plus a stock snapshot `stock_status` = `in_stock` / `partial` / `not_in_stock` / `no_match`.

Number series (`service.py`, Postgres advisory lock per prefix): PR `P2P-<CAT>-YYYY-NNNN`, RFQ `RFQ-YYYY-NNNN`, PO `PO-YYYY-NNNN`, GRN `GRN-YYYY-NNNN`.

---

# 4. Raising and approving the PR

## 4.1 New PR form (`POST /p2p/requests`, needs `p2p`)

| Input | Rule | ERP why |
|---|---|---|
| Category | One of MKT, PNH, RAW, ELE, HWC, JOB, OTH; goes into the PR number; auto-assigns the buyer by email (OTH has none) | Category-wise buyer ownership |
| Project | Required (existing ERP project picked, or a new project's name) | Every spend must be traceable to a cost object |
| Project type | `existing` or `new` — picks the approval role set | Different people own existing-machine vs new-development spend |
| PR approvers | **All** roles of the set are mandatory, one active user each | Accountable sign-off per function |
| Lines | At least one; each line must say **Project** or **Inhouse**; UOM from the Store UOM master | Store issue and reporting split on Project/Inhouse; unit must match store stock |
| Required date, requirement type, priority, remarks, attachments (supporting / specification / po_document) | Optional | |

PR approval role sets (`PR_APPROVAL_ROLE_SETS`):

| Project type | PR approvers (all must sign) |
|---|---|
| existing | Design Manager, Production Manager, Project Manager, **Store Manager** |
| new | R&D Manager, Production Manager, **Store Manager** |

On creation the system takes an **automatic store-stock snapshot** per line (matched to the Item Master by name, and part code when given; available = on hand − reserved, summed across all warehouses) so approvers see what is already in store before they sign.

**Pre-fill entry points:** Maintenance → Spares "Raise PR" (one item via query string) or "Raise PR for selected" (several items via `sessionStorage['p2p_new_prefill']`, opened as `/dashboard/p2p/new?prefill=session`); Store/Production low-stock links use the query-string form. Pre-filled lines default to Inhouse. Nothing is submitted until the requester reviews and clicks Submit.

## 4.2 PR approval (`POST /p2p/requests/{id}/approve`)

- Only from `submitted`. **A comment is mandatory** (also for admin override) and is stored on the approval trail.
- A user holding several slots on the same PR signs all of them in one click.
- **Self-approval is allowed by business decision (2026-09-30, "user self select kar sake"):** a requester may pick themselves for a slot and sign it. This deliberately waives the PR-level four-eyes control. It does *not* extend to legacy PRs with no assigned approvers, and the admin override never applies to the admin's own PR.
- When the last slot is signed: status → `approved`, stock is **re-checked** and lines are **auto-routed** (§5), the requester gets a bell notice, the buyer gets the stock-routing result.
- Reject: any assigned approver (approved or not) or admin; reason stored; requester notified.

> **ERP why — mandatory approval comment.** An approval with no reasoning can't be audited later ("why did we buy this?"). The comment is the approver's recorded justification.

---

# 5. Stock check and partial split

```
PR approved
  └─ re-check every pending line against store stock
       ├─ not_in_stock / no_match ─► sent_to_procurement (automatic)
       ├─ in_stock                 ─► waits for the Store Manager to Issue from Stock
       └─ partial                  ─► Store Manager issues what's there; shortfall → procurement
```

- **Stock check** (`GET …/items/{item_id}/stock-check`): Purchase Team or the PR's Store Manager. Returns the Ship To store (if it matches a store name/code), the total, and **every warehouse with available stock, fullest first** (`3503b7b`) so a blank or unknown Ship To doesn't force a purchase. The PR page runs it automatically for undecided lines (`acf8777`).
- **Issue from stock** (`POST …/items/{item_id}/issue-from-stock`): **only the Store Manager named on the PR, or an admin** (`2be2bfb`, replacing the earlier `is_store_manager`-flag rule from `1dd17f5`). Comment mandatory. Locks the PR line (no double issue). Creates a Store Material Issue (`MI-…`, `p2p_request_id` set) and posts an `issue` from the chosen warehouse (Free stock only, reservation-aware). Quantity ≤ requested.
  - **Partial issue splits the line** (`02c39e4`): issued qty is recorded, the line becomes `sent_to_procurement`, and the PO draft orders `quantity − issued_qty`.
  - If every line ends up `stock_issued`, the PR **closes automatically** — nothing left to buy.
  - The Purchase Team sees "Waiting for the Store Manager" instead of an Issue button.
- **Send to procurement** (`…/send-to-procurement`, Purchase Team): confirm a pending line must be bought.
- **RFQ gate** (`acf8777`): an RFQ can't be raised while any line is still `pending`, nor when nothing was sent to procurement.

> **ERP why — check stock before buying.** Buying what is already on the shelf ties up cash and creates dead stock. SAP's MRP nets requirements against available stock for the same reason. Using *available* (on hand − reserved) avoids promising stock already earmarked for another job, and Quality/Blocked stock is never counted (Store stock types).

---

# 6. PRs from Service (Service Requests) — no PR approval

`POST /erp/service-requests/{sr_id}/raise-pr` (ERP app; only the SR creator with edit permission, or admin) — commit `2da327c`:

- The SR Materials tab uses the same fields as the New PR form (category, required date, requirement type defaulting to Service, item table with Project/Inhouse, priority, remarks, documents) **minus project and approvers**. Project label comes from the SR's machine.
- The PR is created **already `approved`** (`approved_by` = the raiser), `project_type = existing`, buyer auto-assigned by category (default OTH → no buyer).
- Stock routing (§5) runs immediately; the buyer gets the result. All Procurement users get a "New Purchase Requisition" bell notice, and Purchase gets an email.
- SR-side helpers for users without `p2p`: `GET /erp/service-requests/pr-form-meta`, `POST …/raise-pr/{pr_id}/attachments`.
- SR materials keep `pr_id` / `pr_number` / `pr_status` (mirrored on read).

> **ERP why — skipping PR approval for Service.** A breakdown at a customer site is time-critical and the material need is already defined by the service job. Control moves to the PO stage, which still needs full PO approval.

---

# 7. RFQ, quotations and vendor selection (`routes/rfq.py`, Purchase Team)

```
create RFQ (PR approved, all lines decided) ─► draft ─ attach quotations L1..L4 + terms ─► submit ─► locked
                                                                                            PR → vendor_quotations
```

- **Vendors are tiers L1–L4** (`d020993`): L1 is the lowest quote. Each tier's attachment carries vendor name and contact.
- **Submit rules:** an L1 attachment is mandatory; if only L1 is attached it is a **single-quotation RFQ** and needs a reason *and* comments; payment terms, delivery lead time and late-delivery clause are mandatory. Submitting locks the RFQ (only admin can edit it afterwards) and moves the PR to `vendor_quotations`.
- A second "create" on the same PR returns the existing draft instead of a duplicate.
- **Structured quotations** (`VendorQuotation`): price, delivery, payment terms per vendor; comparison view is a read-only list.
- **Technical evaluation** (only if `requires_technical_evaluation`): every quotation qualified/disqualified, at least one qualified.
- **Commercial evaluation:** approved/rejected; only technically qualified ones when tech eval applies.
- **Select vendor:** only a commercially approved quotation → PR `vendor_selected`.

> **ERP why — three quotes and a written reason for one.** Competitive quotations are the basic control against overpricing and favouritism; a single-source purchase is allowed but must be justified in writing so an auditor can see why. Fixing commercial terms (payment, lead time, LD clause) before the PO means the PO can't quietly drop them.

---

# 8. Purchase Order

## 8.1 PO draft (`POST /p2p/rfqs/{rfq_id}/po-draft`)

- From `vendor_quotations` or `vendor_selected`.
- **Vendor:** the selected quotation's vendor if one was selected; otherwise **always the L1 vendor** from the RFQ attachments (`d020993` — the vendor field is read-only in the UI and forced by the backend). A typed vendor name is only used when no L1 vendor name exists.
- PO number auto (`PO-YYYY-NNNN`) unless one is typed (must be unique).
- Lines default to the PR's procurable lines at **`quantity − issued_qty`**; stock-issued lines are excluded so nothing is fulfilled twice.
- **Quality vendor block:** `ensure_po_allowed` refuses a PO if the vendor is **Blocked** on Quality's approved-vendor list for any of the items (unblocking needs a Partner, Quality → Supplier Quality).
- PR → `po_drafted`. Draft lines are priced by `PATCH …/po-draft/{po_id}`; `total_value` = Σ qty × unit price × (1 + tax %) and stays null while any line is unpriced.
- **PO document:** one upload while draft, then permanently locked (no replace/delete route).

## 8.2 PO approvers are picked on the RFQ page (`POST /p2p/requests/{id}/set-po-approvers`)

Commits `8ef99ea`, `2931985`: PO approvers are **not** chosen on the New PR form any more. The Purchase Team picks one person per role on the RFQ page, any time from `approved` to `po_drafted`, once the vendor and value are known. Re-saving replaces the earlier picks.

| Project type | Picked per PR | Plus |
|---|---|---|
| existing | Production Manager, Purchase Manager, Project Manager | any one **Director** |
| new | R&D Manager, Purchase Manager, Production Manager | any one **Director** |

## 8.3 Send for approval (`POST …/po-draft/{po_id}/submit`)

Refused unless: the PO has lines, **every line has a unit price > 0**, and **every picked role has a person**. Then PO → `issued`, PR → `po_raised`, value/date/expected delivery copied to the PR, and every approver (picked people + every Director) gets a bell + **Teams** notice and an email with the PO (`fe5f095`).

## 8.4 PO approval (`POST /p2p/requests/{id}/approve-po`)

- From `po_raised` only; PR row locked (two approvers clicking together can't race). **Comment mandatory.**
- **Matrix PRs:** **each picked role must approve, and one Director must approve.** A picked person stamps their own row; a Director (not picked) stamps the Director slot. When nothing is pending → `po_approved`, requester notified.
- Anyone holding a PO slot may approve, **including the person who raised the PR or the PO** (`9f16c11`).
- **Legacy PRs** (`project_type` NULL): Purchase Head, Director and **Partner** must each stamp their slot. (The MD role was removed; Partners are the top approval — renamed in the working tree.)
- Reject (`/reject` while `po_raised`): any holder of one of the PR's PO roles, or admin.
- When approval is unavailable the UI explains why instead of hiding the button (`e2e6bd5`).

> **ERP why — priced PO before approval.** Approvers sign a commitment of money. An unpriced PO means they approve an unknown amount, and the invoice match would then have nothing to compare against (ERP review C-04). The Director sign-off is the final commercial authority on every PO.

## 8.5 Other PO endpoints

- `GET /p2p/purchase-orders`, `GET /{id}`: Purchase Team list/detail.
- `PATCH /p2p/purchase-orders/{id}`: **only** expected delivery and delivery terms; any other key → 400. Ad-hoc `POST /p2p/purchase-orders` (a PO with no PR) was removed.
- Legacy direct path still exposed: `POST /p2p/requests/{id}/create-po` (from `approved`, priced lines required, Quality vendor block applied) plus `request-quotations`, `select-vendor`, `assign-buyer`. See §12.

PO status: `draft → issued → partially_fulfilled → fulfilled` (`acknowledged` and `cancelled` exist in the vocabulary but no endpoint sets them).

---

# 9. Goods Receipt (GRN) — `routes/goods_receipts.py`

```
PO approved ─► GRN (draft) ── lines needing inspection ─► Quality lot (Quality stock)
                    │                                            └─ lot decision writes accept/reject back
                    └─ other lines ─► store inspection (accept/reject split) ─► receipt → Free stock
                                   all lines decided ─► GRN completed ─► PO / PR receipt status rolled up
```

- **Gate:** the PO must be `issued` / `acknowledged` / `partially_fulfilled` **and** its PR must have finished PO approval (`po_approved` / `partially_received`, no pending roles). A PO with no PR can't be received.
- **GRN list tabs** (`f6e4aaa`): Upcoming (approved POs awaiting delivery, pending qty per vendor), Pending Inspection, Completed, All. `GET /pending-purchase-orders` feeds the picker.
- **Create:** PO row locked; received qty > 0 and never more than still outstanding (PO qty − accepted on completed GRNs − received on draft GRNs). Line snapshots item name, unit, ordered qty.
- **Short-receipt tracking:** the GRN form shows Already Received / Pending per line. If anything is still owed, an audit entry *"GRN … received less than ordered … Pending from <vendor>: …"* is written and the PO creator gets a "Short Supply" bell notice. The PO stays open for the balance.
- **Quality on receipt:** items flagged `inspection_on_receipt` go to **Quality stock** (`quality_in`) with an incoming inspection lot (or a First Article lot); the GRN must name a store for these. Their accept/reject split comes only from the lot's usage decision (`apply_quality_decision`), which also completes the GRN when nothing is waiting.
- **Store inspection** (`POST /{id}/inspect`): GRN row locked (no double stock post); each line Passed / Failed / Partial; **accepted + rejected must equal received**; Passed has no rejected qty, Failed no accepted qty, Partial needs both. Accepted qty posts `receipt` into the GRN's store, matched to the Item Master by name.
- **Roll-up:** accepted totals set the PO to `partially_fulfilled` / `fulfilled` and the PR to `partially_received` / `received`. Rejected qty is not "used up" — the vendor still owes it.
- **Close:** Purchase Team closes a `received` PR; requester notified.

> **ERP why — receive only against an approved PO, never more than ordered.** Otherwise goods (and later an invoice) can enter the books without anyone authorising the spend. Splitting accepted/rejected at receipt is what lets the invoice match pay only for good material.

---

# 10. Invoice and 3-way match (Accounts — `accounts/service.py: check_three_way_match`)

**Hard stops** (no override): PO not linked to a PR; PO approval not finished; nothing accepted on a GRN yet; this invoice would take the **cumulative invoiced amount past the approved PO value** (pre-GST, +1% tolerance).

**Variance** (needs a Finance Manager who is not the invoice creator): invoice qty vs accepted-but-not-yet-invoiced qty outside **2%**; invoice amount vs (accepted qty × PO unit price − already invoiced) outside **1%**; or a legacy PO with unpriced lines. Otherwise `matched`.

> **ERP why — 3-way match.** PO (what we agreed to pay) × GRN (what we accepted) × invoice (what the vendor claims). Paying only when all three agree stops paying for goods never received, rejected, or priced above the PO — and netting earlier invoices stops the same receipt being paid twice.

---

# 11. Notifications

Rule (commit `20d441d`): **Teams only for approval requests and reminders**; everything else is bell-only. Create/update/delete types are suppressed (`19d537d`).

| Event | To | Channel |
|---|---|---|
| PR raised — awaiting your review | Each PR approver (once per person) | Bell + **Teams** + email |
| PR approved / rejected | Requester | Bell |
| PR approved — stock check result | Assigned buyer | Bell |
| Item issued from stock | Requester | Bell |
| Buyer assigned (legacy) | Buyer | Bell |
| PO raised | Requester | Bell (legacy `create-po` path only) |
| PO awaiting approval | Picked PO approvers + every Director (legacy: holders of pending flags) | Bell + **Teams** + email |
| PO fully approved | Requester | Bell |
| GRN recorded / short supply | PO creator | Bell |
| PR closed | Requester | Bell |
| Service PR raised | All Procurement users | Bell broadcast + email to Purchase |

No P2P reminders (overdue approvals, late deliveries) are scheduled yet. Approving one PO role does not notify the remaining approvers — they were all notified at submit.

---

# 12. Settings and hard-coded configuration

There is no P2P settings screen; these live in code:

| What | Where |
|---|---|
| Categories and PR number codes | `P2P_CATEGORIES` (`models/p2p_request.py`) |
| Auto-buyer per category (by email) | `P2P_CATEGORY_AUTO_BUYERS` — OTH has no buyer |
| PR and PO approval role sets | `PR_APPROVAL_ROLE_SETS`, `PO_APPROVAL_ROLE_SETS`, `PO_PICKED_ROLE_SETS` |
| Requirement types, priorities | `P2P_REQUIREMENT_TYPES`, `P2P_REQUEST_PRIORITIES` |
| RFQ vendor tiers | `RFQ_VENDOR_TIERS = L1..L4` |
| 3-way-match tolerances | `QTY_TOLERANCE_PCT = 2.0`, `AMOUNT_TOLERANCE_PCT = 1.0` (`accounts/service.py`) |
| UOM list | Store UOM master (shared) |
| Approver role flags on users | Users page (Director, Store Manager, Purchase Head, Partner — Partner set only in Company Info → Partners) |

MIS: `GET /p2p/mis/summary` and `GET /p2p/mis/export` (Excel), for the Purchase Team, PO-approver flag holders and admins.

---

# 13. Known gaps and open controls

Verified against the code on 7 October 2026. IDs from `docs/erp-review/05-summary-and-roadmap.md`.

| ID | Control | Status in code | Detail |
|---|---|---|---|
| **C-02** | No self-approval of PRs | **Consciously waived / partly open** | All role slots are now mandatory ✅. But the requester may pick and sign their own slot (business decision 2026-09-30), approvers need not hold the matching role flag, and one user clears all their slots in one click. Service PRs skip PR approval entirely. **2026-10-07:** the owner reviewed requester self-pick again and left it **undecided** — behaviour is unchanged until a decision is taken. |
| **C-03** | No status overrides | **Closed** | PR and PO PATCH reject `status`/approver keys; the PR-less ad-hoc PO route is gone; GRN and invoice both re-check that PO approval actually finished. |
| **C-04** | Priced PO + real 3-way match | **Closed** | Unit price > 0 on every line before submit (both PO paths); value derived from lines; match on accepted qty × PO price, net of earlier invoices; hard cap at PO value; approval check. Residual: GRN/PO lines are matched to items by name (C-21). |
| C-14 | Notify PO approvers | Closed | Submit notifies (bell + Teams + email). |
| C-15 | Access mismatch | Partly open | GRN pages are gated on `store` but the GRN API needs `purchase`, so a receiver needs both. |
| C-21 | GRN stock integrity | Partly open | Name-text matching to the Item Master; a GRN with no store completes without posting stock (unless an item needs inspection); double-post fixed. |
| C-30 | SR → PR integration | Partly open | SR PRs now use the P2P form and stock routing, but default to OTH (no buyer) and skip PR approval by design. |
| C-31 | Hard-coded buyers | Open | Email map in code; no active-user check; no buyer for OTH. |
| C-32 | Approval identity | Partly closed | Matrix PO approvals store `approved_by_id` (picked rows) and `director_po_approved_by_id`; legacy chain stores names only; approvals live on the PR, not the PO. |
| C-43 | Cancel cascade | Partly open | Cancel is still allowed from `po_drafted` and `po_approved`; the PO stays `issued`. GRN and invoice are then blocked by the PR status check, but the PO is never marked cancelled. |
| C-44 | Concurrency | Partly open | `approve-po` and `create-po` lock the PR; PR `approve` does not; PO draft creation has no lock (status check only). |
| — | Service PRs and issue-from-stock | **Gap** | Service PRs have no PR approval rows, so **no Store Manager slot** — only an admin can issue their lines from stock. |
| — | Legacy `create-po` path | Gap | Still exposed: raises a PO straight from `approved`, skipping RFQ, line decisions and PO approver picks. On a matrix PR with no picked approvers the picked roles stay pending forever (nobody can sign them). |
| — | PO approval SoD | Gap | Raiser of the PR or PO may approve the PO (`9f16c11`), so with self-picked approvers one person can carry a PO through all but the Director slot. |
| — | Vendor master link | Gap | RFQ/PO vendors are free text; `vendor_id` has no FK to `accounts.vendors`; the Quality block matches by normalised name. |
| — | Plant access | Gap | Issue-from-stock and GRN receiving ignore Store Plant Access. |
| — | Reminders | Gap | No scheduled reminders for pending PR/PO approvals or overdue deliveries. |

---

# 14. Contradictions in code comments (for the next code change)

- `P2PRequestCreate` schema comment says approvers *"none may be the requester, and each user must hold the role flag"*; `resolve_pr_approvers` allows both.
- `resolve_pr_approvers` docstring says *"the requester and the PO's creator can never approve the PO"*; `approve_po` has no such check (removed in `9f16c11`).
- `PR_APPROVAL_ROLE_SETS` comment and `submit_po_draft` docstring say *"any one approval approves the PO"*; `approve_po` / `pending_po_approval_roles` require **every** picked role plus one Director (since `8ef99ea`). Commit `2be2bfb` also says "any one approves" — superseded.
- `P2PRequest` model comment on the three head columns says *"each optional"*; matrix PRs make every slot mandatory.
- `create_po_draft` / `submit_po_draft` / GRN docstrings still describe the "Purchase Head → Director → Partner chain" as *the* PO chain; it applies only to legacy PRs.
- `P2PGoodsReceipt.store_location_id` comment says Store "has no stock ledger yet"; it does.

---

# 15. Related documentation

- [Store Overview](../store/overview.md) — stock types, ledger, material issues, Store Manager issue from stock.
- [Service & Commissioning Overview](../service-commissioning/overview.md) — the SR Materials tab that raises PRs.
- [Maintenance Overview](../maintenance/overview.md) — spares below minimum → Raise PR.
- `docs/02-modules/finance/` — vendor master, AP invoice and 3-way match.
- `docs/erp-review/` — the ERP review referenced in §13.
- Superseded: `docs/02-modules/purchase/overview.md`, `docs/02-modules/vendor/overview.md` (modules removed).
