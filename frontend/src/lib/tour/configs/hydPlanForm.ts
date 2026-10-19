import { TourConfig } from '../types'
import { hydPlanFormSteps } from './hydPlanFormSteps'

const config: TourConfig = {
  id: 'hyd-plan-form',
  pageTitle: 'New Maintenance Plan',
  steps: [
    {
      target: 'hyd-planf-form',
      title: 'New Maintenance Plan',
      purpose: 'The form sheet.',
    },
    {
      target: 'hyd-planf-back-btn',
      title: '← Back',
      purpose: 'Returns to the maintenance plans list without saving — same as Cancel.',
    },
    ...hydPlanFormSteps(false),
  ],
}

export default config
