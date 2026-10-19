import { TourConfig, TourStep } from '../types'

export const BANK_FORM_STEPS: TourStep[] = [
  {
    target: 'fin-bank-kind',
    title: 'Kind',
    options: [
      { value: 'Bank', meaning: 'A current/CC/OD account at a bank — needs account number and IFSC.' },
      { value: 'Cash', meaning: 'A physical cash box (e.g. Head Office petty cash) — no bank details.' },
    ],
    after: 'Changing the kind clears the ledger picked below, because bank and cash use different ledger groups.',
  },
  {
    target: 'fin-bank-name',
    title: 'Bank name / Account name',
    required: true,
    whatToEnter: 'For a bank: the bank\'s name. For cash: a name for the cash box.',
    validExample: 'HDFC Bank — CC A/c  or  Head Office Cash',
  },
  {
    target: 'fin-bank-account-no',
    title: 'Account no.',
    required: true,
    whatToEnter: 'The full bank account number exactly as on the cheque book / statement (bank only).',
    validExample: '50200012345678',
  },
  {
    target: 'fin-bank-holder',
    title: 'Account holder',
    whatToEnter: 'Name the account is held in (usually the company name).',
    validExample: 'Premnath Rail Tools Pvt Ltd',
  },
  {
    target: 'fin-bank-ifsc',
    title: 'IFSC',
    whatToEnter: '11-character bank branch code — 4 letters, a zero, then 6 letters/digits. Auto-capitalised.',
    validExample: 'HDFC0001234',
    invalidExample: 'HDFC1234 (too short)',
  },
  {
    target: 'fin-bank-branch',
    title: 'Branch',
    whatToEnter: 'Branch name or location.',
    validExample: 'Faridabad Sector 15',
  },
  {
    target: 'fin-bank-ledger',
    title: 'GL ledger',
    required: true,
    purpose: 'The ledger this account posts to. Ledgers in "Bank Accounts" (or "Cash-in-Hand") are listed first.',
    why: 'The account\'s book balance IS this ledger\'s balance — there is no second balance to drift. Once vouchers exist the ledger cannot be changed.',
  },
  {
    target: 'fin-bank-status',
    title: 'Status',
    options: [
      { value: 'Active', meaning: 'Can be used on payments and receipts.' },
      { value: 'Inactive', meaning: 'Temporarily not used; history kept.' },
      { value: 'Closed', meaning: 'Account closed at the bank. Use this instead of deleting once it has vouchers.' },
    ],
  },
  {
    target: 'fin-masters-form-save',
    title: 'Create Account / Save Changes',
    purpose: 'Saves the account.',
    after: 'It appears in the list and becomes available in Payments and Bank & Cash. Enter its opening balance once via the Opening Balances tab.',
  },
  {
    target: 'fin-masters-form-cancel',
    title: 'Cancel',
    purpose: 'Closes the form without saving.',
  },
]

const config: TourConfig = {
  id: 'finance-masters-bank-form',
  pageTitle: 'Finance — Bank / Cash account form',
  steps: [
    {
      target: 'fin-subtab-bank-cash',
      title: 'Bank & Cash',
      purpose: 'You are adding or editing a bank or cash account.',
    },
    ...BANK_FORM_STEPS,
  ],
}

export default config
