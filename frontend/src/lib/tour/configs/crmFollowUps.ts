import { TourConfig, TourStep } from '../types'

const steps: TourStep[] = [
  {
    target: 'followups-tab-open',
    title: 'Open Follow-ups',
    purpose: 'Every follow-up activity still marked Open, across all inquiries and tenders — regardless of due date.',
  },
  {
    target: 'followups-tab-overdue',
    title: 'Overdue Follow-ups',
    purpose: 'Open follow-ups whose due date has already passed — the ones needing attention first.',
  },
  {
    target: 'followups-tab-today',
    title: "Today's Follow-ups",
    purpose: 'Open follow-ups due today.',
  },
  {
    target: 'followups-table',
    title: 'Follow-up list',
    purpose: 'Type, the inquiry/tender it\'s tied to, organization, due date, who it\'s assigned to, remarks, and status. Rows linked to an inquiry or tender are clickable and open that record\'s detail page.',
  },
  {
    target: 'followups-back-btn',
    title: 'Back',
    purpose: 'Returns to the CRM dashboard.',
  },
]

const config: TourConfig = {
  id: 'crm-followups',
  pageTitle: 'Follow-ups',
  steps,
}

export default config
