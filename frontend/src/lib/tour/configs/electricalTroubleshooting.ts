import { TourConfig } from '../types'
import { SEVERITY_OPTIONS } from './electricalJobIssuesTab'

const config: TourConfig = {
  id: 'electrical-troubleshooting',
  pageTitle: 'Electrical Troubleshooting',
  steps: [
    {
      target: 'electrical-nav-wrench',
      title: 'Troubleshooting',
      purpose: 'Electrical faults logged on every RRV job. Issues are logged and resolved from each job\'s Troubleshooting tab; this page is the cross-job view.',
      why: 'Seeing faults across vehicles shows repeat problems — e.g. the same connector failing on three RRVs points to a design or supplier issue.',
    },
    {
      target: 'elec-ireg-status-filter',
      title: 'Status filter',
      options: [
        { value: 'Open (unresolved)', meaning: 'Default — Open and Investigating issues.' },
        { value: 'Investigating', meaning: 'Someone is finding the cause.' },
        { value: 'Resolved', meaning: 'Root cause and fix recorded, waiting to be closed.' },
        { value: 'Closed', meaning: 'Finished.' },
        { value: 'All statuses', meaning: 'Everything.' },
      ],
    },
    {
      target: 'elec-ireg-severity-filter',
      title: 'Severity filter',
      options: SEVERITY_OPTIONS,
    },
    {
      target: 'elec-ireg-mine-toggle',
      title: 'Assigned to me',
      purpose: 'Shows only issues assigned to you — your fault-finding to-do list.',
    },
    {
      target: 'elec-ireg-summary',
      title: 'Totals',
      purpose: 'Open / investigating count, critical issues still open, and how many are shown.',
    },
    {
      target: 'elec-ireg-table',
      title: 'Issues list',
      purpose: 'Issue no., job, title, severity, status, linked test / panel / cable, assignee and when reported.',
      after: 'Click a row to open the job on its Troubleshooting tab to investigate, resolve or close it.',
    },
  ],
}

export default config
