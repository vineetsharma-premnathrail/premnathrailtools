import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'rnd-project-detail',
  pageTitle: 'Prototype / Research Project',
  steps: [
    {
      target: 'rnd-pd-badges',
      title: 'Project number and priority',
      purpose: 'The heading is the project number given when it was created; the badge beside it is the priority (High, Medium or Low). The title is in Project Initiation below.',
    },
    {
      target: 'rnd-pd-back-btn',
      title: '← Back',
      purpose: 'Returns to the Prototype / Research list.',
    },
    {
      target: 'rnd-pd-edit-btn',
      title: 'Edit',
      purpose: 'Opens the Edit R&D Project popup (initiation, schedule, members, remarks). Shown only if you have Edit permission on Prototype / Research.',
      after: 'Discard throws away your changes; Save changes saves them (Title and Objective must not be empty, and the target end date cannot be before the start date).',
    },
    {
      target: 'rnd-pd-delete-btn',
      title: 'Delete',
      purpose: 'Permanently deletes the project after you confirm.',
      after: 'A project that still has attachments, experiments or prototypes cannot be deleted — remove those first.',
    },
    {
      target: 'rnd-pd-details',
      title: 'Project details',
      purpose: 'Everything entered when the project was created — title, dates, objective, scope, leads, team and remarks.',
    },
    {
      target: 'rnd-pd-tasks',
      title: 'Tasks',
      purpose: 'Project leads give work to team members: Task (what to do), Assign to, Due Date, Remarks and files. Only people under Team Members can be assigned.',
      why: 'Each piece of work has one owner and a date, so nothing is left to "someone will do it".',
      after: 'The assignee posts progress with "Add update" (remarks + any documents), asks for more time if needed, and clicks "Complete task" when finished — the task closes; the person who created it can Reopen it with a reason. While working, "Ask for approval" sends a task-related request (e.g. a drawing or material) to the creator / leads, who Approve or Reject it with remarks; the task stays open. The assignee can also split their task with "+ Sub-task" — the task can be completed only once its sub-tasks are completed or cancelled.',
    },
    {
      target: 'rnd-docpanel',
      title: 'Attachments',
      purpose: 'Files uploaded for this project — including those added on the New Project form. Everyone on the project can open and upload files.',
      after: 'Only a project lead can delete a file; team members cannot, even files they uploaded.',
    },
  ],
}

export default config
