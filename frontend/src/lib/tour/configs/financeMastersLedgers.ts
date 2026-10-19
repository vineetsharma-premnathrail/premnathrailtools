import { TourConfig } from '../types'
import { LEDGER_FORM_STEPS } from './financeMastersLedgerForm'

const config: TourConfig = {
  id: 'finance-masters-ledgers',
  pageTitle: 'Finance — Ledgers (chart of accounts)',
  steps: [
    {
      target: 'fin-subtab-ledgers',
      title: 'Ledgers',
      purpose: 'The chart of accounts — every account money can be posted to (bank, sales, purchases, rent, GST…).',
      autoActivate: true,
    },
    {
      target: 'fin-ledgers-search',
      title: 'Search',
      purpose: 'Filters the list by ledger code or name as you type.',
      validExample: 'freight',
    },
    {
      target: 'fin-ledgers-group-filter',
      title: 'Group filter',
      purpose: 'Shows only ledgers in the chosen group and all its sub-groups.',
    },
    {
      target: 'fin-ledgers-status-filter',
      title: 'Status filter',
      options: [
        { value: 'All', meaning: 'Every ledger.' },
        { value: 'Active', meaning: 'Ledgers that can be used on new vouchers.' },
        { value: 'Inactive', meaning: 'Retired ledgers kept for history.' },
      ],
    },
    {
      target: 'fin-ledgers-table',
      title: 'Ledger list',
      purpose: 'Ledgers grouped under shaded group headings. Flags show Posting (vouchers allowed) or Header, and Control (party sub-ledger total).',
      options: [
        { value: 'Active / Inactive', meaning: 'Status badge — inactive ledgers are hidden from new vouchers.' },
        { value: 'Edit (row link)', meaning: 'Opens the ledger in the form above.' },
        { value: 'Delete (row link)', meaning: 'Only works for a ledger with no postings — otherwise set it Inactive.' },
      ],
    },
    {
      target: 'fin-ledgers-new-btn',
      title: '+ New Ledger',
      purpose: 'Adds a new account to the chart of accounts.',
      after: 'Opens the ledger form right here — the next steps explain each field.',
      autoActivateOnAdvance: true,
    },
    ...LEDGER_FORM_STEPS,
  ],
}

export default config
