import { TourConfig } from '../types'
import { PM_NAV_STEPS } from './projectsShared'

const config: TourConfig = {
  id: 'projects-dashboard',
  pageTitle: 'Projects Dashboard',
  steps: [
    ...PM_NAV_STEPS,
    {
      target: 'pm-dash-kpis',
      title: 'Headline counts',
      purpose: 'How many projects are open, how many must be handed over in the next 30 days, and how many have passed their target handover date.',
    },
    {
      target: 'pm-dash-live',
      title: 'Open projects',
      purpose: 'One row per open project, nearest handover first: customer, project manager, start date and target handover. A red date means the handover date has passed and the project is still open.',
      after: 'Click any row to open that project.',
    },
  ],
}

export default config
