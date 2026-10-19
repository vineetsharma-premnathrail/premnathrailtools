import { TourConfig } from '../types'
import { hydSpareFormSteps } from './hydSpareFormSteps'

const config: TourConfig = {
  id: 'hyd-spare-form',
  pageTitle: 'New Spare Part',
  steps: [
    {
      target: 'hyd-sparef-form',
      title: 'New Spare Part',
      purpose: 'The form sheet.',
    },
    {
      target: 'hyd-sparef-back-btn',
      title: '← Back',
      purpose: 'Returns to the spares list without saving — same as Cancel.',
    },
    ...hydSpareFormSteps(false),
  ],
}

export default config
