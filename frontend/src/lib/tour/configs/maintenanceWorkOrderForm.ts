import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-work-order-form',
  pageTitle: 'New Work Order',
  steps: [
    {
      target: 'maint-wof-back',
      title: '← Back',
      purpose: 'Returns to the Work Orders list without saving — same as Cancel.',
    },
    {
      target: 'maint-wof-asset',
      title: 'Asset',
      purpose: 'The machine or equipment the work is on.',
      whatToEnter: 'Type the asset code or name and pick it.',
      required: true,
      validExample: 'PRESS-03 — 200T Hydraulic Press',
      invalidExample: 'A decommissioned asset (not allowed).',
    },
    {
      target: 'maint-wof-type',
      title: 'Type',
      purpose: 'What kind of job this is.',
      options: [
        { value: 'Breakdown', meaning: 'Repair after a stop. Counts in MTTR/MTBF.' },
        { value: 'Preventive', meaning: 'Routine planned maintenance (usually raised by a PM plan, not by hand).' },
        { value: 'Corrective', meaning: 'Fixing a defect found before it caused a stop.' },
        { value: 'Calibration', meaning: 'Checking a gauge or instrument against a standard.' },
        { value: 'Improvement', meaning: 'Modifying the machine to make it better or safer.' },
        { value: 'Inspection', meaning: 'Condition check only.' },
      ],
      why: 'Reports split cost and effort by type — a plant spending most of its effort on Breakdown rather than Preventive is reacting, not maintaining.',
    },
    {
      target: 'maint-wof-priority',
      title: 'Priority',
      purpose: 'How urgent the job is.',
      options: [
        { value: 'Standard', meaning: 'Normal course of the day (default).' },
        { value: 'Urgent', meaning: 'Immediately — line stopped or safety risk.' },
      ],
    },
    {
      target: 'maint-wof-title',
      title: 'Title',
      purpose: 'One line describing the job.',
      required: true,
      validExample: 'Replace worn spindle bearings',
      invalidExample: 'Work',
    },
    {
      target: 'maint-wof-instructions',
      title: 'Instructions',
      purpose: 'Details for the technician — what to do, safety precautions (lock-out), tools or spares to bring.',
    },
    {
      target: 'maint-wof-machine-down',
      title: 'Machine is down for this job',
      purpose: 'Tick if the machine cannot run while this job is open.',
      after: 'A "Down Since" date-time box appears (cannot be in the future). The asset is marked down, downtime is tracked from that time, and the machine is blocked in Production until the job is completed.',
      why: 'Planned shutdown time is still lost production — tracking it keeps availability figures honest.',
    },
    {
      target: 'maint-wof-technician',
      title: 'Technician',
      purpose: 'Who will do the job.',
      whatToEnter: 'Pick a technician, or leave "Assign later".',
      after: 'With a technician the job starts as Assigned and they are notified; without one it starts as Draft.',
    },
    {
      target: 'maint-wof-planned-start',
      title: 'Planned Start',
      purpose: 'Date the job is planned to begin.',
      whatToEnter: 'A date (DD-MM-YYYY). Optional.',
    },
    {
      target: 'maint-wof-planned-end',
      title: 'Planned End',
      purpose: 'Date the job should be finished.',
      invalidExample: 'A date before Planned Start — rejected.',
    },
    {
      target: 'maint-wof-est-hours',
      title: 'Est. Hours',
      purpose: 'Estimated working hours for the job, in half-hour steps.',
      validExample: '2.5',
      invalidExample: '-1',
      why: 'Comparing estimated hours with labour actually logged shows where planning is off.',
    },
    {
      target: 'maint-wof-add-line',
      title: '+ Add Line (Checklist)',
      purpose: 'Adds a checklist step. Each line has a description and an optional expected value.',
      validExample: 'Check belt tension — Expected: 10–12 mm deflection',
      after: 'Each line must be marked OK / Not OK / N/A on the work order before it can be completed. Empty lines are rejected — fill them in or click Remove.',
      why: 'A checklist makes sure every technician does the job the same, complete way.',
    },
    {
      target: 'maint-wof-submit',
      title: 'Create Work Order',
      purpose: 'Saves the job.',
      after: 'You are taken to the new work order page, where it is assigned, started, completed and closed.',
    },
  ],
}

export default config
