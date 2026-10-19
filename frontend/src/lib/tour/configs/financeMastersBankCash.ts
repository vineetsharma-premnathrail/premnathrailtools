import { TourConfig } from '../types'
import { BANK_FORM_STEPS } from './financeMastersBankForm'

const config: TourConfig = {
  id: 'finance-masters-bank-cash',
  pageTitle: 'Finance — Bank & Cash accounts',
  steps: [
    {
      target: 'fin-subtab-bank-cash',
      title: 'Bank & Cash',
      purpose: 'Every company bank account and cash box. Payments, receipts and contra entries pick from this list.',
      autoActivate: true,
    },
    {
      target: 'fin-bank-table',
      title: 'Account list',
      purpose: 'Kind, name, account number, IFSC/branch, linked ledger and the balance per our books.',
      options: [
        { value: 'Active', meaning: 'In use.' },
        { value: 'Inactive', meaning: 'Not in use for now.' },
        { value: 'Closed', meaning: 'Closed at the bank; kept for history.' },
        { value: 'Not linked (red)', meaning: 'No GL ledger — fix with Edit, or postings will fail.' },
        { value: 'Edit / Delete', meaning: 'Delete works only while the account has no vouchers — otherwise set it Closed.' },
      ],
    },
    {
      target: 'fin-bank-new-btn',
      title: '+ New Account',
      purpose: 'Adds a bank account or cash box.',
      after: 'Opens the account form right here — the next steps explain each field.',
      autoActivateOnAdvance: true,
    },
    ...BANK_FORM_STEPS,
  ],
}

export default config
