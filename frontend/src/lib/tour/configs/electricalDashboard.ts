import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'electrical-dashboard',
  pageTitle: 'Electrical Dashboard',
  steps: [
    {
      target: 'electrical-nav-dashboard',
      title: 'Dashboard',
      purpose: 'This page — a one-screen health check of every RRV electrical job.',
    },
    {
      target: 'electrical-nav-pm-work',
      title: 'Project Work',
      purpose: 'Project WBS elements management has given the Electrical department, and project tasks assigned to you.',
    },
    {
      target: 'electrical-nav-bolt',
      title: 'RRV Jobs',
      purpose: 'The main working area. One job = the complete electrical scope of one rail-road vehicle, from requirement to handover, tracked in 20 stages.',
    },
    {
      target: 'electrical-nav-drawing',
      title: 'Drawings',
      purpose: 'The drawing register across all jobs — schematics, wiring and panel drawings with their revisions (R0, R1 …) and approval status.',
    },
    {
      target: 'electrical-nav-cart',
      title: 'Purchase Req.',
      purpose: 'Every BOM component across all jobs that still has to be bought, with the purchase requisition (PR) it is linked to.',
    },
    {
      target: 'electrical-nav-meter',
      title: 'Testing',
      purpose: 'Register of all factory and commissioning tests (continuity, insulation resistance, etc.) across jobs, with pass/fail and retests.',
    },
    {
      target: 'electrical-nav-wrench',
      title: 'Troubleshooting',
      purpose: 'Log of electrical faults found on any job — symptom, root cause and corrective action.',
    },
    {
      target: 'electrical-nav-bell',
      title: 'Notifications',
      purpose: 'Your alerts — e.g. a drawing waiting for your approval, an issue assigned to you, a QC inspection result.',
    },
    {
      target: 'elec-dash-new-job-btn',
      title: '+ New RRV Electrical Job',
      purpose: 'Starts a new job for a vehicle whose electrical system you are about to build.',
      after: 'Opens the New Job form — it has its own guided tour.',
    },
    {
      target: 'elec-dash-kpi-active',
      title: 'Active Jobs',
      purpose: 'Jobs In Progress, with Draft (created but no stage started) and On Hold counts underneath. Click to open the jobs list.',
    },
    {
      target: 'elec-dash-kpi-overdue',
      title: 'Overdue',
      purpose: 'Open jobs whose Target Handover date has already passed.',
      why: 'This is the first number to look at each morning — a non-zero value means a customer commitment is already late.',
    },
    {
      target: 'elec-dash-kpi-handed-over',
      title: 'Handed Over',
      purpose: 'Vehicles already handed to the customer but not yet closed — usually waiting for the as-built drawings and final documents.',
      why: 'A job is only finished when its records are complete. Closing it then locks the records.',
    },
    {
      target: 'elec-dash-kpi-awaiting-qc',
      title: 'Awaiting QC',
      purpose: 'Jobs where a final inspection has been requested from the Quality department and not yet decided.',
    },
    {
      target: 'elec-dash-kpi-drawings',
      title: 'Drawings to Approve',
      purpose: 'Drawing revisions submitted for approval and still waiting. Click to open the Drawing Register.',
      why: 'Nothing should be built from an unapproved drawing — pending approvals hold up the build.',
    },
    {
      target: 'elec-dash-kpi-to-buy',
      title: 'Components to Buy',
      purpose: 'BOM lines marked "To Buy" that have no purchase requisition yet. Click to open Purchase Requirements.',
      why: 'Components with long lead times hold up assembly if the PR is raised late.',
    },
    {
      target: 'elec-dash-kpi-failed-tests',
      title: 'Failed Tests',
      purpose: 'Tests that failed and do not yet have a passing retest. Click to open the Test Register.',
    },
    {
      target: 'elec-dash-kpi-open-issues',
      title: 'Open Issues',
      purpose: 'Faults still Open or Investigating, with how many are Critical. Click to open Troubleshooting.',
    },
    {
      target: 'elec-dash-by-phase',
      title: 'Open jobs by phase',
      purpose: 'How many open jobs are currently in each phase: Design & Engineering → Procurement → Assembly & Installation → Testing & QC → Commissioning & Handover.',
      why: 'Shows where work is piling up — e.g. many jobs stuck in Procurement points to a purchasing bottleneck.',
    },
    {
      target: 'elec-dash-due-soon',
      title: 'Handover due in the next 14 days',
      purpose: 'Jobs whose Target Handover falls in the next two weeks, with stages done / total. A red date means already overdue. Click a row to open the job.',
    },
    {
      target: 'elec-dash-recent',
      title: 'Recent jobs',
      purpose: 'The latest jobs with their current stage and status badge. Click a row to open the job.',
      options: [
        { value: 'Draft', meaning: 'Created, no stage started yet.' },
        { value: 'In Progress', meaning: 'At least one stage has been started.' },
        { value: 'On Hold', meaning: 'Paused with a reason; stage work is frozen until resumed.' },
        { value: 'Handed Over', meaning: 'Vehicle handed to the customer; records may still be finishing.' },
        { value: 'Closed', meaning: 'Finished — records are final and cannot be changed.' },
        { value: 'Cancelled', meaning: 'Stopped for good, with a reason. Cannot be reopened.' },
      ],
    },
  ],
}

export default config
