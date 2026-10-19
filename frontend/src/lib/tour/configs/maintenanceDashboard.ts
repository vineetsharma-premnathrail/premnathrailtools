import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-dashboard',
  pageTitle: 'Maintenance Dashboard',
  steps: [
    {
      target: 'maintenance-nav-dashboard',
      title: 'Dashboard',
      purpose: 'The live picture of the plant: which machines are down right now, what is waiting for the maintenance team, and how well maintenance performed over the last 30 days.',
    },
    {
      target: 'maintenance-nav-pm-work',
      title: 'Project Work',
      purpose: 'Project WBS elements given to the Maintenance department, and project tasks assigned to you.',
    },
    {
      target: 'maintenance-nav-alert',
      title: 'Requests',
      purpose: 'Breakdown / problem reports raised by operators and supervisors. Every job starts here: someone reports a problem, maintenance acknowledges it and turns it into a Work Order.',
      why: 'Keeping requests separate from work orders means the shop floor can report problems instantly, while the maintenance in-charge decides what actually becomes a job.',
    },
    {
      target: 'maintenance-nav-wrench',
      title: 'Work Orders',
      purpose: 'The actual maintenance jobs — breakdown repairs, preventive (PM) jobs, calibrations. Each one is assigned, started, completed with spares and labour recorded, then closed.',
    },
    {
      target: 'maintenance-nav-factory',
      title: 'Assets',
      purpose: 'The asset register — every machine, crane, compressor, gauge or vehicle that maintenance looks after, with its full repair history, PM plans, spares and documents.',
    },
    {
      target: 'maintenance-nav-calendar',
      title: 'PM Schedule',
      purpose: 'Preventive Maintenance plans — "grease the press every week", "service the compressor every 3 months". The system raises the PM work order automatically when it falls due.',
      why: 'Planned maintenance is far cheaper than breakdowns. PM keeps machines running instead of waiting for them to fail.',
    },
    {
      target: 'maintenance-nav-box',
      title: 'Spares',
      purpose: 'Spare parts linked to assets, their stock levels, and which critical spares are below minimum.',
    },
    {
      target: 'maintenance-nav-shield',
      title: 'AMC & Warranty',
      purpose: 'Annual Maintenance Contracts and warranties on assets, with expiry alerts so renewals are not missed.',
    },
    {
      target: 'maintenance-nav-chart',
      title: 'Reports',
      purpose: 'MTTR, MTBF, availability, PM compliance, downtime and cost reports — how management measures the maintenance function.',
    },
    {
      target: 'maintenance-nav-settings',
      title: 'Settings',
      purpose: 'Module rules you can tune without code: PM lead days, the dashboard PM window, default request priorities, requester sign-off before close, AMC/warranty reminder days, default hours/day for MTBF and the critical-spare alert.',
    },
    {
      target: 'maintenance-nav-bell',
      title: 'Notifications',
      purpose: 'Alerts for new requests, assignments, approvals and PM jobs due.',
    },
    {
      target: 'maint-dash-plant-filter',
      title: 'Plant filter',
      purpose: 'Shown only when the company has more than one plant. Pick a plant to see only its machines and jobs; "All plants" shows everything.',
      after: 'Every tile and list on the page reloads for the chosen plant. Clicking a tile opens the matching list already filtered to that plant.',
    },
    {
      target: 'maint-dash-report-btn',
      title: '+ Report Breakdown',
      purpose: 'The quickest way to report a machine problem. Opens the New Request form.',
      after: 'The maintenance team is notified and the request appears under "Open requests" until someone acknowledges it.',
    },
    {
      target: 'maint-dash-kpi-live',
      title: 'Live counts',
      purpose: 'Machines Down — assets in Breakdown status right now. Open Requests — reported problems nobody has acknowledged yet. Open Work Orders — jobs not yet completed (with how many are yours). Awaiting Close — jobs finished by the technician but not yet verified and closed.',
      after: 'Click any tile to open the matching list, already filtered.',
      why: 'These four numbers should be close to zero at the end of a good day. A growing "Awaiting Close" means supervisors are not verifying finished jobs.',
    },
    {
      target: 'maint-dash-kpi-30d',
      title: 'Last 30 days',
      purpose: 'Breakdowns — how many breakdown jobs happened. Downtime — total machine time lost to breakdowns. MTTR — Mean Time To Repair: average time from a machine going down to being back up. Maintenance Cost — spares + labour + external service spent.',
      why: 'MTTR shows how fast the team responds and fixes. If it keeps rising, look at spares availability or skill gaps.',
    },
    {
      target: 'maint-dash-kpi-month',
      title: 'This month',
      purpose: 'MTTR and Availability for the current month, PM jobs due this week, overdue PM jobs, and critical spares below minimum stock.',
      why: 'Availability = share of working hours the machines were NOT lost to breakdowns. Green is 95% or more, amber 85–95%, red below 85%. Overdue PM and low critical spares are the two early warnings of future breakdowns.',
      after: 'Click a tile to open Reports, the PM Schedule (upcoming view) or Spares.',
    },
    {
      target: 'maint-dash-machines-down',
      title: 'Machines down now',
      purpose: 'Every asset currently in breakdown, with its criticality (A = line stops, B = important, C = low impact), the work order working on it, and a running downtime clock (refreshes every minute).',
      after: 'Click a row to open its work order — or the asset, if no work order has been raised yet.',
      why: 'An A-criticality machine with "No work order yet" is the first thing the maintenance in-charge should act on.',
    },
    {
      target: 'maint-dash-open-requests',
      title: 'Open requests',
      purpose: 'Problems reported but not yet acknowledged, with priority and a red "Machine down" tag where production has stopped.',
      after: 'Click to open the request, then acknowledge it or raise a work order.',
    },
    {
      target: 'maint-dash-my-wos',
      title: 'My work orders',
      purpose: 'Jobs assigned to you, with priority, status and planned start date.',
    },
    {
      target: 'maint-dash-awaiting-close',
      title: 'Completed — awaiting close',
      purpose: 'Jobs the technician has marked complete. "Waiting for requester" means the person who reported the problem has not yet confirmed the machine is fine; "Ready to close" means a supervisor can verify and close it.',
      why: 'Closing only after requester confirmation stops jobs being "closed" on paper while the machine is still faulty.',
    },
    {
      target: 'maint-dash-pm-due',
      title: 'Preventive maintenance — overdue & due this week',
      purpose: 'Overdue PM work orders (red, with days overdue) and PM due in the next 7 days. "Job not generated yet" means the plan is due but its work order has not been raised yet.',
    },
    {
      target: 'maint-dash-spares-low',
      title: 'Critical spares below minimum',
      purpose: 'Spares marked critical on some asset whose store stock is below minimum (shown as on hand / minimum), and how many assets depend on each.',
      why: 'A critical spare at zero turns a 1-hour repair into a multi-day breakdown while you wait for purchase.',
    },
  ],
}

export default config
