import { TourConfig } from '../types'
import { hydServiceFormSteps } from './hydServiceFormSteps'

const config: TourConfig = {
  id: 'hyd-service-form',
  pageTitle: 'New Service Job',
  steps: [
    {
      target: 'hyd-svcf-form',
      title: 'New Service Job',
      purpose: 'The form sheet.',
    },
    {
      target: 'hyd-svcf-back-btn',
      title: '← Back',
      purpose: 'Returns without saving — to the maintenance plan if the job was raised from one, otherwise to the service list.',
    },
    ...hydServiceFormSteps(false),
  ],
}

export default config
