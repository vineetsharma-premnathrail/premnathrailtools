import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'hr-my-profile-edit',
  pageTitle: 'Edit My Details',
  steps: [
    {
      target: 'hr-me-personal-email',
      title: 'Personal Email',
      whatToEnter: 'Your own (non-company) email.',
      validExample: 'name@gmail.com',
      invalidExample: 'name@gmail',
      why: 'HR uses it to send your relieving letter or Form 16 after you leave, when your company email no longer works.',
    },
    {
      target: 'hr-me-personal-phone',
      title: 'Personal Phone',
      whatToEnter: 'Digits only, optionally starting with + and the country code.',
      validExample: '+91 98765 43210',
      invalidExample: '98765-ABCD',
    },
    {
      target: 'hr-me-blood-group',
      title: 'Blood Group',
      purpose: 'Needed in a medical emergency on site.',
    },
    {
      target: 'hr-me-marital',
      title: 'Marital Status',
      purpose: 'Single, Married, Divorced, Widowed or Other.',
    },
    {
      target: 'hr-me-current-address',
      title: 'Current Address',
      whatToEnter: 'Where you live now.',
    },
    {
      target: 'hr-me-permanent-address',
      title: 'Permanent Address',
      whatToEnter: 'Your home-town address as on your ID proof.',
    },
    {
      target: 'hr-me-same-as-current',
      title: 'Same as current',
      purpose: 'Copies the current address into Permanent Address in one click.',
    },
    {
      target: 'hr-me-emg-name',
      title: 'Emergency Contact Name',
      whatToEnter: 'A family member or friend to call if something happens to you at work.',
    },
    {
      target: 'hr-me-emg-relation',
      title: 'Relation',
      validExample: 'Spouse / Father',
    },
    {
      target: 'hr-me-emg-phone',
      title: 'Emergency Phone',
      whatToEnter: 'Their phone number — digits only, optionally with + and country code.',
      validExample: '+91 98111 22334',
    },
    {
      target: 'hr-me-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the form without saving.',
    },
    {
      target: 'hr-me-save-btn',
      title: 'Save My Details',
      purpose: 'Saves only what you changed.',
      after: 'A "Details Updated" message confirms it; HR sees the change straight away. If an email or phone looks wrong, the exact problem is shown above the buttons.',
    },
  ],
}

export default config
