import { TourConfig } from '../types'
import tenderFormConfig from './crmTenderForm'

// A standalone tour for editing an existing tender — kept separate from the
// Tender Detail (view) tour rather than merged into one continuous flow, so
// starting the tour while looking at the read-only view never drags in
// edit-form field steps the user isn't looking at yet, and starting it while
// the edit form is open never drags in view-only steps that aren't visible
// right now either.
const config: TourConfig = {
  id: 'crm-tender-edit-form',
  pageTitle: 'Edit Tender',
  // Same field steps as the Create Tender page, except the button here reads
  // "Save Changes" (editing an existing tender), not "Create Tender".
  steps: tenderFormConfig.steps.map((s) => (s.target === 'tnd-save' ? { ...s, title: 'Save Changes' } : s)),
}

export default config
