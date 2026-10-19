import { TourConfig } from '../types'
import { MILESTONE_STATUS_OPTIONS, TASK_STATUS_OPTIONS } from './projectsShared'

const config: TourConfig = {
  id: 'projects-department-work',
  pageTitle: 'Department Work',
  steps: [
    {
      target: 'pm-nav-team',
      title: 'Department Work',
      purpose: 'Your workbench as a department head: the project WBS elements management has given your department, and your team\'s tasks.',
    },
    {
      target: 'pm-dw-projects',
      title: 'My department\'s projects',
      purpose: 'Each project with open WBS elements for your department. Every WBS line shows its status, overdue / at-risk flags, % of tasks done (— until work starts), the due date (amber within 3 days, red when late) and the next step. A WBS waiting for you to plan it has a Create & assign tasks button.',
      options: MILESTONE_STATUS_OPTIONS,
      after: 'Click a WBS to open its workspace, where you create and assign tasks, attach evidence and submit it.',
    },
    {
      target: 'pm-dw-dept-filter',
      title: 'Department',
      purpose: 'Only shown if you head more than one department — choose which department\'s work to see, or "All my departments".',
    },
    {
      target: 'pm-dw-show-finished',
      title: 'Show finished',
      purpose: 'Tick to also list WBS elements already Achieved or Cancelled (and projects with nothing open). Untick to focus on live work.',
    },
    {
      target: 'pm-dw-workload',
      title: 'Team workload',
      purpose: 'Per person: open tasks, how many are in progress, blocked and overdue, and the estimated hours still open. With no open team tasks this is a single Team line instead.',
      why: 'Check this before assigning a new task — give it to the person with capacity, not just the one you always ask.',
    },
    {
      target: 'pm-dw-team-tasks',
      title: 'Open team tasks',
      purpose: 'All open tasks of your team across projects, with Blocked and Overdue tasks sorted to the top.',
      options: TASK_STATUS_OPTIONS,
      after: 'Click a task to see its sub-tasks, files and comments, or to mark it unblocked once the problem is solved.',
    },
    {
      target: 'pm-dw-hint',
      title: 'Who sees this page',
      purpose: 'Only department heads see WBS elements here. Heads are set in Organization › Departments. If you are not a head, your own tasks are under My Tasks.',
    },
  ],
}

export default config
