import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-work-order-detail',
  pageTitle: 'Work Order',
  steps: [
    {
      target: 'maint-wod-status',
      title: 'Number, status & priority',
      purpose: 'The work order number, its current status and its priority. The title is shown just below.',
      options: [
        { value: 'Draft', meaning: 'Created, no technician yet.' },
        { value: 'Assigned', meaning: 'Technician assigned, work not started.' },
        { value: 'In Progress', meaning: 'Work started — log labour, issue spares, tick the checklist.' },
        { value: 'On Hold', meaning: 'Paused — waiting for spares, a vendor or a shutdown window (reason shown in a purple banner).' },
        { value: 'Completed', meaning: 'Technician has finished. Waiting for the requester to confirm (if raised from a request) and a supervisor to close.' },
        { value: 'Closed', meaning: 'Verified and closed. Cost is frozen; the asset returns to Operational if nothing else is open on it.' },
        { value: 'Cancelled', meaning: 'Dropped (reason shown in a red banner). Planned spares are released.' },
      ],
    },
    {
      target: 'maint-wod-pm-plan',
      title: 'From PM plan',
      purpose: 'Shown when this job was raised automatically by a Preventive Maintenance plan — click the plan code to open it. The due date is the date the PM fell due.',
      why: 'When this job is closed, the plan\'s next due date is calculated from it, so PM jobs should be closed promptly.',
    },
    {
      target: 'maint-wo-assign-btn',
      title: 'Assign Technician',
      purpose: 'Draft jobs only. Pick the technician who will do the work.',
      after: 'Status moves to Assigned and the technician is notified.',
    },
    {
      target: 'maint-wo-start-btn',
      title: 'Start Job',
      purpose: 'Press when work actually begins on the machine.',
      after: 'Status moves to In Progress and the actual start time is recorded. Spares can now be issued from Store.',
      why: 'Actual start vs. report time shows how long the machine waited for a technician — part of the downtime that MTTR measures.',
    },
    {
      target: 'maint-wo-complete-btn',
      title: 'Mark Completed',
      purpose: 'Press when the repair is done. Opens a dialog for failure category, root cause, action taken and the time the machine was handed back.',
      after: 'Status becomes Completed and the downtime clock stops. If the job came from a request, the requester is asked to confirm the machine is OK.',
      why: 'Every checklist line must have a result, and Breakdown/Corrective jobs must record the root cause — that is what lets you stop the same failure happening again.',
    },
    {
      target: 'maint-wo-resume-btn',
      title: 'Resume',
      purpose: 'On Hold jobs only. Restarts work once whatever you were waiting for has arrived.',
      after: 'Status returns to In Progress.',
    },
    {
      target: 'maint-wo-close-btn',
      title: 'Verify & Close',
      purpose: 'Completed jobs only — for the supervisor. Confirms the work is done properly.',
      after: 'Status becomes Closed, the cost is frozen, and the asset returns to Operational if nothing else is open on it. For PM jobs, the next due date is set.',
      why: 'Greyed out while waiting for the requester to confirm the machine is OK — closing a job the operator has not accepted hides repeat faults.',
    },
    {
      target: 'maint-wo-hold-btn',
      title: 'Put On Hold',
      purpose: 'In Progress jobs only. Pause the job.',
      whatToEnter: 'A reason — required.',
      validExample: 'Waiting for bearing 6205-2RS from purchase, PO raised',
      after: 'Status becomes On Hold and the reason shows in a purple banner.',
    },
    {
      target: 'maint-wo-reassign-btn',
      title: 'Reassign',
      purpose: 'Hand the job to a different technician (Assigned, In Progress or On Hold jobs).',
    },
    {
      target: 'maint-wo-reopen-btn',
      title: 'Reopen',
      purpose: 'Completed jobs only. Sends the job back to In Progress if the fix did not hold.',
      whatToEnter: 'A reason — required.',
    },
    {
      target: 'maint-wo-edit-btn',
      title: 'Edit Details',
      purpose: 'Change title, type, priority, estimated hours, planned dates, external service vendor and cost, and instructions. Available until the job is closed or cancelled.',
    },
    {
      target: 'maint-wo-cancel-btn',
      title: 'Cancel',
      purpose: 'Drop the job (Draft, Assigned or On Hold only — an In Progress job must be put On Hold first).',
      whatToEnter: 'A reason — required.',
      after: 'Planned spares are dropped. If it came from a request, the request goes back to Acknowledged.',
    },
    {
      target: 'maint-wod-back',
      title: '← Back',
      purpose: 'Returns to the Work Orders list.',
    },
    {
      target: 'maint-wod-stepper',
      title: 'Progress',
      purpose: 'Where the job is in its life: Draft → Assigned → In Progress (or On Hold) → Completed → Closed.',
    },
    {
      target: 'maint-wod-summary',
      title: 'Job summary',
      purpose: 'Asset (click to open), plant, type, technician, the request it came from (click to open), planned dates, estimated hours, actual start/finish, and — if the machine is down — when it went down and downtime so far (live) or final. Failure category, root cause and action taken appear once recorded.',
    },
    {
      target: 'maint-wod-checklist',
      title: 'Checklist',
      purpose: 'Step-by-step checks for this job. For each line click OK, Not OK or N/A, and type the measured reading and remarks where useful (saved when you leave the box).',
      after: 'The job cannot be completed until every line has a result.',
      why: 'A Not OK result with a reading (e.g. vibration 7.2 mm/s against 4.5 expected) is evidence for planning the next repair.',
    },
    {
      target: 'maint-wod-add-check',
      title: 'Add a check',
      purpose: 'Type an extra checklist line and press Enter or + Add.',
      validExample: 'Inspect coupling for wear',
    },
    {
      target: 'maint-wod-spares',
      title: 'Spares',
      purpose: 'Spare parts for this job: planned quantity, issued, returned, current stock and cost. Per line: Issue (take from Store), Return (send unused back), Remove (only if nothing issued yet). Stock shown red means not enough for what is still planned.',
    },
    {
      target: 'maint-wo-issue-spare-btn',
      title: 'Issue from Store',
      purpose: 'Takes a spare part out of Store stock against this job (Assigned, In Progress or On Hold).',
      after: 'Posts an issue in the Store stock ledger against this work order; the cost is added to the job.',
      why: 'Issuing against the work order means every rupee of spares is traceable to the machine it was used on.',
    },
    {
      target: 'maint-wo-plan-spare-btn',
      title: '+ Plan Spare',
      purpose: 'Lists a spare the job will need without taking it from stock yet.',
      why: 'Planning shows Store what to keep ready and highlights shortages before the technician is standing at the machine.',
    },
    {
      target: 'maint-wod-labour',
      title: 'Labour',
      purpose: 'Time each technician spent on this job, with rate and cost.',
    },
    {
      target: 'maint-wo-log-time-btn',
      title: '+ Log Time',
      purpose: 'Record hours worked (Assigned, In Progress, On Hold or Completed jobs).',
      after: 'Opens a dialog for technician, from/to time or hours, hourly rate and remarks. Labour cost is added to the job.',
    },
    {
      target: 'maint-wod-cost',
      title: 'Cost',
      purpose: 'Spares + Labour + External (outside service vendor) = Total cost of this job.',
      why: 'Cost per asset over time shows which machines are becoming too expensive to keep repairing.',
    },
    {
      target: 'maint-wod-files',
      title: 'Service Reports & Photos',
      purpose: 'Attach the vendor service report, before/after photos, or test certificates. Uploading is allowed until the job is closed.',
    },
  ],
}

export default config
