import { TourConfig } from '../types'
import { serviceRequestFormSteps } from './erpShared'

const config: TourConfig = {
  id: 'erp-sr-form',
  pageTitle: 'Create Service Request',
  steps: serviceRequestFormSteps('create'),
}

export default config
