import { TourConfig } from '../types'

const PRIORITY_OPTIONS = [
  { value: 'Low', meaning: 'No deadline pressure.' },
  { value: 'Normal', meaning: 'Standard delivery commitment.' },
  { value: 'High', meaning: 'Tight customer deadline.' },
  { value: 'Urgent', meaning: 'Penalty or critical customer need — first call on people and material.' },
]

const config: TourConfig = {
  id: 'production-rrv-form',
  pageTitle: 'New RRV Build',
  steps: [
    {
      target: 'production-rrv-new-back-btn',
      title: '← Back',
      purpose: 'Returns to the RRV Builds list without saving.',
    },
    {
      target: 'production-rrv-new-model',
      title: 'RRV model',
      required: true,
      whatToEnter: 'The vehicle model / variant being built.',
      validExample: 'PR-RRV 4x4 Tower Wagon',
    },
    {
      target: 'production-rrv-new-customer',
      title: 'Customer',
      whatToEnter: 'Who the vehicle is for.',
      validExample: 'Northern Railway',
    },
    {
      target: 'production-rrv-new-po-no',
      title: 'Customer PO no.',
      whatToEnter: 'The customer\'s purchase order number.',
      why: 'Printed on the handover certificate and used to match delivery against the order.',
    },
    {
      target: 'production-rrv-new-po-date',
      title: 'PO date',
      whatToEnter: 'Date on the customer\'s purchase order.',
    },
    {
      target: 'production-rrv-new-order-ref',
      title: 'Order / tender ref.',
      whatToEnter: 'LOI, tender or inquiry number, if there is no PO yet or for cross-reference.',
    },
    {
      target: 'production-rrv-new-machine',
      title: 'Existing machine in ERP (optional)',
      purpose: 'Pick only if this vehicle is already registered in the ERP machine registry. Otherwise leave "None" — it is registered automatically at RRV Completion using the serial and chassis numbers.',
      why: 'The registry entry is what Service uses to raise warranty tickets after handover.',
    },
    {
      target: 'production-rrv-new-serial',
      title: 'Vehicle serial no.',
      whatToEnter: 'Our serial number for the vehicle. Filled from the machine if one is picked above.',
      validExample: 'PR-RRV-2026-014',
    },
    {
      target: 'production-rrv-new-chassis',
      title: 'Chassis no.',
      whatToEnter: 'Chassis number of the base vehicle (from the OEM).',
    },
    {
      target: 'production-rrv-new-engine',
      title: 'Engine no.',
      whatToEnter: 'Engine number of the base vehicle.',
    },
    {
      target: 'production-rrv-new-year',
      title: 'Year',
      whatToEnter: 'Year of manufacture.',
      validExample: '2026',
    },
    {
      target: 'production-rrv-new-manager',
      title: 'Build manager',
      purpose: 'The person who owns this vehicle end to end. Manager sign-off is needed for RRV Completion and Production Handover.',
    },
    {
      target: 'production-rrv-new-plant',
      title: 'Plant',
      purpose: 'Factory where the vehicle is built.',
    },
    {
      target: 'production-rrv-new-priority',
      title: 'Priority',
      options: PRIORITY_OPTIONS,
    },
    {
      target: 'production-rrv-new-start',
      title: 'Planned start',
      whatToEnter: 'Date assembly is planned to begin.',
    },
    {
      target: 'production-rrv-new-target-completion',
      title: 'Target completion',
      whatToEnter: 'Date the vehicle should be built, tested and signed off as complete.',
    },
    {
      target: 'production-rrv-new-target-handover',
      title: 'Target handover',
      whatToEnter: 'Date promised to the customer for delivery.',
      why: 'Builds past this date show as overdue in the list.',
    },
    {
      target: 'production-rrv-new-warranty',
      title: 'Warranty (months)',
      whatToEnter: 'Warranty period from handover, in whole months.',
      validExample: '12',
      invalidExample: '1 year',
    },
    {
      target: 'production-rrv-new-remarks',
      title: 'Remarks',
      purpose: 'Special customer requirements, variant details or agreed deviations.',
    },
    {
      target: 'production-rrv-new-tests',
      title: 'Vehicle tests required before handover',
      purpose: 'Tick every test this vehicle must pass. The common set is ticked by default.',
      why: 'The Vehicle Testing stage cannot be completed until the latest record of each ticked test is a Pass — so no vehicle leaves with a missed brake or rail trial. Can be changed later on the build.',
    },
    {
      target: 'production-rrv-new-cancel-btn',
      title: 'Cancel',
      purpose: 'Discards the form and returns to the RRV Builds list',
    },
    {
      target: 'production-rrv-new-submit-btn',
      title: 'Create RRV Build',
      purpose: 'Saves the build.',
      after: 'Opens the build with its 12 stages. Next: raise the main work order from the "Work Orders & Material" tab.',
    },
  ],
}

export default config
