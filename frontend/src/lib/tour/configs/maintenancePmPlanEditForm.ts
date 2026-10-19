import { TourConfig } from '../types'
import { pmPlanFormSteps } from './maintenancePmPlanFormSteps'

const config: TourConfig = {
  id: 'maintenance-pm-plan-edit-form',
  pageTitle: 'Edit PM Plan',
  steps: pmPlanFormSteps(true),
}

export default config
