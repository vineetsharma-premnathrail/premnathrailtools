import { TourStep } from '../types'

// Shared field steps for the PM Plan create and edit forms (both render
// components/maintenance/PmPlanForm.tsx).
export function pmPlanFormSteps(isEdit: boolean): TourStep[] {
  return [
    {
      target: 'maint-pmf-back',
      title: '← Back',
      purpose: isEdit
        ? 'Returns to the plan without saving — same as Cancel.'
        : 'Returns to the PM Schedule (or the asset you came from) without saving — same as Cancel.',
    },
    {
      target: 'maint-pmf-asset',
      title: 'Asset',
      purpose: 'The machine this plan is for.',
      required: true,
      whatToEnter: 'Type the asset code or name and pick it.',
    },
    {
      target: 'maint-pmf-title',
      title: 'Title',
      purpose: 'What the job is, in a few words. Becomes the title of every work order raised.',
      required: true,
      validExample: 'Monthly lubrication & oil level check',
      invalidExample: 'PM',
    },
    {
      target: 'maint-pmf-type',
      title: 'Job Type',
      purpose: 'The kind of routine job.',
      options: [
        { value: 'Preventive', meaning: 'Routine servicing to prevent failure — lubrication, cleaning, part replacement.' },
        { value: 'Calibration', meaning: 'Checking gauges/instruments against a standard on a schedule.' },
        { value: 'Inspection', meaning: 'Condition check only — look, listen, measure.' },
      ],
    },
    {
      target: 'maint-pmf-instructions',
      title: 'Instructions',
      purpose: 'Copied onto every work order: safety notes, lock-out steps, reference to the OEM manual.',
    },
    {
      target: 'maint-pmf-frequency',
      title: 'Every',
      purpose: 'How often the job repeats: a whole number and a unit (Day(s), Week(s), Month(s), Year(s)).',
      required: true,
      validExample: '3 Month(s)',
      invalidExample: '0 or 1.5',
      why: 'Start from the OEM manual\'s service intervals, then adjust using the machine\'s breakdown history.',
    },
    {
      target: 'maint-pmf-basis',
      title: 'Next Due From',
      purpose: 'How the next due date is worked out after a job is closed.',
      options: [
        { value: 'Due date (fixed calendar)', meaning: 'Next due = previous DUE date + interval, even if done late. Keeps a steady calendar (e.g. every 1st of the month).' },
        { value: 'Last completion (floating)', meaning: 'Next due = date the job was actually DONE + interval. Use when the gap between services matters more than the calendar date.' },
      ],
    },
    {
      target: 'maint-pmf-next-due',
      title: 'Next Due Date',
      purpose: 'When the first (or next) job falls due.',
      required: true,
      whatToEnter: 'A date (DD-MM-YYYY).',
    },
    {
      target: 'maint-pmf-lead-days',
      title: 'Lead Days',
      purpose: 'How many days before the due date the work order is raised. Default 3.',
      validExample: '3',
      invalidExample: '-1',
      why: 'Gives the technician time to plan, collect spares and book the machine stop.',
    },
    {
      target: 'maint-pmf-technician',
      title: 'Default Technician',
      purpose: 'Who normally does this job.',
      after: 'With a technician, each job is raised as Assigned and they are notified; without one it is raised as Draft for the planner to assign.',
    },
    {
      target: 'maint-pmf-est-hours',
      title: 'Est. Hours',
      purpose: 'Expected working hours per job.',
      validExample: '1.5',
    },
    {
      target: 'maint-pmf-shutdown',
      title: 'Machine must be stopped',
      purpose: 'Tick if the machine cannot run during this job.',
      after: 'The machine and its Production workstation are blocked only once the technician starts the job — not when it is raised.',
    },
    {
      target: 'maint-pmf-active',
      title: 'Plan is active',
      purpose: 'Untick to pause the plan — no jobs will be raised until it is active again.',
    },
    {
      target: 'maint-pmf-add-check',
      title: '+ Add Check',
      purpose: 'Adds a checklist line: description and an optional expected value. Use ↑ to reorder and × to remove.',
      validExample: 'Check hydraulic oil level — Expected: between marks',
      after: 'Each line is copied into every work order; the technician marks it OK / Not OK / N/A.',
    },
    {
      target: 'maint-pmf-spare-search',
      title: 'Spares Kit',
      purpose: 'Search Store items and click to add the spares this job normally uses, then set quantity and remarks.',
      validExample: 'Grease EP2 — 0.5 kg',
      after: 'The kit is copied onto each work order as planned spares at the plant\'s default store. Nothing is reserved or issued until the technician issues it on the job.',
    },
    {
      target: 'maint-pmf-submit',
      title: isEdit ? 'Save Changes' : 'Create PM Plan',
      purpose: isEdit ? 'Saves the changes to the plan.' : 'Creates the plan.',
      after: 'You are taken to the plan page. The scheduler raises jobs automatically from now on; use Generate Now there to raise the first job straight away.',
    },
  ]
}
