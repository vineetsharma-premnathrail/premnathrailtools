import { TourConfig } from '../types'
import { SERVICE_TYPE_OPTIONS, SR_PRIORITY_OPTIONS, SR_STATUS_OPTIONS } from './erpShared'

const config: TourConfig = {
  id: 'erp-sr-list',
  pageTitle: 'Service Request Registry',
  steps: [
    {
      target: 'erp-nav-file',
      title: 'Service Requests',
      purpose: 'Every service ticket on our supplied machines, newest first.',
    },
    {
      target: 'erp-sr-add-btn',
      title: '+ New Service Request',
      purpose: 'Logs a new complaint or planned visit against a machine.',
      after: 'Opens the Create Service Request form — its own tour explains each field.',
    },
    {
      target: 'erp-sr-search',
      title: 'Search',
      purpose: 'Finds SRs by SR number, issue title, machine serial or client.',
      validExample: 'SR-2026',
    },
    {
      target: 'erp-sr-status-filter',
      title: 'Status filter',
      purpose: 'Shows only SRs at one stage of the job. Applies immediately.',
      options: SR_STATUS_OPTIONS,
    },
    {
      target: 'erp-sr-priority-filter',
      title: 'Priority filter',
      options: SR_PRIORITY_OPTIONS,
    },
    {
      target: 'erp-sr-type-filter',
      title: 'Service Type filter',
      options: SERVICE_TYPE_OPTIONS,
    },
    {
      target: 'erp-sr-overdue',
      title: 'Overdue Only',
      purpose: 'Shows only SRs whose Expected Close Date has passed and that are not yet Closed or Cancelled.',
      why: 'These are the promises to customers already broken — chase them first.',
    },
    {
      target: 'erp-sr-clear-btn',
      title: 'Clear',
      purpose: 'Resets search and every filter.',
    },
    {
      target: 'erp-sr-table',
      title: 'Service request rows',
      purpose: 'SR number, machine, client & site, issue, service type, priority (red = Urgent), coloured status badge, opening/closing dates, age in days and warranty period. Click a row to open the SR; "Edit" appears only on SRs you created (or for admins).',
      why: 'Age counts days since the SR was opened — it is the customer\'s waiting time.',
    },
  ],
}

export default config
