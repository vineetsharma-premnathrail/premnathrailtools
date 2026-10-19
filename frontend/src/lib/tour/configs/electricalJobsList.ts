import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'electrical-jobs-list',
  pageTitle: 'RRV Electrical Jobs',
  steps: [
    {
      target: 'electrical-nav-bolt',
      title: 'RRV Jobs',
      purpose: 'Every electrical job — one per rail-road vehicle whose electrical system is being built.',
    },
    {
      target: 'elec-jobs-new-btn',
      title: '+ New Job',
      purpose: 'Creates a job for a new vehicle.',
      after: 'Opens the New Job form (with its own tour). The job is created with all 20 scope stages ready to plan.',
    },
    {
      target: 'elec-jobs-search',
      title: 'Search',
      purpose: 'Finds jobs by job number, title, RRV model, vehicle / serial number or customer.',
      whatToEnter: 'Any part of those values — the list updates as you type.',
      validExample: 'RRV-450',
    },
    {
      target: 'elec-jobs-status-filter',
      title: 'Status filter',
      purpose: 'Limits the list by job status.',
      options: [
        { value: 'Open (draft / active / hold)', meaning: 'Default — every job that still needs work: Draft, In Progress and On Hold.' },
        { value: 'All statuses', meaning: 'Everything, including finished and cancelled jobs.' },
        { value: 'Draft', meaning: 'Created but no stage started yet.' },
        { value: 'In Progress', meaning: 'Work has started on at least one stage.' },
        { value: 'On Hold', meaning: 'Paused with a reason (e.g. waiting for customer approval).' },
        { value: 'Handed Over', meaning: 'Vehicle handed to the customer; job waiting to be closed.' },
        { value: 'Closed', meaning: 'Finished and locked.' },
        { value: 'Cancelled', meaning: 'Stopped for good.' },
      ],
    },
    {
      target: 'elec-jobs-phase-filter',
      title: 'Phase filter',
      purpose: 'Shows only jobs whose current (next unfinished) stage is in this phase.',
      options: [
        { value: 'Design', meaning: 'Requirement, system design, schematics, component selection, BOM, cable and panel design, drawing revisions.' },
        { value: 'Procurement', meaning: 'Buying the components (Purchase Requirement).' },
        { value: 'Assembly', meaning: 'Electrical assembly, wiring / harness installation, panel assembly.' },
        { value: 'Testing & QC', meaning: 'Electrical testing, Quality inspection, troubleshooting.' },
        { value: 'Handover', meaning: 'Commissioning, final documents, handover and as-built records.' },
      ],
    },
    {
      target: 'elec-jobs-mine',
      title: 'My jobs',
      purpose: 'Tick to see only jobs where you are the lead engineer or own a stage.',
    },
    {
      target: 'elec-jobs-table',
      title: 'Jobs table',
      purpose: 'One row per job. Click any row to open the job page.',
      after: 'Columns: Current Stage = the next stage still to finish; Progress = stages done out of total; Target Handover turns red when overdue; Priority and Status are coloured badges.',
      why: 'Progress counts stages that are Completed or marked N/A, so a job can reach 100% even when some stages do not apply to that vehicle.',
    },
  ],
}

export default config
