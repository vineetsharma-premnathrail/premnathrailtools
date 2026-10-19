import { TourStep } from '../types'

// Steps for the shared MaintenancePlanForm (New Plan page and the edit form
// on the plan detail page).
export function hydPlanFormSteps(editing: boolean): TourStep[] {
  return [
    {
      target: 'hyd-planf-title',
      title: 'Title',
      required: true,
      whatToEnter: 'The task, written as an instruction.',
      validExample: 'Replace return-line filter element',
      invalidExample: 'Filter',
    },
    {
      target: 'hyd-planf-system',
      title: 'System',
      required: !editing,
      purpose: editing
        ? 'The system this plan belongs to — fixed once the plan is created.'
        : 'The system (power pack, air unit…) this task is done on. Cannot be changed after the plan is created.',
      why: 'Hours-based plans read the system\'s running hours, and every job raised from the plan is booked against this system.',
    },
    {
      target: 'hyd-planf-type',
      title: 'Maintenance Type',
      purpose: 'What kind of task this is — used for filtering and reports.',
      options: [
        { value: 'Preventive', meaning: 'General planned maintenance with several tasks.' },
        { value: 'Oil Change', meaning: 'Drain and refill hydraulic oil.' },
        { value: 'Oil Sampling', meaning: 'Take an oil sample for a cleanliness/condition check.' },
        { value: 'Filter Change', meaning: 'Replace filter elements.' },
        { value: 'Seal Inspection', meaning: 'Check cylinders and valves for seal leaks.' },
        { value: 'Hose Inspection', meaning: 'Check hoses for cracks, bulges, abrasion and age.' },
        { value: 'Accumulator Pre-charge Check', meaning: 'Check the nitrogen gas pressure in the accumulator.' },
        { value: 'Calibration', meaning: 'Calibrate gauges, pressure switches and sensors.' },
        { value: 'Lubrication', meaning: 'Grease/oil the moving parts.' },
        { value: 'Condensate Drain', meaning: 'Drain water from air receivers and filters (pneumatic).' },
        { value: 'General Inspection', meaning: 'Walk-round visual check.' },
      ],
    },
    {
      target: 'hyd-planf-assigned',
      title: 'Assigned To',
      purpose: 'The person responsible for doing this task when it falls due. Leave "Unassigned" if not decided.',
    },
    {
      target: 'hyd-planf-active',
      title: 'Active',
      purpose: 'Ticked = the plan is tracked and shows up when due. Unticked = paused (e.g. system is idle or scrapped); it shows as Inactive.',
    },
    {
      target: 'hyd-planf-freq-days',
      title: 'Every N Days',
      whatToEnter: 'Repeat the task every this many calendar days. Whole number, 1 or more.',
      validExample: '90',
      invalidExample: '0 or 2.5',
      why: 'Some things age with time even when the machine is idle — oil oxidises, hoses perish, seals dry out.',
    },
    {
      target: 'hyd-planf-freq-hours',
      title: 'Every N Running Hours',
      whatToEnter: 'Repeat the task every this many running hours of the system. More than zero.',
      validExample: '500',
      why: 'Wear depends on how much the machine runs. Set both days and hours and the task falls due at whichever comes first. At least one of the two is required.',
    },
    {
      target: 'hyd-planf-start',
      title: 'Start Date',
      whatToEnter: 'The first due date if the task has never been done. Left empty = today.',
    },
    {
      target: 'hyd-planf-last-date',
      title: 'Last Done On',
      whatToEnter: 'When this task was last carried out, if you know it. Next due date = last done + N days.',
      after: 'Completing a service job raised from this plan updates this automatically.',
    },
    {
      target: 'hyd-planf-last-hours',
      title: 'Last Done At (Running h)',
      whatToEnter: 'The system\'s running-hour meter reading when the task was last done. Zero or more.',
      validExample: '12450',
      after: editing ? 'Updated automatically when a job from this plan is completed with hours recorded.' : 'If left empty on an hours-based plan, counting starts from the system\'s current running hours.',
    },
    {
      target: 'hyd-planf-checklist',
      title: 'Checklist',
      whatToEnter: 'One task per line — the steps the technician must do.',
      validExample: 'Drain and flush reservoir\nReplace return filter element\nCheck accumulator pre-charge',
      after: 'Copied onto every service job raised from this plan, so the technician ticks through the same list each time.',
    },
    {
      target: 'hyd-planf-remarks',
      title: 'Remarks',
      whatToEnter: 'Any note — oil grade, special tools, safety precautions.',
    },
    {
      target: 'hyd-planf-submit-btn',
      title: editing ? 'Save Changes' : 'Create Plan',
      purpose: editing ? 'Saves the plan.' : 'Creates the plan with its own plan number.',
      after: editing
        ? 'A green "Maintenance plan saved." message appears and the due card above is recalculated.'
        : 'Opens the new plan showing when it is next due. If something is missing, the exact reason is shown at the top of the form.',
    },
  ]
}
