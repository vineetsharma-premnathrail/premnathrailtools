import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'erp-reports',
  pageTitle: 'Service Reports',
  steps: [
    {
      target: 'erp-nav-chart',
      title: 'Reports',
      purpose: 'Service performance across every service request (deleted ones excluded).',
    },
    {
      target: 'erp-rep-kpis',
      title: 'Key numbers',
      purpose: 'Total requests; raised this month; Open (any stage before Work Completed); Closed; Avg Resolution — average days from opening to closing; Total Billed — sum of all SR bills in rupees.',
      why: 'Average resolution time is the service team\'s main speed measure (similar to MTTR — Mean Time To Repair). If it rises, customers are waiting longer.',
    },
    {
      target: 'erp-rep-charts',
      title: 'Charts',
      purpose: 'Status breakdown, Urgent vs Standard counts, requests per month for the last 6 months, top 6 issue categories, and cost split into Service, Transport, Accommodation, Material and Misc. Hover a chart for exact values.',
      why: 'Top issue categories tell you which system of the machine fails most — feed that back to Design and Production.',
    },
    {
      target: 'erp-rep-status-detail',
      title: 'Status Detail',
      purpose: 'Exact count of SRs in each status.',
    },
  ],
}

export default config
