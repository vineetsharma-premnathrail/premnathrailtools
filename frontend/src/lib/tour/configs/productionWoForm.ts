import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'production-wo-form',
  pageTitle: 'New Work Order',
  steps: [
    {
      target: 'production-wo-new-back-btn',
      title: '← Back',
      purpose: 'Returns without saving (to the RRV build if you came from one, otherwise to the Work Orders list).',
    },
    {
      target: 'production-wo-new-rrv-banner',
      title: 'Linked to an RRV build',
      purpose: 'Shown when you came from an RRV build. The order will be linked to that vehicle as its main (final assembly) or sub-assembly order, and uses the build\'s machine — so leave Machine blank.',
    },
    {
      target: 'production-wo-new-bom',
      title: 'Product / Active BOM',
      required: true,
      purpose: 'What to build. Only products with an Active BOM are listed — the BOM supplies the material list and routing.',
      after: 'A preview of required components and planned hours appears at the bottom.',
      why: 'If the product is missing, create and activate its BOM under BOM & Routing first.',
    },
    {
      target: 'production-wo-new-qty',
      title: 'Quantity',
      required: true,
      whatToEnter: 'How many units to build, in the product\'s unit.',
      validExample: '5',
      invalidExample: '0',
      why: 'Component quantities and planned hours are calculated from this. It can be changed while the order is a Draft, and locks at release.',
    },
    {
      target: 'production-wo-new-priority',
      title: 'Priority',
      options: [
        { value: 'Low', meaning: 'Stock build, no deadline pressure.' },
        { value: 'Normal', meaning: 'Standard order (default).' },
        { value: 'High', meaning: 'Customer waiting — goes ahead of Normal on the Shop Floor board.' },
        { value: 'Urgent', meaning: 'Breakdown or penalty risk — shown first on the Shop Floor board.' },
      ],
    },
    {
      target: 'production-wo-new-machine',
      title: 'For Machine / Project (ERP)',
      purpose: 'The customer machine or project this is built for (search by serial number, model or client). Leave as "Stock build" when building for stock.',
      why: 'Ties material and labour cost to the machine, so the true cost of each vehicle is known.',
    },
    {
      target: 'production-wo-new-plant',
      title: 'Plant',
      purpose: 'Which factory builds this order.',
    },
    {
      target: 'production-wo-new-start',
      title: 'Planned Start',
      whatToEnter: 'Date work is planned to begin.',
    },
    {
      target: 'production-wo-new-end',
      title: 'Planned End',
      whatToEnter: 'Date the order must be finished. Must not be before Planned Start.',
      why: 'Drives the Overdue flag, the "Due in 7 days" list and the schedule chart.',
    },
    {
      target: 'production-wo-new-supervisor',
      title: 'Supervisor',
      purpose: 'The person responsible for getting this order built on time.',
    },
    {
      target: 'production-wo-new-source',
      title: 'Issue Materials From',
      purpose: 'Store location components are reserved and issued from — normally the raw material store.',
      why: 'Can be left blank on the draft, but must be set before release — reservation checks stock at this location.',
    },
    {
      target: 'production-wo-new-target',
      title: 'Receive Output Into',
      purpose: 'Store location finished units are received into — normally the finished goods store. Must be set before release.',
    },
    {
      target: 'production-wo-new-remarks',
      title: 'Remarks',
      purpose: 'Optional notes, e.g. customer special requirements.',
    },
    {
      target: 'production-wo-new-preview',
      title: 'Preview',
      purpose: 'Read-only check before saving: each component\'s required quantity (BOM qty × order qty ÷ base qty, plus scrap %) and each operation\'s planned hours (setup + run × qty).',
    },
    {
      target: 'production-wo-new-submit-btn',
      title: 'Create Draft Work Order',
      purpose: 'Saves the order as a Draft with its own copy of the BOM\'s materials and operations.',
      after: 'Opens the work order. Check the details, then click "Release to Shop Floor" when ready to start.',
    },
  ],
}

export default config
