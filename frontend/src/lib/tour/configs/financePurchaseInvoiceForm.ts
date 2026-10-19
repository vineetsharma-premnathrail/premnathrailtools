import { TourConfig, TourStep } from '../types'
import { taxLineSteps } from './financeTaxLinesSteps'

export const PURCHASE_INVOICE_FORM_STEPS: TourStep[] = [
  {
    target: 'fin-pinv-mode',
    title: 'Against PO / Direct',
    options: [
      { value: 'Against PO', meaning: 'For material bought on a purchase order. The bill is checked against the PO and the goods received (3-way match).' },
      { value: 'Direct (no PO)', meaning: 'For services and expenses with no PO — rent, electricity, courier, professional fees.' },
    ],
    why: 'The 3-way match (PO ↔ GRN ↔ bill) stops paying for goods that were never ordered or never received, or at a higher price than agreed.',
  },
  {
    target: 'fin-pinv-po',
    title: 'Purchase order',
    required: true,
    purpose: 'Shown in "Against PO" mode. Only issued / acknowledged / received POs are listed.',
    whatToEnter: 'Search by PO number or vendor and pick the PO this bill is for.',
    after: 'The vendor is filled in from the PO. A red note means no vendor master matches the PO\'s vendor — add it under Masters → Vendors first.',
  },
  {
    target: 'fin-pinv-vendor',
    title: 'Vendor',
    required: true,
    purpose: 'Shown in "Direct (no PO)" mode — the supplier who issued the bill. Blocked vendors are not listed.',
  },
  {
    target: 'fin-pinv-bill-no',
    title: 'Vendor bill no.',
    required: true,
    whatToEnter: "The vendor's invoice number exactly as printed on their bill.",
    validExample: 'HT/24-25/0187',
    invalidExample: 'Our own GRN number or PO number',
    why: 'GST input credit is matched against the vendor\'s GSTR-1 by this number — a typo means the credit may not match.',
  },
  {
    target: 'fin-pinv-date',
    title: 'Bill date',
    required: true,
    whatToEnter: 'The date printed on the vendor bill (not the date you received it).',
  },
  {
    target: 'fin-pinv-due',
    title: 'Due date (optional)',
    purpose: 'When the bill must be paid. Leave blank to use bill date + the vendor\'s payment days (shown under the box).',
    why: 'Drives the payables ageing and the cash-flow forecast.',
  },
  {
    target: 'fin-pinv-pos',
    title: 'Place of supply',
    purpose: 'The state where the supply is received — defaults to our own state.',
    why: 'If the vendor\'s state differs from the place of supply, the bill carries IGST; otherwise CGST + SGST.',
  },
  {
    target: 'fin-pinv-round-off',
    title: 'Round-off (₹)',
    whatToEnter: 'The paise adjustment printed on the bill, plus or minus. Must be less than ₹1.',
    validExample: '-0.40',
    invalidExample: '5',
  },
  {
    target: 'fin-pinv-rcm',
    title: 'Reverse charge (RCM)',
    purpose: 'Tick when WE pay the GST to the government instead of the vendor — e.g. GTA freight, legal fees, notified goods from unregistered suppliers.',
    after: 'The vendor is owed only the taxable value; the GST goes to RCM payable and is claimed back as input credit.',
  },
  ...taxLineSteps('bill', 'Purchases or the vendor\'s default expense ledger'),
  {
    target: 'fin-pinv-payable',
    title: 'Payable to vendor',
    purpose: 'Taxable value + GST (left out under RCM) + round-off — what we will owe the vendor once posted.',
  },
  {
    target: 'fin-pinv-narration',
    title: 'Narration',
    purpose: 'Optional note on what the bill is for. It appears on the journal entry.',
    validExample: 'Hose fittings for Tamper unit #4',
  },
  {
    target: 'fin-pinv-save',
    title: 'Record invoice',
    purpose: 'Saves the bill as Pending.',
    after:
      'The bill appears in the list as Pending. A different finance user must then Post it (maker-checker). A bill with a 3-way-match variance needs a Finance Manager to approve the variance first. Posting creates the journal and the bill becomes payable.',
  },
  {
    target: 'fin-pinv-close',
    title: 'Cancel',
    purpose: 'Leaves the form without saving and returns to the list.',
  },
  {
    target: 'fin-pinv-back',
    title: '← Back',
    purpose: 'Leaves the form without saving and returns to the list — same as Cancel.',
  },
]

const config: TourConfig = {
  id: 'finance-purchase-invoice-form',
  pageTitle: 'Finance — Record purchase invoice',
  steps: [
    {
      target: 'fin-pinv-form',
      title: 'Record purchase invoice',
      purpose: 'Book a vendor bill exactly as printed. Once posted it cannot be edited — corrections are made with a debit note.',
    },
    ...PURCHASE_INVOICE_FORM_STEPS,
  ],
}

export default config
