import { TourConfig } from '../types'
import { ECN_FORM_STEPS } from './designEcnFormSteps'

const config: TourConfig = {
  id: 'design-ecn-form',
  pageTitle: 'Raise Change Notice',
  steps: [
    {
      target: 'design-ecnnew-form',
      title: 'Raise Change Notice',
      purpose: 'Fill the change, the affected drawings / BOMs and the effectivity below.',
      why: 'Raising an ECN directly skips the change board. Normally you raise an ECR instead and the ECN is created from it once approved.',
    },
    {
      target: 'design-ecnnew-back-btn',
      title: '← Back',
      purpose: 'Returns to the Changes list without saving.',
    },
    ...ECN_FORM_STEPS,
  ],
}

export default config
