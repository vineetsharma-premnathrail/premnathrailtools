import { TourConfig } from '../types'
import { ECN_FORM_STEPS } from './designEcnFormSteps'

const config: TourConfig = {
  id: 'design-ecn-edit',
  pageTitle: 'Edit Change Notice',
  steps: [
    {
      target: 'design-ecn-header',
      title: 'Editing this ECN',
      purpose: 'You are editing a draft ECN. Every field below can be changed until it is submitted for approval.',
    },
    {
      target: 'design-ecn-edit-back-btn',
      title: '← Back',
      purpose: 'Discards your edits and returns to the read-only view — same as Cancel.',
    },
    ...ECN_FORM_STEPS.map((s) =>
      s.target === 'design-ecnform-save-btn'
        ? { ...s, title: 'Save Changes', after: 'The ECN is saved and the page returns to the read-only view.' }
        : s.target === 'design-ecnform-cancel-btn'
          ? { ...s, purpose: 'Discard your edits and return to the read-only view.' }
          : s,
    ),
  ],
}

export default config
