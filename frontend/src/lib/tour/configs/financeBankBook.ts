import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-bank-book',
  pageTitle: 'Finance — Bank / Cash Book',
  steps: [
    {
      target: 'fin-subtab-bank-cash-book',
      title: 'Bank / Cash Book',
      purpose: 'The ledger of one bank or cash account: receipts on the Dr side, payments on the Cr side, with a running balance.',
      autoActivate: true,
      why: 'Cash can never go negative — a payment that would take cash below zero is refused.',
    },
    {
      target: 'fin-bk-book-account',
      title: 'Bank / Cash Account',
      required: true,
      purpose: 'Pick the account to view. The book loads as soon as you pick it.',
    },
    {
      target: 'fin-bk-book-from',
      title: 'From',
      purpose: 'Start date — defaults to the 1st of this month.',
    },
    {
      target: 'fin-bk-book-to',
      title: 'To',
      purpose: 'End date — defaults to today.',
    },
    {
      target: 'fin-bk-book-show',
      title: 'Show',
      purpose: 'Reloads the book after you change the dates.',
    },
    {
      target: 'fin-bk-book-stats',
      title: 'Summary',
      purpose: 'Opening balance, total receipts (Dr), total payments (Cr) and closing balance for the range.',
    },
    {
      target: 'fin-bk-book-table',
      title: 'Book',
      purpose: 'Opening line, then each voucher (date, number, type, particulars, receipt / payment amount, running balance), and a closing totals row.',
    },
  ],
}

export default config
