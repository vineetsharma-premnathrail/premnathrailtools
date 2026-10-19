import { TourConfig } from '../types'
import { projectFormSteps } from './erpShared'

const config: TourConfig = {
  id: 'erp-project-edit-form',
  pageTitle: 'Edit Project',
  steps: projectFormSteps('edit'),
}

export default config
