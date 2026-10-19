import { TourConfig, TourStep } from '../types'

export const GROUP_FORM_STEPS: TourStep[] = [
  {
    target: 'fin-groups-parent',
    title: 'Parent group',
    required: true,
    purpose: 'The existing group this new sub-group sits under. (Shown read-only when editing — a group cannot be moved.)',
    whatToEnter: 'Search and pick the parent, e.g. Sundry Creditors or Indirect Expenses.',
    validExample: 'Current Liabilities › Sundry Creditors',
    why: 'Every new group must sit under one of the standard groups so it lands in the correct Balance Sheet / P&L line.',
  },
  {
    target: 'fin-groups-nature',
    title: 'Nature (inherited)',
    purpose: 'Asset, Liability, Capital / Equity, Income or Expense — copied from the parent automatically; you cannot change it.',
    why: 'A sub-group of an asset group can only ever hold assets, so a ledger\'s type and its position in the reports can never disagree.',
  },
  {
    target: 'fin-groups-code',
    title: 'Code',
    required: true,
    whatToEnter: 'A short unique code. Cannot be changed after creation.',
    validExample: 'G-SC-RAW',
    invalidExample: 'A code already used by another group',
  },
  {
    target: 'fin-groups-name',
    title: 'Name',
    required: true,
    whatToEnter: 'A clear name for the grouping.',
    validExample: 'Raw Material Suppliers',
  },
  {
    target: 'fin-groups-schedule',
    title: 'Schedule III head',
    purpose: 'The line of the statutory Balance Sheet / P&L (Companies Act, Schedule III) this group rolls up into.',
    whatToEnter: 'Leave as "Same as parent" unless this sub-group belongs on a different line. Fixed for standard (system) groups.',
    why: 'Schedule III is the format auditors and the ROC expect — choosing the head here makes the statutory statements come out right automatically.',
  },
  {
    target: 'fin-groups-gross-profit',
    title: 'Affects gross profit',
    purpose: 'Whether ledgers in this group are counted above the Gross Profit line (trading account) — shown only when creating.',
    options: [
      { value: 'Same as parent', meaning: 'Follow the parent group (normal choice).' },
      { value: 'Yes', meaning: 'Part of trading: purchases, sales, direct expenses like freight-in, job work.' },
      { value: 'No', meaning: 'Below gross profit: office, admin, selling and finance costs.' },
    ],
    why: 'Gross profit shows how much the factory earns on what it makes and sells, before overheads.',
  },
  {
    target: 'fin-groups-sequence',
    title: 'Sequence',
    purpose: 'Display order among sibling groups (lower shows first). 0 is fine.',
    validExample: '10',
  },
  {
    target: 'fin-masters-form-save',
    title: 'Create Sub-group / Save Changes',
    purpose: 'Saves the group. Parent, code and name are required for a new group.',
    after: 'The popup closes and the group appears in the tree, under its parent.',
  },
  {
    target: 'fin-masters-form-cancel',
    title: 'Cancel',
    purpose: 'Closes the form without saving.',
  },
]

const config: TourConfig = {
  id: 'finance-masters-group-form',
  pageTitle: 'Finance — Account Group form',
  steps: [
    {
      target: 'fin-subtab-account-groups',
      title: 'Account Groups',
      purpose: 'You are adding or editing an account group.',
    },
    ...GROUP_FORM_STEPS,
  ],
}

export default config
