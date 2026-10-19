import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-gst-registers',
  pageTitle: 'Finance — GST Registers',
  steps: [
    {
      target: 'finance-nav-percent',
      title: 'GST',
      purpose: 'GST registers, GSTR-1 and GSTR-3B working figures and the monthly input-credit set-off — all built from posted invoices and notes.',
      why: 'The returns are filed on the GST portal; this screen prepares the figures so they match the books exactly.',
    },
    {
      target: 'fin-subtab-registers',
      title: 'Registers',
      purpose: 'Document-by-document list of GST charged (sales) or claimed (purchases).',
      autoActivate: true,
    },
    {
      target: 'fin-subtab-gstr-1',
      title: 'GSTR-1',
      purpose: 'Monthly return of outward supplies (sales).',
    },
    {
      target: 'fin-subtab-gstr-3b',
      title: 'GSTR-3B',
      purpose: 'Monthly summary return on which tax is paid.',
    },
    {
      target: 'fin-subtab-itc-set-off',
      title: 'ITC Set-off',
      purpose: 'Use input credit against output tax and post the set-off journal.',
    },
    {
      target: 'fin-gst-reg-kind',
      title: 'Register',
      options: [
        { value: 'Sales (output)', meaning: 'Posted sales invoices and credit notes — GST we charged. Credit notes show negative.' },
        { value: 'Purchase (input)', meaning: 'Posted purchase bills and debit notes — GST we can claim. Debit notes show negative.' },
      ],
      after: 'The register reloads as soon as you switch.',
    },
    {
      target: 'fin-gst-reg-from',
      title: 'From',
      purpose: 'Start date — defaults to the 1st of this month.',
    },
    {
      target: 'fin-gst-reg-to',
      title: 'To',
      purpose: 'End date — defaults to today.',
    },
    {
      target: 'fin-gst-reg-show',
      title: 'Show',
      purpose: 'Reloads the register for the chosen dates.',
    },
    {
      target: 'fin-gst-reg-table',
      title: 'Register',
      purpose: 'One row per document: type, number, date, party, GSTIN ("Unregistered" if none), place of supply, RCM flag, taxable value, CGST / SGST / IGST and total. The last row totals everything.',
      why: 'Tally this register with the GST ledgers every month — a difference means something was posted outside an invoice or note.',
    },
  ],
}

export default config
