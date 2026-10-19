import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-outstanding-party',
  pageTitle: 'Finance — Party outstanding',
  steps: [
    {
      target: 'fin-os-party',
      title: 'Party detail',
      purpose: 'The selected party with its outstanding, overdue, advances and net in one line.',
    },
    {
      target: 'fin-os-record-btn',
      title: 'Record payment / receipt',
      purpose: 'Opens Payments with the voucher form already set for this party and its open bills loaded.',
    },
    {
      target: 'fin-os-bills',
      title: 'Open bills',
      purpose: 'Every unpaid bill: date, due date, days overdue, age bucket, total, settled so far and still due.',
    },
    {
      target: 'fin-os-credits',
      title: 'Open credits',
      purpose: 'Advances and unadjusted debit/credit notes still available. They reduce the net but are not yet set against a specific bill.',
      after: 'Set them off from Payments & Receipts → "Allocate" on the voucher.',
    },
    {
      target: 'fin-os-stmt-from',
      title: 'Statement from',
      purpose: 'Start of the statement period (defaults to 1 April).',
    },
    {
      target: 'fin-os-stmt-to',
      title: 'Statement to',
      purpose: 'End date (defaults to today). The statement reloads automatically.',
    },
    {
      target: 'fin-os-statement',
      title: 'Party statement',
      purpose: 'Opening balance, every voucher with this party (debit / credit), running balance and closing balance. A bracketed balance means the opposite side — e.g. an advance.',
      why: 'Send this to the party to confirm balances (balance confirmation) at year end.',
    },
    {
      target: 'fin-os-close',
      title: 'Close',
      purpose: 'Hides the party detail.',
    },
  ],
}

export default config
