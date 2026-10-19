import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-day-book',
  pageTitle: 'Finance — Day Book',
  steps: [
    {
      target: 'fin-subtab-day-book',
      title: 'Day Book',
      purpose: 'Every posted voucher in date order — the chronological record of all transactions.',
      autoActivate: true,
      why: 'Accountants scan the Day Book daily to check nothing was missed or entered twice.',
    },
    {
      target: 'fin-daybook-from',
      title: 'From',
      purpose: 'Start date (defaults to the 1st of this month).',
    },
    {
      target: 'fin-daybook-to',
      title: 'To',
      purpose: 'End date (defaults to today).',
    },
    {
      target: 'fin-daybook-type',
      title: 'Voucher Type',
      purpose: 'Limit to one kind of voucher (Journal, Payment, Receipt, Contra, Purchase, Sales, Debit/Credit Note, Opening) or All.',
    },
    {
      target: 'fin-daybook-show',
      title: 'Show',
      purpose: 'Loads the vouchers for the chosen dates and type.',
    },
    {
      target: 'fin-daybook-table',
      title: 'Day Book',
      purpose: 'Each voucher shows its date, number, type and narration, followed by its Dr lines and indented "To …" Cr lines. A Reversed badge marks a voucher that was later reversed. The last row totals Dr and Cr — they must always match.',
    },
  ],
}

export default config
