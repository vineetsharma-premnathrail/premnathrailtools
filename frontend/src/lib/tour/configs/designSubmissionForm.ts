import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'design-submission-form',
  pageTitle: 'New Customer Submission',
  steps: [
    {
      target: 'design-subnew-form',
      title: 'New submission form',
      purpose: 'Fill in the customer and pick the drawings on the left, links and cover note on the right.',
    },
    {
      target: 'design-subnew-back-btn',
      title: '← Back',
      purpose: 'Returns to Reviews & Approvals without saving.',
    },
    {
      target: 'design-subnew-customer',
      title: 'Customer',
      required: true,
      whatToEnter: 'Pick the customer from the list. If they are not in the list, choose "Not in the customer list" and type the name in the field that appears.',
      why: 'The list of drawings below narrows to those waiting on this customer.',
    },
    {
      target: 'design-subnew-customer-name',
      title: 'Customer name',
      required: true,
      whatToEnter: 'Only when the customer is not in the list.',
      validExample: 'RDSO, Lucknow',
    },
    {
      target: 'design-subnew-contact',
      title: 'Contact name',
      whatToEnter: 'The person at the customer who reviews drawings. Optional.',
    },
    {
      target: 'design-subnew-email',
      title: 'Contact email',
      whatToEnter: 'Their email address. Optional.',
      validExample: 'ce.design@rdso.gov.in',
      invalidExample: 'ce.design at rdso',
    },
    {
      target: 'design-subnew-project',
      title: 'Project',
      purpose: 'The project this submission belongs to. Optional.',
    },
    {
      target: 'design-subnew-machine',
      title: 'Machine',
      purpose: 'The machine it belongs to. Optional.',
    },
    {
      target: 'design-subnew-cover',
      title: 'Cover note',
      whatToEnter: 'The message printed on the transmittal.',
      validExample: 'Please review and return with your approval / comments within 15 days.',
    },
    {
      target: 'design-subnew-drawings',
      title: 'Drawings to send',
      purpose: 'Only revisions approved internally and marked "customer approval required" are listed. Click a "+ drawing" chip to add it, or x on a selected chip to remove it.',
    },
    {
      target: 'design-subnew-search',
      title: 'Search drawings',
      whatToEnter: 'Drawing number or title, then click the match to add it.',
    },
    {
      target: 'design-subnew-cancel-btn',
      title: 'Cancel',
      purpose: 'Leave without saving.',
    },
    {
      target: 'design-subnew-save-btn',
      title: 'Save Draft',
      after: 'The submission is saved as a Draft transmittal and its page opens. Send it to the customer from there once the drawing list is final.',
    },
  ],
}

export default config
