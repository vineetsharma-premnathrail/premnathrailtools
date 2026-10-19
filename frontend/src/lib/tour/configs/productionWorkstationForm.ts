import { TourConfig } from '../types'
import { WORKSTATION_FORM_STEPS } from './productionWorkstationFormSteps'

const config: TourConfig = {
  id: 'production-workstation-form',
  pageTitle: 'New Workstation',
  steps: [
    {
      target: 'production-ws-form-back-btn',
      title: 'Cancel',
      purpose: 'Closes the New Workstation popup and returns to the Workstations list without saving.',
    },
    ...WORKSTATION_FORM_STEPS.map((s) => (s.target === 'production-ws-form-submit-btn'
      ? { ...s, title: 'Create Workstation', after: 'Opens the new workstation. It can now be picked on BOM routing operations.' }
      : s)),
  ],
}

export default config
