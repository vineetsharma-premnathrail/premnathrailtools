import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'crm-tender-form',
  pageTitle: 'Create / Edit Tender',
  steps: [
    {
      target: 'tnd-number',
      title: 'Tender Number',
      required: false,
      purpose: 'The tendering authority\'s own reference number for this tender (not the same as the Internal Tender ID shown above, which this app generates itself). Required once the status is Tender Published or later; not needed while Waiting for Future Tender.',
    },
    {
      target: 'tnd-name',
      title: 'Tender Name',
      required: false,
      whatToEnter: 'A short descriptive title for the tender.',
      purpose: 'Required once the status is Tender Published or later; not needed while Waiting for Future Tender.',
    },
    {
      target: 'tnd-authority',
      title: 'Tender Authority',
      required: false,
      purpose: 'The specific department/body issuing the tender, if different from the Customer Organization itself.',
    },
    {
      target: 'tnd-portal',
      title: 'Tender Portal',
      required: false,
      options: [
        { value: 'GeM', meaning: 'Government e-Marketplace.' },
        { value: 'IREPS', meaning: 'Indian Railways e-Procurement System.' },
        { value: 'CPP Portal', meaning: 'Central Public Procurement Portal.' },
        { value: 'eProcure', meaning: 'A generic eProcurement portal.' },
        { value: 'Direct', meaning: 'Received directly, not through an online portal.' },
        { value: 'Other', meaning: 'Reveals a text box to specify the portal name.' },
      ],
    },
    {
      target: 'tnd-type',
      title: 'Tender Type',
      required: false,
      options: [
        { value: 'Open', meaning: 'Open to any bidder.' },
        { value: 'Limited', meaning: 'Restricted to a pre-qualified/invited set of bidders.' },
        { value: 'Single', meaning: 'Single-source, only one bidder invited.' },
        { value: 'Global', meaning: 'Open to international bidders.' },
      ],
    },
    {
      target: 'tnd-value',
      title: 'Tender Value',
      required: false,
      whatToEnter: 'Estimated/quoted numeric value, paired with the Currency field next to it.',
    },
    {
      target: 'tnd-currency',
      title: 'Currency',
      required: false,
      options: [
        { value: 'INR', meaning: 'Indian Rupees — default.' },
        { value: 'USD', meaning: 'US Dollars.' },
        { value: 'EUR', meaning: 'Euros.' },
      ],
    },
    {
      target: 'tnd-status',
      title: 'Status',
      required: false,
      options: [
        { value: 'Waiting for Future Tender', meaning: 'Expected but not floated yet — the default for a new tender.' },
        { value: 'Tender Published', meaning: 'The authority has floated the tender.' },
        { value: 'Tender Participation', meaning: 'Decision made to participate; preparation underway.' },
        { value: 'Tender Submitted', meaning: 'Your bid has been submitted.' },
        { value: 'LOA / Order Received', meaning: 'Letter of Award or order received.' },
        { value: 'Closed – Ordered', meaning: 'Tender awarded to your company.' },
        { value: 'Closed – Not Ordered', meaning: 'Awarded to someone else or otherwise lost.' },
        { value: 'Tender Cancelled', meaning: 'The tender itself was cancelled/withdrawn.' },
      ],
      why: 'This drives the "Pending Tenders" count on the CRM Dashboard, which counts every tender not yet closed or cancelled.',
    },
    {
      target: 'tnd-details',
      title: 'Tender Details',
      required: false,
      purpose: 'What the tender is for — scope of supply, items and quantities, eligibility, anything the team should know. Can be filled in later.',
    },
    {
      target: 'tnd-current-status-note',
      title: 'Current Status',
      purpose: 'A free-text running note on where things stand right now — separate from the fixed Status dropdown above. Can also be updated later from the tender\'s detail page.',
      required: false,
      why: 'Every change to this note is recorded on the Timeline, just like any other field edit.',
    },
    {
      target: 'tnd-publish-date',
      title: 'Publish Date',
      required: false,
      purpose: 'When the tender was first published/floated by the authority. Required once the status is Tender Published or later; not needed while Waiting for Future Tender.',
    },
    {
      target: 'tnd-doc-download-date',
      title: 'Document Download Date',
      required: false,
    },
    {
      target: 'tnd-submission-date',
      title: 'Submission Date',
      required: false,
      purpose: 'The day we plan to (or did) submit our bid. Optional — fill it in when known.',
    },
    {
      target: 'tnd-closing',
      title: 'Tender Closing Date & Time',
      required: false,
      purpose: 'The closing date and time printed on the tender — bids are not accepted after it. Time starts at 12:00 AM; change it to the time on the tender. Required once the status is Tender Published or later.',
      why: 'When no Submission Date is given, the closing date is used for the submission follow-up reminder.',
    },
    {
      target: 'tnd-date',
      title: 'Created Date',
      purpose: 'The day this tender was taken up. Starts as today; change it when you log a tender picked up earlier. Cannot be a future date.',
      required: true,
    },
    {
      target: 'tnd-priority',
      title: 'Priority',
      required: true,
      options: [
        { value: 'Standard', meaning: 'Normal requirement (default).' },
        { value: 'Urgent', meaning: 'Important requirement, quick action needed.' },
      ],
    },

    {
      target: 'tnd-org',
      title: 'Customer Organization',
      purpose: 'The tendering authority/customer organization this tender belongs to. Search and select an existing customer organization — new ones are created from the Customer Organizations page.',
      required: true,
      after: 'Selecting an customer organization loads its contacts below and auto-fills Railway Zone/Division if the org has them set.',
    },
    {
      target: 'tnd-contact',
      title: 'Contact Person',
      required: false,
      options: [
        { value: '(existing contact)', meaning: 'Any contact already saved under the selected customer organization.' },
        { value: '+ Add New Contact', meaning: 'Reveals a small form below to create a brand-new contact inline, without leaving this page.' },
      ],
      why: 'Unlike the Inquiry form, this field is optional here — leaving it on "+ Add New Contact" with no name typed still saves the tender, it just won\'t have a linked contact.',
    },
    {
      target: 'tnd-save',
      title: 'Create',
      purpose: 'Validates the required fields (Customer Organization, Tender Number, Tender Name, Submission Date, Tender Date, Priority) and saves the tender.',
      after: 'On success you land on the tender\'s own detail page.',
    },
  ],
}

export default config
