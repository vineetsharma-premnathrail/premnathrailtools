import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'crm-tender-form',
  pageTitle: 'Create / Edit Tender',
  steps: [
    {
      target: 'tnd-lead-source',
      title: 'Lead Source',
      purpose: 'Where this tender opportunity was found.',
      required: true,
      options: [
        { value: 'Email / Direct', meaning: 'Customer emailed or contacted you directly.' },
        { value: 'Reference', meaning: 'Came through a referral/existing contact.' },
        { value: 'Tender Portal', meaning: 'Found via a government/public tender listing — the common case for tenders.' },
        { value: 'Cold Call', meaning: 'Outbound call initiated by your team.' },
        { value: 'Exhibition', meaning: 'Met at a trade show/exhibition.' },
        { value: 'Website', meaning: 'Came through the company website.' },
      ],
    },
    {
      target: 'tnd-priority',
      title: 'Priority',
      required: true,
      options: [
        { value: 'Low', meaning: 'No urgency.' },
        { value: 'Medium', meaning: 'Default priority for most tenders.' },
        { value: 'High', meaning: 'Needs faster turnaround.' },
        { value: 'Urgent', meaning: 'Time-critical, e.g. a near submission deadline.' },
      ],
    },
    {
      target: 'tnd-bd-owner',
      title: 'BD Owner',
      required: false,
      purpose: 'The business-development person responsible — auto-filled with your own name and locked.',
    },
    {
      target: 'tnd-org',
      title: 'Organization',
      purpose: 'The tendering authority/organization this tender belongs to. Search and select an existing organization — new ones are created from the Organizations page.',
      required: true,
      after: 'Selecting an organization loads its contacts below and auto-fills Railway Zone/Division if the org has them set.',
    },
    {
      target: 'tnd-contact',
      title: 'Contact Person',
      required: false,
      options: [
        { value: '(existing contact)', meaning: 'Any contact already saved under the selected organization.' },
        { value: '+ Add New Contact', meaning: 'Reveals a small form below to create a brand-new contact inline, without leaving this page.' },
      ],
      why: 'Unlike the Inquiry form, this field is optional here — leaving it on "+ Add New Contact" with no name typed still saves the tender, it just won\'t have a linked contact.',
    },
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
      purpose: 'The specific department/body issuing the tender, if different from the Organization itself.',
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
        { value: 'Active', meaning: 'Currently being pursued — the default for a new tender.' },
        { value: 'Submitted', meaning: 'Your bid has been submitted.' },
        { value: 'Won', meaning: 'Tender awarded to your company.' },
        { value: 'Lost', meaning: 'Awarded to someone else.' },
        { value: 'Cancelled', meaning: 'The tender itself was cancelled/withdrawn.' },
      ],
      why: 'This drives the "Pending Tenders" count on the CRM Dashboard, which only counts tenders still Active.',
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
      target: 'tnd-save',
      title: 'Create',
      purpose: 'Validates the required fields (Organization, Tender Number, Tender Name, Submission Date, Lead Source, Priority) and saves the tender.',
      after: 'On success you land on the tender\'s own detail page.',
    },
  ],
}

export default config
