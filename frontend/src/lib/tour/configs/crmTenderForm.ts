import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'crm-tender-form',
  pageTitle: 'Create / Edit Tender',
  steps: [
    {
      target: 'tnd-number',
      title: 'Tender Number',
      required: true,
      purpose: 'The tendering authority\'s own reference number for this tender (not the same as the Internal Tender ID shown above, which this app generates itself).',
    },
    {
      target: 'tnd-name',
      title: 'Tender Name',
      required: true,
      whatToEnter: 'A short descriptive title for the tender.',
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
      target: 'tnd-category',
      title: 'Category',
      required: false,
      purpose: 'Free-text category/classification for this tender.',
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
        { value: 'Requirement Received', meaning: 'Just identified — the default for a new tender.' },
        { value: 'Tender Published', meaning: 'The authority has floated the tender.' },
        { value: 'Tender Participation', meaning: 'Decision made to participate; preparation underway.' },
        { value: 'Tender Submitted', meaning: 'Your bid has been submitted.' },
        { value: 'Technical Evaluation', meaning: 'Under technical evaluation by the authority.' },
        { value: 'Commercial Evaluation', meaning: 'Under commercial/financial evaluation.' },
        { value: 'Negotiation', meaning: 'In price or terms negotiation.' },
        { value: 'LOA / Order Received', meaning: 'Letter of Award or order received.' },
        { value: 'Closed – Ordered', meaning: 'Tender awarded to your company.' },
        { value: 'Closed – Not Ordered', meaning: 'Awarded to someone else or otherwise lost.' },
        { value: 'Tender Cancelled', meaning: 'The tender itself was cancelled/withdrawn.' },
      ],
      why: 'This drives the "Pending Tenders" count on the CRM Dashboard, which counts every tender not yet closed or cancelled.',
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
      purpose: 'When the tender was first published/floated by the authority.',
    },
    {
      target: 'tnd-doc-download-date',
      title: 'Document Download Date',
      required: false,
    },
    {
      target: 'tnd-prebid-date',
      title: 'Pre-Bid Meeting Date',
      required: false,
    },
    {
      target: 'tnd-query-date',
      title: 'Query Submission Date',
      required: false,
      purpose: 'Deadline for submitting pre-bid clarification queries to the authority.',
    },
    {
      target: 'tnd-submission-date',
      title: 'Submission Date',
      required: true,
      purpose: 'The bid submission deadline — the one date this form actually requires, since everything else can be filled in later as the tender progresses.',
    },
    {
      target: 'tnd-tech-opening-date',
      title: 'Technical Opening Date',
      required: false,
      purpose: 'When technical bids are opened/evaluated.',
    },
    {
      target: 'tnd-fin-opening-date',
      title: 'Financial Opening Date',
      required: false,
      purpose: 'When financial/price bids are opened.',
    },
    {
      target: 'tnd-award-date',
      title: 'Expected Award Date',
      required: false,
    },
    {
      target: 'tnd-date',
      title: 'Tender Date',
      purpose: 'The day this tender was taken up. Starts as today; change it when you log a tender picked up earlier. Cannot be a future date.',
      required: true,
    },
    {
      target: 'tnd-priority',
      title: 'Priority',
      required: true,
      options: [
        { value: 'High', meaning: 'Important requirement, quick action needed.' },
        { value: 'Medium', meaning: 'Normal requirement (default).' },
        { value: 'Low', meaning: 'Can be handled later.' },
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
