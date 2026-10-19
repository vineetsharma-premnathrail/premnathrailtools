import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'sales-order-form',
  pageTitle: 'New Sales Order',
  steps: [
    {
      target: 'sales-form-back',
      title: '← Back',
      purpose: 'Returns to the Sales Orders list without saving.',
    },
    {
      target: 'sales-form-customer',
      title: 'Customer',
      purpose: 'The CRM organisation that placed the order. Sales never keeps its own customer list.',
      required: true,
      why: 'Every link (builds, invoices, machines) uses the customer id, not a typed name, so reports per customer are exact.',
    },
    {
      target: 'sales-form-po',
      title: 'Customer PO number and date',
      purpose: 'Exactly as printed on the customer’s PO (or LOA for railway tenders).',
      required: true,
      validExample: 'CR/COS/RRV/2026/771',
      why: 'A PO number can be used only once per customer among live orders — the system blocks duplicates.',
    },
    {
      target: 'sales-form-price-basis',
      title: 'Price basis',
      purpose: 'Who pays freight and when risk passes.',
      options: [
        { value: 'Ex-works', meaning: 'Customer collects; LD is reckoned from the dispatch date.' },
        { value: 'FOR destination', meaning: 'We deliver to the consignee and bear transit risk; LD is reckoned from the proof-of-delivery date. Normal for railway orders.' },
        { value: 'FOR dispatch station', meaning: 'Delivered free on rail / road at our end.' },
      ],
    },
    {
      target: 'sales-form-inspection',
      title: 'Inspection agency',
      purpose: 'RITES / RDSO / customer inspection required by the contract. Quality’s dispatch check reads this — a vehicle can’t be dispatched without the accepted inspection call.',
    },
    {
      target: 'sales-form-ld',
      title: 'Liquidated damages (LD)',
      purpose: 'Rate, period, basis and cap from the contract. Leave the cap blank only if the contract really has no cap.',
      validExample: '0.5% per week or part thereof, of the delayed value, capped at 10%',
      why: 'An LD cap above the standard (Settings) or no cap is a non-standard term — the order then needs a Partner’s approval whatever its value.',
    },
    {
      target: 'sales-form-warranty',
      title: 'Warranty',
      purpose: 'Months from delivery and/or commissioning and the rule that combines them.',
      validExample: '30 months from delivery / 24 months from commissioning, whichever is earlier',
    },
    {
      target: 'sales-form-lines',
      title: 'Lines',
      purpose: 'What was sold, at what price. Use the customer’s PO wording and their item reference (railway paying authorities match invoices on it). Totals are computed by the system.',
    },
    {
      target: 'sales-form-schedule',
      title: 'Delivery schedule',
      purpose: 'One row per vehicle with its consignee and contractual delivery date. Each vehicle later gets its own RRV build, LD and warranty.',
      why: 'A single “delivery date” on the order can’t tell you that vehicle 3 is late while 1, 2 and 4 are fine.',
    },
    {
      target: 'sales-form-billing',
      title: 'Billing plan',
      purpose: 'The payment terms as milestones (advance, on delivery, on commissioning, retention…). They must add up to exactly 100%.',
    },
    {
      target: 'sales-form-po-file',
      title: 'PO document',
      purpose: 'Attach the customer’s PO / LOA. It is required before the order can be submitted.',
    },
    {
      target: 'sales-form-save',
      title: 'Save draft',
      purpose: 'Saves the draft and opens it. From there, submit it for approval.',
      after: 'The draft opens on its detail page.',
    },
  ],
}

export default config
