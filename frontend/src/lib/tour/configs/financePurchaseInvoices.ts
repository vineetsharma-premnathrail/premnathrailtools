import { TourConfig } from '../types'
import { PURCHASE_INVOICE_FORM_STEPS } from './financePurchaseInvoiceForm'

const config: TourConfig = {
  id: 'finance-purchase-invoices',
  pageTitle: 'Finance — Purchase Invoices',
  steps: [
    {
      target: 'finance-nav-cart',
      title: 'Purchase',
      purpose: 'Vendor bills and debit notes (purchase returns) are booked here.',
    },
    {
      target: 'fin-subtab-purchase-invoices',
      title: 'Purchase Invoices',
      purpose: 'Every vendor bill — against a PO or direct — with its GST, match result, posting and payment status.',
      autoActivate: true,
    },
    {
      target: 'fin-subtab-debit-notes',
      title: 'Debit Notes',
      purpose: 'Purchase returns and reductions of a vendor bill (rate difference, discount, shortage).',
    },
    {
      target: 'fin-pinv-status',
      title: 'Status filter',
      options: [
        { value: 'Pending', meaning: 'Recorded but not yet in the books — waiting for a second finance user to post (or for variance approval).' },
        { value: 'Posted', meaning: 'In the books with a journal; now payable to the vendor.' },
        { value: 'Cancelled', meaning: 'Cancelled before posting, with a reason. No ledger effect.' },
      ],
    },
    {
      target: 'fin-pinv-payment',
      title: 'Payment filter',
      options: [
        { value: 'Unpaid', meaning: 'Nothing paid or adjusted yet.' },
        { value: 'Part paid', meaning: 'Some payment or debit note set off; a balance is still due.' },
        { value: 'Paid', meaning: 'Fully settled.' },
      ],
    },
    {
      target: 'fin-pinv-type',
      title: 'Type filter',
      options: [
        { value: 'Against PO', meaning: 'Material bills linked to a purchase order (3-way matched).' },
        { value: 'Direct', meaning: 'Service / expense bills with no PO.' },
        { value: 'Opening', meaning: 'Unpaid bills carried in from the old books via Opening Balances.' },
      ],
    },
    {
      target: 'fin-pinv-vendor-filter',
      title: 'Vendor filter',
      purpose: 'Show bills of one vendor only.',
    },
    {
      target: 'fin-pinv-table',
      title: 'Bill list',
      purpose: 'Click a bill number to expand its lines, GSTIN, PO/GRN quantities and settlement history. "RCM" under GST marks a reverse-charge bill.',
      options: [
        { value: 'Match: Matched', meaning: 'Bill agrees with PO and goods received within tolerance.' },
        { value: 'Match: Variance', meaning: 'Bill differs from PO/GRN beyond tolerance — cannot be posted until approved.' },
        { value: 'Match: Variance approved', meaning: 'A Finance Manager accepted the difference with a note.' },
        { value: 'Match: No PO', meaning: 'Direct bill — no match applies.' },
        { value: 'Approve variance (row)', meaning: 'Finance Manager / admin only, and not the person who recorded the bill.' },
        { value: 'Post (row)', meaning: 'Puts the bill in the books. Only a different finance user than the one who recorded it (maker-checker).' },
        { value: 'Cancel (row)', meaning: 'Cancels a pending bill; asks for a reason.' },
        { value: 'Pay (row)', meaning: 'Opens Payments for this vendor to pay the balance due.' },
      ],
      why: 'Maker-checker means no single person can both book and approve a bill — a basic control against fraud and errors.',
    },
    {
      target: 'fin-pinv-new-btn',
      title: '+ Record purchase invoice',
      purpose: 'Book a new vendor bill.',
      after: 'Opens the bill form above the list — the next steps explain each field.',
      autoActivateOnAdvance: true,
    },
    ...PURCHASE_INVOICE_FORM_STEPS,
  ],
}

export default config
