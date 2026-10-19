import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-brs-active',
  pageTitle: 'Finance — Reconciling a bank statement',
  steps: [
    {
      target: 'fin-bk-brs-active',
      title: 'Open reconciliation',
      purpose: 'The bank account and statement date you are reconciling.',
    },
    {
      target: 'fin-bk-brs-status',
      title: 'Status',
      options: [
        { value: 'In Progress', meaning: 'Still matching vouchers.' },
        { value: 'Completed', meaning: 'Locked — shows who completed it and when.' },
      ],
    },
    {
      target: 'fin-bk-brs-summary',
      title: 'BRS summary',
      purpose: 'Balance as per books + cheques issued not yet paid − deposits not yet credited = expected bank balance. Compared with the statement balance gives the Difference.',
      why: 'The Difference must be exactly 0 to complete. If it is not, something on the statement (bank charges, interest, direct credit) is missing from our books — enter it as a payment/receipt voucher first.',
    },
    {
      target: 'fin-bk-brs-uncleared',
      title: 'Uncleared vouchers',
      purpose: 'Our vouchers up to the statement date that the bank hasn\'t cleared yet. Tick each one that appears on the bank statement (the header box ticks all).',
      options: [
        { value: 'Deposit', meaning: 'Money in — a receipt we recorded.' },
        { value: 'Withdrawal', meaning: 'Money out — a payment or cheque we issued.' },
      ],
    },
    {
      target: 'fin-bk-brs-cleared-date',
      title: 'Bank (clearing) date',
      purpose: 'The date the bank actually cleared the ticked items. Leave blank to use the statement date.',
    },
    {
      target: 'fin-bk-brs-match-btn',
      title: 'Mark as Cleared',
      purpose: 'Marks the ticked vouchers as cleared. The net of the selection shows alongside.',
      after: 'They disappear from the list, the summary recalculates and the vouchers show "Reconciled" in Payments (and can no longer be cancelled).',
    },
    {
      target: 'fin-bk-brs-complete-btn',
      title: 'Complete Reconciliation',
      purpose: 'Enabled only when the Difference is 0. Asks for confirmation, then locks the BRS as the record for this statement date.',
    },
    {
      target: 'fin-bk-brs-close',
      title: 'Close',
      purpose: 'Hides this reconciliation — your ticks are already saved; reopen it from the history table.',
    },
  ],
}

export default config
