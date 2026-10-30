import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'rnd-project-detail',
  pageTitle: 'Prototype / Research Project',
  steps: [
    {
      target: 'rnd-pd-badges',
      title: 'Project number and priority',
      purpose: 'The heading is the project number given when it was created. The priority (Standard or Urgent) is in the summary below.',
    },
    {
      target: 'rnd-pd-back-btn',
      title: '← Back',
      purpose: 'Returns to the Prototype / Research list.',
    },
    {
      target: 'rnd-pd-edit-btn',
      title: 'Edit',
      purpose: 'Opens the Edit R&D Project form — the same page as New Project (origin, initiation, schedule, members, remarks, attachments). Shown only if you have Edit permission on Prototype / Research.',
      after: 'Discard throws away your changes; Save changes saves them (Title and Objective must not be empty, and the target end date cannot be before the start date).',
    },
    {
      target: 'rnd-pd-delete-btn',
      title: 'Delete',
      purpose: 'Permanently deletes the project after you confirm.',
      after: 'A project that still has attachments, experiments or prototypes cannot be deleted — remove those first.',
    },
    {
      target: 'rnd-pd-tabs',
      title: 'Tabs',
      purpose: 'Overview (origin, initiation, members), Members (project leads and team — add or remove people here), Tasks (the project\'s tasks), Documents (attachments) and Timeline (everything that changed).',
    },
    {
      target: 'rnd-pd-details',
      title: 'Project details',
      purpose: 'Everything entered when the project was created — title, dates, objective, scope, leads, team and remarks.',
    },
    {
      target: 'rnd-pd-tasks',
      title: 'Tasks',
      purpose: 'The project\'s tasks as a flat list: priority (Standard / Urgent), dates, status and progress. "Add Task" (project leads) gives work to a person on the project team — only people under Team Members can be assigned. You can also create tasks from R&D › R&D Tasks.',
      why: 'Each piece of work has one owner and a date, so nothing is left to "someone will do it".',
      after: 'The assignee posts progress with "Add update" (remarks + any documents), types the progress percentage (or ticks checklist steps, which sets it), asks for more time if needed, and clicks "Complete task" when finished — the task closes at 100%; the person who created it can Reopen it with a reason. While working, "Ask for approval" sends a task-related request (e.g. a drawing or material) to the creator / leads, who Approve or Reject it with remarks; the task stays open. The assignee can also split their task with "+ Sub-task" — the task can be completed only once its sub-tasks are completed or cancelled.',
    },
    {
      target: 'rnd-docpanel',
      title: 'Documents',
      purpose: 'On the Documents tab: files uploaded for this project — including those added on the New Project form. Everyone on the project can open and upload files.',
      after: 'Only a project lead can delete a file; team members cannot, even files they uploaded.',
    },
    {
      target: 'rnd-pd-history',
      title: 'Timeline',
      purpose: 'On the Timeline tab: project edits and every task event, newest first, with who did it and when.',
    },
  ],
}

export default config
