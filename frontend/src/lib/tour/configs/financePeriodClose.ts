import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'finance-period-close',
  pageTitle: 'Finance — Period Close',
  steps: [
    {
      target: 'fin-subtab-period-close',
      title: 'Period Close',
      purpose: 'Month-end lock. Once a month is closed nothing more can be posted with a date in it, so its reports stop changing.',
      autoActivate: true,
      why: 'After GST returns are filed and MIS is shared for a month, its figures must not move — closing the period guarantees that.',
    },
    {
      target: 'fin-period-select',
      title: 'Accounting Period',
      purpose: 'Pick the month to check, close or reopen (last 18 months listed). Clicking a row in the table below also selects it.',
    },
    {
      target: 'fin-period-status',
      title: 'Period status',
      options: [
        { value: 'Open', meaning: 'Postings dated in this month are allowed.' },
        { value: 'Closed', meaning: 'Locked — shows who closed it and when.' },
      ],
    },
    {
      target: 'fin-period-close-btn',
      title: 'Close <month>',
      purpose: 'Locks the selected month. Only a Finance Manager sees this button.',
      after: 'You can add optional notes. The close is refused, with the reason, if any document dated in that month (invoice, note, payment, journal) is still a draft — post or cancel those first.',
    },
    {
      target: 'fin-period-reopen-btn',
      title: 'Reopen',
      purpose: 'Unlocks a closed month. Only an admin sees this button, and a reason is required.',
      after: 'The reason is kept on the audit trail and shown in the table.',
    },
    {
      target: 'fin-period-table',
      title: 'Period history',
      purpose: 'Every month ever closed: status, who closed it, notes, and any reopen with its reason.',
    },
  ],
}

export default config
