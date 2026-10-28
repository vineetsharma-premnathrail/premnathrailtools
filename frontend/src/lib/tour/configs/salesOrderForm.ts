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
      target: 'sales-form-category',
      title: '1. What is this order?',
      purpose: 'Pick the kind of business first. The rest of the form opens after this and step 2.',
      required: true,
      options: [
        { value: 'New Project', meaning: 'New machines to design and build. When the order is approved, a project (PEW-xx) with one unit per vehicle opens in Project Management for design, purchase, production and QC.' },
        { value: 'Service', meaning: 'Paid service on one of our machines: pick the project / machine, then its service requests (SRs). No build project.' },
        { value: 'Rental', meaning: 'A machine given on hire: pick the organisation it is rented to. No build project.' },
      ],
      why: 'Only a New Project order builds machines, so only it should create a project. Every kind is billed in Finance from the billing plan.',
    },
    {
      target: 'sales-form-source',
      title: '2. Where the order comes from',
      purpose: 'New Project: the won CRM inquiry (status "Order Received") or the tender with LOA / order received — customer, contact, lines, prices and terms are filled from it. Service: the machine and the SRs this order bills for — the customer is the machine’s customer. Rental: the organisation the machine is rented to.',
      required: true,
      why: 'Nobody types a customer twice, and every order traces back to its inquiry, machine or SR. An SR can sit on only one live order, so it is never billed twice.',
    },
    {
      target: 'sales-form-customer',
      title: 'Customer',
      purpose: 'The CRM organisation of the picked inquiry / tender — read-only here. Pick another inquiry / tender to change it.',
      why: 'Every link (builds, invoices, machines) uses the customer id, not a typed name, so reports per customer are exact.',
    },
    {
      target: 'sales-form-po',
      title: 'Customer PO number and date',
      purpose: 'Exactly as printed on the customer’s PO. For railway tenders, enter the LOA number and date here — a PO and an LOA are treated as the same thing.',
      required: true,
      validExample: 'CR/COS/RRV/2026/771',
      why: 'A PO number can be used only once per customer among live orders — the system blocks duplicates.',
    },
    {
      target: 'sales-form-currency',
      title: 'Currency',
      purpose: 'The currency of the customer’s PO. Default is INR. Pick from the list or type to search.',
      why: 'Recorded as a label only: billing plan, invoices and Finance reports use the amounts exactly as entered, without any conversion. A note appears when the currency is not INR.',
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
      purpose: 'Attach the customer’s PO (or LOA). It is required before the order can be submitted.',
    },
    {
      // Only shown when the order is raised from an inquiry or tender — the tour skips it otherwise.
      target: 'sales-form-crm-docs',
      title: 'CRM documents to link',
      purpose: 'Tick which documents of the inquiry / tender belong with this order — customer files, internal files, the Technical Offer Request and R&D files. Nothing is ticked by default.',
      why: 'Only a link is kept: the file stays in CRM, so the order always opens the current file and nothing is duplicated. They show on the order’s Documents tab under "Linked from CRM".',
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
