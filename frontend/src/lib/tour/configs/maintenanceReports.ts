import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-reports',
  pageTitle: 'Maintenance Reports',
  steps: [
    {
      target: 'maintenance-nav-chart',
      title: 'Reports',
      purpose: 'How well maintenance is performing for a chosen period — the numbers management reviews every month.',
    },
    {
      target: 'maint-rpt-export-btn',
      title: 'Export Excel',
      purpose: 'Downloads the full report for the selected period and filters as an Excel workbook.',
    },
    {
      target: 'maint-rpt-filters',
      title: 'Filters',
      purpose: 'From / To dates (defaults to this month so far), Plant (when there are several), asset Category, and a single Asset. Every number and chart below reloads when you change one.',
      validExample: 'From 01-04-2026 To 30-09-2026 for a half-year review',
      invalidExample: 'To earlier than From',
    },
    {
      target: 'maint-rpt-kpis',
      title: 'Key numbers',
      purpose: 'Six headline KPIs. Hover or read the caption under each for its exact definition.',
      options: [
        { value: 'Downtime', meaning: 'Hours machines were down on breakdown/corrective (machine-down) jobs, counted only inside the period.' },
        { value: 'MTTR', meaning: 'Mean Time To Repair — average downtime per breakdown. Lower is better: it measures how fast the team responds and fixes.' },
        { value: 'MTBF', meaning: 'Mean Time Between Failures — (available hours − downtime) ÷ number of breakdowns. Higher is better: it measures how reliable the machines are.' },
        { value: 'Availability', meaning: 'Share of working hours machines were not down on breakdowns. Planned PM shutdowns do not count against it. Green ≥ 95%, amber 85–95%, red < 85%.' },
        { value: 'PM Compliance', meaning: 'PM jobs done on or before their due date ÷ PM jobs due in the period. Green ≥ 90%, amber 70–90%, red < 70%.' },
        { value: 'Maintenance Cost', meaning: 'Spares (net of returns) + labour + outside vendor cost of jobs finished in the period.' },
      ],
      why: 'MTTR tells you about the maintenance team (speed); MTBF tells you about the machines (reliability). Good PM compliance should, over months, push MTBF up and downtime down. The line under the tiles explains which working hours count as "available".',
    },
    {
      target: 'maint-rpt-downtime-chart',
      title: 'Breakdown downtime by month',
      purpose: 'Hours lost to breakdowns in each month of the period.',
      why: 'A rising trend is the earliest sign that PM is slipping or machines are ageing.',
    },
    {
      target: 'maint-rpt-cost-chart',
      title: 'Maintenance cost by month',
      purpose: 'Stacked bars of spares, labour and external (vendor) cost for jobs finished in each month.',
    },
    {
      target: 'maint-rpt-pm-compliance',
      title: 'PM compliance',
      purpose: 'For PM jobs due in the period: how many were done on time, done late, overdue and not done, and not yet due.',
      why: '"Overdue, not done" is the number to chase — each one is a machine running without the servicing it needs.',
    },
    {
      target: 'maint-rpt-work-mix',
      title: 'Breakdown vs planned work',
      purpose: 'Red = breakdown/corrective jobs, green = preventive/calibration/inspection jobs raised in the period, and the planned share %. Improvement jobs are not counted.',
      why: 'A healthy plant does most of its work as planned jobs. If red dominates, the team is fire-fighting instead of maintaining.',
    },
    {
      target: 'maint-rpt-top-assets',
      title: 'Top 10 assets',
      purpose: 'The ten assets with the most breakdowns and the ten with the most downtime. Click a row to open the asset.',
      why: 'Your worst offenders — candidates for a root-cause review, a better PM plan, or replacement.',
    },
    {
      target: 'maint-rpt-backlog',
      title: 'Backlog by age',
      purpose: 'Open work orders today (not limited to the period), grouped by age in days and priority.',
      why: 'Old Urgent/High jobs are the ones to chase in the daily maintenance meeting.',
    },
    {
      target: 'maint-rpt-pareto',
      title: 'Failure Pareto',
      purpose: 'Breakdown and corrective jobs by failure category, largest first, with each category\'s share and the running (cumulative) %.',
      why: 'Usually 2–3 categories cause ~80% of failures (the 80/20 rule). Fixing those first gives the biggest gain. A large "Not recorded" means technicians are skipping the failure category on completion.',
    },
    {
      target: 'maint-rpt-cost-asset',
      title: 'Cost by asset',
      purpose: 'Jobs, spares, labour, external and total cost per asset for jobs finished in the period.',
      why: 'Compare with the asset\'s purchase cost to decide whether to keep repairing or replace it.',
    },
    {
      target: 'maint-rpt-availability-asset',
      title: 'Availability by asset',
      purpose: 'For each asset that had breakdowns: number of breakdowns, downtime, available hours and availability %.',
    },
  ],
}

export default config
