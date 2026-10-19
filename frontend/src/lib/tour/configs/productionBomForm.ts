import { TourConfig } from '../types'
import { BOM_FORM_STEPS } from './productionBomFormSteps'

const config: TourConfig = {
  id: 'production-bom-form',
  pageTitle: 'New BOM',
  steps: [
    {
      target: 'production-bom-form-back-btn',
      title: '← Back',
      purpose: 'Returns to the BOM list without saving (same as Cancel at the bottom).',
    },
    ...BOM_FORM_STEPS,
  ],
}

export default config
