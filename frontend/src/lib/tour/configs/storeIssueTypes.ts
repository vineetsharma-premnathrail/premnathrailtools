import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-issue-types',
  pageTitle: 'Store Settings — Issue Types',
  steps: [
    {
      target: 'doctype-issue-add-btn',
      title: '+ Add Issue Type',
      purpose: 'Creates a purpose that can be picked on every Material Issue.',
      after: 'Opens a small form — the next steps walk through it.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'store-doctype-name',
      title: 'Name',
      required: true,
      whatToEnter: 'Why material leaves the store, in plain words.',
      validExample: 'Production, Maintenance, Project, Job Work – Machining, Rework',
      why: 'Consumption reports are split by issue type, so management can see how much material goes to production vs. maintenance vs. outside job work.',
    },
    {
      target: 'store-doctype-save-btn',
      title: 'Save',
      purpose: 'Saves the issue type.',
      after: 'Immediately offered on new Material Issues. Use Issue Rules to decide if this type also needs a Challan No., Vendor or return Date.',
    },
    {
      target: 'store-doctype-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the form without saving.',
      autoActivateOnAdvance: true,
    },
    {
      target: 'doctype-issue-table',
      title: 'Issue types list',
      purpose: 'Every issue type and whether it is Active (pickable) or Inactive (kept on old issues only).',
    },
    {
      target: 'store-doctype-edit-link',
      title: 'Edit',
      purpose: 'Rename the type or deactivate it.',
    },
    {
      target: 'store-doctype-delete-link',
      title: 'Delete',
      purpose: 'Removes a type after you confirm — only allowed while no issue uses it; otherwise deactivate it instead.',
    },
  ],
}

export default config
