import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-document-edit',
  pageTitle: 'Edit Document',
  steps: [
    {
      target: 'design-doc-rev-edit-form',
      title: 'Edit revision',
      purpose: 'This popup edits the change summary, checker, approver and the ECN this revision is made under. Only possible before the revision is submitted.',
    },
    {
      target: 'design-doc-rev-save-btn',
      title: 'Save revision',
      purpose: 'Saves the revision changes.',
    },
    {
      target: 'design-doc-rev-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the popup and leaves the revision unchanged.',
    },
    {
      target: 'design-doc-edit-title',
      title: 'Title',
      required: true,
      whatToEnter: 'A clear title for the document.',
      validExample: 'Front bogie frame — general arrangement',
    },
    {
      target: 'design-doc-edit-description',
      title: 'Description',
      whatToEnter: 'Scope, variant, key notes.',
    },
    {
      target: 'design-doc-edit-discipline',
      title: 'Discipline',
      purpose: 'Mechanical, Electrical, Hydraulic, Pneumatic, Structural, Civil, Instrumentation or General.',
    },
    {
      target: 'design-doc-edit-owner',
      title: 'Owner',
      purpose: 'The responsible engineer for this document.',
    },
    {
      target: 'design-doc-edit-project',
      title: 'Project',
      purpose: 'Project Management project the document belongs to.',
    },
    {
      target: 'design-doc-edit-machine',
      title: 'Machine',
      purpose: 'Machine / RRV the document belongs to.',
    },
    {
      target: 'design-doc-edit-item',
      title: 'Part (Store item)',
      purpose: 'The Store item this drawing defines.',
    },
    {
      target: 'design-doc-edit-department',
      title: 'Department',
      purpose: 'Department that mainly uses this document.',
    },
    {
      target: 'design-doc-edit-customer',
      title: 'Customer',
      purpose: 'Customer the document is made for.',
    },
    {
      target: 'design-doc-edit-customer-approval',
      title: 'Customer approval required',
      purpose: 'When ticked, future revisions stop at "Approved · awaiting customer" until the customer approves them on a submission.',
      why: 'Use it for contract drawings the customer (e.g. RDSO / Railways) must approve.',
    },
    {
      target: 'design-doc-edit-standard',
      title: 'Standard',
      purpose: 'Standard the document follows (from the Library).',
    },
    {
      target: 'design-doc-edit-request',
      title: 'Design request',
      purpose: 'The design request this document is a deliverable of.',
    },
    {
      target: 'design-doc-edit-legacy',
      title: 'Legacy drawing number',
      whatToEnter: 'Old number if migrated from the old register.',
    },
    {
      target: 'design-doc-details-save-btn',
      title: 'Save',
      purpose: 'Saves the details.',
      after: 'The popup closes and the change is logged on the timeline. If saving fails, the reason is shown at the top of the popup.',
    },
    {
      target: 'design-doc-details-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the popup and discards your edits.',
    },
  ],
}

export default config
