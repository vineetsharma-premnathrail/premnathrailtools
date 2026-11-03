import { TourConfig } from '../types'
import { PROJECT_STATUS_OPTIONS } from './projectsShared'

const config: TourConfig = {
  id: 'projects-detail',
  pageTitle: 'Project',
  steps: [
    {
      target: 'pm-proj-badges',
      title: 'Stage and status',
      purpose: 'The project code, its lifecycle stage (Planned, Design, Manufacturing ... Closed / Delivered) and, only when paused or cancelled, an On hold / Cancelled badge. Customer, project manager and closing date are in the Overview summary.',
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
      target: 'pm-ov-stage',
      title: 'Stage',
      purpose: 'Where the project stands in its life. The project manager or management moves it forward (Move to next stage, or pick a later stage). Only an admin or Partner can move it back, and must give a reason. When every unit is dispatched it moves to Dispatched by itself.',
      why: 'Service can raise requests only for machines that have reached Dispatched or later.',
    },
    {
      target: 'pm-ov-machine',
      title: 'Machine details',
      purpose: 'The machine registered with this project: identity, client and site, specs, timeline and warranty. Use Edit machine to change it.',
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
      target: 'pm-proj-tab-units',
      title: 'Units tab',
      purpose: 'Where the project stands in each department (Design, Purchase, Store, Production, Quality, Dispatch, Delivered). A project made here is one machine, so it has a single "Whole project" row. An older project that came from a sales order still lists one row per vehicle or spares lot.',
      autoActivate: true,
    },
    {
      target: 'pm-proj-tab-store-issues',
      title: 'Store Issues tab',
      purpose: 'Every material issue made to this project from a store: issue number, date, type, who it was issued to and its status.',
      why: 'Shows what material has already gone out for the project, without opening Store.',
      autoActivate: true,
    },
    {
      target: 'proj-hist-store-issues',
      title: 'Material issues',
      purpose: 'Click an issue number to open it. Click "N items" to list the item code, name and quantity issued on that line set.',
    },
    {
      target: 'pm-proj-tab-purchases',
      title: 'Purchases tab',
      purpose: 'Purchase requisitions charged to this project, and under each one its purchase orders (vendor, date, amount) and the goods receipts booked against them.',
      why: 'Follows an item from request to order to receipt in one place.',
      autoActivate: true,
    },
    {
      target: 'proj-hist-purchases',
      title: 'Requisitions, orders and receipts',
      purpose: 'One row per requisition. Orders sit indented under it, receipts under their order. A dash in the amount means the order has no value recorded yet. Click any number to open it.',
    },
    {
      target: 'pm-proj-tab-tasks',
      title: 'Tasks tab',
      purpose: 'Every task on the project across all milestones and departments: milestone, department, assignee, due date, status and when it was completed.',
      autoActivate: true,
    },
    {
      target: 'proj-hist-tasks',
      title: 'Task list',
      purpose: 'A due date in red means the task is overdue and not yet done. Click a task to open it with its sub-tasks, remarks and files. Tasks are created inside a milestone (Milestones tab).',
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
