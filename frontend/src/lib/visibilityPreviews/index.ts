// Manager-owned index: one import line per module file. Module files own their own screens.
import type { PreviewScreens } from './types'
import { p2pPreviews } from './p2p'
import { crmPreviews } from './crm'
import { projectsPreviews } from './projects'
import { erpPreviews } from './erp'
import { hrPreviews } from './hr'
import { accountsPreviews } from './accounts'
import { storePreviews } from './store'
import { maintenancePreviews } from './maintenance'
import { productsPreviews } from './products'
import { rndPreviews } from './rnd'
import { productionPreviews } from './production'
import { qualityPreviews } from './quality'
import { designPreviews } from './design'
import { electricalPreviews } from './electrical'
import { hydraulicPreviews } from './hydraulic'

export const PREVIEW_SCREENS: PreviewScreens = {
  ...p2pPreviews,
  ...crmPreviews,
  ...projectsPreviews,
  ...erpPreviews,
  ...hrPreviews,
  ...accountsPreviews,
  ...storePreviews,
  ...maintenancePreviews,
  ...productsPreviews,
  ...rndPreviews,
  ...productionPreviews,
  ...qualityPreviews,
  ...designPreviews,
  ...electricalPreviews,
  ...hydraulicPreviews,
}
