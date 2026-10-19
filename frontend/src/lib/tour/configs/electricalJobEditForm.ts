import { TourConfig } from '../types'
import { JOB_FORM_FIELD_STEPS } from './electricalJobFormSteps'

const config: TourConfig = {
  id: 'electrical-job-edit-form',
  pageTitle: 'Edit Job Details & Requirement',
  steps: [
    {
      target: 'elec-job-tab-details',
      title: 'Details & Requirement — editing',
      purpose: 'You are editing this job\'s identity, planning dates and Electrical Requirement. Nothing is saved until you press "Save Changes".',
    },
    ...JOB_FORM_FIELD_STEPS,
    {
      target: 'elec-job-form-submit',
      title: 'Save Changes',
      purpose: 'Saves the edits.',
      after: 'The tab switches back to the read-only view and a green "Job details saved." message appears. If System Voltage and Requirement are filled in, the Electrical Requirement stage can now be completed on the Stages tab.',
    },
    {
      target: 'elec-job-form-cancel',
      title: 'Cancel',
      purpose: 'Throws away the edits and returns to the read-only view.',
    },
  ],
}

export default config
