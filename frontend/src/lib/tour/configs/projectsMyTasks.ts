import { TourConfig } from '../types'
import { TASK_STATUS_OPTIONS } from './projectsShared'

const config: TourConfig = {
  id: 'projects-my-tasks',
  pageTitle: 'My Tasks',
  steps: [
    {
      target: 'pm-mt-list',
      title: 'My Tasks',
      purpose: 'Only your own project work, from every project, in the same design as a project\'s Plan & Milestones. Three tabs: "Given to me" (milestones you are responsible for), "My tasks in others\' milestones" (a task in it is yours) and "Milestones I gave" (follow-up). The number on each tab is how many milestones it holds.',
      options: TASK_STATUS_OPTIONS,
    },
    {
      target: 'pm-mt-show-done',
      title: 'Show finished',
      purpose: 'Tick to also list milestones that are achieved or cancelled.',
    },
    {
      target: 'pm-tasks-table',
      title: 'Milestone timeline',
      purpose: 'The tab\'s milestones in date order, each in its own colour — click one to open it. Below are the milestone cards with the project, dates, tasks and progress.',
      after: 'An opened milestone shows its tasks: Add Task (each with a person and a due date), tick tasks off, and open a task for its sub-tasks, remarks and files. Mark achieved once every task is done.',
    },
  ],
}

export default config
