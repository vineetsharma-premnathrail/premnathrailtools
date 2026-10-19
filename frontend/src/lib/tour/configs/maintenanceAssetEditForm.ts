import { TourConfig } from '../types'
import { assetFormSteps } from './maintenanceAssetFormSteps'

const config: TourConfig = {
  id: 'maintenance-asset-edit-form',
  pageTitle: 'Edit Asset',
  steps: assetFormSteps(true),
}

export default config
