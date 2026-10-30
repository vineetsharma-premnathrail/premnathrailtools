import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'production-rrv-edit-form',
  pageTitle: 'Edit RRV Build',
  steps: [
    { target: 'production-rrv-edit-rrv-model', title: 'RRV model', required: true, whatToEnter: 'Vehicle model / variant.' },
    { target: 'production-rrv-edit-customer-name', title: 'Customer', whatToEnter: 'Who the vehicle is for.' },
    { target: 'production-rrv-edit-customer-po-number', title: 'Customer PO no.', whatToEnter: 'Customer purchase order number.' },
    { target: 'production-rrv-edit-order-reference', title: 'Order / tender ref.', whatToEnter: 'LOI, tender or inquiry number.' },
    {
      target: 'production-rrv-edit-vehicle-serial-number',
      title: 'Vehicle serial no.',
      whatToEnter: 'Our serial number. Locked when a machine is picked below (it comes from the machine).',
    },
    { target: 'production-rrv-edit-chassis-number', title: 'Chassis no.', whatToEnter: 'Base vehicle chassis number.' },
    { target: 'production-rrv-edit-engine-number', title: 'Engine no.', whatToEnter: 'Base vehicle engine number.' },
    { target: 'production-rrv-edit-year-of-manufacture', title: 'Year', whatToEnter: 'Year of manufacture.', validExample: '2026' },
    { target: 'production-rrv-edit-po-date', title: 'PO date', whatToEnter: 'Date on the customer PO.' },
    {
      target: 'production-rrv-edit-machine',
      title: 'Machine in ERP',
      purpose: 'Link to an existing ERP machine, or leave "None" to have it registered automatically at RRV Completion.',
    },
    { target: 'production-rrv-edit-manager', title: 'Build manager', purpose: 'Owner of the build; signs off RRV Completion and Handover.' },
    {
      target: 'production-rrv-edit-priority',
      title: 'Priority',
      options: [
        { value: 'Standard', meaning: 'Standard commitment (default).' },
        { value: 'Urgent', meaning: 'Penalty or critical need.' },
      ],
    },
    { target: 'production-rrv-edit-start', title: 'Planned start', whatToEnter: 'Planned assembly start date.' },
    { target: 'production-rrv-edit-target-completion', title: 'Target completion', whatToEnter: 'Date the vehicle should be complete.' },
    { target: 'production-rrv-edit-target-handover', title: 'Target handover', whatToEnter: 'Date promised to the customer.' },
    { target: 'production-rrv-edit-remarks', title: 'Remarks', purpose: 'Special requirements or deviations.' },
    {
      target: 'production-rrv-edit-save-btn',
      title: 'Save',
      purpose: 'Saves the changes.',
      after: 'The popup closes, the details show the updated values and the change is recorded on the Timeline tab.',
    },
    { target: 'production-rrv-edit-cancel-btn', title: 'Cancel', purpose: 'Closes the Edit Build Details popup without saving.' },
  ],
}

export default config
