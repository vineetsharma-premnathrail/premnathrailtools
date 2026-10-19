import { TourConfig } from '../types'
import { JOB_FORM_FIELD_STEPS } from './electricalJobFormSteps'

const config: TourConfig = {
  id: 'electrical-job-form',
  pageTitle: 'New RRV Electrical Job',
  steps: [
    {
      target: 'elec-job-form',
      title: 'New RRV Electrical Job',
      purpose: 'The job sheet: RRV identity and planning on the left, the Electrical Requirement on the right.',
    },
    {
      target: 'elec-job-form-back-btn',
      title: '← Back',
      purpose: 'Returns to the RRV Jobs list without creating anything.',
    },
    ...JOB_FORM_FIELD_STEPS,
    {
      target: 'elec-job-form-cancel',
      title: 'Cancel',
      purpose: 'Leaves the form without saving and goes back to the jobs list.',
    },
    {
      target: 'elec-job-form-submit',
      title: 'Create Job',
      purpose: 'Creates the job.',
      after: 'The job is created in Draft status with all 20 scope stages (Electrical Requirement → As-Built Records) and opens on its own page. It becomes "In Progress" automatically once the first stage is started.',
      why: 'Only Job Title is required now — everything else can be filled in later from the job\'s "Details & Requirement" tab.',
    },
  ],
}

export default config
