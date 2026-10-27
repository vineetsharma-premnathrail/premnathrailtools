import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'erp-reports',
  pageTitle: 'Service Reports',
  steps: [
    {
      target: 'rep-tabs',
      title: 'Dashboard pages',
      purpose: 'Each tab is a ready-made dashboard: Overview, Engineers, Pending & Ageing, Timing, Customers & Machines, Billing and Visits. The last tab, Detailed data, lists the individual records.',
      why: 'Each page answers one management question, so nothing needs to be set up before you read it.',
    },
    {
      target: 'rep-range',
      title: 'Period and comparison',
      purpose: 'Open the period dropdown and pick This month, Last month, This quarter, This financial year, Last 30 days or Custom range for your own dates. Switch on "Compare with previous period" to see on each number how much it went up or down. Pages about work that is open right now show "As of today".',
    },
    {
      target: 'rep-slicers',
      title: 'Filters',
      purpose: 'Open a filter such as Engineer, Customer or Priority, search it and tick one or more values. Every number and chart on the page follows.',
    },
    {
      target: 'rep-kpis',
      title: 'Key numbers',
      purpose: 'The main totals for the page. Hover for the plain meaning; click one to see the service requests behind it.',
    },
    {
      target: 'rep-charts',
      title: 'Click a chart to filter everything',
      purpose: 'Click a bar, slice or point and every other chart and number shows only that value; the chosen one stays bright. Click it again to unselect, or hold Ctrl or Shift to pick more. The "..." on a chart opens Show data and Export this to Excel.',
      why: 'This is the quickest way to ask "and what about only Urgent jobs?" without touching a setting.',
    },
    {
      target: 'rep-selection',
      title: 'What is showing',
      purpose: 'Everything narrowing the page, from filters and chart clicks. Remove one with its x, or Clear all.',
    },
    {
      target: 'rep-export',
      title: 'Export to Excel',
      purpose: 'Download a designed Excel file of the current page with the same period and filters: the key numbers, one sheet per chart, the records and how each figure is calculated.',
    },
  ],
}

export default config
