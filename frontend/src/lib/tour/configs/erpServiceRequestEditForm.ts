import { TourConfig } from '../types'
import { serviceRequestFormSteps } from './erpShared'

const config: TourConfig = {
  id: 'erp-sr-edit-form',
  pageTitle: 'Edit Service Request',
  steps: serviceRequestFormSteps('edit'),
}

export default config
