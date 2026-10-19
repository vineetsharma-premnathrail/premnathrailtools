import { TourConfig } from '../types'
import { PROJECT_FORM_STEPS } from './projectsShared'

const config: TourConfig = {
  id: 'projects-edit-form',
  pageTitle: 'Edit Project',
  steps: [
    ...PROJECT_FORM_STEPS.map((s) => s.target === 'pm-form-code'
      ? { ...s, purpose: `${s.purpose} Once the project is released it is greyed out and cannot be changed — departments already know the job by it.` }
      : s),
    {
      target: 'pm-proj-edit-cancel',
      title: 'Cancel',
      purpose: 'Closes the form without saving; the project details go back to read-only.',
    },
    {
      target: 'pm-proj-edit-save',
      title: 'Save',
      purpose: 'Saves the changes.',
      after: 'Every changed field is recorded on the History tab (old → new value, who, when). Changing the target handover date may change the project\'s health.',
    },
  ],
}

export default config
