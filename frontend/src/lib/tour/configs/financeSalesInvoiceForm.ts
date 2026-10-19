import { TourConfig, TourStep } from '../types'
import { taxLineSteps } from './financeTaxLinesSteps'
import { EINVOICE_FIELD_STEPS } from './financeEInvoiceSteps'

export const SALES_INVOICE_FORM_STEPS: TourStep[] = [
  {
    target: 'fin-sinv-customer',
    title: 'Customer',
    required: true,
    purpose: 'The customer (a CRM organization) being billed.',
    whatToEnter: 'Search by name or GSTIN and pick the customer.',
    after: 'Their GSTIN and credit days show below; Place of supply and Billing address are filled in from the customer master.',
    why: 'Customers are kept in CRM so sales and accounts share one master — fix a wrong GSTIN or address there.',
  },
  {
    target: 'fin-sinv-date',
    title: 'Invoice date',
    required: true,
    purpose: 'Date of supply / invoice. Due date = this date + the customer\'s credit days (30 if none set).',
  },
  {
    target: 'fin-sinv-pos',
    title: 'Place of supply',
    required: true,
    purpose: 'The state where goods are delivered — taken from the customer\'s GSTIN, changeable for a different delivery state.',
    why: 'Same state as ours → CGST + SGST; different state → IGST. Charging the wrong one means the customer cannot claim the credit.',
  },
  {
    target: 'fin-sinv-po-no',
    title: 'Customer PO no.',
    purpose: 'The customer\'s purchase order number, printed on the invoice. Optional but most customers (esp. Railways) reject bills without it.',
    validExample: 'NR/STORES/2024/1187',
  },
  {
    target: 'fin-sinv-po-date',
    title: 'Customer PO date',
  },
  {
    target: 'fin-sinv-billing',
    title: 'Billing address',
    purpose: 'Address printed as "Bill to" — filled from the customer; edit if needed.',
  },
  {
    target: 'fin-sinv-shipping',
    title: 'Shipping address',
    purpose: 'Where the goods go. Leave blank if same as billing, or use "Copy billing address".',
  },
  ...taxLineSteps('invoice', 'Sales'),
  {
    target: 'fin-sinv-round-off',
    title: 'Round-off (₹)',
    whatToEnter: 'Paise adjustment to reach a round total, less than ₹1 either way.',
    validExample: '0.35',
    invalidExample: '2',
  },
  {
    target: 'fin-sinv-total',
    title: 'Invoice total',
    purpose: 'Taxable value + GST + round-off — what the customer owes.',
  },
  {
    target: 'fin-sinv-narration',
    title: 'Narration',
    purpose: 'Optional note shown on the journal entry.',
  },
  {
    target: 'fin-sinv-einv-toggle',
    title: 'E-invoice / e-way bill',
    purpose: 'Opens optional fields for the IRN and e-way bill. They can also be added later from the list with "E-invoice / e-way bill".',
    autoActivateOnAdvance: true,
  },
  ...EINVOICE_FIELD_STEPS,
  {
    target: 'fin-sinv-save',
    title: 'Save draft',
    purpose: 'Saves the invoice as a Draft (no tax-invoice number yet).',
    after:
      'Another finance user must "Issue / Post" it. Only then does it get its number (SI/FY/NNNN), post to the books and become receivable.',
    why: 'GST Rule 46 needs one consecutive invoice series with no gaps — numbering only at issue means a cancelled draft never leaves a hole.',
  },
  {
    target: 'fin-sinv-close',
    title: 'Cancel',
    purpose: 'Leaves the form without saving and returns to the list.',
  },
  {
    target: 'fin-sinv-back',
    title: '← Back',
    purpose: 'Leaves the form without saving and returns to the list — same as Cancel.',
  },
]

const config: TourConfig = {
  id: 'finance-sales-invoice-form',
  pageTitle: 'Finance — New sales invoice',
  steps: [
    {
      target: 'fin-sinv-form',
      title: 'New sales invoice',
      purpose: 'Raise a GST tax invoice to a customer.',
    },
    ...SALES_INVOICE_FORM_STEPS,
  ],
}

export default config
