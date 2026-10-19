import { TourConfig } from '../types'
import { pmPlanFormSteps } from './maintenancePmPlanFormSteps'

const config: TourConfig = {
  id: 'maintenance-pm-plan-form',
  pageTitle: 'New PM Plan',
  steps: pmPlanFormSteps(false),
}

export default config
