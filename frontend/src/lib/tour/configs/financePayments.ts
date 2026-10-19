import { TourConfig } from '../types'
import { PAYMENT_FORM_STEPS } from './financePaymentForm'

const config: TourConfig = {
  id: 'finance-payments',
  pageTitle: 'Finance — Payments & Receipts',
  steps: [
    {
      target: 'finance-nav-rupee',
      title: 'Payments',
      purpose: 'Every rupee in or out of the bank or cash: vendor payments, customer receipts, expenses, other receipts and contra transfers.',
    },
    {
      target: 'fin-subtab-all',
      title: 'Voucher type tabs',
      purpose: 'All shows every voucher; the other tabs narrow the list to one type.',
      options: [
        { value: 'Vendor Payments', meaning: 'Payments to suppliers (PV).' },
        { value: 'Customer Receipts', meaning: 'Money received from customers (RV).' },
        { value: 'Expense Payments', meaning: 'Direct expense payments split across ledgers (PV).' },
        { value: 'Other Receipts', meaning: 'Non-customer income received (RV).' },
        { value: 'Contra', meaning: 'Transfers between our own bank and cash accounts (CV).' },
      ],
    },
    {
      target: 'fin-pay-from',
      title: 'From',
      purpose: 'Start date — defaults to the start of the financial year (1 April).',
    },
    {
      target: 'fin-pay-to',
      title: 'To',
      purpose: 'End date — defaults to today.',
    },
    {
      target: 'fin-pay-status',
      title: 'Status filter',
      options: [
        { value: 'Posted', meaning: 'In the books.' },
        { value: 'Cancelled', meaning: 'Cancelled with a reason; its journal was reversed and its bill allocations released.' },
      ],
    },
    {
      target: 'fin-pay-table',
      title: 'Voucher list',
      purpose: 'Click a row to see its ledger lines and which bills it settled (with Remove to undo an allocation). "Unallocated" (amber) is an advance not yet set against a bill.',
      options: [
        { value: 'Bank reco: Unreconciled', meaning: 'Not yet matched with the bank statement.' },
        { value: 'Bank reco: Reconciled / Cleared', meaning: 'Matched in BRS — the money really went through the bank. Such a voucher cannot be cancelled.' },
        { value: 'Allocate (row)', meaning: 'Set an advance off against the party\'s open bills.' },
        { value: 'Cancel (row)', meaning: 'Reverses the journal and releases its bills (they become due again). Asks for a reason.' },
      ],
    },
    {
      target: 'fin-pay-new-btn',
      title: '+ New voucher',
      purpose: 'Record a payment, receipt or transfer.',
      after: 'Opens the voucher form at the top — the next steps explain each field. Tip: "Pay" / "Receive" links on Purchase, Sales and Outstanding open this form pre-filled for that party.',
      autoActivateOnAdvance: true,
    },
    ...PAYMENT_FORM_STEPS,
  ],
}

export default config
