import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-gstr1',
  pageTitle: 'Finance — GSTR-1',
  steps: [
    {
      target: 'fin-subtab-gstr-1',
      title: 'GSTR-1',
      purpose: 'Your outward supplies for the month, arranged in the GST portal\'s tables — working figures to key in or upload. Filing happens on the portal.',
      autoActivate: true,
      why: 'Your customers\' input credit (GSTR-2B) is built from what you report here — a missed invoice means they cannot claim credit.',
    },
    {
      target: 'fin-gst-period',
      title: 'Return period (month)',
      required: true,
      purpose: 'The month you are filing for (defaults to this month).',
    },
    {
      target: 'fin-gst-refresh',
      title: 'Refresh',
      purpose: 'Rebuilds the return for the chosen month. Warnings (e.g. missing HSN) appear below in amber.',
    },
    {
      target: 'fin-gst-r1-b2b',
      title: '4A — B2B invoices',
      purpose: 'Invoices to GST-registered buyers, one per invoice with a sub-row per GST rate. Click the heading to open or close any section; the count is in brackets.',
    },
    {
      target: 'fin-gst-r1-b2cl',
      title: '5 — B2C Large',
      purpose: 'Inter-state invoices to unregistered buyers above ₹1,00,000, invoice-wise.',
    },
    {
      target: 'fin-gst-r1-b2cs',
      title: '7 — B2C Small',
      purpose: 'All other unregistered sales, summed by place of supply and rate (not invoice-wise).',
    },
    {
      target: 'fin-gst-r1-cdnr',
      title: '9B — Credit notes (registered)',
      purpose: 'Credit notes to registered buyers, each with the original invoice it reduces.',
    },
    {
      target: 'fin-gst-r1-cdnur',
      title: '9B — Credit notes (unregistered)',
      purpose: 'Credit notes to unregistered buyers.',
    },
    {
      target: 'fin-gst-r1-hsn',
      title: '12 — HSN summary',
      purpose: 'Sales by HSN/SAC code and rate with quantity, net of credit notes. "Missing" (amber) means an invoice line had no HSN — fix the source item for next time.',
    },
    {
      target: 'fin-gst-r1-docs',
      title: '13 — Documents issued',
      purpose: 'First and last sales invoice number used in the month, total issued, cancelled and net.',
    },
  ],
}

export default config
