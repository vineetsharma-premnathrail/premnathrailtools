import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'production-dashboard',
  pageTitle: 'Production Dashboard',
  steps: [
    {
      target: 'production-nav-dashboard',
      title: 'Dashboard tab',
      purpose: 'This page — a one-screen summary of everything happening in Production right now.',
    },
    {
      target: 'production-nav-pm-work',
      title: 'Project Work tab',
      purpose: 'Project Management WBS elements given to the Production department, and project tasks assigned to you.',
    },
    {
      target: 'production-nav-truck',
      title: 'RRV Builds tab',
      purpose: 'One record per Rail-cum-Road Vehicle, tracked stage by stage from planning to customer handover.',
    },
    {
      target: 'production-nav-clipboard',
      title: 'Work Orders tab',
      purpose: 'Every work order — the shop-floor instruction to build a quantity of one product from its BOM.',
    },
    {
      target: 'production-nav-gear',
      title: 'Shop Floor tab',
      purpose: 'The operator\'s board: open operations grouped by workstation, with Start, Log Time and Complete buttons.',
    },
    {
      target: 'production-nav-calendar',
      title: 'Planning tab',
      purpose: 'Material shortages against open work orders, workstation load and the schedule chart.',
    },
    {
      target: 'production-nav-layers',
      title: 'BOM & Routing tab',
      purpose: 'Bills of Material (what parts go into a product) and Routings (which operations, on which workstation, for how long).',
    },
    {
      target: 'production-nav-factory',
      title: 'Workstations tab',
      purpose: 'Machines, bays and work centres the routing operations run on, with their daily capacity and hourly rate.',
    },
    {
      target: 'production-nav-bar-chart',
      title: 'Reports tab',
      purpose: 'Output, cost (estimated vs actual) and workstation utilization for any date range.',
    },
    {
      target: 'production-nav-bell',
      title: 'Notifications',
      purpose: 'Approvals, inspection results and reminders that need your attention.',
    },
    {
      target: 'production-dash-new-wo-btn',
      title: '+ New Work Order',
      purpose: 'Shortcut to raise a new work order from an active BOM.',
      after: 'Opens the New Work Order form. The order is created as a Draft — nothing moves in Store until it is released.',
    },
    {
      target: 'production-dash-kpi-in-progress',
      title: 'In Progress',
      purpose: 'Work orders currently being built. The small line underneath shows how many are Released (waiting to start) and Draft (not yet released). Click to open the Work Orders list.',
    },
    {
      target: 'production-dash-kpi-overdue',
      title: 'Overdue',
      purpose: 'Open work orders whose planned end date has passed. Shown in red when above zero.',
      why: 'Overdue orders usually mean a late customer delivery — check these first every morning.',
    },
    {
      target: 'production-dash-kpi-shortages',
      title: 'Material Shortages',
      purpose: 'Number of items that Store cannot fully supply for released work orders. Click to go to Planning, where you can raise a Purchase Request or a build order for each.',
    },
    {
      target: 'production-dash-kpi-inspection',
      title: 'Awaiting Inspection',
      purpose: 'Quality-gate operations waiting for a Quality inspection result. Click to go to the Shop Floor board.',
      why: 'A quality-gate operation cannot be completed until Quality passes it, so these hold up the whole order.',
    },
    {
      target: 'production-dash-kpi-output',
      title: 'Output (30 days)',
      purpose: 'Finished units received into Store from work orders in the last 30 days.',
    },
    {
      target: 'production-dash-kpi-scrap',
      title: 'Scrap (30 days)',
      purpose: 'Units scrapped in the last 30 days, with the scrap rate as a percentage of total output.',
      why: 'Scrap rate is a key quality and cost measure — a rising rate points to a process, tooling or skill problem.',
    },
    {
      target: 'production-dash-kpi-hours',
      title: 'Hours Booked (30 days)',
      purpose: 'Total operator/machine hours logged against operations in the last 30 days.',
    },
    {
      target: 'production-dash-kpi-masters',
      title: 'Masters',
      purpose: 'Number of active BOMs and active workstations. Click to open BOM & Routing.',
    },
    {
      target: 'production-dash-due-soon',
      title: 'Due in the next 7 days',
      purpose: 'Open work orders that must finish this week, with progress (built / planned), due date and status. Click a row to open it.',
      options: [
        { value: 'Draft', meaning: 'Created but not yet released — no material reserved, not on the shop floor.' },
        { value: 'Released', meaning: 'Sent to the shop floor; material reserved; waiting for the first operation to start.' },
        { value: 'In Progress', meaning: 'At least one operation has started.' },
        { value: 'Completed', meaning: 'Production finished; waiting to be closed.' },
        { value: 'Closed', meaning: 'Locked — costs are final for reporting.' },
        { value: 'Cancelled', meaning: 'Stopped; kept on record.' },
      ],
    },
    {
      target: 'production-dash-recent',
      title: 'Recent work orders',
      purpose: 'The latest work orders raised. Click a row to open it.',
    },
  ],
}

export default config
