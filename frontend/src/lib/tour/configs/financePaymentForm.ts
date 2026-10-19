import { TourConfig, TourStep } from '../types'

export const PAYMENT_FORM_STEPS: TourStep[] = [
  {
    target: 'fin-pay-type',
    title: 'Voucher type',
    required: true,
    options: [
      { value: 'Vendor payment (PV)', meaning: 'Paying a supplier against their bills (or as an advance).' },
      { value: 'Customer receipt (RV)', meaning: 'Money received from a customer against their invoices (or as an advance).' },
      { value: 'Expense payment (PV)', meaning: 'Paying an expense with no vendor bill — bank charges, petty expenses, salaries advance. Split it across ledgers.' },
      { value: 'Other receipt (RV)', meaning: 'Money in that is not from a customer invoice — interest, scrap sale, refund.' },
      { value: 'Contra — bank/cash transfer (CV)', meaning: 'Moving our own money between bank and cash accounts (deposit, withdrawal, bank-to-bank).' },
    ],
    why: 'Each type posts a different journal: PV = money out, RV = money in, CV = between our own accounts. A GST bill should be booked in Purchase first and then paid as a vendor payment, or the input credit is lost.',
  },
  {
    target: 'fin-pay-party',
    title: 'Vendor / Customer',
    required: true,
    purpose: 'Shown for vendor payments and customer receipts — whom the money is paid to / received from.',
    after: 'Their open bills load below so you can settle them bill-wise.',
  },
  {
    target: 'fin-pay-date',
    title: 'Date',
    required: true,
    purpose: 'Date the money actually moved (as on the bank statement). It cannot fall in a closed period.',
  },
  {
    target: 'fin-pay-amount',
    title: 'Amount (₹)',
    required: true,
    whatToEnter: 'The total amount paid or received.',
    validExample: '118000',
    invalidExample: '0 or a negative number',
  },
  {
    target: 'fin-pay-bank',
    title: 'Bank / cash account',
    required: true,
    purpose: 'The account the money leaves (payments) or lands in (receipts). For contra, the paying account. Its current book balance shows below after you pick it.',
    why: 'Cash cannot go below zero — record a withdrawal (contra) first if needed.',
  },
  {
    target: 'fin-pay-counter-bank',
    title: 'To (receiving) account',
    required: true,
    purpose: 'Contra only — the other bank/cash account that receives the money. Must differ from the paying account.',
  },
  {
    target: 'fin-pay-mode',
    title: 'Mode',
    options: [
      { value: 'Cheque', meaning: 'Asks for cheque number (required) and cheque date.' },
      { value: 'NEFT / RTGS / IMPS / UPI', meaning: 'Electronic transfer — enter the UTR as reference.' },
      { value: 'Demand Draft', meaning: 'DD — enter the DD number as reference.' },
      { value: 'Cash', meaning: 'Only offered when a cash account is picked.' },
    ],
  },
  {
    target: 'fin-pay-cheque-no',
    title: 'Cheque no.',
    required: true,
    purpose: 'Cheque mode only.',
    validExample: '004512',
  },
  {
    target: 'fin-pay-cheque-date',
    title: 'Cheque date',
    purpose: 'Date written on the cheque (may be post-dated).',
  },
  {
    target: 'fin-pay-reference',
    title: 'UTR / reference',
    purpose: 'The bank\'s transaction reference (UTR) for electronic transfers.',
    validExample: 'HDFCR52024100712345678',
    why: 'Makes matching with the bank statement (BRS) quick and certain.',
  },
  {
    target: 'fin-pay-open-bills',
    title: 'Open bills (bill-wise settlement)',
    purpose: 'The party\'s unpaid bills, oldest first. Enter how much of this voucher clears each bill, use "Pay / Receive in full", or "Auto-settle oldest first".',
    after: 'Whatever is not allocated stays "On account" as an advance — it shows in Outstanding and can be set off against a later bill.',
    why: 'Bill-wise settlement keeps each invoice\'s due amount and ageing correct, not just the party total.',
  },
  {
    target: 'fin-pay-split-lines',
    title: 'Ledger lines',
    purpose: 'Expense payment / other receipt only — split the amount across ledgers, each with an optional cost centre and remark.',
    whatToEnter: 'Pick the ledger and amount on each line. "Use full amount" fills a single line.',
    invalidExample: 'Lines totalling ₹9,500 on a ₹10,000 voucher — the totals must match.',
  },
  {
    target: 'fin-pay-narration',
    title: 'Narration',
    purpose: 'What this money is for — shows on the voucher and journal.',
    validExample: 'Part payment against bills of Sept for hose fittings',
  },
  {
    target: 'fin-pay-save',
    title: 'Post voucher',
    purpose: 'Posts the voucher straight to the books with a PV/RV/CV number.',
    after: 'A confirmation shows the voucher number and any advance left on account; the bank balance and the party\'s bills update immediately.',
  },
  {
    target: 'fin-pay-clear',
    title: 'Clear',
    purpose: 'Empties the form (keeps the voucher type).',
  },
  {
    target: 'fin-pay-close',
    title: 'Cancel',
    purpose: 'Leaves the form without saving and returns to the voucher list.',
  },
  {
    target: 'fin-pay-back',
    title: '← Back',
    purpose: 'Leaves the form without saving and returns to the voucher list — same as Cancel.',
  },
]

const config: TourConfig = {
  id: 'finance-payment-form',
  pageTitle: 'Finance — New payment / receipt voucher',
  steps: [
    {
      target: 'fin-pay-form',
      title: 'New voucher',
      purpose: 'Record money paid or received. A posted voucher is never edited — cancel it (which reverses the journal) and record it again.',
    },
    ...PAYMENT_FORM_STEPS,
  ],
}

export default config
