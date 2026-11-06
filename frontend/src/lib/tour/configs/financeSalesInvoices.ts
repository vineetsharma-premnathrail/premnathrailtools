import { TourConfig } from '../types'
import { SALES_INVOICE_FORM_STEPS } from './financeSalesInvoiceForm'

const config: TourConfig = {
  id: 'finance-sales-invoices',
  pageTitle: 'Finance — Sales Invoices',
  steps: [
    {
      target: 'finance-nav-tag',
      title: 'Sales',
      purpose: 'GST tax invoices to customers and credit notes (sales returns).',
    },
    {
      target: 'fin-subtab-sales-invoices',
      title: 'Sales Invoices',
      purpose: 'All tax invoices with their GST, e-invoice status and collection status.',
      autoActivate: true,
    },
    {
      target: 'fin-subtab-credit-notes',
      title: 'Credit Notes',
      purpose: 'Sales returns and reductions of an issued invoice.',
    },
    {
      target: 'fin-sinv-status',
      title: 'Filter',
      purpose: 'Opens the Filter panel with Status, Collection and Customer (show one customer\'s invoices only). Choices apply at once.',
      options: [
        { value: 'Status: Draft', meaning: 'Saved, no tax-invoice number yet, not in the books. Waiting for a second finance user to issue.' },
        { value: 'Status: Issued', meaning: 'Numbered, posted to the books and receivable from the customer.' },
        { value: 'Status: Cancelled', meaning: 'A draft cancelled with a reason — it never got a number.' },
        { value: 'Collection: Uncollected', meaning: 'Nothing received yet, not yet past due.' },
        { value: 'Collection: Part received', meaning: 'Some money or a credit note set off; balance still due.' },
        { value: 'Collection: Overdue', meaning: 'Past its due date with a balance outstanding — chase it.' },
        { value: 'Collection: Received', meaning: 'Fully collected.' },
      ],
    },
    {
      target: 'fin-sinv-table',
      title: 'Invoice list',
      purpose:
        'Click an invoice number to expand lines, addresses, IRN / e-way bill and receipt history. "Overdue" shows days past due. IRN / EWB badges mean the e-invoice / e-way bill is recorded.',
      options: [
        { value: 'Issue / Post (row)', meaning: 'Gives the draft its invoice number and posts it. Only a finance user other than the one who drafted it.' },
        { value: 'Cancel (row)', meaning: 'Cancels a draft (asks for a reason). An issued invoice is corrected with a credit note instead.' },
        { value: 'E-invoice / e-way bill (row)', meaning: 'Record or update the IRN, ack and e-way bill details — no amounts change.' },
        { value: 'Receive (row)', meaning: 'Opens Payments for this customer to record money received.' },
      ],
    },
    {
      target: 'fin-sinv-new-btn',
      title: '+ New sales invoice',
      purpose: 'Raise a new tax invoice.',
      after: 'Opens the invoice form above the list — the next steps explain each field.',
      autoActivateOnAdvance: true,
    },
    ...SALES_INVOICE_FORM_STEPS,
  ],
}

export default config
