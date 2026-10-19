# SAP T-Codes vs Premnath ERP — Coverage Check

Your SAP reference list, checked line by line against our ERP code as it stands on **11-Oct-2026**.
Every mark comes from reading the actual models, routes and pages — not from plans or docs.

**How to read the marks**

| Mark | Meaning |
|---|---|
| ✅ | We already do this (data model + server + screen all exist) |
| 🟡 | We do part of it — see the note for what is missing |
| ❌ | Not built, and we **should** build it |
| ➖ | Not built, and we **should not** copy it from SAP (not useful for a company our size / our business) |

Each section ends with three short lists:
- **Do** — what to build next, in this area
- **Don't** — what SAP has that we should skip
- **Wrong now** — what we are doing incorrectly today and should fix

> SAP T-codes are just "screens". What matters is the **business object** behind them (document, master, posting) and how it links to the next step. That is what this check looks at.

---

## Quick summary

| SAP area | Our coverage | One-line verdict |
|---|---|---|
| FI — Financial Accounting | 🟢 Strong | GL, AP, AR, GST, bank, period close, assets all correct. Missing: TDS, multi-currency, payment run. |
| CO — Controlling | 🔴 Weak | Only cost centers (basic) and internal orders (not usable in postings). |
| MM / P2P | 🟢 Good | Full chain PR → PO → GRN → Invoice → Payment with 3-way match. Lines not linked to Item Master. |
| WM / EWM | 🟡 Basic | Locations + bins exist, but stock is not tracked per bin. Fine for now. |
| PP — Production | 🟢 Good on shop floor | BOM, routing, work orders, issue, FG receipt. No real MRP. |
| PLM — Engineering | 🟢 Strong | Drawings with revisions, BOM revisions, ECR → ECN. Not connected to Production BOM. |
| SD — Sales | 🔴 Broken links | Order + amendment are strong, but delivery and billing are **not connected** to the order. |
| CRM | 🟡 Good | Customers, inquiries, tenders, activities. Three product masters. |
| Service | 🟡 Partial | Service requests work, but spares don't reduce stock and service bill never reaches Finance. |
| QM — Quality | 🟢 Very strong | Lots, AQL, usage decision, NCR, CAPA, FAI, supplier quality. Missing: gauge calibration. |
| PM — Plant Maintenance | 🟢 Good | Assets, breakdowns, work orders, time-based PM. Missing: meter readings. |
| PS — Projects | 🟡 By choice | Project + tasks only. Costing deferred (your decision). |
| HCM — HR | 🟡 Good core | Employee, lifecycle, attendance, leave. Payroll in ADP (your decision). |
| EHS — Safety | 🔴 None | No incident / accident register. |
| Basis | 🟡 Basic | Scheduler, logs, sessions exist; no job history, no record locking. |
| Security & GRC | 🟢 Strong | SSO, roles, deny-by-default, approval engine, audit log. Some audit gaps. |

---

## 1. FI — Financial Accounting

GL, AP, AR, assets, payments, closing and reporting.

**What we do right (keep it this way):** every posting goes through one engine that refuses unbalanced entries; posted documents are never edited or deleted — only reversed; periods and financial years lock; voucher numbers run per type per FY (`JV/2026-27/0001`); maker-checker on journals and invoices; posted invoices are corrected only by debit/credit notes.

| Code | Area | Work / Meaning | ERP | What we have / note |
|---|---|---|---|---|
| FB50 | G/L posting | Enter G/L document | ✅ | Journal Entry: draft → submit → approve → post (Finance › Ledger) |
| FB01 | Accounting document | Post accounting document | ✅ | Same journal engine |
| F-02 | G/L posting | General G/L posting | ✅ | Same journal engine |
| FB03 | Display | Display accounting document | ✅ | Standalone voucher screen (Journals › Open voucher no., or click a voucher no. in Day Book / Ledger Statement): header, lines, source document, reversal pair, full history |
| FB02 | Change | Change permitted document fields | ✅ | Voucher screen › Change: narration + line remarks only, each change logged old → new. Ledger, amount, party, cost centre, date → reversal. E-invoice / e-way bill fields on the sales invoice |
| FBL3N | G/L line items | Display G/L line items | ✅ | GL ledger report + day book. Cannot filter by cost center |
| FS00 | G/L master | Create/change/display G/L account | ✅ | Chart of accounts + groups. **See "Wrong now" #1** |
| FB60 | Vendor invoice | Enter vendor invoice | ✅ | Purchase invoice with 3-way match and variance approval |
| FB65 | Vendor credit memo | Enter vendor credit memo | ✅ | Debit note |
| FBL1N | Vendor line items | Display vendor items | ✅ | Party statement, open bills, AP ageing |
| F-53 | Vendor payment | Post outgoing payment | ✅ | Payment voucher; you cannot pay a bill you booked yourself. No approval step (see "Do") |
| F110 | Automatic payment | Run payment program | ❌ | No payment proposal / batch / bank file |
| F-44 | Vendor clearing | Clear vendor items | ✅ | Bill-wise "against reference" allocation |
| FB70 | Customer invoice | Enter customer invoice | ✅ | Sales invoice (AR). **Not linked to Sales Order — see SD** |
| FB75 | Customer credit memo | Enter customer credit memo | ✅ | Credit note |
| FBL5N | Customer line items | Display customer items | ✅ | Party statement, AR ageing |
| F-28 | Customer payment | Post incoming payment | ✅ | Receipt voucher / collect |
| F-32 | Customer clearing | Clear customer items | ✅ | Same allocation engine |
| F-03 | G/L clearing | Clear G/L items | ➖ | Not needed — bill-wise allocation covers parties; bank reco covers bank |
| F.13 | Automatic clearing | Automatic clearing | ➖ | Not needed at our volume |
| AS01/02/03 | Asset | Create/change/display asset | ✅ | Fixed asset register; only descriptive fields editable after creation |
| ABZON | Asset acquisition | Post acquisition | 🟡 | Asset links to purchase invoice, but registering the asset posts nothing — cost can differ from invoice |
| ABUMN | Asset transfer | Transfer asset | ❌ | No transfer between cost centers / locations with a record |
| ABAVN | Asset retirement | Retire asset | 🟡 | Full disposal with gain/loss entry; no partial retirement |
| AFAB | Depreciation | Execute depreciation | ✅ | Monthly run: preview → post → reverse, SLM / WDV, one run per period |
| AW01N | Asset Explorer | Review asset values | 🟡 | Asset list + run list; no per-asset value history screen |
| F.01 | Financial statements | Financial statement report | ✅ | Trial balance, P&L, Balance Sheet, Cash Flow, monthly pack |
| FS10N | G/L balance | Display G/L balance | ✅ | Trial balance + ledger |
| FAGLL03 | G/L line items | Display G/L line items | ✅ | Same as FBL3N |
| OB52 | Posting periods | Maintain posting periods | ✅ | Period close; reopen is admin-only with a reason |
| FBRA | Reset clearing | Reset cleared items | 🟡 | Works, but deletes the allocation row (see "Wrong now" #3) |
| F.07 | Balance carryforward | Carry balances forward | ✅ | Year-end close: P&L → Retained Earnings, FY locked |
| F.05 | FX valuation | Foreign currency valuation | ❌ / ➖ | No multi-currency at all. Build **only if** we import or export in foreign currency |

**Indian statutory (not in your list, but needed):**

| Item | ERP | Note |
|---|---|---|
| GST (GSTR-1, GSTR-3B, set-off, reverse charge, HSN) | ✅ | Complete |
| E-invoice / e-way bill | 🟡 | Fields captured by hand (your decision: fields only, no portal API) |
| TDS | ➖ | Your decision: no TDS. Re-check with the CA if vendor payments cross limits |

**Do**
1. Add an approval step for payment vouchers above a limit (today they post immediately).
2. Asset acquisition should post from the purchase invoice, so asset cost = invoice value.
3. Asset transfer with a record (from / to cost center, date).
4. ~~Standalone "view voucher" screen (FB03) — useful for auditors.~~ Done 2026-10-12.

**Don't**
- F-03 / F.13 GL clearing, F110 bank payment files (until volume demands it), F.05 unless foreign currency trade starts.

**Wrong now**
1. GL account **code, posting/control flags and currency can be changed after postings exist**, and the change is not audit-logged. Lock these once the account has entries.
2. Audit log not written for changes to GL accounts, vendors, bank accounts, internal orders.
3. "Reset clearing" hard-deletes the allocation. Keep the row and mark it reversed, so history survives.

---

## 2. CO — Controlling

Cost centers, internal orders, allocations, product costing, profit centers and profitability.

| Code | Area | Work / Meaning | ERP | What we have / note |
|---|---|---|---|---|
| KS01/02/03 | Cost center | Create/change/display | 🟡 | Exists under Organization › Plants, not under Finance. No hierarchy |
| KSB1 | Actuals | Cost center line items | ❌ | Cost center is stored on postings but no report shows them |
| KSB5 | Documents | Cost center documents | ❌ | Same |
| KP06 | Planning | Cost center planning | 🟡 | One annual budget number per cost center; no month / GL split |
| KP26 | Activity planning | Activity type planning | ➖ | Too heavy for us |
| KB11N | Allocation | Manual allocation | ➖ | A normal journal entry with cost center is enough |
| KB15N | Allocation | Manual allocation/posting | ➖ | Same |
| KSV5 | Assessment | Execute assessment | ➖ | Overhead spreading — skip |
| KSU5 | Distribution | Execute distribution | ➖ | Skip |
| KA01/02/03 | Cost element | Create/change/display | ➖ | S/4HANA itself merged cost elements into GL accounts. Our GL accounts already play this role — correct |
| KO01/02/03 | Internal order | Create/change/display | 🟡 | Master exists with budget vs actual, **but no screen lets you put an internal order on a posting** |
| KOB1 | Actuals | Internal order line items | ❌ | No report |
| KO88 | Settlement | Settle internal order | ➖ | Skip |
| KE51/52/53 | Profit center | Create/change/display | ❌ / ➖ | Only a text field. Build only if management wants P&L per plant / business line |
| KE5Z | Line items | Profit center line items | ❌ / ➖ | Same |
| KE30 | CO-PA | Profitability report | 🟡 → ❌ | No CO-PA. But a simple **margin per Sales Order / per machine** report is very useful (see "Do") |
| KE24 | CO-PA | Line items | ➖ | Skip |
| CK11N | Product costing | Cost estimate | 🟡 | BOM standard cost (material + labour) is calculated in Production |
| CK13N | Cost estimate | Display | 🟡 | Same |
| CK40N | Product costing | Cost planning | ➖ | Skip |
| CK24 | Standard cost | Mark/release | ➖ | We use moving average, not standard price — skip |
| KGI2 / KGI4 | Overhead | Actual overhead / calculation | ➖ | Skip |

**Do**
1. Cost-center line item report (KSB1) — the data is already on postings; only the report is missing.
2. Make internal orders usable: pick one on journal / invoice lines, and **block postings to closed orders or inactive cost centers** (the code says it blocks, but it doesn't).
3. A simple **profitability per Sales Order / machine**: revenue from AR invoices − material issued − labour from work orders. This is the 20 % of CO-PA that gives 80 % of the value.

**Don't**
- Activity types, assessment, distribution, overhead sheets, settlement, CK40N/CK24 standard-cost release. These need a full-time controller to maintain.

**Wrong now**
1. Internal orders show "budget vs actual" but nothing can post to them from the UI — actual is always zero.
2. Cost center budget is stored as `Float` while all accounting uses exact money type. Change to money type.

---

## 3. MM — Materials Management / Procurement

Material master, purchasing, suppliers, goods movements, stock and invoice receipt.

| Code | Area | Work / Meaning | ERP | What we have / note |
|---|---|---|---|---|
| MM01/02/03 | Material master | Create/change/display | ✅ | Store › Item Master (rich fields; delete blocked once used) |
| MM17 | Mass change | Mass material changes | 🟡 | CSV import creates new items only; existing items are skipped |
| ME51N/52N/53N | PR | Create/change/display PR | ✅ | P2P request. **Lines are free text, not linked to Item Master** |
| ME54N | PR release | Approve/release | ✅ | Approvers fixed in Settings |
| ME41/42/43 | RFQ | Create/change/display | ✅ | One RFQ per PR, up to 4 vendor quotes |
| ME47 | Quotation | Maintain vendor quotation | 🟡 | Only a total price per vendor, not price per item line |
| ME49 | Comparison | Compare quotations | 🟡 | Technical + commercial evaluation exists; no line-by-line price comparison |
| ME21N | PO | Create purchase order | ✅ | From RFQ only |
| ME22N | PO | Change | 🟡 | **No amendment / version flow, no cancel** (see "Wrong now") |
| ME23N | PO | Display | ✅ | |
| ME28 | PO release | Approve/release | ✅ | Purchase Head → Director → Partner |
| MIGO | Goods movement | GR / GI / transfer | ✅ | GRN (with quality inspection), material issue, warehouse transfer (2-step) |
| MB51 | Material documents | List documents | ✅ | Stock movement ledger (append-only) |
| MB52 | Stock | Stock overview | ✅ | Free / quality / blocked stock per item per location |
| MI01 | Inventory | Create physical inventory document | 🟡 | Only stock adjustment with maker-checker |
| MI04 | Inventory count | Enter count | 🟡 | Same — no count sheet / freeze / recount |
| MI07 | Inventory differences | Post differences | ✅ | Adjustment posts the difference after approval |
| MIRO | Invoice | Enter vendor invoice | ✅ | Purchase invoice with 3-way match (Finance) |
| MR8M | Invoice reversal | Cancel invoice | 🟡 | Only before posting; after posting use a debit note (acceptable) |
| ME2N | PO list | By PO number | ✅ | |
| ME2L | PO list | By vendor | 🟡 | No vendor filter on the PO list |
| ME2M | PO list | By material | ❌ | Impossible today — PO lines are not linked to items |
| ME5A | PR list | PR list | ✅ | With approval-queue filters |
| ME80FN | Purchasing report | Purchasing reporting | 🟡 | Fixed P2P MIS views + export |

**Also checked**

| Item | ERP | Note |
|---|---|---|
| Short receipt | ✅ | Recorded, notified, PO stays partly fulfilled |
| Quality inspection at GRN | ✅ | Goods go to quality stock → usage decision moves to free / blocked |
| Stock reservation | ✅ | Available = on hand − reserved |
| Issue to production / projects | ✅ | |
| Return to vendor | 🟡 | Only via NCR / quarantine disposition — no return document, no automatic debit note |
| Batch / serial numbers | 🟡 | Flags exist; batch is free text; no serial tracking |
| Reorder level → PR | ❌ | Reorder / safety stock fields exist but nothing uses them |
| Rate contracts with vendors | ❌ | |

**Do**
1. **Link PR / PO / GRN lines to the Item Master** (item id, not name). This unlocks ME2M, correct stock posting, purchase history per item and price history.
2. PO amendment with version + re-approval, and PO cancel.
3. Vendor return document linked to the GRN, which raises the debit note automatically.
4. Reorder suggestions: items below reorder level → one click "Create PR".
5. Physical inventory count sheet (freeze → count → recount → post), at least yearly.
6. Line-level prices in vendor quotations, so comparison is per item.

**Don't**
- MM17 full mass-change tooling — an "update existing on import" option is enough.

**Wrong now**
1. **GRN finds the item by exact name.** If the name differs slightly, stock is silently not posted (only a note is shown).
2. **GRN stock is valued at the current average, not at the PO price.** Your stock value is wrong after every price change. Pass the PO rate as unit cost.
3. A PO is marked **"issued" before it is approved**. The GRN is blocked correctly, but the status misleads users. Use "pending approval".
4. The 3-way-match error tells users to "amend and re-approve the PO", but there is no amendment route.
5. Store Manager can post a manual receipt / issue with no PO or GRN. It is logged, but it bypasses P2P — restrict to admin, or remove after go-live.
6. No GRN reversal (SAP movement 102). A wrong GRN can't be undone with a record.

---

## 4. P2P — Procure-to-Pay

| Step | ERP | Note |
|---|---|---|
| Requirement → PR | ✅ | |
| PR approval | ✅ | |
| RFQ → Quotation | ✅ | Header price only |
| PO + PO approval | ✅ | |
| Goods Receipt + inspection | ✅ | |
| Invoice | ✅ | |
| **3-way match** | 🟡 | Enforced, but compares **totals**, not line by line — two wrong lines can cancel out. Tolerances (2 % qty / 1 % amount) are hard-coded; move to Settings |
| Payment | ✅ | Bill-wise |

---

## 5. PP — Production Planning

Demand, MRP, BOM, routing, work centers, planned and production orders.

| Code | Area | Work / Meaning | ERP | What we have / note |
|---|---|---|---|---|
| CS01/02/03 | BOM | Create/change/display | ✅ | Production BOM: draft → active (approval) → obsolete; changes by new version |
| CS11 | BOM explosion | Explode BOM | 🟡 | Multi-level explosion exists in **Design** BOM; Production BOM is single-level |
| CA01/02/03 | Routing | Create/change/display | 🟡 | Operations live inside the BOM (sequence, work station, hours, inspection gate). Not a separate reusable master — fine for us |
| CR01/02/03 | Work center | Create/change/display | ✅ | Work stations with capacity and hourly rate |
| MD61/62/63 | PIR | Demand forecast | ➖ | We build to order (rail machines). Skip unless we start stocking standard tools |
| MD01N | MRP | MRP Live | 🟡 | Planning page nets work-order demand vs stock. Ignores open POs / PRs, lead time, sub-assemblies |
| MD04 | Requirements | Stock/requirements list | 🟡 | Per-item shortage list, not by date |
| MD05 / MD06 | MRP list | MRP lists | ➖ | Skip |
| MD11/12/13 | Planned order | Create/change/display | ➖ | Shortage goes straight to work order / PR — fine for make-to-order |
| CO01/02/03 | Production order | Create/change/display | ✅ | Work order from active BOM; BOM copied into the order |
| COHV | Production orders | Mass processing | ➖ | Not needed at our volume |
| CO11N | Confirmation | Operation confirmation | ✅ | Shop floor: start / complete operation, good / scrap qty, time logs |
| CO15 | Confirmation | Order confirmation | ✅ | Complete = all operations done + FG received |
| MIGO | Goods movement | GI to order / GR of FG | ✅ | Issue / return materials; FG receipt to store or to Quality lot |
| COGI | Errors | Goods-movement errors | ➖ | Our postings fail immediately with a clear error — no error queue needed |
| COOIS | Information system | Production order info | 🟡 | Reports: FG output, estimated vs actual cost, movements, job card |
| MF50 | Planning table | Production planning | 🟡 | Work-station load view; no drag-and-drop scheduling |

**PP-PI — Process Industries** (C201–C203, COR1–COR3, COR6N, CORK, C223, COOISPI): ➖ **Not for us.** These are for chemicals / pharma / food (recipes, batches). We are discrete manufacturing.

**Do**
1. MRP should count **open POs and PRs** as incoming supply, otherwise the same shortage keeps showing and gets ordered twice.
2. "Raise PR" from planning should create one PR for all shortages and link back to the work order.
3. Use item lead time to show an "order by" date.
4. FG receipt should check that the last operation's good qty covers the received qty.

**Don't**
- Forecasting, planned orders, MRP lists, COHV, process industry. Make-to-order doesn't need them.

**Wrong now**
1. **FG can be received into stock without any material issued** to the work order. Stock goes up without consumption.

---

## 6. PLM / Product Engineering

| Code | Area | Work / Meaning | ERP | What we have / note |
|---|---|---|---|---|
| CV01N/02N/03N | Document | Create/change/display | ✅ | Design documents with revisions (draft → review → approve → release → superseded), customer approval |
| CS01/02/03 | BOM | Engineering BOM | ✅ | Design BOM with revisions B0, B1…, make / buy, drawing revision per line |
| CC01/02/03 | Change master | ECN | ✅ | Change notice with stock / WIP disposition, effectivity, department sign-off |
| CWBPP | Engineering change | ECR → ECN | ✅ | Change request with impact check and votes → converts to ECN |
| COMMPR01 | Product | Product maintenance | 🟡 | Products module (finished-product master) |
| COMM_HIERARCHY | Product hierarchy | Product hierarchy | ❌ | Flat product type only |

**Wrong now** — this is the biggest design gap in the ERP:
1. **Design BOM and Production BOM are two separate worlds.** Releasing a design BOM or an ECN does not create or update the Production BOM. Production can run a BOM that engineering has already changed. Standard practice: the released engineering BOM **is the source** for the production BOM (EBOM → MBOM), and an ECN creates the new production version.
2. Electrical BOM has no revisions; quantities can change after approval; "received" / "issued" are set by hand without any store movement.
3. Four BOM systems (Design, Production, Electrical, Hydraulic) with no single "full machine" structure.

**Do**
1. "Transfer to Production" on a released design BOM revision → creates the production BOM version.
2. ECN implementation → creates the new production BOM version automatically.
3. Electrical / Hydraulic BOMs should feed the same structure (or be sub-BOMs of the machine BOM).

---

## 7. SD — Sales & Distribution

| Code | Area | Work / Meaning | ERP | What we have / note |
|---|---|---|---|---|
| VA01/02/03 | Sales order | Create/change/display | ✅ | Strong: approval chain, LD, PBG, warranty terms, Order Acceptance PDF |
| VA05 | Sales orders | List | ✅ | + order book, backlog, LD exposure |
| VA21/22/23 | Quotation | Create/change/display | 🟡 | Lives inside CRM inquiry (with revisions). No approval, no validity date |
| VL01N/02N/03N | Delivery | Outbound delivery | ❌ | **No dispatch document linked to the Sales Order** |
| VL06O | Delivery monitor | Outbound monitor | 🟡 | Delivery board shows build stage and LD risk, not actual dispatch |
| VF01/02/03 | Billing | Create/change/display | 🟡 | Sales invoice exists in Finance, but **not linked to the order** |
| VF04 | Billing due list | Billing due | ❌ | Billing plan exists on the order but nothing updates it |
| VA41/42/43 | Contract | Create/change/display | ❌ | No rate contract / AMC contract with customers |
| VK11/12/13 | Pricing | Condition records | ➖ | Price per line is fine for engineered machines. A simple price list for spares is enough |
| BP | Business Partner | Customer master | ✅ | One customer master shared by CRM, Sales and Finance (GSTIN unique, credit limit) |
| VD01/02/03 | Customer | Legacy create/change/display | ✅ | Same |

**Also checked**

| Item | ERP | Note |
|---|---|---|
| Order amendment with versions | ✅ | Approval + change diff |
| Credit limit check | 🟡 | Looks at open orders only, not unpaid invoices |
| Sales return | 🟡 | Credit note only — no goods-return receipt |
| Advance against order | 🟡 | Kept on the customer, not on the order |

**Wrong now** — the Order-to-Cash chain is broken in two places:
1. **Dispatch dates on the Sales Order can never be set.** Nothing in the system writes "dispatched / delivered / commissioned" dates. So the order never becomes "delivered", **LD keeps counting forever**, and **warranty start / end stay empty**.
2. **Invoice is not linked to the order** (only a free-text reference). Invoiced quantity and billing milestones are never updated, so the same order can be invoiced twice.
3. Store "dispatch" issue reduces stock but knows only the machine, not the Sales Order line.
4. Quotation "accepted" is detected by searching the words "accept" / "won" in a text field. Use a proper status.

**Do (highest priority in the whole ERP)**
1. Dispatch document: Sales Order schedule → Quality dispatch check → Store issue → sets dispatched date. Delivery / commissioning dates set from POD and commissioning report.
2. Invoice from Sales Order (or billing milestone): copies lines, updates invoiced qty / milestone status, blocks over-billing.
3. Credit check = open orders **+ unpaid invoices**.
4. Advance receipt tagged to the Sales Order.

---

## 8. QM — Quality Management

| Code | Area | Work / Meaning | ERP | What we have / note |
|---|---|---|---|---|
| QA01/02/03 | Notification | Create/change/display | ✅ | NCR (propose → approve disposition → action → verify → close) |
| QM01/02/03 | Notification | Create/change/display | ✅ | NCR + Customer complaints |
| QA32 | Inspection lots | Worklist | ✅ | Lots auto-created from GRN, production output, job work; "My inspections" |
| QA33 | Inspection lots | Display | ✅ | |
| QA11 | Usage decision | Record | ✅ | Accept / reject / partial / accept with deviation → moves stock, raises NCR |
| QA12 | Usage decision | Change | ✅ | Correctly **locked** after decision |
| QE01/02/03 | Results | Record/change/display | ✅ | Only while lot is "in inspection". (Old inspection screen: see "Wrong now") |
| QP01/02/03 | Inspection plan | Create/change/display | ✅ | With approval and revisions |
| QS21/22/23 | MIC | Create/change/display | ✅ | Characteristics master (no versions) |
| QCC0 | QM customizing | Customizing | ✅ | Quality settings + roles |

Also: AQL sampling ✅, FAI ✅, CAPA ✅, supplier quality / approved vendor list ✅, segregation of duties on deviation acceptance ✅.

**Do**
1. **Gauge / instrument calibration master** with due dates — and block using an overdue gauge in results. Railway and ISO audits always ask for this.

**Wrong now**
1. The old (legacy) inspection records can still be **edited and deleted after completion**. Lock them read-only.

---

## 9. PM — Plant Maintenance / Asset Management

| Code | Area | Work / Meaning | ERP | What we have / note |
|---|---|---|---|---|
| IE01/02/03 | Equipment | Create/change/display | ✅ | Maintenance assets with parent, spares list, QR labels, history |
| IL01/02/03 | Functional location | Create/change/display | ➖ | Location + parent asset is enough for one or two plants |
| IW21/22/23 | Notification | Create/change/display | ✅ | Breakdown / abnormality / improvement / safety requests |
| IW31/32/33 | Maintenance order | Create/change/display | ✅ | Tasks, spares, labour, downtime, cost |
| IW38 | Orders | Order list | ✅ | |
| IW41 | Confirmation | Confirm operation | ✅ | Labour, spares issue / return (posts to store), complete, close |
| IP01/02/03 | Maintenance plan | Create/change/display | 🟡 | Time-based plans only |
| IP10 | Maintenance plan | Schedule | ✅ | Daily scheduler creates PM work orders |
| IK01/02/03 | Measuring point | Create/change/display | ❌ | Only one overwritable meter value on the asset |
| IK11 | Measurement | Enter measurement document | ❌ | No reading history |

**Do**
1. Meter reading history (hours / km / strokes) and **usage-based PM** — the plan already has a "meter interval" field that nothing uses.

**Wrong now**
1. `meter_interval` on PM plans is a dead field — users can fill it but it does nothing. Build it or hide it.

---

## 10. WM / EWM — Warehouse

| Code | Area | Work / Meaning | ERP | What we have / note |
|---|---|---|---|---|
| LX01 / LT01 | Transfer order | Create | ➖ | |
| LT03 | Transfer order | From delivery | ➖ | |
| LT10 | Transfer order | From list | ➖ | |
| LT12 | Transfer order | Confirm | ➖ | |
| LT21 | Transfer order | Display | ➖ | |
| LS24 | Stock | By storage bin | 🟡 | Bins exist, but stock is not kept per bin |
| LS26 | Warehouse stock | Stock | ✅ | Stock per location |
| LX03 | Warehouse | Overview | ✅ | |
| LI01N/02N/03N | Inventory | Create/change/display | 🟡 | See MI01 |
| LI11N | Inventory count | Enter count | 🟡 | See MI04 |
| LI20 | Inventory | Clear differences | ✅ | Stock adjustment |
| /SCWM/* (all EWM codes) | EWM | Warehouse tasks, HUs, inbound / outbound, monitor | ➖ | EWM is for large distribution centres. Not for us |

**Do (later):** bin-level stock (which rack the item is in) once the store grows; a ledger-vs-balance consistency report.

**Don't:** transfer orders, handling units, EWM.

---

## 11. PS — Project System

| Code | Area | Work / Meaning | ERP | What we have / note |
|---|---|---|---|---|
| CJ20N | Project Builder | Manage project | ✅ | Project with Overview, Tasks, Documents, History |
| CJ01/02/03 | Project | Create/change/display | ✅ | |
| CJ11/12/13/14 | WBS | Create/change/display/delete | ➖ | Your decision (10-Oct): WBS removed; projects use department tasks + sub-tasks |
| CJ40 / CJ41 | Planning | Cost planning | ➖ | Costing deferred (your decision) |
| CJI3 | Costs | Actual line items | ➖ | Deferred |
| CJI5 | Commitments | Commitment line items | ➖ | Deferred |
| CN41N / CN43N | Overview | Structure overview | 🟡 | Dashboard, all projects, Ongoing Projects per department |
| CJ88 | Settlement | Project settlement | ➖ | |
| CJB2 / CJ30 | Budget | Project budgeting | ➖ | Deferred |

**Wrong now**
1. The word **"WBS"** still appears on some Project pages (department board, new project, milestone pages) although WBS is removed. Clean up the wording so users aren't confused.

---

## 12. HCM — Human Capital Management

| Code | Area | Work / Meaning | ERP | What we have / note |
|---|---|---|---|---|
| PA20 / PA30 | Employee | Display / maintain master data | ✅ | Employee profile |
| PA40 | Personnel action | Hire / transfer / terminate | ✅ | Joining, confirmation, transfer, promotion, exit with checklists |
| PA10 | Personnel file | Employee file | 🟡 | Documents stored on the user; no document types or expiry dates |
| PP01 | Org objects | Maintain objects | 🟡 | Departments, designations, grades, reporting manager. No positions / vacancies |
| PPOME | Org structure | Organization structure | 🟡 | Org chart; departments have no parent department |
| PT01 | Work schedule | Create | 🟡 | Shifts exist; no rosters / rotation / weekly-off pattern |
| PT60 | Time evaluation | Evaluate time | 🟡 | Late minutes, half days; **no overtime** |
| PA61 / PA51 | Time data | Maintain / display | ✅ | Attendance, regularisation, leave types / balances / requests |
| PC00_MXX_CALC | Payroll | Payroll calculation | ➖ | Payroll stays in ADP (your decision) |
| PC00_MXX_CEDT | Payroll | Reporting | ➖ | ADP |
| PC_PAYRESULT | Payroll | Display results | ➖ | ADP |
| PU03 | Payroll record | Lock/unlock | ➖ | ADP |
| SE16N | Tables | Display table data | ➖ | Developer tool — never give users raw table access |
| SU01 | Users | User administration | ✅ | See Security |

**Do**
1. Overtime calculation (it feeds ADP).
2. Document types with expiry (licences, medical, contracts) and reminders.
3. Training records — needed for ISO / railway audits (who is qualified to inspect / weld / operate).

**Don't:** payroll, recruiting suite, performance suite for now.

---

## 13. EHS — Environment, Health & Safety

| Code | Area | Work / Meaning | ERP | What we have / note |
|---|---|---|---|---|
| CG01/02/03 | Specification | Create/change/display | ➖ | Chemical specifications — not our business |
| CG12/13/14 | Substance | Create/change/display | ➖ | |
| CG36/37/38 | Report template | Create/change/display | ➖ | |
| CB01/02/03 | Incident | Create/change/display | ❌ | **No incident / accident / near-miss register** |
| CVD1/2/3 | Dangerous goods | Create/change/display | ➖ | |

**Do**
1. A small **Incident & Near-miss register** (what happened, injury, root cause, action — can reuse CAPA). Factories Act and customer audits expect it.
2. Optional: PPE issue record per employee.

---

## 14. Service Management

| Code | Area | Work / Meaning | ERP | What we have / note |
|---|---|---|---|---|
| BP | Business Partner | Customer / contact master | ✅ | CRM organisations + contacts |
| IW21/22/23 | Notification | Service notification | ✅ | Service Request (ERP module) |
| IW31/32/33 | Service order | Create/change/display | 🟡 | Same Service Request record; no separate order with planned cost |
| IW41 | Confirmation | Confirm service operation | 🟡 | Total hours, dates, downtime, customer sign-off. Single technician; spares don't touch stock |
| VA01 | Order | Service-related order | ❌ | |
| VF01 | Billing | Create billing | ❌ | Bill total is calculated on the SR but **never becomes a Finance invoice** |

Also: installed base by machine serial ✅, warranty on machine ✅ (but Sales warranty dates never filled — see SD), AMC 🟡 (text fields only), commissioning 🟡.

**Wrong now**
1. **Spares used in service never reduce store stock.** Spares are free text, bought through a PR, and "received" doesn't post stock.
2. **Service bill never reaches Finance** — no AR invoice, so service revenue is missing from the books unless typed again by hand. The bill also includes warranty-covered parts.
3. Machine registry keeps the customer as **free text** (name, GST) instead of linking to the CRM customer — a second customer master.
4. Service money fields use `Float` instead of exact money type.

**Do**
1. Service spares from Item Master → issue from store against the SR.
2. "Create invoice" from a closed chargeable SR → AR invoice (exclude warranty parts).
3. Link machines to the CRM customer and to the Sales Order line.
4. AMC contract object with visits and billing schedule.

---

## 15. TM — Transportation Management

| Code | Area | Work / Meaning | ERP | What we have / note |
|---|---|---|---|---|
| /SCMTMS/LOC3, LOC2 | Location | Maintain / display | ➖ | |
| /SCMTMS/PLN | Planning | Transportation planning | ➖ | |
| /SCMTMS/RES01 | Resource | Create resource | ➖ | |
| /SCMTMS/TOR | Transportation order | Manage | ➖ | |
| /SCMTMS/D_TOR_MON | Monitor | Transportation order monitor | ➖ | |
| /SCMTMS/FWO | Freight order | Manage | ➖ | |
| /SCMTMS/CHACO | Charges | Charge calculation | ➖ | |
| /SCMTMS/CONF | Confirmation | Execution / confirmation | 🟡 → ❌ | Need **POD** (proof of delivery) on dispatch |

**Do:** on the dispatch document (see SD) capture transporter, vehicle, LR number, e-way bill, freight cost and POD date. That is all a machine manufacturer needs.

**Don't:** full TM.

---

## 16. CRM / CX

| Code | Area | Work / Meaning | ERP | What we have / note |
|---|---|---|---|---|
| BP | Business Partner | Customer / contact master | ✅ | |
| CRMD_ORDER | CRM transaction | Create / display | ✅ | Inquiries, tenders, quotations |
| CRMD_BUS2000116 | Sales activity | Sales activity | ✅ | Calls / visits / meetings with MoM |
| CRMD_BUS2000126 | Service request | Service request | ✅ | In ERP module, not CRM (fine) |
| CRMD_BUS2000140 | Opportunity | Opportunity | 🟡 | Inquiry = lead + opportunity in one (fine for B2B) |
| CRMD_BUS2000151 | Lead | Lead | 🟡 | Same |
| CRMC_UI_PROFILE | UI profile | CRM UI configuration | ➖ | Your decision: no metadata customisation |
| COMMPR01 | Product | Product maintenance | 🟡 | See "Wrong now" |
| COMM_HIERARCHY | Product hierarchy | Product hierarchy | ❌ | Flat categories |
| SM_CRM_UI | CRM UI | Web UI configuration | ➖ | |

**Wrong now**
1. **Three product masters**: CRM products, Products module, Store items. Sales Order lines never point to the Products module. (Already on your list: merge into Products.)
2. Owner fields (BD owner, sales engineer, follow-up person, activity assignee) are **free text, not users** — so no "my inquiries", no notifications, no reports per person.
3. Quotation money uses `Float`.

**Do:** weighted pipeline report (value × probability by stage).

---

## 17. Basis

| Code | Area | Work / Meaning | ERP | What we have / note |
|---|---|---|---|---|
| SM51 | Servers | Application servers | ➖ | Dokploy handles this |
| SM50 / SM66 | Work processes | Monitor | ➖ | |
| SM21 | System log | System log | 🟡 | Log files only; no screen |
| ST22 | ABAP dumps | Analyse dumps | 🟡 | Errors logged to file; no screen |
| SM37 | Jobs | Monitor jobs | 🟡 | ~11 scheduled jobs run; **no run history, no failure alert** |
| SM36 | Jobs | Schedule jobs | ✅ | In code (APScheduler) |
| SM04 / AL08 | Sessions / users | Logged-on users | ✅ | Organization › Security: list and revoke sessions |
| SM12 | Locks | Lock entries | ❌ | **No record locking** — two people editing the same record overwrite each other |
| SM13 | Updates | Update requests | ➖ | |
| ST03N | Performance | Workload analysis | 🟡 | Slow-request warnings only |
| STMS / SE09 / SE10 | Transports | Transport management | ✅ | Git + Alembic migrations + Dokploy auto-deploy from main |
| RZ10 / RZ11 | Profiles / parameters | System config | ✅ | Environment settings |
| SCC4 / SCCL / SCC9 | Clients | Client admin / copy | ➖ | Not applicable |
| SPAM / SAINT | Support packages | Updates / add-ons | ➖ | |

**Wrong now**
1. **Scheduled jobs run once per server worker** — with more than one worker, every job (reminders, escalations, PM generation) fires multiple times. Add a single-runner lock.
2. No optimistic locking on business documents (add a version number; reject a save if someone else saved first).
3. Automated database backup is documented as "not confirmed". Confirm it — this is the most important Basis item.

---

## 18. Security & GRC

| Code | Area | Work / Meaning | ERP | What we have / note |
|---|---|---|---|---|
| SU01 | Users | Create/change/display | ✅ | Users with nightly Azure sync |
| PFCG | Roles | Create/manage roles | ✅ | Roles with module › tab › action permissions, data scope |
| SU10 | Users | Mass administration | 🟡 | Bulk assign users to a role |
| SU24 | Authorizations | Defaults | 🟡 | Permission catalogue in code |
| SU25 | Authorizations | Upgrade / setup | ➖ | |
| SU53 | Authorizations | Missing authorization analysis | ✅ | Every 403 says exactly which permission is missing |
| STAUTHTRACE / ST01 | Trace | Authorization / system trace | 🟡 | "Effective permissions" per user |
| SM20 | Audit | Security audit log | ✅ | Audit log + sign-in history (some gaps — below) |
| SM19 | Audit | Audit log configuration | ✅ | Audit registry |
| PFUD | Role users | User comparison | 🟡 | Permission history per user |
| SE16N / AGR_USERS / AGR_1251 | Role data | Role tables | ✅ | Shown in the Roles / Users screens |

Also: Microsoft SSO ✅, MFA via Microsoft ✅, rate limiting ✅, central approval engine with delegation and four-eyes rule ✅.

**Wrong now**
1. **Audit log gaps**: Projects, P2P, CRM, ERP machines / service requests and Users / Roles are not in the automatic audit registry — only some manual entries.
2. Sign-in history trusts the `X-Forwarded-For` header, so the recorded IP can be faked. (The rate limiter already does this correctly — reuse the same check.)
3. Write rate-limit is per IP (40 writes / minute). Everyone in the office shares one IP — limit per user instead.

**Do:** a segregation-of-duties check (warn when one user gets conflicting rights, e.g. create vendor + post payment).

---

## 19. Cloud / Platform areas

| SAP product | What it is | Our position |
|---|---|---|
| Supply Chain Management | Demand → MRP → procure / produce → stock → transport | 🟡 Covered by P2P + Store + Production. Missing: MRP counting POs, dispatch document |
| SAP Ariba | Cloud procurement, supplier portal | 🟡 Vendor master, catalogue, supplier rating exist. ➖ No supplier portal needed now |
| SAP BTP & Integration | Integration platform | ➖ Our API + Microsoft Graph / Teams integration is enough |
| BW/4HANA & Analytics | Data warehouse | ➖ Not needed. Module reports + exports are enough at our size |
| Treasury & FSCM | Cash, liquidity, collections, credit | 🟡 Bank accounts, reconciliation, liquidity forecast exist. ❌ Dunning (field exists, never used), bank statement import |
| SAP Concur | Travel & expense | ❌ Consider a small **employee expense claim** (service engineers travel a lot) |
| RE-FX | Real estate | ➖ Not our business |
| SuccessFactors | Cloud HR | 🟡 See HCM |
| SAP Analytics Cloud | Dashboards, planning | 🟡 Module dashboards exist |

---

## 20. End-to-End Business Processes

| Process | Status | Where it breaks |
|---|---|---|
| **Order-to-Cash** Customer → Quotation → Sales Order → Delivery → Goods Issue → Billing → AR → Payment | 🔴 | ✅ Customer → Quotation → Order. ❌ **Delivery** not linked to order. ❌ **Billing** not linked to order. ✅ AR → Payment |
| **Procure-to-Pay** Requirement → PR → Approval → RFQ → Quotation → PO → GR → Invoice → 3-way match → Payment | 🟢 | Works end to end. Weak: lines not linked to items, GRN valued at average, match on totals only |
| **Plan-to-Produce** Demand → MRP → Planned Order → Production Order → Availability → Production → Confirmation → GR | 🟡 | ✅ Order → BOM → work order → issue → confirm → FG receipt. 🟡 MRP ignores open POs. ❌ Design BOM not feeding Production BOM |
| **Record-to-Report** Transaction → Accounting doc → GL → Closing → Statements | 🟡 | ✅ Inside Finance it is correct. ❌ Store, Production, Service, HR don't post to accounts automatically — everything is keyed in Finance again |
| **Maintain-to-Operate** Equipment → Notification → Order → Execution → Confirmation → Completion | 🟢 | Works. Missing meter-based maintenance |
| **Project-to-Settlement** Project → WBS → Budget → Execution → Costs → Settlement → Closure | ➖ | By your decision: project + tasks only, no costing |

---

## 21. Priority list — what to fix first

Ordered by business risk (money, customer, audit).

| # | Fix | Why it matters | Area |
|---|---|---|---|
| 1 | Dispatch document linked to Sales Order (sets dispatch / delivery / commissioning dates) | LD keeps counting, warranty never starts, order never closes | SD |
| 2 | Invoice from Sales Order / billing milestone, block over-billing | Double billing possible; no order-wise billed status | SD + FI |
| 3 | GRN posts stock at **PO price**, and by item id (not name) | Stock value is wrong; items silently skipped | MM |
| 4 | Service spares from store + service bill → AR invoice | Stock and revenue missing from books | Service |
| 5 | Design BOM / ECN → Production BOM | Production can build an outdated design | PLM / PP |
| 6 | Lock GL account key fields after posting + audit it | Can silently change the meaning of past entries | FI |
| 7 | Confirm automated DB backup; single-runner scheduler | Data loss; duplicate reminders / escalations | Basis |
| 8 | PO amendment + cancel; PO status "pending approval" | Users told to "amend" — no way to do it | MM |
| 9 | Gauge calibration master | ISO / railway audit finding | QM |
| 10 | Audit registry for Projects, P2P, CRM, ERP, Users / Roles | Audit trail incomplete | GRC |
| 11 | Link PR/PO lines to Item Master; MRP counts open POs / PRs | Duplicate ordering | MM / PP |
| 12 | Merge three product masters (already planned) | Same product with different names | CRM / Products |
| 13 | Payment voucher approval above a limit | Payments post without second check | FI |
| 14 | Incident & near-miss register | Factory safety compliance | EHS |
| 15 | Meter readings + usage-based PM | Dead field today | PM |

---

## 22. What we should **not** copy from SAP

- **CO allocations** (activity types, assessment, distribution, overhead, settlement) — needs a full-time controller.
- **Standard costing** (CK24 release) — we use moving average; keep it.
- **Forecasting / planned orders / MRP lists** — we build to order.
- **PP-PI process industry**, **EHS chemicals / dangerous goods**, **RE-FX real estate**.
- **EWM / WM transfer orders and handling units**, **full TM**.
- **Functional locations** — location + parent asset is enough.
- **Pricing condition technique** (VK11) — engineered machines are priced per order.
- **Payroll** — stays in ADP.
- **UI configuration T-codes** (CRMC_UI_PROFILE, SM_CRM_UI) — modules are coded, not configured.
- **Client copy, support packages, transports** — Git + Alembic + Dokploy already do this.
- **SE16N for users** — never give raw table access.

---

*Prepared from a code review of the Premnath ERP repository on 11-Oct-2026. File-level evidence for every mark is available on request.*
