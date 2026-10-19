import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'production-wo-edit-form',
  pageTitle: 'Edit Work Order',
  steps: [
    {
      target: 'production-wo-edit-qty',
      title: 'Quantity',
      purpose: 'Units to build. Editable only while the order is a Draft — it locks at release because material has been reserved for it.',
      validExample: '5',
      invalidExample: '0',
    },
    {
      target: 'production-wo-edit-priority',
      title: 'Priority',
      options: [
        { value: 'Low', meaning: 'Stock build, no deadline pressure.' },
        { value: 'Normal', meaning: 'Standard order.' },
        { value: 'High', meaning: 'Customer waiting — ahead of Normal on the Shop Floor board.' },
        { value: 'Urgent', meaning: 'Breakdown or penalty risk — shown first.' },
      ],
    },
    {
      target: 'production-wo-edit-start',
      title: 'Planned Start',
      whatToEnter: 'Date work is planned to begin.',
    },
    {
      target: 'production-wo-edit-end',
      title: 'Planned End',
      whatToEnter: 'Date the order must finish; not before Planned Start.',
      why: 'Changing it moves the order on the schedule chart and clears or sets the Overdue flag.',
    },
    {
      target: 'production-wo-edit-supervisor',
      title: 'Supervisor',
      purpose: 'Person responsible for the order.',
    },
    {
      target: 'production-wo-edit-machine',
      title: 'Machine / Project',
      purpose: 'Customer machine or project this is built for, or "Stock build".',
    },
    {
      target: 'production-wo-edit-source',
      title: 'Issue Materials From',
      purpose: 'Default store location for issuing components.',
    },
    {
      target: 'production-wo-edit-target',
      title: 'Receive Output Into',
      purpose: 'Default store location for finished units.',
    },
    {
      target: 'production-wo-edit-remarks',
      title: 'Remarks',
      purpose: 'Optional notes.',
    },
    {
      target: 'production-wo-edit-cancel-btn',
      title: 'Cancel',
      purpose: 'Closes the Edit Work Order popup without saving.',
    },
    {
      target: 'production-wo-edit-save-btn',
      title: 'Save',
      purpose: 'Saves the changes.',
      after: 'The popup closes and the order details refresh.',
    },
  ],
}

export default config
