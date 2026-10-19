import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-brs',
  pageTitle: 'Finance — Bank Reconciliation (BRS)',
  steps: [
    {
      target: 'fin-subtab-reconciliation-brs',
      title: 'Reconciliation (BRS)',
      purpose: 'A Bank Reconciliation Statement explains why our book balance differs from the bank statement.',
      autoActivate: true,
      why: 'Differences come from cheques we issued that the bank hasn\'t paid yet and deposits the bank hasn\'t credited yet. Reconciling monthly catches errors, missed bank charges and fraud early.',
    },
    {
      target: 'fin-bk-brs-history',
      title: 'Reconciliation history',
      purpose: 'Every BRS started, with book vs statement balance and the difference (green when zero). Click a row or "Open" to continue or review it.',
      options: [
        { value: 'In Progress', meaning: 'Still being matched — difference may not be zero yet.' },
        { value: 'Completed', meaning: 'Difference was zero and the BRS is locked as a record for that statement date.' },
      ],
    },
    {
      target: 'fin-bk-brs-new-btn',
      title: 'Start reconciliation',
      purpose: 'Opens the popup to start a BRS for one bank account and statement date.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'fin-bk-brs-bank',
      title: 'Bank Account',
      required: true,
      purpose: 'The bank account whose statement you are reconciling. Cash accounts are not reconciled — cash is counted.',
    },
    {
      target: 'fin-bk-brs-date',
      title: 'Statement Date',
      required: true,
      purpose: 'The closing date of the bank statement (usually month end).',
    },
    {
      target: 'fin-bk-brs-balance',
      title: 'Statement Closing Balance (₹)',
      required: true,
      whatToEnter: 'The closing balance printed on the bank statement for that date. Enter an overdraft as a negative number.',
      validExample: '1245830.50',
    },
    {
      target: 'fin-bk-brs-start-btn',
      title: 'Start Reconciliation',
      purpose: 'Creates the reconciliation.',
      after: 'The popup closes and the reconciliation opens with the BRS summary and the list of uncleared vouchers to tick.',
    },
  ],
}

export default config
