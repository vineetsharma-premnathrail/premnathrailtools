import { TourConfig } from '../types'
import { WORKSTATION_FORM_STEPS } from './productionWorkstationFormSteps'

const config: TourConfig = {
  id: 'production-workstation-detail',
  pageTitle: 'Workstation',
  steps: [
    {
      target: 'production-ws-summary',
      title: 'Workstation details',
      purpose: 'Code, type, status, plant, capacity and hourly rate as currently saved.',
    },
    {
      target: 'production-ws-delete-btn',
      title: 'Delete',
      purpose: 'Removes the workstation from routing pickers (after confirmation). Completed work orders and time logs keep their history.',
    },
    {
      target: 'production-ws-form-back-btn',
      title: '← Back',
      purpose: 'Returns to the Workstations list.',
    },
    {
      target: 'production-ws-open-ops',
      title: 'Open operations',
      purpose: 'How many operations on released or in-progress work orders are queued here right now.',
    },
    {
      target: 'production-ws-edit-btn',
      title: 'Edit',
      purpose: 'Opens the Edit Workstation popup. Shown only to users with Edit on Production › Workstations.',
      autoActivateOnAdvance: true,
    },
    ...WORKSTATION_FORM_STEPS.map((s) => (s.target === 'production-ws-form-submit-btn'
      ? { ...s, title: 'Save Changes', after: 'A green "Workstation saved." message appears. A new hourly rate applies to costs calculated from now on.' }
      : s)),
  ],
}

export default config
