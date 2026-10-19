import { TourConfig } from '../types'
import { projectFormSteps } from './erpShared'

const config: TourConfig = {
  id: 'erp-project-form',
  pageTitle: 'Add New Project',
  steps: projectFormSteps('create'),
}

export default config
