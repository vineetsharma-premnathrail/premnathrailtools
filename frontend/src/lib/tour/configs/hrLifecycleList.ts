import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hr-lifecycle-list',
  pageTitle: 'Lifecycle Events',
  steps: [
    {
      target: 'hr-nav-lifecycle',
      title: 'Lifecycle tab',
      purpose: 'Every career event of an employee — Joining, Confirmation, Transfer, Promotion and Exit — each with its own checklist of tasks for HR, IT, Admin, Store, Finance and the manager.',
      why: 'In a proper HR system an employee\'s department, designation, manager or status is never just overwritten. It changes through a dated event, so you can always answer "when did this person move, who approved it, and was the laptop returned?"',
    },
    {
      target: 'hr-lc-new-btn',
      title: '+ New Event',
      purpose: 'Starts a new joining, confirmation, transfer, promotion or exit.',
      after: 'Opens the New Lifecycle Event form. Its own tour explains each field.',
    },
    {
      target: 'hr-lc-type-cards',
      title: 'Open events by type',
      purpose: 'How many events of each type are still open (Draft or In Progress).',
      after: 'Click a card to show only that type in the list below; click it again to clear the filter.',
      why: 'A quick health check. For example, many open Exits usually means assets or handovers are still pending for people who have already left.',
    },
    {
      target: 'hr-appr-checklist-section',
      title: 'My checklist tasks',
      purpose: 'Checklist tasks from any lifecycle event that are assigned to you. Examples: "Create email ID" for IT, or "Collect ID card" for Admin.',
      after: 'Mark a task done here without opening the event. HR sees the event\'s progress go up.',
    },
    {
      target: 'hr-lc-my-task-done',
      title: 'Mark task done',
      purpose: 'Closes one of your checklist tasks.',
      after: 'The task is stamped with your name and the time, and the event\'s checklist progress updates.',
    },
    {
      target: 'hr-lc-search',
      title: 'Search',
      purpose: 'Finds events by event number, employee name, employee code or candidate name.',
      whatToEnter: 'Any part of the number or name. The list refreshes a moment after you stop typing.',
      validExample: 'LC-2026-0012 or "verma"',
    },
    {
      target: 'hr-lc-type-filter',
      title: 'Type filter',
      purpose: 'Shows only one kind of event.',
      options: [
        { value: 'Joining', meaning: 'A new hire or a rehire. Runs the onboarding checklist and creates the employee profile.' },
        { value: 'Confirmation', meaning: 'Probation is over and the employee becomes a confirmed (regular) employee.' },
        { value: 'Transfer', meaning: 'A move to another department, plant or reporting manager.' },
        { value: 'Promotion', meaning: 'A new designation or grade.' },
        { value: 'Exit', meaning: 'Resignation, termination, retirement and similar. Runs the offboarding checklist and deactivates the portal account.' },
      ],
    },
    {
      target: 'hr-lc-status-filter',
      title: 'Status filter',
      purpose: 'By default the list shows only open events (Draft + In Progress), which is HR\'s working list.',
      options: [
        { value: 'Open (draft + in progress)', meaning: 'Everything still needing action. This is the default.' },
        { value: 'All statuses', meaning: 'Full history, including completed and cancelled events.' },
        { value: 'Draft', meaning: 'Saved but not started. Checklist owners have not been notified yet.' },
        { value: 'In Progress', meaning: 'Checklist started. Owners have been notified and are working on their tasks.' },
        { value: 'Completed', meaning: 'Done. The change has been applied to the employee\'s profile.' },
        { value: 'Cancelled', meaning: 'Withdrawn, with a recorded reason. Nothing was applied.' },
      ],
    },
    {
      target: 'hr-lc-table',
      title: 'Events list',
      purpose: 'One row per event, showing the event number, type, employee or candidate, effective date (the last working day for exits), checklist progress, status and who raised it.',
      after: 'Click any row to open the event, work through its checklist and complete it.',
    },
    {
      target: 'hr-lc-checklist-progress',
      title: 'Checklist progress',
      purpose: 'How many checklist tasks are closed out of the total. The bar turns green at 100%.',
      why: 'An event should normally be completed only when its checklist is fully closed, for example every company asset returned before an exit.',
    },
    {
      target: 'hr-lc-status-badge',
      title: 'Status badge',
      purpose: 'Where the event currently is.',
      options: [
        { value: 'Draft (grey)', meaning: 'Saved only. Use "Start checklist" on the event to notify owners.' },
        { value: 'In Progress (amber)', meaning: 'Checklist owners are working on their tasks.' },
        { value: 'Completed (green)', meaning: 'Applied to the employee record. It can no longer be edited.' },
        { value: 'Cancelled (red)', meaning: 'Withdrawn. The reason is kept on record.' },
      ],
    },
  ],
}

export default config
