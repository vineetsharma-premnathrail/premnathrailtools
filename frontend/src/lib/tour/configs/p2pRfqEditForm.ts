import { TourConfig } from '../types'

// A standalone tour for the RFQ's "Admin Edit" panel — kept separate from the
// RFQ Detail (view) tour so starting the tour on the read-only view never
// drags in edit-form field steps that aren't on screen yet, and vice versa.
// Same URL as the detail page (the panel opens inline via the `editing`
// state), so the registry picks between the two by probing for this form's
// own Save button.
const config: TourConfig = {
  id: 'p2p-rfq-edit-form',
  pageTitle: 'RFQ — Admin Edit',
  steps: [
    {
      target: 'rfq-edit-payment-terms',
      title: 'Payment Terms',
      purpose: 'Corrects the agreed payment terms with Vendor 1, even though this RFQ is otherwise locked.',
      required: false,
    },
    {
      target: 'rfq-edit-delivery-lead-time',
      title: 'Delivery Lead Time',
      purpose: 'Corrects the agreed delivery lead time.',
      required: false,
    },
    {
      target: 'rfq-edit-late-delivery-clause',
      title: 'Late Delivery Clause',
      purpose: 'Corrects the late delivery clause text.',
      required: false,
    },
    {
      target: 'rfq-edit-single-reason',
      title: 'Reason for Single Quotation',
      purpose: 'Only shown when this RFQ was raised with a single vendor quotation — corrects the justification recorded for it.',
      required: false,
    },
    {
      target: 'rfq-edit-comments',
      title: 'Comments',
      purpose: 'Corrects the supporting comments for the single-quotation justification.',
      required: false,
    },
    {
      target: 'rfq-edit-save',
      title: 'Save Changes',
      purpose: 'Saves the corrected commercial terms back onto this locked RFQ.',
      after: 'Closes the Admin Edit panel and returns to the read-only RFQ detail view.',
    },
  ],
}

export default config
