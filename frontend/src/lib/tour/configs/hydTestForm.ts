import { TourConfig } from '../types'
import { hydTestFormSteps } from './hydTestFormSteps'

const config: TourConfig = {
  id: 'hyd-test-form',
  pageTitle: 'New Test',
  steps: [
    {
      target: 'hyd-testf-form',
      title: 'New Test',
      purpose: 'The test sheet — test and subject on the left, conditions and people on the right, the readings and notes below.',
    },
    {
      target: 'hyd-testf-back-btn',
      title: '← Back',
      purpose: 'Returns to the tests list without saving — same as Cancel.',
    },
    ...hydTestFormSteps(false),
  ],
}

export default config
