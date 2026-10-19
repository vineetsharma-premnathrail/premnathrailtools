# Finance & Accounting Module — End-to-End Overview

> Code ke current state par based (2026-10-06).
> Backend: `backend/app/modules/accounts/` · Frontend: `frontend/src/app/dashboard/finance/`

---

## 1. Basic structure

- **Module key:** `accounts` — display name "Finance & Accounting". Har API par `require_app_access("accounts")` lagta hai.
- **URL:** `/dashboard/finance` → auto-redirect to `/dashboard/finance/masters`
- **Main tabs (5)** — `frontend/src/components/finance/FinanceNav.tsx`:

| # | Tab | Kaam |
|---|---|---|
| 1 | **Masters** | Chart of Accounts, Bank, Vendor, Internal Orders |
| 2 | **Ledger** | Manual journal entries, reversal, period close/reopen |
| 3 | **AR / AP** | Vendor invoices (payables) + Customer invoices (receivables) |
| 4 | **Banking** | Bank reconciliation + Liquidity (cash) forecast |
| 5 | **Reports** | Trial Balance, P&L, Balance Sheet, Aging, Variance, Close Pack |

> `finance/assets`, `finance/budgets`, `finance/expenses` folders bane hain lekin **khali** hain — Fixed Assets, Budgeting, Expense claims abhi built nahi hain.

---

## 2. Tab-wise detail — inputs aur actions

### Tab 1: MASTERS (4 sub-tabs)

#### a) GL Accounts (Chart of Accounts)
- **Inputs:** Code\*, Name\*, Account Type (asset / liability / equity / revenue / expense), Sub Type, Opening Balance, Status (active/inactive), Posting Account (yes/no), Control Account (yes/no)
- **Actions:** Add, Edit, Delete (confirm dialog ke saath)
- **Rules:**
  - *Posting account* = isme entry ho sakti hai. Group/header account (jaise "Current Assets") me direct posting nahi hoti.
  - *Control account* (AP/AR) = sub-ledger se reconcile hota hai.
- **Seeded standard codes** jinpar system auto-post karta hai:

| Code | Account |
|---|---|
| 1130 | Accounts Receivable |
| 1150 | GST Input Credit |
| 2010 | Accounts Payable |
| 2020 | GST Output Payable |

#### b) Bank Accounts
- **Inputs:** Bank Name\*, Account No.\* (create ke baad lock), Account Holder, Branch, IFSC, Opening Balance (create ke baad lock), Status (active / inactive / closed), linked GL account
- **Rule:** `current_balance` kabhi haath se edit nahi hota — sirf postings se badalta hai.
- ⚠️ Bank ke saath GL account link nahi hai to us bank se payment/collection **block** ho jaata hai.

#### c) Vendors (poore ERP ka vendor master)
- **Inputs:** Code\*, Name\*, GSTIN, PAN, Address, City, State, PIN, Contact Name/Phone/Email, Bank Name, Bank A/c No., IFSC, Account Holder, Credit Limit, Payment Days, Early-payment discount %, Reconciliation GL account, Status (active / inactive / blocked)
- **Payment Days** se invoice ki due date nikalti hai (`invoice_date + payment_days`).

#### d) Internal Orders (budgeted spend tracker)
- **Inputs:** Code\*, Name\*, Description, Order Type (capital / maintenance / IT / training), Start/End Date, Budgeted Amount, GL Account, Cost Center, Status (open / in_progress / completed / closed)
- **Actual aur variance store nahi hote** — report ke time linked journal lines se calculate hote hain.

---

### Tab 2: LEDGER

#### New Journal Entry
- **Inputs:** Posting Date, Description, multiple lines → har line me GL Account, Debit **ya** Credit, optional Cost Center / Internal Order, Remarks
- **Actions:** Add/Remove line, **Post**

**Validation rules** — `post_journal_entry()` poore system me journal entry banane wala **akela function** hai:
1. Kam se kam 2 lines
2. Har line me **sirf ek** — debit ya credit (dono nahi, negative nahi)
3. Inactive / group account me posting nahi
4. **Total Debit = Total Credit**, warna error
5. Period **closed** hai to posting refuse

- Number format: `JE-YYYY-NNNN`
- Har posting `GLBalance` (account × month) ko update karti hai.

#### Recent Journal Entries → **Reverse**
- Reason compulsory.
- Original entry kabhi edit/delete nahi hoti — ek **nayi** entry banti hai jisme debit/credit ulte hote hain, aur original "reversed" mark hoti hai (audit standard).

#### Period Close / Reopen
| Action | Kaun kar sakta hai | Rule |
|---|---|---|
| **Close** | Finance Manager ya Admin | Us month ki koi vendor/customer invoice "pending" hai to block. Close hone par us month ke saare GL balances lock. Notes optional. |
| **Reopen** | **Sirf Admin** | Reason compulsory |

---

### Tab 3: AR / AP

#### AP — Vendor Invoices (Payables)

**Record Vendor Invoice — inputs**
- Purchase Order (sirf `issued / acknowledged / partially_fulfilled / fulfilled` POs dikhte hain)
- Invoice Number (vendor ka apna)
- Invoice Date, Quantity, Amount (pre-GST), GST
- Expense / Inventory GL Account

**3-Way Match (PO ↔ GRN ↔ Invoice)** — save se pehle live preview:

| Check | Result |
|---|---|
| PO ka PR approval (Purchase Head / Director / MD) complete nahi | ❌ Hard stop |
| GRN me koi maal accept nahi hua | ❌ Hard stop (receipt se pehle invoice nahi) |
| Total invoiced > approved PO value | ❌ Hard stop (PO amend karna padega) |
| Qty variance > **2%** ya Amount variance > **1%** (received − pehle se invoiced ke against) | ⚠️ "variance" → approval chahiye |
| Tolerance ke andar | ✅ "matched" |

- Same vendor + same invoice number dobara record nahi hota (duplicate block).

**Actions (per row)**

| Action | Kya hota hai |
|---|---|
| **Approve Variance** | Sirf Finance Manager, aur jo record karne wala nahi hai. Note optional. |
| **Post** | `Dr Expense/Inventory` + `Dr GST Input (1150)` / `Cr AP (2010 ya vendor ka recon account)` |
| **Pay / Record Payment** | Inputs: Bank account, Amount, Mode (cheque / NEFT / RTGS / cash), Payment Date → `Dr AP / Cr Bank GL`. Number `PAY-YYYY-NNNN`. Partial allowed, amount due se zyada nahi. |
| **Cancel** | Invoice cancel |

> **Maker-Checker:** jisne invoice record kiya, wo khud approve / post / pay **nahi** kar sakta — admin par bhi lagta hai. Ek akela banda poora fraud cycle nahi chala sakta.

#### AR — Customer Invoices (Receivables)

**Record Customer Invoice — inputs**
- Customer (CRM Organization), Amount, GST, Discount, Revenue GL Account
- Invoice number system generate karta hai: `ARINV-YYYY-NNNN`

**Actions**

| Action | Kya hota hai |
|---|---|
| **Post** | `Dr AR (1130)` / `Cr Revenue` + `Cr GST Output (2020)` |
| **Collect / Record Collection** | Inputs: Bank, Amount, Mode, Date → `Dr Bank / Cr AR`. Status: pending → partial → collected / overdue |

- Dunning level sirf informational counter hai — auto reminder letters nahi jaate.

---

### Tab 4: BANKING

#### Bank Reconciliation
- **Inputs:** Bank Account, Statement Date, Statement Balance (bank statement se)
- System us waqt ka **book balance snapshot** le leta hai.

**Flow**
1. Us bank ke uncleared payments ki list dikhti hai.
2. Jo statement me aa gaye unko tick → **Mark Selected as Reconciled**
3. **Complete Reconciliation** — sirf tab chalega jab difference = 0, warna exact difference error me dikhta hai.

- Outstanding cheques / deposits-in-transit haath se enter nahi hote — unreconciled payments se calculate hote hain.
- **Reconciliation History** → purane recon **Open** karke dekh sakte ho.

#### Liquidity Forecast (read-only)
- Columns: Period, Inflows (AR), Outflows (AP), Net, Projected Balance
- Buckets: Overdue, 0–30 din, 31–60 din, 61+ din
- Starting point = saare active bank accounts ka current balance

---

### Tab 5: REPORTS (5 sub-tabs)

| Report | Kya dikhata hai |
|---|---|
| **Trial Balance** | Har GL account ka Dr/Cr, period-wise + **View Monthly Close Pack** button |
| **P&L Statement** | Revenue − Expense |
| **Balance Sheet** | Assets = Liabilities + Equity |
| **AR / AP Aging** | Kitna paisa kitne din se pending (buckets) |
| **Variance Analysis** | Internal Order: Budget vs Actual |
| *(API only)* GL Ledger | Ek account ki saari transactions |

---

## 3. Poora workflow

```
MASTERS SETUP (ek baar)
  Chart of Accounts → Bank Accounts (GL link zaroori) → Vendors → Internal Orders
        │
        ▼
PROCURE-TO-PAY (AP)
  P2P: PR → PO approval (PH/Dir/MD) → PO issued
  Store: GRN + inspection → accepted qty
  Finance: Record Vendor Invoice → 3-way match
        → [variance?] Finance Manager approve (maker nahi ho sakta)
        → Post (Dr Expense + GST In / Cr AP)
        → Pay  (Dr AP / Cr Bank)        ← maker-checker
        │
ORDER-TO-CASH (AR)
  CRM Customer → Record Customer Invoice → Post (Dr AR / Cr Revenue + GST Out)
        → Collect (Dr Bank / Cr AR)
        │
        ▼
MANUAL JOURNALS (adjustments, accruals, corrections) → galti ho to Reverse
        │
        ▼
MONTH END
  Bank Reconciliation (difference 0) → saari pending invoices post/cancel
  → Close Period (Finance Manager) → Reports / Monthly Close Pack
  → (zarurat ho to) Reopen — sirf Admin + reason
```

---

## 4. Doosre modules se connection

| Module | Connection | Direction |
|---|---|---|
| **P2P (Purchase)** | Vendor invoice **compulsory** P2P PO ke against. PR/PO approval status check. PO ka vendor **naam se** Finance vendor master se match hota hai (P2P me vendor abhi free text). | P2P → Finance |
| **Store (GRN)** | 3-way match ke liye GRN accepted qty. Store stock-entry ka "Vendor" dropdown Finance vendor master se. | Store ↔ Finance |
| **CRM** | AR invoice ka customer = `crm_organizations`. CRM org me `gl_reconciliation_account_id` field. | CRM → Finance |
| **Maintenance** | Assets / work orders ka vendor dropdown Finance vendor master se. | Finance → Maintenance |
| **Organization** | Cost Center ↔ GL account link. Journal lines + Internal Orders cost center lete hain. Company Financial Year yahin. | Org ↔ Finance |
| **Auth / Users** | `user.is_finance_manager` → variance approve, period close. Admin → reopen. | — |
| **Audit Log** | Har post / reverse / close / reopen / recon action log hota hai. | — |
| **HR / Payroll** | **Koi connection nahi** — payroll ADP me. `salary` posting type reserved, unused. | ❌ |

---

## 5. Gaps / ERP-standard ke hisaab se dhyan dene wali baatein

1. **Store → GL auto-posting nahi hai.** GRN par `Dr Inventory / Cr GR-IR` nahi banta, stock issue par consumption post nahi hota → Balance Sheet ka inventory ≠ Store stock value. `production_settlement` posting type defined hai par unused.
2. **AR invoice kisi Sales Order / Dispatch se linked nahi** — amount aur revenue account manually type hote hain → galti aur revenue leakage ka risk.
3. **P2P vendor free text hai**, naam se match hota hai — spelling mismatch = invoice record nahi hoga. P2P PO ko proper `vendor_id` FK chahiye.
4. **India-specific missing:** TDS deduction, CGST/SGST/IGST split (abhi GST ek lump amount), Credit/Debit notes, Advance payments, E-invoice/IRN.
5. **Paise `Float` me store** — accounting standard `Numeric(15,2)` hai; float se paisa-level rounding issue aa sakta hai.
6. **Fixed Assets + depreciation, Budgets, Expense claims** abhi nahi bane (khali folders).
7. **Customer payment terms master nahi** — AR due date manually; vendor ke liye payment days master me hai.

**Priority suggestion:** pehle Store → GL posting aur TDS / GST split — inke bina books statutory audit me tikengi nahi.
