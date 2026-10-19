import { TourStep } from '../types'

// Steps for the shared ServiceRecordForm (New Service Job page and the edit
// form on an open / in-progress service job).
export function hydServiceFormSteps(editing: boolean): TourStep[] {
  return [
    {
      target: 'hyd-svcf-system',
      title: 'System',
      required: !editing,
      purpose: editing
        ? 'The system this job is for — fixed once the job is created.'
        : 'The system being serviced. Cannot be changed after the job is created.',
    },
    {
      target: 'hyd-svcf-plan',
      title: 'Maintenance Plan',
      purpose: editing
        ? 'The PM plan this job was raised from, if any — fixed once created.'
        : 'If this job carries out a preventive maintenance plan, pick it here ("— Not from a plan —" for a breakdown or one-off job). Pick the system first.',
      after: 'Completing a job raised from a plan resets that plan\'s last-done date and hours, so its next due date moves forward.',
    },
    {
      target: 'hyd-svcf-type',
      title: 'Service Type',
      options: [
        { value: 'Preventive', meaning: 'Planned PM work.' },
        { value: 'Corrective', meaning: 'Fixing a fault found before it caused a stoppage. Puts the system Under Maintenance.' },
        { value: 'Breakdown', meaning: 'The system has stopped working and must be repaired. Puts the system Under Maintenance.' },
        { value: 'Oil Change', meaning: 'Drain and refill the oil.' },
        { value: 'Filter Change', meaning: 'Replace filter elements.' },
        { value: 'Overhaul', meaning: 'Strip down and rebuild a major unit. Puts the system Under Maintenance.' },
        { value: 'Commissioning', meaning: 'First start-up and setting of a new system.' },
        { value: 'Inspection', meaning: 'Check only, no repair.' },
        { value: 'Modification', meaning: 'Changing the system\'s design or circuit.' },
      ],
      why: 'Breakdown, corrective and overhaul jobs mark an in-service system "Under Maintenance" until completed or cancelled — that is how the dashboard knows which machines are down.',
    },
    {
      target: 'hyd-svcf-date',
      title: 'Service Date',
      required: true,
      whatToEnter: 'The date the job was raised or started.',
    },
    {
      target: 'hyd-svcf-performed-by',
      title: 'Performed By',
      purpose: 'Our technician who did (or will do) the work.',
    },
    {
      target: 'hyd-svcf-agency',
      title: 'External Agency',
      whatToEnter: 'Outside party who did the work, if any.',
      validExample: 'Bosch Rexroth service engineer',
    },
    {
      target: 'hyd-svcf-problem',
      title: 'Reported Problem',
      whatToEnter: 'The symptom as reported.',
      validExample: 'Cylinder drifting under load, pump noisy',
    },
    {
      target: 'hyd-svcf-root-cause',
      title: 'Root Cause',
      whatToEnter: 'What actually caused the problem, once found.',
      validExample: 'Worn piston seal, clogged suction strainer',
      why: 'Recording the root cause (not just the symptom) shows repeating failures — e.g. the same seal failing every 3 months points to dirty oil or misalignment.',
    },
    {
      target: 'hyd-svcf-work-done',
      title: 'Work Done',
      whatToEnter: 'What was done to fix it. Required before the job can be completed.',
      validExample: 'Replaced piston seal kit, flushed and refilled with HLP 46, tested at 160 bar',
    },
    {
      target: 'hyd-svcf-checklist',
      title: 'Checklist',
      whatToEnter: editing ? 'One task per line.' : 'One task per line. Leave blank to copy the maintenance plan\'s checklist when the job is created.',
    },
    {
      target: 'hyd-svcf-running-hours',
      title: 'Running Hours (h)',
      whatToEnter: 'The system\'s hour-meter reading at the time of service.',
      validExample: '12980',
      after: 'On completion it updates the system\'s hour meter (if higher) and the plan\'s last-done hours.',
    },
    {
      target: 'hyd-svcf-downtime',
      title: 'Downtime (h)',
      whatToEnter: 'How many hours the machine could not be used because of this job. Zero or more.',
      why: 'Downtime is the real cost of a breakdown — lost production. Total downtime ÷ number of breakdowns gives MTTR (Mean Time To Repair); lower is better.',
    },
    {
      target: 'hyd-svcf-fluid-added',
      title: 'Fluid Added (L)',
      whatToEnter: 'Litres of oil topped up or refilled.',
      why: 'Frequent top-ups mean a leak somewhere.',
    },
    {
      target: 'hyd-svcf-oil-condition',
      title: 'Oil / Air Condition',
      whatToEnter: 'Result of the oil (or air) check.',
      validExample: 'ISO 4406 19/17/14, water 200 ppm',
    },
    {
      target: 'hyd-svcf-labour-cost',
      title: 'Labour Cost (₹)',
      whatToEnter: 'Labour charge for this job. Zero or more.',
    },
    {
      target: 'hyd-svcf-other-cost',
      title: 'Other Cost (₹)',
      whatToEnter: 'Any other charge — transport, outside machining, agency visit fee.',
      after: 'Total cost = spares + labour + other, shown at the top of the job and in dashboard totals.',
    },
    {
      target: 'hyd-svcf-next-date',
      title: 'Next Service Date',
      whatToEnter: 'When the system should next be serviced, if a date was advised. Cannot be before the service date.',
    },
    {
      target: 'hyd-svcf-remarks',
      title: 'Remarks',
      whatToEnter: 'Any other note.',
    },
    {
      target: 'hyd-svcf-add-spare-btn',
      title: '+ Add Spare',
      purpose: 'Adds a line for a spare part used on this job.',
    },
    {
      target: 'hyd-svcf-parts',
      title: 'Spare Parts Used',
      purpose: 'Each line: the spare (from the Spare Parts register), quantity (more than zero) and remarks. Do not list the same spare twice — combine the quantities.',
      after: 'Unit cost is taken from the spare (or its Store item) when saved. Spares linked to a Store item can be issued from a Store location when the job is completed.',
    },
    {
      target: 'hyd-svcf-submit-btn',
      title: editing ? 'Save Changes' : 'Create Service Job',
      purpose: editing ? 'Saves the job.' : 'Creates the job with its own record number, status Open.',
      after: editing
        ? 'A green "Service record saved." message appears. Save before clicking "Complete Job" — completion uses the saved job.'
        : 'Opens the new job. If something is missing, the exact reason is shown at the top of the form.',
    },
  ]
}
