import { TourConfig } from '../types'
import { BOM_LINE_STEPS } from './designBomLineSteps'

const config: TourConfig = {
  id: 'design-bom-edit',
  pageTitle: 'Edit BOM',
  steps: [
    {
      target: 'design-bom-rev-edit-form',
      title: 'Edit revision',
      purpose: 'Change summary, checker, approver and the ECN this revision is made under, plus the lines below.',
    },
    ...BOM_LINE_STEPS,
    {
      target: 'design-bom-rev-save-btn',
      title: 'Save revision',
      purpose: 'Validates every line and saves. Any problem is reported with its line number.',
      after: 'When ready, use "Submit for Check".',
    },
    {
      target: 'design-bom-rev-cancel-btn',
      title: 'Cancel',
      purpose: 'Discards your changes to the revision.',
    },
    {
      target: 'design-bom-header-form',
      title: 'Edit details popup',
      purpose: 'Title, description, GA drawing, owner, project, machine and design request. The product item cannot be changed — a different product needs its own BOM.',
    },
    {
      target: 'design-bom-header-save-btn',
      title: 'Save',
      purpose: 'Saves the details.',
    },
    {
      target: 'design-bom-header-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the popup and discards your edits.',
    },
  ],
}

export default config
