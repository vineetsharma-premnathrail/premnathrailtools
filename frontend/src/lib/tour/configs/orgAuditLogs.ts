import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'org-audit-logs',
  pageTitle: 'Audit Logs',
  steps: [
    {
      target: 'org-audit-stats',
      title: 'Summary tiles',
      purpose: 'Total Logs, activity Today and in the Last 7 Days, plus the single most active user in the last 7 days — a quick pulse check before digging into the full list below.',
    },
    {
      target: 'org-audit-by-module',
      title: 'Activity by Module',
      purpose: 'A count of actions logged per module (Organization, Service Module, CRM, Procurement, Quality, Store, R&D, Other) — shows where activity is concentrated. Only appears once at least one log exists.',
    },
    {
      target: 'org-audit-filter-module',
      title: 'Module filter',
      purpose: 'Narrows the list below to logs from one module only, e.g. only Procurement actions.',
      after: 'Applies immediately — no need to click Search.',
    },
    {
      target: 'org-audit-filter-action',
      title: 'Action filter',
      purpose: 'Narrows the list to a single action type, e.g. only approvals or only deletions.',
      after: 'Applies immediately — no need to click Search.',
    },
    {
      target: 'org-audit-filter-search',
      title: 'Search summary',
      purpose: 'Free-text search over each log entry\'s summary line — use it to find logs mentioning a specific record, name, or keyword.',
      after: 'Requires clicking Search (or pressing Enter) to apply, unlike the two dropdown filters above.',
    },
    {
      target: 'org-audit-search-btn',
      title: 'Search',
      purpose: 'Runs the text search together with whichever Module/Action filters are currently set.',
    },
    {
      target: 'org-audit-log-list',
      title: 'All Audit Logs',
      purpose: 'Every matching entry: who did what, on which record, and when — plus IP address, device/browser, session ID, and whether it came from the web app or a bearer-token API client. Expand "Changes" to see the value of each field before and after an update, or the full record as it was before a deletion. This list is entirely system-generated; nothing on this page can be added, edited, or deleted manually.',
    },
  ],
}

export default config
