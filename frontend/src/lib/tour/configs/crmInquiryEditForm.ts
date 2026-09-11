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
  steps: inquiryFormConfig.steps.map((s) => (s.target === 'inq-save' ? { ...s, title: 'Save Changes' } : s)),
}

export default config
