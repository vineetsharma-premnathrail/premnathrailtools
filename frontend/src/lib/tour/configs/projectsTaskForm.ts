import { TourConfig } from '../types'
import { PRIORITY_OPTIONS } from './projectsShared'

const config: TourConfig = {
  id: 'projects-task-form',
  pageTitle: 'Add / Edit Task',
  steps: [
    {
      target: 'pm-task-form-title',
      title: 'Task name',
      purpose: 'One piece of work that one person can finish.',
      whatToEnter: 'A verb + the thing, short and specific.',
      required: true,
      validExample: 'Prepare GA drawing for bogie frame',
      invalidExample: 'Design (too vague — nobody can tell when it is done)',
    },
    {
      target: 'pm-task-form-assignee',
      title: 'Assigned to',
      purpose: 'The one person responsible for this task. Only people in your department are listed.',
      whatToEnter: 'Pick one person — check Team workload on Department Work first to see who has capacity.',
      required: true,
      why: 'One owner per task means there is always someone to ask "where is it?".',
    },
    {
      target: 'pm-task-form-due',
      title: 'Due date',
      purpose: 'When the person must finish it.',
      whatToEnter: "A date on or before the WBS's target date (shown in the label).",
      required: true,
      invalidExample: 'A date after the WBS target — rejected, because the WBS could then never be met.',
    },
    {
      target: 'pm-task-form-priority',
      title: 'Priority',
      purpose: "How urgent this task is compared with the person's other work.",
      required: true,
      options: PRIORITY_OPTIONS,
    },
    {
      target: 'pm-task-form-hours',
      title: 'Estimated hours',
      purpose: 'Roughly how many working hours the task needs.',
      whatToEnter: 'A number, halves allowed. Optional.',
      validExample: '6  or  2.5',
      why: 'Adds up into "estimated hours open" on the Team workload table, so you can see who is overloaded before assigning more.',
    },
    {
      target: 'pm-task-form-description',
      title: 'Description',
      purpose: 'Instructions, references or the acceptance check for the person doing it. Optional.',
      validExample: 'Use customer spec rev 3; follow drawing standard DS-02; get it checked before marking done',
    },
    {
      target: 'pm-task-form-cancel',
      title: 'Cancel',
      purpose: 'Closes the form without saving.',
    },
    {
      target: 'pm-task-form-save',
      title: 'Create & assign / Save',
      purpose: 'Saves the task.',
      after: 'A new task appears in the list as To do, the person is notified and it shows on their My Tasks. If something is wrong, the exact reason is shown above the form.',
    },
  ],
}

export default config
