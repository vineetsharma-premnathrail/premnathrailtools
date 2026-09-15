import { TourConfig } from '../types'

// Covers both lifecycle states of this page from one config, rather than a
// separate view/edit pair: whether each cell below is an editable input or a
// read-only value is driven entirely by the GRN's own `status` from the
// server (draft vs completed), not by anything the viewer toggles — so
// there's no view/edit ambiguity for the registry to resolve here the way
// the RFQ and Purchase Requisition detail pages need.
const config: TourConfig = {
  id: 'p2p-grn-detail',
  pageTitle: 'Goods Receipt Detail',
  steps: [
    {
      target: 'grn-detail-meta',
      title: 'Receipt Details',
      purpose: 'PO/PR numbers, vendor, received date, store location, and who received (and, once completed, inspected) this receipt.',
    },
    {
      target: 'grn-detail-inspection',
      title: 'Quality Inspection',
      purpose: 'One row per received line item. While this GRN is still pending inspection, the Accepted/Rejected/Quality Status/Rejection Reason columns are editable; once completed, they show the final recorded result.',
    },
    {
      target: 'grn-inspect-accepted',
      title: 'Accepted',
      purpose: 'How many of the received units passed inspection and are being taken into stock.',
      required: false,
    },
    {
      target: 'grn-inspect-rejected',
      title: 'Rejected',
      purpose: 'How many of the received units failed inspection and are being rejected back to the vendor.',
      required: false,
      why: 'Accepted + Rejected should together account for the received quantity.',
    },
    {
      target: 'grn-inspect-quality-status',
      title: 'Quality Status',
      purpose: 'The overall inspection outcome for this line item.',
      options: [
        { value: 'passed', meaning: 'Everything received for this item was accepted.' },
        { value: 'failed', meaning: 'Everything received for this item was rejected.' },
        { value: 'partial', meaning: 'Some units were accepted and some rejected.' },
      ],
    },
    {
      target: 'grn-inspect-rejection-reason',
      title: 'Rejection Reason',
      purpose: 'Why the rejected units failed inspection. Only editable when Quality Status isn\'t "Passed".',
      required: false,
    },
    {
      target: 'grn-detail-complete-btn',
      title: 'Complete Inspection',
      purpose: 'Saves the accepted/rejected quantities and quality status for every item, and marks this GRN as completed.',
      why: 'Once completed, the inspection result becomes read-only.',
    },
  ],
}

export default config
