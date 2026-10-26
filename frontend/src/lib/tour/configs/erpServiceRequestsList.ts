import { TourConfig } from '../types'
import { SR_STATUS_OPTIONS } from './erpShared'

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
      purpose: 'Finds SRs by SR number, issue title, machine serial or client — the list refreshes as you type.',
      validExample: 'SR-2026',
    },
    {
      target: 'erp-sr-filter-btn',
      title: 'Filters',
      purpose: 'Opens the filter popup: Status, Priority, Service Type and Overdue Only (SRs whose Expected Close Date has passed and are not yet Closed or Cancelled). The number on the button shows how many filters are on.',
      options: SR_STATUS_OPTIONS,
      after: 'Pick what you need and press Apply Filters; Clear Filters (or the Clear button next to Filters) resets them all.',
      why: 'Overdue SRs are promises to customers already broken — chase them first.',
    },
    {
      target: 'erp-sr-table',
      title: 'Service request rows',
      purpose: 'SR number, machine serial, client & site, issue summary, priority (red = Urgent), coloured status badge, opening and closing date, age in days and warranty. Long client and issue text is cut with "…" (hover for the full text). Click a row to open the SR.',
      why: 'Age counts days since the SR was opened — it is the customer\'s waiting time.',
    },
  ],
}

export default config
