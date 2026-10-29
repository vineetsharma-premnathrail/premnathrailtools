import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'crm-inquiry-form',
  pageTitle: 'Create / Edit Inquiry',
  steps: [
    {
      target: 'inq-org',
      title: 'Client Company',
      purpose: 'The customer organization raising this requirement. Search and select an existing customer organization — new ones are created from the Customer Organizations page, not from here.',
      required: true,
      after: 'Selecting an customer organization loads its contacts below and auto-fills Railway Zone/Division if the org has them set. It also checks for existing open inquiries/tenders from the same customer organization and warns you if found, to avoid duplicates.',
    },
    {
      target: 'inq-contact',
      title: 'Contact Person',
      purpose: 'The specific person at the customer organization this inquiry is tied to.',
      required: true,
      options: [
        { value: '(existing contact)', meaning: 'Any contact already saved under the selected customer organization.' },
        { value: '+ Add New Contact', meaning: 'Reveals a small form below to create a brand-new contact for this customer organization inline, without leaving this page.' },
      ],
      why: 'Saving is blocked with "Please select a contact person, or save the new contact you are adding." if this is left on "+ Add New Contact" without actually saving it.',
      after: 'Once the client company and a saved contact are chosen, the rest of the inquiry (Basic Information, Product Requirement) opens for editing.',
    },
    {
      target: 'inq-number',
      title: 'Inquiry Number',
      purpose: 'A unique, auto-generated ID for this inquiry (format INQ-YYYYMMDD-####). Read-only — you never type this.',
      required: false,
    },
    {
      target: 'inq-date',
      title: 'Inquiry Date',
      purpose: 'The day the customer raised this requirement. Starts as today; change it when you log an inquiry received earlier. Cannot be a future date.',
      required: true,
    },
    {
      target: 'inq-lead-source',
      title: 'Lead Source',
      purpose: 'Where this inquiry came from — used for reporting on which channels bring in business.',
      required: true,
      options: [
        { value: 'Website', meaning: 'Came through the company website.' },
        { value: 'WhatsApp', meaning: 'Enquired via WhatsApp message.' },
        { value: 'Referral', meaning: 'Came through a referral/existing contact.' },
        { value: 'Phone Call', meaning: 'Inbound or outbound phone call.' },
        { value: 'Email', meaning: 'Customer emailed directly.' },
        { value: 'Walk-in', meaning: 'Customer walked in without prior contact.' },
        { value: 'LinkedIn', meaning: 'Came through LinkedIn outreach or a post.' },
        { value: 'Exhibition/Event', meaning: 'Met at a trade show, exhibition, or industry event.' },
        { value: 'Other', meaning: 'Any source not covered by the options above.' },
      ],
    },
    {
      target: 'inq-priority',
      title: 'Customer Requirement Priority',
      required: true,
      options: [
        { value: 'High', meaning: 'Important requirement, quick action needed.' },
        { value: 'Medium', meaning: 'Normal requirement (default).' },
        { value: 'Low', meaning: 'Can be handled later.' },
      ],
    },
    {
      target: 'inq-status',
      title: 'Status',
      purpose: 'Where this inquiry currently stands in the sales pipeline.',
      required: true,
      options: [
        { value: 'Lead', meaning: 'First contact — a possible requirement, not yet confirmed. The default for a new inquiry.' },
        { value: 'Requirement Received', meaning: 'The customer has confirmed what they need; nothing quoted yet.' },
        { value: 'R&D / Technical Review', meaning: 'Requirement is with R&D for technical feasibility / Technical Offer.' },
        { value: 'Qualified Inquiry', meaning: 'Technically feasible and worth quoting — quotation can be prepared.' },
        { value: 'Quotation Sent', meaning: 'At least one quotation has been sent to the customer.' },
        { value: 'Order Received', meaning: 'Customer has sent the PO / order.' },
        { value: 'Closed - Ordered', meaning: 'Customer placed an order — inquiry is won.' },
        { value: 'Closed - Not Ordered', meaning: 'Customer did not proceed — inquiry is lost.' },
      ],
      why: 'Status drives where this inquiry shows up on the dashboard. Setting it to Order Received lets Sales create the sales order.',
    },
    {
      target: 'inq-current-status-note',
      title: 'Current Status',
      purpose: 'A free-text running note on where things stand right now — separate from the fixed Status dropdown above. Can also be updated later from the inquiry\'s detail page.',
      required: false,
      why: 'Every change to this note is recorded on the Timeline, just like any other field edit.',
    },
    {
      target: 'inq-product',
      title: 'Product',
      required: true,
      purpose: 'What the customer asked for, in their words (free text) — e.g. "RRV for OHE maintenance, 1676 mm BG".',
      why: 'An inquiry records the requirement as the customer states it. The exact product and price are picked from the Product master (Sales › Products) on the quotation line. The same text cannot be entered twice in one inquiry.',
    },
    {
      target: 'inq-product-spec',
      title: 'Customer Requirement',
      required: false,
      purpose: 'What the customer needs for this product, in their words — gauge, braking type, special fittings etc.',
    },
    {
      target: 'inq-add-product',
      title: 'Add another product',
      required: false,
      purpose: 'The + beside Product adds one more Product with its own Customer Requirement. It works once the products above are filled in; the red × removes an added one.',
    },
    {
      target: 'inq-project-details',
      title: 'Project Details',
      required: false,
      purpose: 'Its own section: background on the broader project this requirement is part of — scope, timeline, context.',
    },
    {
      target: 'inq-save',
      title: 'Create',
      purpose: 'Validates every required field (customer organization, contact, lead source, priority, status, product) before creating the inquiry.',
      after: 'On success you land on the inquiry\'s detail page, where quotations, documents, and follow-ups are managed from their own tabs.',
    },
  ],
}

export default config
