import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'production-reports',
  pageTitle: 'Production Reports',
  steps: [
    {
      target: 'production-nav-bar-chart',
      title: 'Reports tab',
      purpose: 'Production results for a date range: output, scrap, cost and workstation utilization.',
    },
    {
      target: 'production-rpt-from',
      title: 'From',
      whatToEnter: 'Start date of the period to report on.',
      after: 'All sections reload for the new range.',
    },
    {
      target: 'production-rpt-to',
      title: 'To',
      whatToEnter: 'End date of the period (inclusive). Must be on or after From.',
    },
    {
      target: 'production-rpt-kpis',
      title: 'Summary figures',
      purpose: 'Output (units received into Store), Scrap with scrap rate, number of orders finished in the range, and Cost Variance — total actual cost minus total estimated cost of those orders.',
      why: 'A positive variance (red) means production cost more than the BOM estimate — look at the cost table below to see which orders caused it.',
    },
    {
      target: 'production-rpt-output',
      title: 'Finished Goods Output',
      purpose: 'Quantity of each product received into Store in the range, and from how many work orders.',
    },
    {
      target: 'production-rpt-output-csv-btn',
      title: 'Export CSV',
      purpose: 'Downloads this table as a CSV file that opens in Excel.',
    },
    {
      target: 'production-rpt-cost',
      title: 'Work Order Cost — Estimated vs Actual',
      purpose: 'For each order completed or closed in the range: built vs planned, scrap, estimated cost (from the BOM), actual cost (material issued + hours × workstation rate), variance and cost per unit. Click a row to open the work order.',
      why: 'Cost per unit is the real manufacturing cost — the basis for pricing and margin decisions.',
    },
    {
      target: 'production-rpt-cost-csv-btn',
      title: 'Export CSV',
      purpose: 'Downloads the cost table as CSV.',
    },
    {
      target: 'production-rpt-utilization',
      title: 'Workstation Utilization',
      purpose: 'Hours logged at each workstation compared with its capacity (daily capacity × working days, Monday–Saturday), plus good and scrap quantities. Over 100% shows in red.',
      why: 'Low utilization means idle machines; utilization over 100% means overtime or unrealistic capacity figures.',
    },
    {
      target: 'production-rpt-utilization-csv-btn',
      title: 'Export CSV',
      purpose: 'Downloads the utilization table as CSV.',
    },
  ],
}

export default config
