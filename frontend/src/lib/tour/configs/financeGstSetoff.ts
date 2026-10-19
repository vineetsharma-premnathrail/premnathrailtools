import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-gst-setoff',
  pageTitle: 'Finance — GST ITC Set-off',
  steps: [
    {
      target: 'fin-subtab-itc-set-off',
      title: 'ITC Set-off',
      purpose: 'Adjusts input tax credit (ITC) against output tax for the month and posts the journal.',
      autoActivate: true,
      why: 'CGST Rule 88A fixes the order: IGST credit first (IGST → CGST → SGST), then CGST credit (CGST → IGST), then SGST credit (SGST → IGST). CGST credit never pays SGST or vice versa, and reverse-charge tax is always paid in cash.',
    },
    {
      target: 'fin-gst-setoff-period',
      title: 'Return period (month)',
      required: true,
    },
    {
      target: 'fin-gst-setoff-refresh',
      title: 'Refresh',
      purpose: 'Recomputes the set-off preview for the month.',
    },
    {
      target: 'fin-gst-setoff-post',
      title: 'Post set-off',
      purpose: 'Finance Manager only. Posts one journal on the period end debiting output tax and crediting input credit for the steps shown.',
      after: 'Shows the journal number. The button then reads "Set-off already posted" — reverse that journal first if you must redo it. The cash portion still has to be paid via Payments → Expense payment.',
    },
    {
      target: 'fin-gst-setoff-stats',
      title: 'Cash payable / credit carried forward',
      purpose: 'Cash payable = tax left after using all eligible credit. Credit carried forward = unused credit for next month.',
    },
    {
      target: 'fin-gst-setoff-balances',
      title: 'Ledger balances',
      purpose: 'Input credit and output liability for IGST, CGST and SGST at period end, plus RCM payable.',
    },
    {
      target: 'fin-gst-setoff-utilisation',
      title: 'Utilisation',
      purpose: 'Step-by-step which credit pays which liability, in Rule 88A order.',
    },
    {
      target: 'fin-gst-setoff-cash',
      title: 'Cash payable after set-off',
      purpose: 'Per tax head, including RCM (always cash). This is what goes in the GST challan.',
    },
    {
      target: 'fin-gst-setoff-cf',
      title: 'Credit carried forward',
      purpose: 'Unused credit per head that rolls into next month.',
    },
  ],
}

export default config
