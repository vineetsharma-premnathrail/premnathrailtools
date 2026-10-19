import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'erp-dashboard',
  pageTitle: 'Service & Commissioning Dashboard',
  steps: [
    {
      target: 'erp-nav-grid',
      title: 'Dashboard',
      purpose: 'This page — a one-screen picture of every machine we have supplied and every open service ticket.',
    },
    {
      target: 'erp-nav-truck',
      title: 'Projects',
      purpose: 'The asset register: one record per machine (vehicle/equipment) we built and delivered — serial number, client, site, dates, warranty and AMC.',
      why: 'Every service request is raised against a machine, so the machine record must exist first. It is the single place to see a machine\'s whole life after dispatch.',
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
      purpose: 'Deleted machines and service requests stay here for 10 days and can be restored before they are purged for good.',
    },
    {
      target: 'erp-nav-bell',
      title: 'Notifications',
      purpose: 'Alerts for you — e.g. a service request assigned to you or a status change on one you raised.',
    },
    {
      target: 'erp-dash-stats',
      title: 'Headline numbers',
      purpose: 'Total machines in the register, total service requests ever raised, SRs raised this calendar month, and "Active Tickets" — SRs not yet Closed or Cancelled.',
      why: 'Active Tickets is the service team\'s current workload; if it keeps growing month on month, jobs are being opened faster than they are being closed.',
    },
    {
      target: 'erp-dash-charts',
      title: 'Status charts',
      purpose: 'Left: how many machines are in each operational status (Active, Under Service, Standby…). Right: open tickets split by priority (Urgent vs Standard).',
    },
    {
      target: 'erp-dash-recent-srs',
      title: 'Recent Service Tickets',
      purpose: 'The 8 newest service requests with machine, client, site, priority, status, age (days since it was opened) and warranty period. Click any row to open that ticket.',
      why: 'Age shows how long the customer has been waiting — a high age on an Urgent ticket needs attention first.',
    },
    {
      target: 'erp-dash-srs-viewall',
      title: 'View all tickets',
      purpose: 'Opens the full Service Request list with search and filters.',
    },
    {
      target: 'erp-dash-machines',
      title: 'Machine Assets',
      purpose: 'The first 8 machines by serial number, with dispatch and commissioning dates, current status and how many SRs each has had. Click a row to open the machine.',
      why: 'A machine with many SRs is a reliability problem worth raising with Design/Production.',
    },
    {
      target: 'erp-dash-machines-viewall',
      title: 'View all machines',
      purpose: 'Opens the full Projects Asset Register.',
    },
  ],
}

export default config
