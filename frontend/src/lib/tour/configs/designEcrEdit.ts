import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-ecr-edit',
  pageTitle: 'Edit Change Request',
  steps: [
    {
      target: 'design-ecr-editpanel',
      title: 'Edit change request',
      purpose: 'Same fields as when the ECR was raised: Title (required, 3+ characters), Source, Urgency, NCR/CAPA link (only for those sources), Source reference, Project, Machine, Reason and Proposed change (both required), and the affected released drawings/BOMs with a note each.',
      why: 'Editing is allowed only while the request is still open, so the board always votes on the version they saw.',
    },
    {
      target: 'design-ecr-edit-save-btn',
      title: 'Save',
      purpose: 'Saves the request. At least one drawing or BOM must remain.',
      after: 'The popup closes and the change is logged in the Timeline.',
    },
    {
      target: 'design-ecr-edit-cancel-btn',
      title: 'Cancel',
      purpose: 'Discard your edits.',
    },
  ],
}

export default config
