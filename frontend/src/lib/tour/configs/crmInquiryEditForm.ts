import { TourConfig } from '../types'
import inquiryFormConfig from './crmInquiryForm'

// A standalone tour for editing an existing inquiry — kept separate from the
// Inquiry Detail (view) tour rather than merged into one continuous flow, so
// starting the tour while looking at the read-only view never drags in
// edit-form field steps the user isn't looking at yet, and starting it while
// the edit form is open never drags in view-only steps that aren't visible
// right now either.
const config: TourConfig = {
  id: 'crm-inquiry-edit-form',
  pageTitle: 'Edit Inquiry',
  // Same field steps as the Create Inquiry page, except the button here
  // reads "Save Changes" (editing an existing inquiry), not "Create Inquiry".
  steps: inquiryFormConfig.steps.flatMap((s) => {
    if (s.target === 'inq-save') return [{ ...s, title: 'Save Changes' }]
    if (s.target === 'inq-product-spec') {
      return [s, {
        target: 'inq-spec-locked',
        title: 'Requirement sent to R&D',
        purpose: 'Once the requirement has been sent to R&D, the Customer Requirement of the main product and of each additional product is read-only here (a grey box). To change it, cancel this edit and use Change requirement at the top of the inquiry: R&D then gets a new revision with your reason, or a typo is fixed before R&D accepts it. Every other field stays editable.',
        why: 'So R&D never works on a requirement that changed without being told.',
      }]
    }
    return [s]
  }),
}

export default config
