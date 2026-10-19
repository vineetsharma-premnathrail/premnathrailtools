import { TourConfig } from '../types'
import { hydPlanFormSteps } from './hydPlanFormSteps'

const config: TourConfig = {
  id: 'hyd-plan-detail',
  pageTitle: 'Maintenance Plan',
  steps: [
    {
      target: 'hyd-pland-raise-job-btn',
      title: 'Raise Service Job',
      purpose: 'Creates a service job for this plan with the system, type and checklist filled in. Shown when the plan is active and no job is open.',
      after: 'When that job is completed, this plan\'s "last done" date and hours reset and the next due date moves forward.',
    },
    {
      target: 'hyd-pland-open-job-btn',
      title: 'Go to Open Job',
      purpose: 'Shown instead of "Raise Service Job" when a job from this plan is already open — only one open job per plan, so the same task is not raised twice.',
    },
    {
      target: 'hyd-pland-delete-btn',
      title: 'Delete',
      purpose: 'Removes the plan from the due list (asks for confirmation). Jobs already raised keep their history.',
    },
    {
      target: 'hyd-pland-back-btn',
      title: '← Back',
      purpose: 'Returns to the plans list.',
    },
    {
      target: 'hyd-pland-due-card',
      title: 'When is it due?',
      purpose: 'Due badge (Overdue / Due Soon / On Track / Inactive), next due by date (days left or overdue) and by running hours (hours left or over), the system\'s current running hours, and when it was last done. Click the system name to open the system.',
      why: 'Running hours are updated whenever a service job records the hour-meter reading — so record hours on every job to keep hours-based plans accurate.',
    },
    ...hydPlanFormSteps(true),
    {
      target: 'hyd-pland-history',
      title: 'Service History',
      purpose: 'Every service job raised from this plan — number, date, type, who did it, cost and status. Click one to open it.',
    },
  ],
}

export default config
