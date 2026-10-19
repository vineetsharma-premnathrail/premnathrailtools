import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-po-tracking',
  pageTitle: 'P.O Tracking',
  steps: [
    {
      target: 'p2p-nav-truck',
      title: 'P.O Tracking',
      purpose: 'Follow up every Purchase Order (PO) until the material is delivered. Purchase team only.',
      why: 'A PO is a promise from the vendor to deliver by a date. Chasing late deliveries before they stop production is one of the main jobs of a buyer.',
    },
    {
      target: 'p2p-pot-status-filter',
      title: 'Status filter',
      purpose: 'Show only POs in one status.',
      required: false,
      options: [
        { value: 'All Statuses', meaning: 'Every PO.' },
        { value: 'Draft', meaning: 'Created but not yet sent to the vendor.' },
        { value: 'Issued', meaning: 'Sent to the vendor — waiting for them to confirm.' },
        { value: 'Acknowledged', meaning: 'The vendor has confirmed the order and delivery date.' },
        { value: 'Partially Fulfilled', meaning: 'Part of the quantity has been delivered; the balance is still due.' },
        { value: 'Fulfilled', meaning: 'Everything has been delivered.' },
        { value: 'Cancelled', meaning: 'The order was cancelled — nothing more will come.' },
      ],
    },
    {
      target: 'p2p-pot-overdue-filter',
      title: 'Overdue only',
      purpose: 'Tick to see only open POs (Issued, Acknowledged, Partially Fulfilled) whose Expected Delivery date has already passed.',
      why: 'This is your daily follow-up list — call these vendors first.',
    },
    {
      target: 'p2p-pot-table',
      title: 'PO list',
      purpose: 'PO Number, the PR it was raised against ("Ad-hoc" if none), Vendor, PO Date, Expected Delivery, the Buyer handling it, Status and days overdue.',
      after: 'Click a row that has a PR to open that Purchase Requisition\'s detail page, where its PO and receipts are shown.',
    },
    {
      target: 'p2p-pot-status-badge',
      title: 'Status badge',
      purpose: 'Colour-coded PO status — grey Draft, blue Issued, purple Acknowledged, amber Partially Fulfilled, green Fulfilled, red Cancelled.',
    },
    {
      target: 'p2p-pot-overdue-badge',
      title: 'Days overdue',
      purpose: 'How many days past the Expected Delivery date an open PO is. Fulfilled, cancelled and draft POs are never counted as overdue.',
    },
  ],
}

export default config
