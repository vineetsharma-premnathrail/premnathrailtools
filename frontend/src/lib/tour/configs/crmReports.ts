import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'crm-reports',
  pageTitle: 'CRM Reports',
  steps: [
    {
      target: 'rep-range',
      title: 'Period and comparison',
      purpose: 'Pick This month, Last month, This quarter, This financial year, Last 30 days or Custom range. Switch on "Compare with previous period" to see how much each number went up or down.',
    },
    {
      target: 'rep-slicers',
      title: 'Filters',
      purpose: 'Open a filter such as BD owner, Customer, Railway zone, Lead source or Product category, search it and tick one or more values. Every number and chart on the page follows.',
    },
    {
      target: 'rep-kpis',
      title: 'Key numbers',
      purpose: 'Leads received, customers, still open, won, lost and leads quoted %. Hover for the plain meaning; click one to see the leads behind it.',
    },
    {
      target: 'rep-charts',
      title: 'Click a chart to filter everything',
      purpose: 'Click a bar, slice or point (for example one month or one lead source) and every other chart and number shows only that value. Click it again to unselect, or hold Ctrl or Shift to pick more. The "..." on a chart opens Show data and Export this to Excel.',
    },
    {
      target: 'rep-selection',
      title: 'What is showing',
      purpose: 'Everything narrowing the page, from filters and chart clicks. Remove one with its x, or Clear all.',
    },
    {
      target: 'rep-export',
      title: 'Export to Excel',
      purpose: 'Download an Excel file of the current page with the same period and filters: the key numbers, one sheet per chart, the leads and how each figure is calculated.',
    },
  ],
}

export default config
