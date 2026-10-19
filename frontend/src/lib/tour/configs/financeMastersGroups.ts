import { TourConfig } from '../types'
import { GROUP_FORM_STEPS } from './financeMastersGroupForm'

const config: TourConfig = {
  id: 'finance-masters-groups',
  pageTitle: 'Finance — Account Groups',
  steps: [
    {
      target: 'fin-subtab-account-groups',
      title: 'Account Groups',
      purpose: 'The group tree behind the chart of accounts. Standard groups (Assets, Liabilities, Income, Expenses and their children) come built in.',
      autoActivate: true,
    },
    {
      target: 'fin-groups-table',
      title: 'Group tree',
      purpose: 'Each row is a group, indented under its parent. Columns show nature, Schedule III head, whether it affects gross profit and how many ledgers sit in it.',
      options: [
        { value: 'System', meaning: 'Standard group — cannot be deleted and its Schedule III head is fixed.' },
        { value: 'Custom', meaning: 'A sub-group your team added — can be deleted while it has no ledgers and no sub-groups.' },
        { value: '+ Sub-group (row link)', meaning: 'Opens the form with this row already picked as the parent.' },
        { value: 'Edit (row link)', meaning: 'Change the name, sequence or (custom only) Schedule III head.' },
        { value: 'Delete (row link)', meaning: 'Shown only for empty custom groups.' },
      ],
    },
    {
      target: 'fin-groups-new-btn',
      title: '+ New Sub-group',
      purpose: 'Adds your own grouping under a standard group, e.g. separate "Raw Material Suppliers" under Sundry Creditors.',
      after: 'Opens the group form right here — the next steps explain each field.',
      autoActivateOnAdvance: true,
    },
    ...GROUP_FORM_STEPS,
  ],
}

export default config
