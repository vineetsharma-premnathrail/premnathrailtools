import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'crm-inquiry-form',
  pageTitle: 'Create / Edit Inquiry',
  steps: [
    {
      target: 'inq-number',
      title: 'Inquiry Number',
      purpose: 'A unique, auto-generated ID for this inquiry (format INQ-YYYYMMDD-####). Read-only — you never type this.',
      required: false,
    },
    {
      target: 'inq-lead-source',
      title: 'Lead Source',
      purpose: 'Where this inquiry came from — used for reporting on which channels bring in business.',
      required: true,
      options: [
        { value: 'Email / Direct', meaning: 'Customer emailed or contacted you directly.' },
        { value: 'Reference', meaning: 'Came through a referral/existing contact.' },
        { value: 'Tender Portal', meaning: 'Found via a government/public tender listing.' },
        { value: 'Cold Call', meaning: 'Outbound call initiated by your team.' },
        { value: 'Exhibition', meaning: 'Met at a trade show/exhibition.' },
        { value: 'Website', meaning: 'Came through the company website.' },
      ],
    },
    {
      target: 'inq-priority',
      title: 'Priority',
      required: true,
      options: [
        { value: 'Low', meaning: 'No urgency — handle in normal course.' },
        { value: 'Medium', meaning: 'Default priority for most inquiries.' },
        { value: 'High', meaning: 'Needs faster turnaround than usual.' },
        { value: 'Urgent', meaning: 'Time-critical — flagged for immediate attention.' },
      ],
    },
    {
      target: 'inq-status',
      title: 'Status',
      purpose: 'Where this inquiry currently stands in the sales pipeline.',
      required: true,
      options: [
        { value: 'Requirement Received', meaning: 'Just logged, nothing quoted yet — the default for a new inquiry.' },
        { value: 'Quotation Under Creation', meaning: 'A quotation is being prepared.' },
        { value: 'Quotation Sent', meaning: 'At least one quotation has been sent to the customer.' },
        { value: 'Negotiation', meaning: 'Back-and-forth on price/terms is underway.' },
        { value: 'Closed - Ordered', meaning: 'Customer placed an order — inquiry is won.' },
        { value: 'Closed - Not Ordered', meaning: 'Customer did not proceed — inquiry is lost.' },
      ],
      why: 'Status drives which pipeline stage this inquiry shows up in on the dashboard.',
    },
    {
      target: 'inq-bd-owner',
      title: 'BD Owner',
      purpose: 'The business-development person responsible for this inquiry — auto-filled with your own name and locked.',
      required: false,
    },
    {
      target: 'inq-org',
      title: 'Client Company',
      purpose: 'The organization raising this requirement. Search and select an existing organization — new ones are created from the Organizations page, not from here.',
      required: true,
      after: 'Selecting an organization loads its contacts below and auto-fills Railway Zone/Division if the org has them set. It also checks for existing open inquiries/tenders from the same organization and warns you if found, to avoid duplicates.',
    },
    {
      target: 'inq-contact',
      title: 'Contact Person',
      purpose: 'The specific person at the client organization this inquiry is tied to.',
      required: true,
      options: [
        { value: '(existing contact)', meaning: 'Any contact already saved under the selected organization.' },
        { value: '+ Add New Contact', meaning: 'Reveals a small form below to create a brand-new contact for this organization inline, without leaving this page.' },
      ],
      why: 'Saving is blocked with "Please select a contact person, or save the new contact you are adding." if this is left on "+ Add New Contact" without actually saving it.',
    },
    {
      target: 'inq-product-category',
      title: 'Category',
      required: true,
      purpose: 'The broad product category for the primary item being enquired about. Pick an existing one or type a new value to add it to the shared catalog.',
    },
    {
      target: 'inq-product',
      title: 'Product',
      required: true,
      purpose: 'The specific product/model. Picking one auto-fills its Category if the product already has one on record.',
      why: 'The same Category + Product combination cannot be added twice (here and in an additional product row below) — a duplicate is flagged and blocks saving.',
    },
    {
      target: 'inq-quantity',
      title: 'Quantity',
      required: true,
      whatToEnter: 'A whole number.',
      validExample: '2',
    },
    {
      target: 'inq-delivery-date',
      title: 'Required Delivery Date',
      required: false,
    },
    {
      target: 'inq-delivery-location',
      title: 'Delivery Location',
      required: false,
      validExample: 'Allahabad, UP',
    },
    {
      target: 'inq-inspection',
      title: 'Inspection Requirement',
      required: false,
      validExample: 'RDSO inspection, third party QA',
    },
    {
      target: 'inq-warranty',
      title: 'Warranty Requirement',
      required: false,
      validExample: '12 months from commissioning',
    },
    {
      target: 'inq-product-spec',
      title: 'Product Specification',
      required: false,
      purpose: 'Technical spec details for the primary product line — gauge, braking type, special fittings etc.',
    },
    {
      target: 'inq-requirement-desc',
      title: 'Requirement Description',
      required: false,
      purpose: 'A short plain-language summary of what the customer needs, for anyone skimming the inquiry list.',
    },
    {
      target: 'inq-project-details',
      title: 'Project Details',
      required: false,
      purpose: 'Background on the broader project this requirement is part of — scope, timeline, context.',
    },
    {
      target: 'inq-save',
      title: 'Create',
      purpose: 'Validates every required field (organization, contact, lead source, priority, status, category, product, quantity) before creating the inquiry.',
      after: 'On success you land on the inquiry\'s detail page, where quotations, documents, and follow-ups are managed from their own tabs.',
    },
  ],
}

export default config
