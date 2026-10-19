import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'maintenance-pm-plan-detail',
  pageTitle: 'PM Plan',
  steps: [
    {
      target: 'maint-pmd-status',
      title: 'Plan & due state',
      purpose: 'Plan code, title and its due state.',
      options: [
        { value: 'Overdue', meaning: 'Past due and the job is not done.' },
        { value: 'Due soon', meaning: 'Within lead time — the job is raised or about to be.' },
        { value: 'Scheduled', meaning: 'Active, next due date further away.' },
        { value: 'Inactive', meaning: 'Plan is switched off.' },
      ],
      after: 'A blue banner below shows the current open job, if any. Only one job per plan is open at a time — the next is raised after it is closed.',
    },
    {
      target: 'maint-pmd-generate-btn',
      title: 'Generate Now',
      purpose: 'Raises the work order for the next due date immediately instead of waiting for the scheduler. Shown only when the plan is active and has no open job.',
      after: 'The job is assigned to the default technician (or raised as Draft) and a green note shows its number.',
    },
    {
      target: 'maint-pmd-edit-btn',
      title: 'Edit',
      purpose: 'Change frequency, due date, checklist, spares kit or technician.',
    },
    {
      target: 'maint-pmd-toggle-btn',
      title: 'Deactivate / Activate',
      purpose: 'Deactivate stops the scheduler raising jobs (an open job stays open). Activate restarts it from the next due date — check that date first if the plan was off for a while.',
    },
    {
      target: 'maint-pmd-delete-btn',
      title: 'Delete',
      purpose: 'Removes the plan (asks to confirm). Work orders already raised stay on record.',
    },
    {
      target: 'maint-pmd-back',
      title: '← Back',
      purpose: 'Returns to the PM Schedule.',
    },
    {
      target: 'maint-pmd-plan',
      title: 'Plan details',
      purpose: 'Asset (click to open), plant, job type, frequency, basis (fixed calendar or from last completion), next due, how many days before due the job is raised, last done (with its work order), default technician, estimated hours, whether the machine is stopped, and active status.',
    },
    {
      target: 'maint-pmd-checklist',
      title: 'Checklist',
      purpose: 'The checks copied into every job from this plan, with expected values.',
    },
    {
      target: 'maint-pmd-spares',
      title: 'Spares Kit',
      purpose: 'Spares planned onto every job from this plan.',
    },
    {
      target: 'maint-pmd-wos',
      title: 'Work Orders From This Plan',
      purpose: 'Recent jobs with due date, technician, date done, On Time (Yes/Late) and status. Click a row to open the job.',
      why: 'The On Time column is what PM compliance is measured from — a run of "Late" means the plan\'s frequency, lead days or technician load needs a look.',
    },
  ],
}

export default config
