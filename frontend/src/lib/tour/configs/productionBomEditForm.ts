import { TourConfig } from '../types'
import { BOM_FORM_STEPS } from './productionBomFormSteps'

const config: TourConfig = {
  id: 'production-bom-edit-form',
  pageTitle: 'Edit BOM',
  steps: [
    {
      target: 'production-bom-edit-cancel-btn',
      title: '← Back',
      purpose: 'Leaves edit mode (same as Cancel at the bottom) without saving and shows the BOM again. Only Draft BOMs can be edited — an active BOM is changed by creating a New Version.',
    },
    ...BOM_FORM_STEPS.map((s) => (s.target === 'production-bom-form-submit-btn'
      ? { ...s, title: 'Save Changes', purpose: 'Saves the draft BOM.', after: 'Returns to the BOM view with the updated components, routing and standard costs.' }
      : s)),
  ],
}

export default config
