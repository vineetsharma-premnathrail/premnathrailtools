import { TourConfig } from '../types'
import { PROJECT_FORM_STEPS } from './projectsShared'

const config: TourConfig = {
  id: 'projects-new-form',
  pageTitle: 'New Project',
  steps: [
    {
      target: 'pm-new-form',
      title: 'New project form',
      purpose: 'Name, client and timeline of the project.',
    },
    {
      target: 'pm-new-back',
      title: '← Back',
      purpose: 'Leaves without saving anything.',
    },
    ...PROJECT_FORM_STEPS,
    {
      target: 'pm-new-cancel',
      title: 'Cancel',
      purpose: 'Discards what you typed and goes back.',
    },
    {
      target: 'pm-new-create-btn',
      title: 'Create project',
      purpose: 'Saves the project in Planning status.',
      after: 'You land on the new project. Give each department its tasks on the Tasks tab and upload its documents on the Documents tab. If a required field is missing, the exact reason is shown at the top of the form.',
    },
  ],
}

export default config
