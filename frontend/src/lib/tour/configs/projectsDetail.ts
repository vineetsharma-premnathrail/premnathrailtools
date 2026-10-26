import { TourConfig } from '../types'
import { PROJECT_STATUS_OPTIONS } from './projectsShared'

const config: TourConfig = {
  id: 'projects-detail',
  pageTitle: 'Project',
  steps: [
    {
      target: 'pm-proj-badges',
      title: 'Status',
      purpose: 'The project code and its status badge (no badge while the project is simply Open). Customer, project manager and closing date are in the Overview summary.',
      options: PROJECT_STATUS_OPTIONS,
    },
    {
      target: 'pm-proj-action-resume',
      title: 'Resume',
      purpose: 'Only on a project that was put on hold earlier. On hold → Active, so departments can work on their tasks again.',
    },
    {
      target: 'pm-proj-delete',
      title: 'Delete',
      purpose: 'Deletes a project created by mistake. Only for an Open project with no history of WBS elements.',
    },
    {
      target: 'pm-proj-back',
      title: '← Back',
      purpose: 'Returns to All Projects.',
    },
    {
      target: 'pm-proj-tab-overview',
      title: 'Overview tab',
      purpose: 'Project details (and, on a project closed earlier, its closure record).',
      autoActivate: true,
    },
    {
      target: 'pm-ov-closure',
      title: 'Project closure',
      purpose: 'Shown only on a project that was closed earlier: its closure note, lessons learned and Final Project Report, read-only.',
    },
    {
      target: 'pm-ov-details',
      title: 'Project details',
      purpose: 'Customer, project manager, start date, who released it and when, who created it, scope, and closure details once closed.',
    },
    {
      target: 'pm-ov-edit-btn',
      title: 'Edit',
      purpose: 'Opens the project details as a form (management / project manager only, not on closed or cancelled projects). Start the tour again while editing for a field-by-field guide.',
    },
    {
      target: 'pm-proj-tab-milestones',
      title: 'Milestones tab',
      purpose: 'The milestones of this project — each with one responsible person, and the tasks created inside it.',
      autoActivate: true,
    },
    {
      target: 'pm-tasks-add-btn',
      title: '+ Add Milestone',
      purpose: 'Project manager / management only. Opens a popup: milestone name, expected achievable date and the responsible person. That person is notified and sees it in their My Tasks. Then open the milestone and use + Add Task to create its tasks. The responsible person and you are both reminded on the date.',
    },
    {
      target: 'pm-tasks-table',
      title: 'Milestones',
      purpose: 'The project timeline — every milestone in date order with its expected date. Click a milestone (here or on its card) to open it: its progress, responsible person, + Add Task, and the tasks table. Click a task to see its sub-tasks, remarks and files.',
      options: [
        { value: 'Edit', meaning: 'Project manager: change the title, due date or owner (person / department) of an open milestone. A new owner is notified.' },
        { value: 'Reopen', meaning: 'Project manager: sends a Done milestone back, with a reason the owner sees.' },
        { value: 'Cancel', meaning: 'Project manager: the milestone is no longer needed. A reason is required.' },
      ],
    },
    {
      target: 'pm-proj-tab-documents',
      title: 'Documents tab',
      purpose: 'Every file on the project in one place.',
      autoActivate: true,
    },
    {
      target: 'pm-docs-section',
      title: 'Task documents',
      purpose: 'Every file attached on the tasks and sub-tasks of this project, with the department, task, who uploaded it and when. Files are attached on the task itself (Tasks tab). Click a file name to open it.',
    },
    {
      target: 'pm-proj-tab-history',
      title: 'History tab',
      purpose: 'Audit trail of the project: every status change and edited field, with who did it and when.',
      autoActivate: true,
    },
    {
      target: 'pm-hist-list',
      title: 'History entries',
      purpose: 'Newest first. Edits show "field: old value → new value".',
      why: 'Answers "who moved the handover date and why" without anyone having to remember.',
    },
  ],
}

export default config
