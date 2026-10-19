import { TourConfig } from '../types'
import { assetFormSteps } from './maintenanceAssetFormSteps'

const config: TourConfig = {
  id: 'maintenance-asset-form',
  pageTitle: 'New Asset',
  steps: assetFormSteps(false),
}

export default config
