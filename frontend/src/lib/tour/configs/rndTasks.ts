import { TourConfig } from '../types'
import { RND_PRIORITY_OPTIONS } from './rndShared'

const config: TourConfig = {
  id: 'rnd-tasks',
  pageTitle: 'R&D Tasks',
  steps: [
    {
      target: 'rnd-nav-tasks',
      title: 'R&D Tasks',
      purpose: 'Every R&D task in one place: Requirement tasks (on a requirement R&D has accepted), Prototype tasks (on a Prototype / Research project) and Project tasks (on a Project Management › All Projects project). PM tasks stay in Project Management › My Tasks.',
    },
    {
      target: 'rnd-tasks-header',
      title: 'Who sees what',
      purpose: 'R&D heads and people with R&D › R&D Tasks › "All R&D tasks & analytics" see every task. Everyone else sees the tasks assigned to them or created by them.',
    },
    {
      target: 'rnd-tasks-create-btn',
      title: '+ Create Task',
      purpose: 'Opens the Create Task form. Shown only with R&D › R&D Tasks › Create.',
      after: 'The assignee is notified. The task also shows on its requirement or project.',
    },
    {
      target: 'rnd-tasks-type-requirement',
      title: 'Type — Requirement, Prototype or Project',
      purpose: 'Pick the type first; the matching form follows. Requirement: pick a requirement by its R&D ID — only requirements whose latest revision R&D has accepted are listed. Prototype: pick a Prototype / Research project. Project: pick a project from Project Management › All Projects.',
      required: true,
      invalidExample: 'Saving without a type, or with a requirement that is only awaiting review — the form says what to pick.',
    },
    {
      target: 'rnd-tasks-type-project',
      title: 'Type — Project',
      purpose: 'Gives R&D work on a project from Project Management › All Projects, picked by its PEW code. Only R&D heads or that project manager can give such a task; the assignee is picked from people with R&D access. The task is tracked here and on R&D › R&D Tasks › the project page; Project Management only shows it (read-only) on the project Tasks tab.',
      required: true,
      invalidExample: 'Saving without picking the project, or on a project you cannot give R&D tasks on — the form says so.',
    },
    {
      target: 'rnd-tasks-priority',
      title: 'Priority',
      options: RND_PRIORITY_OPTIONS,
    },
    {
      target: 'rnd-tasks-create-submit',
      title: 'Create Task',
      purpose: 'Saves the task. Title, assignee and due date are required; the start date cannot be after the due date.',
      after: 'You can add a checklist: progress then follows the ticked steps. Without a checklist the assignee types the progress percentage.',
    },
    {
      target: 'rnd-tasks-tiles',
      title: 'Summary tiles',
      purpose: 'Total, Pending, Completed, Overdue and Average progress for the tasks that match the filters. Pending + Completed + Overdue = Total; cancelled tasks are left out.',
      options: [
        { value: 'Completed', meaning: 'Tasks the assignee completed.' },
        { value: 'Overdue', meaning: 'Open tasks whose due date is before today.' },
        { value: 'Pending', meaning: 'Open tasks that are not overdue yet.' },
      ],
    },
    {
      target: 'rnd-tasks-search',
      title: 'Search',
      purpose: 'Find by task title, R&D ID, RND number, project or person.',
    },
    {
      target: 'rnd-tasks-filter-btn',
      title: 'Filter',
      purpose: 'Opens the Filter menu: Project (Prototype, All Projects) / requirement, assigned user, department (the assignee\'s department in Organization), type, status, priority and completion progress (0, 1–49, 50–99, 100%). It applies as soon as you pick a value; the number on the button shows how many filters are on. Tiles, the table and the grouped views all use the same filters; Clear resets them.',
    },
    {
      target: 'rnd-tasks-due-range',
      title: 'Due date range',
      purpose: 'Due from / Due to: shows only tasks due inside this range. Leave both empty for every due date.',
      validExample: '01-11-2026 to 30-11-2026',
    },
    {
      target: 'rnd-tasks-views',
      title: 'Views',
      purpose: 'By task (the full list), By person (tasks, pending, completed, overdue and progress per person) and By project / requirement (the same per project or R&D ID — progress is the average of its tasks, cancelled ones ignored).',
    },
    {
      target: 'rnd-tasks-table',
      title: 'Task table',
      purpose: 'Task, type, project or requirement (R&D ID / RND number), assignee, department, priority, status, progress, start, due, completed on and days overdue — sorted by R&D ID / project number ascending. Click a row to open its requirement or project on the Tasks tab (All Projects tasks open the project R&D task page).',
    },
  ],
}

export default config
