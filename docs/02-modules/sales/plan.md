# Sales Module — Plan

**Module:** Sales (order management: customer order → delivery → billing hand-off)
**Backend Location:** `backend/app/modules/sales/` (to be created)
**Frontend Location:** `frontend/src/app/dashboard/sales/` (empty scaffold folders already exist: `delivery`, `opportunities`, `orders`, `pricing`, `quotations`, `reports`. §9 says which to keep.)
**Spec:** `docs/MODULE_DETAILED_PLAN.md` §0 (R1–R6, D1–D8), §5 (CRM), §6 (Sales), §7 (PM, D2), §17 (Production / RRV Build), §19 (Service), §21 (Finance), §24 (integration), §31 (Sales settings)
**Prepared by:** Vineet Sharma
**Date:** 07 October 2026
**Status:** Draft. Every open question in §15 has a recommended default, so Phase 1 can start without waiting for answers. Answers only change defaults.

---

# 1. Purpose

Today a won order has no home in the portal. The customer's PO number is typed as free text in four places: `production_rrv_builds.customer_po_number`, `erp_projects.po_number`, `ar_transactions.customer_po_number` and `pm_projects.customer_po_ref`. Nobody can answer these questions from the system:

1. **What have we sold, to whom, at what price, and on what terms?** This is the order book.
2. **What is due for delivery and when, vehicle by vehicle? Which vehicles are late, and how much LD (liquidated damages) are we exposed to?** This is the delivery schedule and backlog.
3. **Which vehicle on the shop floor belongs to which order?** This is the Sales Order → RRV Build link.
4. **What can we bill now, what have we billed, and what has been collected against each order?** This is the billing plan, handed off to Finance.
5. **When does the warranty on each delivered vehicle start and end, per the contract?** This is the contract warranty, which feeds the Service registry.

The core design decision is that **Sales owns the order, and nothing else.** The quotation stays in CRM. The tax invoice and the money stay in Finance (Accounts). Stock movement stays in Store. The vehicle build stays in Production. Inspection stays in Quality. Sales is the **contract record** that sits between them and links them together. Sales never posts to the GL (general ledger) and never moves stock.

> **ERP standard / why — the order-to-cash document chain.** Every ERP (SAP SD, Oracle OM, Odoo Sales, Tally) uses the same chain. Each document has a different legal meaning, so they are kept as separate records:
>
> | Document | Who issues it | What it is legally | Accounting effect |
> |---|---|---|---|
> | **Quotation** (offer) | Us | An *offer*. It binds us only until its validity date, and only if the customer accepts it unchanged. | None |
> | **Customer PO / LOA** (Letter of Acceptance) | Customer | The customer's *acceptance*. In railway tenders, the LOA forms the contract and a formal PO or contract agreement follows. | None |
> | **Sales Order (SO)** | Us (internal) | Our internal record of the contract: what, how many, price, delivery dates, payment terms, LD, warranty. It is the single place every other department reads the contract from. | None (it is a *commitment*, not a transaction) |
> | **Order Acknowledgement (OA)** | Us | Our written confirmation to the customer that we accept their PO *as we understood it*. It is the moment to catch any mismatch in price, delivery or terms before work starts. | None |
> | **Proforma Invoice (PI)** | Us | A *request for payment*, usually to release an advance. It is **not** a tax invoice: no GST liability arises and it has no GST invoice number. | None |
> | **Tax Invoice** | Finance | The legal demand for payment, and the GST document. It is issued **at or before** the goods leave (CGST Act s.31). | Debtor Dr, Sales Cr, Output GST Cr |
> | **Dispatch note / POD** (proof of delivery) | Us / customer | Proof that the goods left and arrived. Delivery date drives LD and (often) warranty. | None |
>
> Merging any two of these (for example, using the quotation as the order, or the proforma as the invoice) is the most common mistake in small ERPs. That is why this plan keeps them apart.

---

# 2. What already exists, and how Sales relates to it

## 2.1 Inventory

| Existing | Where | Shape | Relationship to Sales |
|---|---|---|---|
| **Customer master** | `crm/models/organization.py` (`crm_organizations`) | Name, type, zone/division, address, state, `gst_number` (unique), `credit_limit`, `credit_days`, `discount_percentage`, `gl_reconciliation_account_id`; contacts in `crm_org_contacts` | **This is the customer master.** Every SO has `customer_id` → `crm_organizations.id`. Sales never creates its own customer table (R6). AR already uses the same FK (`ar_transactions.customer_id`, `payment_transactions.customer_id`). |
| **Inquiry** | `crm/models/inquiry.py` (`crm_inquiries`) | `org_id`, product / category / spec / quantity (+ `crm_inquiry_line_items`), `required_delivery_date`, `inspection_req`, `warranty_req`, `expected_value`; free-text `status` (the UI uses "Won" / "Lost" / "Cancelled"); 15-step `INQ_STAGES` in `routes/inquiries.py` including "Purchase Order", "Manufacturing", "Dispatch" | **A source of an SO.** "Create Sales Order" on a won inquiry pre-fills the SO. After the SO exists, the inquiry's post-PO stages become read-only mirrors of the SO (master plan §5). |
| **Tender** | `crm/models/tender.py` (`crm_tenders`) | Tender no., authority, portal, dates, `participate`, `awarded_to`, **`loi_number`**, **`contract_value`**, `loss_reason`; 12-step `TND_STAGES` ending in "Awarded / Lost" | **A source of an SO.** A tender has **no quotation table**: the price bid lives on the tender portal (IREPS / GeM). The SO from a tender takes the LOA/LOI number and contract value, and lines are typed from the LOA's schedule of quantities. |
| **Quotation** | `crm/models/inquiry.py` (`crm_quotations`, `crm_quotation_line_items`); routes in `crm/routes/workflow.py`; Word document of record in `crm/reports/quotation_docx.py` (managed document `crm_quotation`) | Belongs to an **inquiry only**. Number `QT-<inquiry suffix>-NN`. Revisions **mutate the row in place** (`-r1`, `-r2`…) and log the old values to `audit_logs` (`quotation_revision`). Only `payment_terms`, `valid_until`, `delivery_time` and line `unit_price` can be revised. `customer_response` is a free-text tracking field. Lines: description, `model_number`, qty, unit price, GST %, totals (server-computed). | **Stays in CRM** (decision §2.2-A). The SO **copies** the accepted quotation's lines and terms into its own rows at creation (a frozen snapshot) and keeps `source_quotation_id` + `source_quotation_number` (with revision). Quotation approval (master plan §6.1) is added in Phase 3 (§6.11). |
| **Product catalog** | `crm/models/product.py` (`crm_products`) | Name, `model_number`, category, unit, `default_price` | SO line `crm_product_id` (what was sold, commercially). The **Item Master** link (`product_item_id` → `store_items`) is added when the RRV model exists as a finished-good item (Engineering plan Q2). |
| **Payment terms catalog** | `crm/models/payment_term.py` (`crm_payment_terms`) | Label + description, free text | Used as a **label picker only**. The SO's structured billing plan (§4.5) is what Sales and Finance act on. |
| **CRM "Purchase Order" sub-entity** | *Dropped* (`e5a1c7d93f42_drop_unused_crm_workflow_tables.py`, commit `0be1d8d`) | — | Gone. `docs/02-modules/crm/overview.md` still describes it, so update that doc when Sales ships. The SO replaces it. |
| **RRV Build** | `production/models/rrv_build.py` (`production_rrv_builds`) | One per vehicle. `rrv_model` (free text), **`customer_name` (free text)**, `customer_po_number`, `customer_po_date`, `order_reference`, `erp_project_id`, `target_handover_date`, `warranty_months` (default 12), handover fields. Created only from the Production UI (logic is route-local in `production/routes/rrv_builds.py:create_build`). | **Planned builds are created from the SO** (one per scheduled vehicle). New nullable FKs `sales_order_id`, `sales_order_line_id`, `sales_schedule_id`, `customer_id` (→ `crm_organizations`) are added (§4.11). The free-text customer fields stay, as snapshots filled from the SO. |
| **Handover → machine registry → warranty** | `production/service.py:register_rrv_machine`, `apply_rrv_handover` | At RRV Completion the ERP machine (`erp_projects`) is created. At handover: `warranty_start_date = handover_date`, `warranty_end_date = handover_date + warranty_months`. | Sales supplies the **contract warranty rule** (§6.8). When a build has an SO, warranty is computed from the contract, not from the default 12 months. |
| **ERP machine registry** | `erp/models/project.py` (`erp_projects`) | One row per delivered machine. `client_company` and `client_*` free text, `po_number`, `po_date`, `delivery_date`, `commissioning_date`, `third_party_inspection_required`, `inspection_agency`, `warranty_start_date` / `end_date`, `warranty_terms` | Gains `customer_id` and `sales_order_id` (Phase 2). Sales writes `third_party_inspection_required` / `inspection_agency` / PO data onto the machine when it's registered, because **Quality's dispatch check reads them from here**. |
| **Dispatch block** (Quality Phase 2, just committed) | `quality/services/dispatch.py`, `quality/models/inspection_call.py` | Rule 8: finished goods can't be dispatched without a decided final inspection and, when the contract (`erp_projects`) needs it, an accepted RITES/RDSO/customer inspection call with a certificate. Its docstring says: *"there is no sales-order / delivery module yet. Finished goods leave through a Store Material Issue of issue type `dispatch`."* | **Reused as-is.** A Sales dispatch note (§4.7) creates or links that Store `dispatch` issue, so the stock movement and Rule 8 checks keep happening in exactly one place. Sales adds the paper trail (consignee, transporter, LR, e-way bill, POD) and the link to the order. |
| **AR invoice** | `accounts/models/ar_transaction.py`, `accounts/service.py:create_ar_transaction`, `post_customer_invoice` | Draft → posted. Number `SI/<FY>/<NNNN>` issued only at posting (CGST Rule 46, no gaps). **Already has `customer_id` → `crm_organizations`** (committed). Has `customer_po_number` / `date`, e-invoice and e-way bill capture fields, and `reference_type` / `reference_id` (free text, "purely informational"). Lines via `TaxLineMixin` (item, HSN, qty, rate, discount, GST split, ledger). | Sales **requests** a draft invoice by calling `create_ar_transaction(...)` with lines from the SO. Finance reviews and posts it. Sales never posts. Phase 2 adds a real nullable FK `sales_order_id` (+ `sales_billing_line_id`) to `ar_transactions`, because `reference_type/id` is not validated (§4.11). |
| **Customer receipts and advances** | `accounts/models/payment_transaction.py` | `payment_type = "customer"`, `customer_id`, `unallocated_amount` (= on-account advance), allocations to `ar_transaction` | An advance is a customer receipt left unallocated. Phase 2 adds nullable `sales_order_id` so an advance can be tagged to its order. Finance allocates it to invoices later. |
| **Number series** | `accounts/services/fiscal.py:next_number` (`<PREFIX>/<FY>/<NNNN>`, advisory lock, `accounts_number_series`) | FY-wise numbering | Reused for `SO/26-27/0001`, `PFI/26-27/0001`, `DSP/26-27/0001` until the Platform `number_series` (§27) exists. |
| **PM project** | `projects/models/project.py` | `client_name`, `customer_po_ref` free text; "Not linked to CRM or Sales yet." | **No link (D2).** Master plan §31's setting "Auto-create Project on order confirmation" is **not built** until P5 is explicitly started. |

## 2.2 Key decisions

**A. The quotation stays in CRM; the Sales Order is new in Sales.** The quotation belongs to the pursuit (the inquiry, with its stages, MOMs, technical offer and costing). Moving it would mean migrating a live table that the CRM session is editing right now. The SO copies what was accepted, so later quotation edits can't silently change the contract. The `sales/quotations` page becomes a **cross-inquiry quotation register and approval queue** over `crm_quotations` (Phase 3). It is not a second quotation table.

> **ERP standard / why — copy, don't reference, at each document step.** In SAP and Odoo, when you create an order "with reference to" a quotation, the lines, prices and terms are **copied** into the order, and the order keeps a pointer back. That way the order is self-contained, and it stays legally correct even if somebody later edits or deletes the quotation. The same applies at Order → Invoice (the invoice copies the line, it doesn't re-read the order price).

**B. One SO per customer contract.** A single customer PO for 4 RRVs is **one SO** with one line (qty 4) and **four delivery-schedule rows**, one per vehicle. It is not four SOs. Each schedule row gets its own RRV Build, contractual date, LD calculation, dispatch and warranty.

**C. Customer = `crm_organizations`, always by id.** The SO stores snapshots (name, GSTIN, billing address) taken at confirmation for its documents, but every query and link uses `customer_id`.

**D. Sales never posts and never moves stock.** Invoices are drafted by Sales and posted by Finance (segregation of duties, C-05). Dispatch stock movement is a Store issue. LD deductions and retention are booked by Finance.

**E. No PM link (D2).** SO ↔ PM project is P5 work.

**F. Railway-tender realities are first-class fields, not remarks.** These are LD clause, delivery period (DP) extension, inspection agency (RDSO / RITES / customer), consignee-wise delivery, paying authority, PBG (performance bank guarantee) and warranty "whichever is earlier". Indian Railways and PSU orders depend on them.

---

# 3. Users and roles

The module is gated by a new app key, `sales` (label "Sales"). Roles are expressed through the permission registry, not new role tables.

| Role | Typical person | What they do |
|---|---|---|
| **Sales executive / BD (maker)** | BD owner of the inquiry or tender | Creates the SO from a won inquiry or tender, enters customer PO details, schedule and terms, uploads the PO/LOA, and submits for approval. Raises proformas. |
| **Sales coordinator (order desk)** | Sales/commercial office | Maintains the delivery schedule and consignees, issues the OA, requests DP extensions, prepares dispatch notes, records POD, and requests invoices. Often the same person as the maker in a small team. |
| **Sales Head (approver, level 1)** | Head of Sales/BD (`sales_head_id` setting, default: the head of the Sales/BD department) | Approves SOs and amendments up to limit 1. Must not be the maker (four-eyes). |
| **Director (level 2)** | `is_director` | Approves above limit 1 and up to limit 2. |
| **Partner (level 3, top)** | `is_partner` (D1) | Approves above limit 2. Also approves any SO that **deviates from standard terms** (LD cap above the setting, unlimited LD, warranty beyond the setting, advance below the setting), whatever the value. |
| **Production planner** | Production | Read-only on SOs. Gets planned RRV Builds from confirmed SOs and sets their targets. |
| **Finance** | Accounts | Reviews and posts invoice drafts, records receipts and advances, books LD deductions, tracks retention. Read-only on SOs. |
| **Quality / Service** | QA, Service | Read-only. Quality sees inspection-agency requirements. Service sees warranty terms and commissioning obligations. |
| **Management viewer** | Partners, plant head | Dashboard and reports. |

Permission registry entry (`MODULES["sales"]`), with subtabs matching `SalesNav.tsx` one-to-one:
`dashboard`, `orders`, `delivery`, `billing`, `quotations`, `pricing`, `reports`, `settings`, used with the standard actions (`view`, `create`, `edit`, `delete`, `approve`, `export`, `print`). `orders:approve` is the "can be an SO approver" right. Who must approve a given SO is decided by the value and terms rules (§6.2), not by this right alone.

> **ERP standard / why — value-based approval with a "non-standard terms" escalation.** Order approval in every ERP is driven by two things: **value** (a bigger contract means a more senior approver) and **risk** (non-standard terms). An order for ₹40 lakh with uncapped LD is riskier than a ₹4 crore order on standard terms. That is why a terms deviation escalates to a Partner independently of value.

---

# 4. Data model

All tables use `TimestampMixin`. Headers also use `SoftDeleteMixin` (drafts only; a confirmed SO is cancelled, never deleted). Every model is registered in `core/audit_registry.py` via `register_audited(...)`, with child rows using `parent_attr`. Statuses and types are **coded tuples in the model files** (D8). Money uses the Accounts `Money` / `Rate` / `Percent` / `Quantity` types (`accounts/models/_types.py`), not `Float`, so totals match the invoice to the paisa.

## 4.1 `SalesOrder` (`sales_orders`), number `SO/<FY>/<NNNN>`

| Field | Notes |
|---|---|
| `so_number` | Issued at **confirmation**, not at draft. A draft is shown as `Draft #<id>`, the same "no gaps" principle as the tax invoice. |
| `status` | §5.1 |
| `order_type` | `rrv_supply` (vehicles, the normal case), `spares` (spares supply to a customer), `service` (paid service/AMC — Phase 3), `other` |
| `customer_id` | Required. FK `crm_organizations.id`. |
| `customer_contact_id` | FK `crm_org_contacts.id` |
| `source_type`, `source_inquiry_id`, `source_tender_id`, `source_quotation_id`, `source_quotation_number` | Where the order came from. `source_quotation_number` stores the revision label at copy time (e.g. `QT-20260801-01-02-r2`). At most one live (not cancelled) SO per inquiry or tender (§15 Q3). |
| `customer_po_number`, `customer_po_date`, `customer_po_received_date` | Required at submit. The PO/LOA number is unique per customer among live SOs. |
| `loa_number`, `loa_date` | Railway Letter of Acceptance, when it comes before the formal PO. Defaults from `crm_tenders.loi_number`. |
| `contract_reference` | Contract agreement no. (railway), if separate |
| `purchaser_name` | Who placed the order (e.g. "COS, Central Railway") |
| `paying_authority` | Who pays (e.g. "FA&CAO, Central Railway"). Printed on invoices. |
| `billing_address`, `customer_gstin`, `place_of_supply_state_code` | Snapshot from the organisation at confirmation, editable before confirmation |
| `currency` | `INR` (Phase 1 supports INR only, §15 Q10) |
| `price_basis` | `ex_works`, `for_destination` (freight and transit insurance to us), `for_dispatch` — this decides who pays freight and when risk passes |
| `freight_terms`, `insurance_terms` | Short text |
| `subtotal`, `discount_total`, `taxable_total`, `gst_total`, `grand_total` | Server-computed from lines. Never typed. |
| `inspection_agency` | Coded from the Quality master list `inspection_agencies` (RITES / RDSO / Customer / Self / Other) |
| `third_party_inspection_required` | Boolean. Copied to each machine and read by Quality Rule 8. |
| `ld_applicable` | Boolean |
| `ld_rate_percent`, `ld_rate_period` | e.g. `0.5` per `week` (or `day`). "Per week **or part thereof**" is the railway wording, so a delay of 8 days = 2 weeks. |
| `ld_basis` | `delayed_value` (value of the late units only — railway standard) or `contract_value` |
| `ld_max_percent` | Cap, e.g. `10` |
| `warranty_months_from_delivery`, `warranty_months_from_commissioning`, `warranty_rule` | e.g. 30 / 24 / `earlier_of`. `warranty_rule`: `from_delivery`, `from_commissioning`, `earlier_of`, `later_of`. |
| `warranty_terms_text` | Contract wording, printed on the OA and copied to the machine's `warranty_terms` |
| `pbg_required`, `pbg_percent`, `pbg_due_days` | Performance bank guarantee. Tracked in Phase 3 (§4.9). |
| `delivery_terms_text`, `special_conditions` | Free text for what doesn't fit a field |
| `sales_owner_id` | FK `users.id` (the BD owner) |
| `branch_id` | Plant that will build it |
| `deviation_flags` | JSON list, computed at submit: `ld_uncapped`, `ld_cap_above_standard`, `warranty_above_standard`, `advance_below_standard`, `price_below_list` (Phase 3). Drives Partner escalation. |
| `required_approval_level` | `sales_head`, `director`, `partner`, computed at submit |
| `submitted_at`, `submitted_by_id`, `confirmed_at`, `confirmed_by_id` | |
| `oa_issued_at`, `oa_issued_by_id` | Order acknowledgement (§6.3) |
| `amendment_no` | 0 for the original; +1 per approved amendment (§6.4) |
| `hold_reason`, `cancel_reason`, `short_close_reason` | Required for those transitions |

> **ERP standard / why — price basis and Incoterms-style terms.** "FOR destination" vs "ex works" isn't just print text. It decides who pays freight, who insures the vehicle in transit, and when ownership and risk pass to the customer. Railway contracts are usually FOR destination, which means a vehicle damaged on the trailer is still our problem. That is why it's a coded field, and why the POD date (not the dispatch date) is the delivery date for LD on FOR-destination orders (§6.6).

## 4.2 `SalesOrderLine` (`sales_order_lines`)

| Field | Notes |
|---|---|
| `so_id`, `line_number` | |
| `line_type` | `rrv` (one vehicle per unit, gets schedule rows and builds), `spares`, `service`, `freight`, `other` |
| `crm_product_id` | FK `crm_products` (commercial model) |
| `product_item_id` | FK `store_items`. Nullable in Phase 1. **Required for `spares` lines**, and for `rrv` lines once the RRV model exists as an Item Master finished-good item (Engineering Q2), because the Store `dispatch` issue needs it. |
| `rrv_model` | Text snapshot, copied to the RRV Build's `rrv_model` |
| `description`, `specification` | Customer's description (from the PO schedule) |
| `customer_line_ref` | The PO's own item/schedule number, e.g. "Item 1, PL No. 12345678". Printed on invoices because railway paying authorities match on it. |
| `hsn_sac_code`, `uom`, `quantity` | |
| `unit_price`, `discount_percent`, `discount_amount`, `taxable_amount`, `gst_rate`, `gst_amount`, `line_total` | Server-computed |
| `qty_scheduled`, `qty_dispatched`, `qty_delivered`, `qty_invoiced`, `qty_cancelled` | Maintained by the service layer, never typed |

## 4.3 `SalesOrderSchedule` (`sales_order_schedules`) — the delivery schedule

One row per **delivery lot**. For `rrv` lines this is **one row per vehicle** (qty 1), so every vehicle has its own date, build, LD and warranty.

| Field | Notes |
|---|---|
| `so_id`, `so_line_id`, `sequence` | |
| `quantity` | Always 1 for `rrv` lines |
| `consignee_name`, `consignee_address`, `consignee_gstin`, `consignee_state_code` | Railway orders often split delivery across consignees (e.g. 2 to Mumbai division, 1 to Pune). Defaults from the SO billing party. The ship-to state matters for e-way bills. |
| `contract_delivery_date` | The **original** contractual date. Never changed after confirmation, except by an approved amendment. |
| `current_delivery_date` | The contractual date after approved DP extensions (§4.8). Used for LD. |
| `committed_date` | Our internal promise (from Production's `target_handover_date`), for the "will it be late?" warning |
| `rrv_build_id` | FK `production_rrv_builds` (set when the build is created) |
| `erp_project_id` | FK `erp_projects` (the machine, once registered) |
| `status` | §5.3 |
| `dispatched_on`, `delivered_on` (POD date), `commissioned_on` | |
| `ld_weeks`, `ld_amount`, `ld_computed_at`, `ld_waived` | Computed (§6.6). Waived only through an approved DP extension "without LD". |
| `warranty_start`, `warranty_end` | Computed from the SO warranty rule (§6.8) |

> **ERP standard / why — schedule lines.** SAP SD has "schedule lines" under each order item for exactly this reason: one item (4 vehicles) has several delivery dates. LD, dispatch and invoicing all happen per delivery, not per order, so the delivery must be its own row. A single "delivery date" field on the order can't tell you that vehicle 3 is late while 1, 2 and 4 are fine.

## 4.4 `SalesOrderAmendment` (`sales_order_amendments`)

| Field | Notes |
|---|---|
| `so_id`, `amendment_no` | |
| `customer_amendment_ref`, `customer_amendment_date` | The customer's PO amendment letter |
| `reason` | Required |
| `changes` | JSON diff (header fields, lines, schedule rows: old → new). Built by the service from a draft copy, never typed. |
| `value_change` | New grand total − old |
| `status` | `draft` → `pending_approval` → `approved` (applied to the SO) / `rejected` / `cancelled` |
| `required_approval_level`, `approved_by_id`, `approved_at`, `rejection_reason` | |

## 4.5 `SalesBillingPlanLine` (`sales_billing_plan_lines`) — payment / billing milestones

The structured version of the payment terms. The free-text payment terms on a quotation ("30% advance, 60% on delivery, 10% on commissioning") become rows here.

| Field | Notes |
|---|---|
| `so_id`, `sequence` | |
| `milestone_type` | `advance` (against proforma / ABG), `drawing_approval`, `inspection` (on RITES/RDSO clearance), `dispatch` (pro-rata on dispatch), `delivery` (on POD / receipt by consignee), `commissioning`, `retention_release` (after warranty / PBG), `other` |
| `percent`, `amount` | One of them is entered; the other is computed against `grand_total` (or the per-unit value for pro-rata milestones) |
| `per_unit` | True for pro-rata milestones that trigger per vehicle (e.g. "60% of each vehicle's value on delivery") |
| `trigger_event` | Derived from `milestone_type`. Manual for `drawing_approval`, `other`. |
| `due_days` | Credit days after the trigger (defaults to the organisation's `credit_days`) |
| `recovers_advance_percent` | For delivery/dispatch milestones: what % of the advance is adjusted on each invoice (railway "pro-rata recovery of advance") |
| `status` | §5.4 |
| `triggered_at`, `proforma_id`, `ar_transaction_id`, `invoiced_amount` | |

Rules: the percentages of one SO must add up to 100 (409 with the real numbers otherwise, e.g. "Billing plan adds up to 90% — 10% is not scheduled. Add a retention or commissioning milestone, or correct a percentage."). Retention is a milestone, not a deduction.

> **ERP standard / why — the billing plan.** For capital goods (machines, vehicles, projects), invoicing isn't "one order = one invoice". SAP calls this a **milestone billing plan**: each slice of the contract value becomes billable when an event happens. Holding it as rows (not text) is what lets the system say "₹1.2 Cr is billable today because vehicles 1 and 2 were delivered" and "₹38 L of retention is locked until warranty ends".
>
> **Advances and GST:** since November 2017, no GST is payable on advances received for the supply of **goods** (Notification 66/2017-Central Tax). An RRV is goods, so an advance is requested with a **proforma** (no GST liability, no tax invoice number) and recorded by Finance as an on-account receipt. GST arises on the tax invoice at dispatch. A paid AMC or service contract is a service, where GST is due on the advance. That's why `order_type = service` is Phase 3 and needs Finance's sign-off on its flow.

## 4.6 `SalesProforma` (`sales_proformas`, + `sales_proforma_lines`), number `PFI/<FY>/<NNNN>` (`PI` is already Accounts' purchase-invoice voucher prefix)

`so_id`, `billing_plan_line_id` (nullable), `pi_date`, `valid_until`, lines (description, qty, rate, taxable, indicative GST), `total`, `purpose` (`advance`, `milestone`, `customer_budgeting`), `status` (`draft` → `issued` → `paid` / `cancelled`), `paid_payment_id` (FK `payment_transactions`, set when Finance tags the receipt). It is a Word document of record (D4), marked prominently "PROFORMA — NOT A TAX INVOICE". It is never posted.

## 4.7 `SalesDispatch` (`sales_dispatches`, + `sales_dispatch_lines`), number `DSP/<FY>/<NNNN>`

The `DN/` prefix is already used by Accounts debit notes, so this uses `DSP/`.

| Field | Notes |
|---|---|
| `so_id`, `dispatch_date`, `status` (§5.5) | |
| `consignee_*` | From the schedule rows (one consignee per dispatch) |
| `transporter_name`, `lr_number`, `lr_date`, `vehicle_or_trailer_no`, `driver_name`, `driver_phone` | Transport details |
| `mode` | `road_trailer`, `self_driven_road`, `rail` (moved on rails as rolling stock), `customer_pickup` |
| `ar_transaction_id` | The tax invoice that goes with the goods |
| `eway_bill_no`, `eway_bill_date` | Captured on the AR invoice (Finance), shown here |
| `store_issue_id` | FK to the Store `dispatch` issue (`store_material_issues`, `issue_type = "dispatch"`) that moved the stock and passed Quality Rule 8 |
| `pod_received_on`, `pod_received_by`, `pod_remarks`, `pod_attachment_id` | Proof of delivery (signed receipt / consignee's certificate) |
| `pdi_checklist` | JSON: the §31 "dispatch documents required" checklist (PDI report, handover certificate, invoice, e-way bill, inspection certificate), ticked with references |

Lines: `schedule_id`, `so_line_id`, `rrv_build_id`, `product_item_id`, `quantity`, `serial_number` (vehicle serial = batch for Store/Quality), `chassis_number`.

## 4.8 `SalesDeliveryExtension` (`sales_delivery_extensions`) — DP extension

`so_id`, `schedule_ids` (JSON), `requested_on`, `requested_new_date`, `reason_category` (`customer_cause` — e.g. late drawing approval or inspection delay by the agency; `force_majeure`; `our_cause`), `reason`, `customer_letter_ref`, `customer_letter_date`, `granted_new_date`, `with_ld` (bool — railway DP extensions are granted "with LD", "without LD" or "with token penalty"), `token_penalty_amount`, `status` (`requested` → `granted` / `refused`), and `attachment_id`. When granted, the schedule rows' `current_delivery_date` moves and LD is recomputed.

> **ERP standard / why — DP extension.** In railway and PSU supply, a late delivery is not automatically an LD. The supplier applies for a **delivery period extension**. If the delay was the customer's fault (late drawing approval, late inspection by RITES), it's usually granted *without* LD. Recording each extension with the customer's letter is what lets Finance contest a wrong LD deduction later. A system that just stores "delivery date" loses that evidence.

## 4.9 `SalesBankGuarantee` (`sales_bank_guarantees`) — Phase 3

`so_id`, `bg_type` (`pbg` performance, `abg` advance, `warranty`), `bg_number`, `bank_name`, `amount`, `issue_date`, `expiry_date`, `claim_expiry_date`, `status` (`requested` → `submitted` → `released` / `invoked` / `extended`), `attachment_id`. Daily reminder before expiry (§12). EMD stays in CRM (master plan §30 "EMD tracking").

## 4.10 Shared support tables

- `SalesApproval` (`sales_approvals`): `entity_type` (`sales_order`, `sales_amendment`, `crm_quotation` in Phase 3), `entity_id`, `revision` (amendment no. or quotation revision), `level`, `approver_id`, `decision` (`approved`, `rejected`, `returned`), `comment`, `decided_at`. One row per decision, which gives the approval history.
- `SalesAttachment` (`sales_attachments`): a polymorphic attachment table (`entity_type`, `entity_id`, `doc_type` = `customer_po`, `loa`, `amendment_letter`, `dp_extension_letter`, `pod`, `inspection_certificate`, `bank_guarantee`, `other`), using the P2P / Maintenance attachment columns and the SharePoint root folder `Sales-Orders`.
- `sales_settings`: the §27 settings pattern (§10).

## 4.11 Changes to other modules' tables

All columns are additive and nullable. Each change is phase-tagged and **owned by the target module's session** (§13).

| Table | New columns | Phase | Why |
|---|---|---|---|
| `production_rrv_builds` | `sales_order_id`, `sales_order_line_id`, `sales_schedule_id` (unique), `customer_id` (FK `crm_organizations`) | 1 | The SO ↔ vehicle link. `customer_id` replaces matching by free-text `customer_name`, which stays as a printed snapshot. |
| `erp_projects` | `customer_id` (FK `crm_organizations`), `sales_order_id`, `sales_schedule_id` | 2 | Machine registry → contract and customer master. Service can then show contract warranty and terms. |
| `ar_transactions` | `sales_order_id` (FK), `sales_billing_plan_line_id` (FK), `sales_dispatch_id` (FK) | 2 | A validated link instead of the free-text `reference_type/id`. The "billed vs order" report needs it. |
| `payment_transactions` | `sales_order_id` (FK, nullable) | 2 | Tag an advance receipt to its order |
| `crm_inquiries`, `crm_tenders` | None. The SO points at them (`source_*_id`). | — | CRM only shows a "Sales Order SO/26-27/0007" chip, using a read endpoint. |
| `crm_quotations` | None in Phase 1–2. Phase 3 (approval gate): none either — approvals live in `sales_approvals` keyed by `(quotation id, revision_number)`. | — | Keeps CRM's table untouched. |
| Store `material_issues` | None. `issue_type = "dispatch"` and `erp_project_id` already exist. Sales stores the issue id. | — | — |

**AR customer id:** the brief says AR "needs a CRM organisation id". It already has one. `ar_transactions.customer_id` is a non-null FK to `crm_organizations` in the committed code, and so is `payment_transactions.customer_id`. What AR lacks is the **order** link above.

---

# 5. Status machines

All transitions happen through explicit action endpoints. A generic status PATCH is not allowed. An invalid transition returns 409 with the real reason and the fix (for example: "Can't confirm SO draft #14: the billing plan adds up to 90%. Add the missing 10% or correct a milestone.").

## 5.1 Sales Order

```
draft ──submit──► pending_approval ──approve (final level)──► confirmed ──first build starts / first dispatch──► in_execution
  ▲                  │ return / reject                                                     │
  └──────────────────┘                                                                     ├──► partially_delivered ──► delivered ──► closed
                                                                                           │         (auto, from schedule rows)     (all billed and settled, or manual close by Sales Head)
on_hold ⇄ (from confirmed / in_execution / partially_delivered), reason required
cancelled   (from draft / pending_approval: maker; from confirmed with nothing built or billed: Sales Head + reason)
short_closed (from in_execution / partially_delivered: Sales Head + reason — customer reduces quantity; open schedule rows → cancelled)
```

- `approve` with more than one level moves through levels: Sales Head → Director → Partner. Each level is a `sales_approvals` row. The SO stays `pending_approval` until the required level has approved.
- **Four-eyes:** an approver can't be the maker (`submitted_by_id`). An admin stand-in is allowed only with a comment.
- `returned` sends the SO back to `draft` with a comment. `rejected` is final (the SO is cancelled).
- After `confirmed`, header, line and schedule edits are **only possible through an amendment** (§6.4). Exceptions that need no amendment: consignee contact details, transport details, `committed_date`, attachments and remarks.

## 5.2 Amendment
`draft` → `pending_approval` → `approved` (applied atomically, `amendment_no += 1`) / `rejected` / `cancelled`.

## 5.3 Schedule row (per vehicle / lot)
`open` → `build_planned` (RRV Build created) → `in_production` (build in progress) → `ready` (build completed, final inspection passed, TPI accepted if required) → `dispatched` → `delivered` (POD) → `commissioned` (Service record). `cancelled` (via amendment or short-close).

The service derives it from the linked build, dispatch and machine. It is never set by hand.

## 5.4 Billing plan line
`not_due` → `due` (trigger met, e.g. POD recorded) → `proforma_issued` (advance only) / `invoice_requested` (draft AR created) → `invoiced` (Finance posted it) → `settled` (AR `collection_status = collected`). `cancelled` (via amendment). Per-unit milestones split into one invoice request per vehicle.

## 5.5 Dispatch
`draft` → `checks_passed` (all blockers clear, §6.7) → `invoice_requested` → `invoiced` (AR posted, e-way bill captured) → `dispatched` (Store issue posted, gate out) → `delivered` (POD). `cancelled` from `draft` / `checks_passed` / `invoice_requested`. After `invoiced`, a cancellation needs Finance to cancel or credit-note the invoice first, and the error message says so.

---

# 6. Workflows

## 6.1 CRM win → Sales Order (§24 CRM → Sales)

```
Inquiry with an accepted quotation          Tender awarded (loi_number, contract_value)
   │  "Create Sales Order" (Sales app)         │  "Create Sales Order"
   ▼                                           ▼
SO draft: customer, contact, lines copied from the accepted quotation (or typed from the LOA schedule),
          payment terms → billing plan proposal, delivery_time → proposed schedule dates,
          inspection_req / warranty_req → agency / warranty fields, quantity → schedule rows (1 per RRV)
   │  maker adds customer PO no./date, PO PDF, consignees, LD clause, paying authority
   ▼
submit → approval (§6.2)
```

- The "Create Sales Order" button appears on the CRM inquiry/tender detail panel **only for users with `sales:orders:create`**. It is a deep link (`/dashboard/sales/orders/new?inquiry=<id>` or `?tender=<id>`), so no CRM route changes are needed in Phase 1.
- Guard: one live SO per inquiry/tender. A second attempt gets a 409 that names the existing SO.
- When the SO is **confirmed**, Sales calls a small CRM service hook (`crm.services.won.mark_won(db, source, so)`). It sets inquiry `status = "Won"` (or tender `status = "Won"`, stage "Awarded / Lost"), writes a `CrmStageLog` "Sales Order SO/… confirmed", and from then on CRM shows its post-PO stages as read-only. Until the CRM session adds that hook, the SO stores the link and CRM is updated by hand (§13).

## 6.2 Approval

- At submit, the service computes `grand_total`, `deviation_flags` and `required_approval_level`:
  - `≤ limit_sales_head` and no deviation → Sales Head
  - `≤ limit_director` → Sales Head, then Director
  - above that, **or any deviation flag** → Sales Head, then Director, then Partner. Each level must be a different person.
- Submit is blocked (422 listing every problem) unless: the customer has a valid GSTIN or state (same check as `create_ar_transaction`, so the order can be invoiced later); there's a PO number and date plus a PO attachment; every `rrv` line is fully scheduled; the billing plan adds up to 100%; LD fields are complete when `ld_applicable`; and the warranty rule is set.
- **Credit check (warn):** if the customer's outstanding AR + open SO value > `credit_limit`, the approver sees a warning banner with the numbers. Blocking is a setting, off by default, because Railway/PSU customers don't default, they pay late.
- Notifications to the next approver go to Teams (approval request).

## 6.3 Confirmation → OA → RRV Builds (§24 Sales → Production)

On the final approval, in one transaction:
1. Issue `so_number` (`SO/<FY>/<NNNN>`) and set `status = confirmed`.
2. Snapshot the customer's name, GSTIN and address.
3. **Create one planned RRV Build per `rrv` schedule row** (setting `auto_create_rrv_builds`, default on). The build gets: `rrv_model`, `customer_id`, `customer_name`, `customer_po_number` / `date`, `order_reference = so_number`, `sales_*` ids, `branch_id`, `target_handover_date = current_delivery_date − dispatch_buffer_days` (setting, default 7), and `warranty_months` from the contract. Production's `build_number` generator is used through a Production **service** function (`production.service.create_rrv_build`), which has to be extracted from the route first (§13).
4. Notify the production planners of the plant (bell) and the maker (bell).
5. **Order Acknowledgement:** a Word document of record (managed document `sales_order_ack`, D4). It contains the SO number, customer PO reference, lines and prices, the delivery schedule per consignee, the billing plan, LD, warranty, inspection agency and "our understanding of special conditions". "Issue OA" records `oa_issued_at`. Sending is done by the user (email/portal), as with quotations.

> **ERP standard / why — the OA.** The OA is your one chance to say "we accepted your PO on *these* terms" in writing. If the customer's PO quietly changed the LD cap or the delivery date from what was quoted, the OA is where that gets caught and agreed. Without one, the customer's PO terms win by default.

## 6.4 Amendments (customer changes the order)

The customer sends a PO amendment (quantity, date, consignee, price, terms). Sales creates an amendment, which opens a draft copy of the SO. The diff is computed. Approval follows the same value/deviation rules, using `abs(value_change)` and the new deviation flags. On approval the change is applied atomically:
- Added units get new schedule rows and new planned builds.
- Removed units cancel their schedule rows. If a removed unit's build has started, the amendment is blocked with a message naming the build, and Production decides first (cancel the build or re-assign it to another order).
- A new date moves `contract_delivery_date`. This is the only way it changes.
- Billing plan changes re-check the 100% rule and never touch already-invoiced milestones.

The OA can be re-issued as "OA — Amendment 1".

## 6.5 Advance and proforma

```
Billing plan line "advance 20%" ── Sales: Issue proforma PFI/26-27/0003 (Word) ──► customer
      (if the contract needs an ABG, the BG row (Phase 3) must be `submitted` first — warning in Phase 2)
Customer pays ──► Finance records a customer receipt (payment_type=customer, unallocated, sales_order_id tag)
      ──► the billing line → settled; the proforma → paid
Later delivery invoices ──► Finance allocates the advance per `recovers_advance_percent`
```

## 6.6 Delivery tracking, DP extension and LD

- A daily job (`backend/app/tasks/sales_scheduler.py`, 06:30 Asia/Kolkata, registered in `main.py` startup, idempotent per day) recomputes for every open schedule row:
  - **Late risk:** `committed_date` (from the build's `target_handover_date`) > `current_delivery_date` → "at risk".
  - **Overdue:** today > `current_delivery_date` and not delivered → "overdue". The LD accrued so far is computed.
- **LD formula (railway default):**
  `delay_days = delivery_date − current_delivery_date` (delivery date = POD date for FOR-destination orders, dispatch date for ex-works orders);
  `periods = ceil(delay_days / 7)` for `per week or part thereof`;
  `ld = min(rate% × periods × unit_value, max% × basis)`, where `unit_value` is the vehicle's taxable value and `basis` is the delayed value (or contract value, per `ld_basis`).
  Example: a ₹1.2 Cr vehicle delivered 17 days late at 0.5%/week (cap 10%) → 3 weeks → 1.5% → ₹1.8 L.
- LD is **computed and shown, never posted**. When the customer actually deducts it from a payment, Finance books it (credit note or journal, Finance's decision, §15 Q8). The SO shows "LD as per contract" next to "LD actually deducted" (from the payment's short-paid amount, Phase 3).
- DP extension (§4.8): requested by Sales, granted or refused on receipt of the customer's letter. "Granted without LD" sets `ld_waived` on the affected rows.

> **ERP standard / why — LD is a forecastable cost, not a surprise.** LD in railway contracts (typically ½% per week, capped at 10%) can wipe out the margin on a vehicle. Mature ERPs compute it *before* it happens from the production forecast, so management can decide to prioritise a build, ask for a DP extension, or accept the LD. That's why the dashboard shows "LD exposure" (§7) driven from Production's target dates.

## 6.7 Dispatch and invoice (the GST order matters)

```
Schedule row ready (build final inspection passed; RRV Completion done; TPI accepted if required)
   │  Sales: New dispatch (pick ready rows of one consignee; transport details)
   ▼
checks_passed  ← quality.services.dispatch.check(item, qty, serial, erp_project_id) returns [] for every line,
   │             plus the §31 document checklist (PDI report ref, inspection certificate ref)
   │  Sales: Request invoice → accounts.create_ar_transaction(draft; lines from the SO at SO price;
   │         customer PO no./date; consignee as shipping address; sales_* links)
   ▼
invoice_requested ──► Finance reviews, enters e-way bill / e-invoice IRN, POSTS (SI/26-27/NNNN)
   ▼
invoiced ──► Store: dispatch issue of the vehicle (issue_type=dispatch, serial as batch, erp_project_id)
             — Rule 8 runs again inside Store; the issue id is stored on the dispatch
   ▼
dispatched (gate out) ──► delivered (POD date, received by, POD file) ──► billing milestones "delivery" → due
```

- **The invoice comes before the goods leave**, not after the handover. Under GST, the tax invoice for goods must be issued at or before removal (CGST Act s.31(1)(a)), and the vehicle travels with the invoice and an e-way bill (consignments above ₹50,000). The master plan line "dispatch note … triggers AR invoice" is therefore implemented as **dispatch request → invoice → gate out**.
- Moving a vehicle **without a sale** (for example to a customer's site for a trial, to RDSO for type testing, or to a job-worker) is not a dispatch. It needs a **delivery challan** (CGST Rule 55) and is out of scope here (§15 Q9).
- Production "handover" vs Sales "delivery": Production handover (stage 13) is the vehicle leaving production and being accepted for dispatch, and it is where the machine is registered. Sales delivery is the customer receiving it at the consignee. On FOR-destination orders they are different dates, and LD and (often) warranty run from **delivery**.
- Spares orders (`order_type = spares`) follow the same flow without builds. Store's dispatch issue checks free stock and Rule 8.

## 6.8 Commissioning and warranty start

- Commissioning is recorded in **Service** (§19 — the only commissioning lifecycle). It writes `erp_projects.commissioning_date`. Sales reads it and sets the schedule row to `commissioned`, which makes the `commissioning` billing milestone `due`.
- **Warranty** is computed by one Sales function, `sales.service.contract_warranty(schedule)`, with this rule:
  - `from_delivery`: start = delivered_on, end = start + months_from_delivery
  - `from_commissioning`: start = commissioned_on, end = start + months_from_commissioning (until commissioning, a provisional end of `delivered_on + months_from_delivery` is shown)
  - `earlier_of`: end = min(delivered_on + M_d, commissioned_on + M_c); start = delivered_on. This is the typical railway clause, "30 months from delivery or 24 months from commissioning, whichever is earlier".
- It is written onto `erp_projects.warranty_start_date` / `warranty_end_date` / `warranty_terms` **whenever delivery or commissioning is recorded**. Today `production.service.apply_rrv_handover` sets warranty = handover date + `warranty_months`. Once Production applies the change in §13, a build that has `sales_schedule_id` calls `contract_warranty` instead. Builds without an SO keep today's behaviour.

> **ERP standard / why — warranty start.** Warranty is a **contract term**, not a production fact. Starting it at the factory handover (today's code) gives the customer less warranty than they bought when the vehicle then takes three weeks to reach site and two months to commission. Under an "earlier of" clause it can also give *more* than they bought, if the vehicle sits uncommissioned for a year. Service decides free vs chargeable repairs from this date, so it has to come from the contract.

## 6.9 Billing milestones → invoices

- The daily job and the event hooks (POD recorded, commissioning recorded, inspection call accepted) move billing lines from `not_due` to `due`. Each move notifies Finance and the SO owner (bell) and appears in **Sales → Billing → Due to bill**.
- "Request invoice" on a due line creates a draft AR invoice (as in §6.7). Dispatch-linked milestones are requested from the dispatch itself, so the same slice is never requested twice. The service refuses a second request for a line already `invoice_requested` / `invoiced`.
- **Retention** (for example 10% until the end of warranty or against a PBG) stays `not_due` until its trigger. A reminder goes out when it falls due (§12).

## 6.10 Close and short-close

- `delivered` → `closed` happens automatically when all schedule rows are delivered (or cancelled), all billing lines are settled or cancelled, and no BG is open. Otherwise the Sales Head can close manually with a reason. This lists what remains open, for example "₹12.4 L retention not yet invoiced".
- `short_closed`: the customer cancels the balance quantity. Open schedule rows become `cancelled`, planned builds that haven't started are cancelled through Production's service (started builds block it, with the build number named), and billing lines are re-proportioned through an amendment.

## 6.11 Quotation approval (Phase 3, CRM coordination)

The master plan §6.1 asks for quotation approval (Sales Head; Director/Partner above limits; discount above `max_discount_without_approval`). Design:
- `sales/quotations` lists all `crm_quotations` with value, discount, validity, revision and approval state.
- "Submit for approval" creates `sales_approvals` rows for `(quotation_id, revision_number)`.
- CRM blocks recording `submitted_date` (sent to customer) for a quotation revision that needs approval and doesn't have it. This needs a **one-line hook in `crm/routes/workflow.py:update_quotation`**, owned by the CRM session.
- A revision changes `revision_number`, so the earlier approval no longer applies. That is the correct behaviour.

---

# 7. Reports and dashboard

| Report | Definition |
|---|---|
| **Order book** | Confirmed and in-execution SOs: value, delivered value, balance value, by customer, zone, model and month of order |
| **Backlog by delivery month** | Undelivered schedule rows by `current_delivery_date` month, with qty and value. Shows at-risk and overdue rows. |
| **Delivery performance (OTD)** | % of units delivered on or before `contract_delivery_date` (strict) and before `current_delivery_date` (after extensions) |
| **LD exposure** | Accrued LD (overdue rows) + forecast LD (at-risk rows, using `committed_date`), by SO. Compared with LD actually deducted (Phase 3). |
| **Billing status** | Per SO: billing plan vs proforma vs invoiced vs received, and due-to-bill today |
| **Retention and BG register** | Retention locked and its release dates; BGs by expiry (Phase 3) |
| **Quote win rate** | From CRM: quotations sent vs SOs created, by owner, customer type and model (Phase 3) |
| **Warranty register** | Delivered vehicles: contract warranty start and end, by customer (read from machines) |

The dashboard (`/dashboard/sales`) shows: tiles for open order value, units due this month, overdue units, LD accrued, and due to bill; plus lists of approvals waiting for me, schedule rows at risk (with build stage), dispatches waiting for an invoice, and DP extensions pending.

---

# 8. API design

All routers are prefixed `/sales/...`, tagged `["Sales"]`, and included in `main.py` with the `/api/v1` prefix. Access uses `require_tab_action("sales", <subtab>, <action>)`.

| Router file | Endpoints |
|---|---|
| `routes/orders.py` | `GET/POST /sales/orders`, `GET/PATCH/DELETE /sales/orders/{id}` (PATCH and DELETE only in `draft`), `GET /sales/orders/prefill?inquiry=&tender=` (draft payload built from CRM), `POST /{id}/submit`, `/approve`, `/return`, `/reject`, `/hold`, `/resume`, `/cancel`, `/short-close`, `/close`, `POST /{id}/issue-oa`, `GET /{id}/timeline`, `PUT /{id}/lines`, `PUT /{id}/schedule`, `PUT /{id}/billing-plan` (draft only) |
| `routes/amendments.py` | `GET/POST /sales/orders/{id}/amendments`, `PATCH /sales/amendments/{aid}`, `POST /{aid}/submit`, `/approve`, `/reject`, `/cancel` |
| `routes/schedule.py` | `GET /sales/schedule` (cross-order, filters: status, month, at-risk, overdue, customer), `PATCH /sales/schedule/{sid}` (consignee contact and committed date only), `GET/POST /sales/orders/{id}/extensions`, `POST /sales/extensions/{eid}/grant`, `/refuse` |
| `routes/billing.py` | `GET /sales/billing/due`, `POST /sales/billing-lines/{bid}/proforma`, `POST /sales/billing-lines/{bid}/request-invoice`; `GET/POST /sales/proformas`, `GET /sales/proformas/{pid}`, `POST /{pid}/issue`, `/cancel` |
| `routes/dispatches.py` | `GET/POST /sales/dispatches`, `GET/PATCH /sales/dispatches/{did}`, `GET /{did}/checks` (all blockers, read-only), `POST /{did}/request-invoice`, `POST /{did}/mark-dispatched` (requires invoice posted and the Store issue), `POST /{did}/pod`, `POST /{did}/cancel` |
| `routes/guarantees.py` (Phase 3) | CRUD + `/release`, `/extend`, `/invoke` |
| `routes/documents.py` | Upload, download (`/content` proxy) and delete attachments. Word documents of record through `managed_documents.register` for `sales_order_ack`, `sales_proforma`, `sales_dispatch_note`. |
| `routes/dashboard.py`, `routes/reports.py` | Aggregates and Excel export |
| `routes/settings.py` | The §27 pattern: `GET/PUT /sales/settings`, `POST /sales/settings/reset/{key}` |
| `routes/lookups.py` | Enums, customers (from CRM, with GSTIN state), products, inspection agencies (from the Quality master list), approvers |
| **Read endpoints for other modules** | `GET /sales/orders/by-source?inquiry=&tender=` (CRM chip), `GET /sales/schedule/by-build/{build_id}` (Production build header shows the SO, due date and LD rate). These use `require_any_app_access("sales", "crm")` / `("sales", "production")`, following the P2P precedent. |

All cross-module writes go through **service functions, never HTTP**: `crm.services.won.mark_won`, `production.service.create_rrv_build` / `cancel_rrv_build`, `accounts.service.create_ar_transaction`, `store` dispatch-issue service, `quality.services.dispatch.check`.

---

# 9. Frontend

| Route | Page |
|---|---|
| `sales/page.tsx` | Dashboard (§7) |
| `sales/orders/` `page`, `new`, `[id]` | SO list (status, customer, month and at-risk filters). The form is pre-filled from `?inquiry=` / `?tender=`. The detail view has a status stepper and action buttons, and tabs: **Overview · Lines · Delivery Schedule · Billing Plan · Amendments · Dispatches · Documents · Approvals · Timeline**. The LD panel on the schedule tab shows accrued and forecast LD per vehicle. |
| `sales/delivery/` `page`, `new`, `[id]` | Dispatch list and **schedule board** (all open vehicles by due month, with build stage and readiness), dispatch form, and dispatch detail with a **checks panel** that shows every blocker in plain words (Rule 8 messages from Quality, invoice not posted, POD missing) |
| `sales/billing/page.tsx` (new folder) | Due to bill, proformas, and the invoice-requested / invoiced / settled view per SO |
| `sales/quotations/page.tsx` | Phase 3: quotation register and approval queue over CRM quotations. Rows deep-link to the CRM inquiry. |
| `sales/pricing/page.tsx` | Phase 3: price list per RRV model with effective-from dates (§10) |
| `sales/reports/page.tsx` | Reports (§7) with export |
| `sales/settings/page.tsx` | Shared `<ModuleSettings module="sales"/>` |
| `sales/opportunities/` | **Delete the scaffold.** Opportunities are CRM inquiries and tenders; a second pipeline would duplicate CRM. |

Components in `frontend/src/components/sales/`: `SalesNav.tsx` (copied from `ProductionNav`, with a `TABS` array with `subtabKey`, `filterTabsByAccess`, `NotificationBell` and `TourButton`), `SalesOrderForm.tsx`, `ScheduleEditor.tsx`, `BillingPlanEditor.tsx`, `SalesOrderActions.tsx`, `DispatchChecksPanel.tsx`, `LdPanel.tsx`, `SalesStatusBadge.tsx`.

Cross-module UI (read-only chips, each owned by that module's session): the CRM inquiry/tender panel gets a "Create Sales Order" button or an "SO/… (status)" chip; the Production RRV build header gets "SO/…, due dd-mm-yyyy, LD x%/week"; the Service machine page gets "Contract warranty per SO/…".

UI rules that apply to every page:
- The nav renders above the header.
- The "← Back" button uses the secondary pill style at the top-right of the header row.
- Use `ConfirmDialog` / `PromptDialog` and never browser dialogs. For example, the reasons for return, reject, hold, cancel and short-close go through `PromptDialog`.
- Error banners show the backend's real message.
- Forms follow `premnathrail-ui-behavior` for searchable selects (customer, product, consignee), dates and uploads.

---

# 10. Settings (§31; values only, no metadata customization)

Only the settings that Phase 1–3 code reads.

| Key | Type | Default | Read by |
|---|---|---|---|
| `sales_head_id` | user | Head of the Sales/BD department | Approval routing |
| `approval_limit_sales_head` | decimal (₹) | 50,00,000 (owner undecided as of 2026-10-07; editable, §15 Q1) | Approval routing |
| `approval_limit_director` | decimal (₹) | 2,00,00,000 (to confirm) | Approval routing. Above this → Partner. |
| `standard_ld_max_percent` | decimal | 10 | Deviation flag `ld_cap_above_standard` |
| `standard_warranty_months_max` | int | 30 | Deviation flag `warranty_above_standard` |
| `standard_min_advance_percent` | decimal | 0 (flag off) | Deviation flag `advance_below_standard` |
| `default_ld_rate_percent`, `default_ld_period`, `default_ld_basis` | decimal / select / select | 0.5 / week / delayed_value | New SO defaults |
| `default_warranty` | json | 30 months from delivery / 24 from commissioning / earlier_of | New SO defaults |
| `auto_create_rrv_builds` | bool | on | Confirmation |
| `dispatch_buffer_days` | int | 7 | Build `target_handover_date` |
| `credit_check_mode` | select | warn (`off`, `warn`, `block`) | Approval |
| `dispatch_documents_required` | multi_select | PDI report, inspection certificate (if TPI), tax invoice, e-way bill | Dispatch checklist |
| `at_risk_reminder_days` | int | 14 (warn when a build's committed date is past the due date, or the due date is within N days and the build isn't at final inspection) | Daily job |
| `bg_expiry_reminder_days` | int | 30 | Phase 3 |
| `max_discount_without_approval` | decimal | 5 | Phase 3 quotation approval, `price_below_list` flag |

**Masters** (small tables under Settings → Masters, active/inactive): DP-extension reason categories are a coded tuple (not a master); **Terms & conditions templates** (payment, delivery, warranty, LD wording, used as starting text on the SO/OA); **Price list per RRV model with effective-from** (Phase 3, `sales_price_lists` + lines). The **inspection agencies** list is reused from Quality's master (`inspection_agencies`), not duplicated.

**Not built:** "Auto-create Project on order confirmation" (§31). It's blocked by D2 until P5. "Default GST rate for RRV 18%" is also not a Sales setting: GST comes from the item's HSN in Finance (`TaxLineMixin.gst_rate`), so there is a single source. **Locked in code (not settings):** four-eyes on approvals, SO edits only via amendment after confirmation, invoice before gate-out, and no posting from Sales.

---

# 11. Wiring checklist

This is every file a new module touches. Missing items here have broken deploys before.

**Backend**
- [ ] `modules/sales/{models,routes,schemas,reports}/__init__.py`, `service.py` (approval routing, deviation flags, LD, warranty, status derivation), `settings.py` (`SETTING_SPECS`)
- [ ] Add `"sales"` to `AVAILABLE_APPS` in `main/models/user.py:10`
- [ ] Add a `MODULES["sales"]` entry with subtabs in `core/permission_registry.py`
- [ ] Import the models in **both** `backend/alembic/env.py` and `main.py` (model-import-sync rule), and include the routers in `main.py`
- [ ] Add `register_audited(...)` for every model in `core/audit_registry.py`
- [ ] Alembic migration: create the `sales_*` tables, add the columns to `production_rrv_builds` (Phase 1; defensive `inspect` checks, `batch_alter_table`), and seed the `modules` row with a DELETE in `downgrade()`. Chain off the **current** head: `e7c4a1b9d2f5` today, with 6+ untracked migrations from other sessions. Run `alembic heads` immediately before writing `down_revision`. The Phase 2 migration (`erp_projects`, `ar_transactions`, `payment_transactions` columns) is separate.
- [ ] `managed_documents.register(DocumentAdapter(...))` for `sales_order_ack`, `sales_proforma`, `sales_dispatch_note`, plus the docx builders in `sales/reports/`
- [ ] Register the daily `sales_scheduler` job in the `main.py` startup handler
- [ ] Number series prefixes `SO`, `PFI`, `DSP` through `accounts.services.fiscal.next_number`. They avoid the Accounts `VOUCHER_TYPES` prefixes (`PI` = purchase invoice, `DN` = debit note, `SI` = sales invoice).
- [ ] `backend/app/tests/test_sales.py`: approval routing (value × deviation × four-eyes), confirm creates N builds, amendment diff (add, remove, started-build block), billing plan 100% rule, LD maths (part-week, cap, FOR vs ex-works date, waiver), warranty rules (all four), dispatch ordering (no gate-out before posted invoice), Rule 8 pass-through, double invoice-request guard

**Frontend**
- [ ] Add `'sales'` to the `AppModule` union in `types/index.ts:1` and to the literal union in `hooks/useAuth.ts` (`useRequireApp`)
- [ ] Add a Sidebar icon and entry in `components/Sidebar.tsx`, after CRM
- [ ] Add a landing card in `app/dashboard/page.tsx`
- [ ] Add `salesApi` in `lib/api.ts` and the interfaces in `types/index.ts`
- [ ] Add `ENTITY_LINK` entries (`sales_order`, `sales_amendment`, `sales_dispatch`, `sales_proforma`, `sales_extension`) in `components/erp/NotificationBell.tsx`
- [ ] Add tour configs in `lib/tour/configs/sales*.ts` and register them in `lib/tour/registry.ts`. The CRM tour configs also need updating when the "Create Sales Order" button lands on the CRM panels (pre-push CRM tour rule).
- [ ] Delete `dashboard/sales/opportunities/`, and add `dashboard/sales/billing/` and `dashboard/sales/settings/`

**Docs**
- [ ] Turn this plan into `docs/02-modules/sales/overview.md` once built. Update `docs/02-modules/crm/overview.md` (remove the dropped CRM "Purchase Order" sub-entity and point to Sales) and `docs/02-modules/production/rrv-build.md` (SO link, contract warranty). Add a changelog entry.

---

# 12. Notifications

Notifications use `notify_user` / `broadcast_notification`. Following the Teams rule, **only approval requests and reminders pass `teams=True`**. Everything else is bell-only.

| Type | Recipients | When | Teams |
|---|---|---|---|
| `sales_order_approval_needed` | The next-level approver | SO submitted / previous level approved | **Yes** (approval) |
| `sales_amendment_approval_needed` | The next-level approver | Amendment submitted | **Yes** (approval) |
| `sales_order_returned` / `sales_order_rejected` | Maker | Returned or rejected | No |
| `sales_order_confirmed` | Maker, production planners of the plant, Finance (broadcast `app_name="accounts"`) | Confirmed (builds created) | No |
| `sales_approval_pending_reminder` | Pending approver | Daily while waiting > 2 days, at most once per day (the `hr_reminders.py` "don't notify twice" check) | **Yes** (reminder) |
| `sales_delivery_at_risk` | SO owner, Sales Head, build manager | Daily job: a row turns at-risk | **Yes** (reminder) |
| `sales_delivery_overdue` | SO owner, Sales Head | Daily while overdue, at most once per day | **Yes** (reminder) |
| `sales_billing_due` | Finance users, SO owner | A billing line turns due | No |
| `sales_invoice_requested` | Finance users | Draft AR invoice created from a dispatch or milestone | No (it is a work item, not an approval) |
| `sales_invoice_pending_reminder` | Finance users | A dispatch is waiting > 1 day for invoice posting | **Yes** (reminder) |
| `sales_retention_due` / `sales_bg_expiring` | SO owner, Finance | Retention trigger met / BG within `bg_expiry_reminder_days` (Phase 3) | **Yes** (reminder) |
| `sales_dispatch_delivered` | SO owner, Service (broadcast `app_name="erp"`) | POD recorded | No |

---

# 13. Collision notes and sequencing (files other sessions are editing now)

From `git status` on 07-Oct-2026 (about 518 changed paths). **Re-read each file immediately before editing, and make small anchored insertions only** (parallel sessions rule).

| File / area | Current state | Sales's touch | Handling |
|---|---|---|---|
| `crm/routes/inquiries.py`, `tenders.py`, `workflow.py`, `crm/schemas/organization.py`, `crm/models/__init__.py`, `components/crm/InquiryDetailPanel.tsx`, `TenderDetailPanel.tsx`, `OrganizationForm.tsx`, CRM tour configs | **Modified, uncommitted (CRM session)** | Phase 1: **none.** Sales only *reads* `crm_*` models. Phase 1 end: "Create SO" button / SO chip on the two panels, plus a new file `crm/services/won.py`. Phase 3: one guard in `update_quotation`. | Wait for the CRM session to commit. Then hand it the button/chip and the `won.py` hook as one small, separate commit with a tour update. |
| `accounts/models/*` (incl. `ar_transaction.py`, `payment_transaction.py`), `accounts/service.py`, `accounts/routes/*` (about 30 files) + untracked migration `a8c3e5f7b9d1_accounts_standards_upgrade.py` | **Accounts standards upgrade in flight** (FY series, line-wise GST, ledger roles) | Phase 1: none. Phase 2: call `create_ar_transaction` (its signature is changing in that work); add the `sales_*` FKs to `ar_transactions` and `payment_transactions`. | **Phase 2 starts only after the Accounts upgrade is committed and deployed.** Re-read the `create_ar_transaction` signature then. Ask the Accounts session to add the FK columns (their migration chain), or add them in the Sales Phase 2 migration with their agreement. |
| `production/routes/rrv_builds.py`, `dashboard/production/rrv-builds/[id]/page.tsx`, `ProductionNav.tsx` | **Modified, uncommitted (Production/Quality session)** | Phase 1: the 4 columns on `production_rrv_builds`; **extract `create_build` logic into `production.service.create_rrv_build` / `cancel_rrv_build`**. Phase 2: the `apply_rrv_handover` warranty hook; the SO chip on the build header. | The service extraction is a **Production-owned, no-behaviour-change commit, done first.** Sales Phase 1 can ship the schedule without auto-created builds (manual "Link build" on a schedule row) if the extraction is late. That is the fallback, so Production doesn't block Sales. |
| `erp/routes/projects.py`, `service_requests.py`, `erp/models/service_request.py`, `ErpNav.tsx`, `dashboard/erp/**` | **Modified (Service session)** | Phase 2: `customer_id`, `sales_order_id`, `sales_schedule_id` on `erp_projects`; contract warranty written onto machines; commissioning date read | Phase 2, after the Service session commits. Service owns the commissioning record. |
| `quality/services/dispatch.py`, `quality/models/inspection_call.py` | Just committed (`aa9b49f`); other Quality files modified | Read-only reuse of `check()` | No edits. If Quality wants calls tied to an SO instead of a machine, that is Quality's later change. |
| `store` dispatch issue | Clean | Call the Store issue service with `issue_type="dispatch"` | Confirm a service-level function exists (not route-local). If it doesn't, the Store owner extracts it. |
| `core/permission_registry.py`, `core/audit_registry.py`, `main.py`, `alembic/env.py`, `main/models/user.py`, `core/module_visibility.py` (**staged as deleted**) | Modified by several sessions | Anchored inserts | Standard shared-registry care. Check whatever replaced `module_visibility.py` (module lock / allow-list) also needs `sales`. |
| `backend/alembic/versions/` | 6+ untracked migrations; head `e7c4a1b9d2f5` | One migration per phase | `alembic heads` immediately before writing `down_revision`. Upgrade the dev DB only to our own revision. |
| `frontend/src/lib/api.ts`, `types/index.ts`, `components/erp/NotificationBell.tsx`, `app/dashboard/page.tsx` | Modified (uncommitted) | Anchored inserts | Same |

**Recommended order:** (1) Production commits the `create_rrv_build` service extraction → (2) Sales Phase 1 (new tables + build columns, no CRM/Accounts edits) → (3) CRM button/hook commit → (4) the Accounts upgrade lands → Sales Phase 2 → (5) the Service session lands → the machine link and warranty hook.

---

# 14. Phased delivery

**Phase 1: Order book and delivery schedule (no money flows)**
- Module wiring (§11) and settings (approval and default groups)
- SO create (from inquiry, tender or blank) with lines, schedule (one row per RRV, consignees), billing plan (stored, validated at 100%), LD and warranty fields, attachments
- Submit → value + deviation approval routing (Sales Head / Director / Partner), four-eyes, Teams on approvals
- Confirm → SO number, **planned RRV Builds created and linked** (fallback: manual link), OA Word document
- Amendments with diff and approval
- Hold, cancel, short-close
- Schedule board, at-risk / overdue daily job, LD computation (shown, not posted), DP extensions
- Dashboard: order book, backlog, LD exposure
- Tests

*Exit criterion:* a won inquiry for 3 RRVs becomes SO/26-27/0001 approved by the Sales Head and the Director (with the maker ≠ approver lock proven). Production sees 3 planned builds carrying the customer id and PO. A customer amendment moving vehicle 3 by four weeks goes through approval, and the backlog report and the LD forecast change accordingly.

**Phase 2: Billing and dispatch hand-off (after the Accounts upgrade is deployed)**
- Proforma (Word, "not a tax invoice"); advance receipts tagged to the SO
- Billing lines due by event; "Request invoice" → draft AR with the `sales_*` FKs; settled from AR collection status
- Dispatch note with the checks panel (Quality Rule 8 + document checklist), invoice-before-gate-out ordering, Store dispatch issue link, POD
- `erp_projects` customer/SO link; contract warranty (all four rules) written onto machines at delivery and commissioning; the Production handover hook
- CRM `mark_won` hook and the SO chip
- Billing status and warranty register reports; reminders

*Exit criterion:* for one vehicle, a 20% advance proforma is paid and tagged. The vehicle can't be gated out until Finance posts SI/26-27/… with an e-way bill, and RITES clearance is enforced via Rule 8. The POD makes the 60% delivery milestone due, and its invoice recovers the advance pro-rata. The machine shows "warranty to <date>, earlier of 30 months from delivery / 24 months from commissioning". The SO reaches `delivered`.

**Phase 3: Commercial controls and extensions** (each is independent, pick by need)
- Quotation register and approval over CRM quotations (with the CRM hook)
- Price lists per model and the `price_below_list` deviation
- Bank guarantees (PBG / ABG / warranty BG) with expiry reminders and the retention-against-PBG link
- LD actually deducted vs contract LD (from short-payments) and the LD dispute pack (DP extension letters)
- Quote win rate report
- Service/AMC orders (GST on advance for services, with Finance)
- Export orders (currency, LUT) if needed

*Exit criterion:* no quotation above the discount limit reaches a customer unapproved. Management sees per SO the contract LD vs the LD actually deducted and the BG release dates.

---

# 15. Open questions (recommended default in **bold**; Phase 1 proceeds on the default)

1. **Approval limits.** What are the ₹ limits for Sales Head → Director → Partner? **Default: ₹50 L / ₹2 Cr, editable in Settings.** Should *every* RRV order need a Partner (a typical RRV order is likely to exceed ₹2 Cr anyway)?
   *Status 2026-10-07: still **undecided** by the owner. The defaults (₹50 L / ₹2 Cr) stay as editable Sales settings (`approval_limit_sales_head`, `approval_limit_director` in Sales → Settings), so the limits can be set later without a code change.*
2. **Who is the Sales Head?** There is no `is_sales_head` flag. **Default: a `sales_head_id` setting, falling back to the head of the Sales/BD department.** Does Sales/BD exist as a department in Organization today?
3. **One SO per inquiry/tender?** The master plan's acceptance says "exactly one". **Default: yes, one live SO per source.** A repeat order from the same customer is a new inquiry. Railway "repeat orders" (option clause, +30% quantity) are an **amendment** of the original SO. Confirm.
4. **RRV model as an Item Master finished-good item** (Engineering plan Q2). **Default: SO lines carry `crm_product_id` now, and `product_item_id` becomes mandatory for RRV lines from Phase 2** (needed for the Store dispatch issue and Rule 8). Who creates the FG items: Design head or Store?
5. **Warranty basis.** **Default: per contract, with "earlier of 30 months from delivery / 24 months from commissioning" as the template.** Production's current "12 months from handover" stays only for builds without an SO. Is the company's own standard (for non-railway customers) different?
6. **LD date for FOR-destination orders.** **Default: POD (receipt by consignee) date; ex-works orders use the dispatch date.** Some railway contracts count the date of *inspection clearance* + dispatch. Should a per-SO "LD reckoning date" choice be added?
7. **Dispatch ordering.** **Default: hard rule — no gate-out until the tax invoice is posted.** Is there a business case (e.g. a vehicle driven to a nearby customer and invoiced on acceptance) that needs a **delivery challan** path? If so, it's a Phase 3 item with Finance.
8. **LD accounting.** When the customer deducts LD, does Finance book it as a credit note (reduces turnover) or as an expense via journal? GST treatment of LD should be confirmed with the CA (CBIC Circular 178/10/2022 discusses LD). **Default: Sales only computes and shows LD; Finance decides the booking.**
9. **Vehicle movements that aren't sales** (trials at a customer's site, RDSO type tests, demo units). **Default: out of scope for Sales**; they need a delivery-challan document in Store/Finance. Do these happen often enough to plan now?
10. **Currency and exports.** Quotations already support `quotation_type = Export`. **Default: INR-only SOs in Phase 1–2;** export (currency, exchange rate, LUT, shipping bill) is Phase 3 on demand. Are export orders expected this year?
11. **Credit check.** **Default: warn, not block** (railway customers pay late but don't default). Should private contractors be blocked above their credit limit?
12. **Who may create an SO?** **Default: anyone with `sales:orders:create`, usually the inquiry's BD owner.** CRM today restricts quotation creation to the inquiry owner or an admin. Should the SO follow the same rule?
13. **Spares orders.** R1 says the RRV is the only product, but Service sells spares to customers. **Default: `order_type = spares` is supported** (dispatch from Store stock, no builds). Or should spares sales stay in Service (`erp` field materials) for now?
14. **PM project per order (D2).** **Default: no link and no auto-creation until P5.** Master plan §31's "auto-create Project" setting is parked. Confirm that the PM team keeps typing the customer PO as free text until then.
