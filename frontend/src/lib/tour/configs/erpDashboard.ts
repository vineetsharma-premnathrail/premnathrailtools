import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'erp-dashboard',
  pageTitle: 'Service & Commissioning Dashboard',
  steps: [
    {
      target: 'erp-nav-grid',
      title: 'Dashboard',
      purpose: 'This page — a one-screen picture of every service ticket and how many are still open.',
    },
    {
      target: 'erp-nav-file',
      title: 'Service Requests',
      purpose: 'Service tickets (SRs) — a complaint, breakdown, warranty visit, AMC visit or commissioning job on a delivered machine, tracked from "Reported" to "Closed".',
    },
    {
      target: 'erp-nav-chart',
      title: 'Reports',
      purpose: 'Charts and totals across all service requests — how many are open, average time to close, top issue types and cost.',
    },
    {
      target: 'erp-nav-trash',
      title: 'Recycle Bin',
      purpose: 'Deleted service requests stay here for 10 days and can be restored before they are purged for good.',
    },
    {
      target: 'erp-nav-bell',
      title: 'Notifications',
      purpose: 'Alerts for you — e.g. a service request assigned to you or a status change on one you raised.',
    },
    {
      target: 'erp-dash-stats',
      title: 'Headline numbers',
      purpose: 'Total service requests ever raised, SRs raised this calendar month, Active Tickets (not yet Closed or Cancelled), In progress, Past target date (active tickets whose expected completion date has gone by) and Closed.',
      why: 'Active Tickets is the service team\'s current workload; if it keeps growing month on month, jobs are being opened faster than they are being closed.',
    },
    {
      target: 'erp-dash-charts',
      title: 'Status charts',
      purpose: 'Left: how many tickets are in each status (Open, In progress, Pending parts, Closed…). Right: open tickets split by priority (Urgent vs Standard).',
    },
    {
      target: 'erp-dash-recent-srs',
      title: 'Recent Service Tickets',
      purpose: 'The 8 newest service requests with issue, service type, priority, status, assigned person, target date and age (days since it was opened). Click any row to open that ticket.',
      why: 'Age shows how long the customer has been waiting — a high age on an Urgent ticket needs attention first.',
    },
    {
      target: 'erp-dash-srs-viewall',
      title: 'View all tickets',
      purpose: 'Opens the full Service Request list with search and filters.',
    },
  ],
}

export default config
