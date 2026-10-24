import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'p2p-po-tracking',
  pageTitle: 'P.O Tracking',
  steps: [
    {
      target: 'p2p-nav-truck',
      title: 'P.O Tracking',
      purpose: 'Follow every Purchase Order (PO) from draft to closed — which are with the vendor, what is due this week, what is late, what is partly received, what is waiting for approval. Purchase team only.',
      why: 'A released PO is the vendor\'s promise to deliver by a date. Chasing late deliveries before they stop production is one of the main jobs of a buyer.',
    },
    {
      target: 'p2p-pot-status-filter',
      title: 'Status strip',
      purpose: 'Every chip shows how many POs are in that status and is also the filter — click one to show only those POs, click it again to clear.',
      options: [
        { value: 'Overdue', meaning: 'Released POs whose expected delivery date has passed with goods still to come — your daily follow-up list.' },
        { value: 'Due in 7 days', meaning: 'Released POs with goods still to come, due today or within the next week.' },
        { value: 'Draft', meaning: 'Being prepared — not sent for approval yet.' },
        { value: 'In approval', meaning: 'Sent for approval. It is not an order until the final approval is given, so it is never counted as overdue.' },
        { value: 'With vendor', meaning: 'Approved and released — waiting for the vendor to deliver.' },
        { value: 'Partly received', meaning: 'Part of the quantity has been delivered; the balance is still due.' },
        { value: 'Received', meaning: 'Everything delivered; the requisition is not closed yet.' },
        { value: 'Short-closed', meaning: 'Closed with a balance the vendor will not supply — the balance is written off and no longer counted as open or overdue.' },
        { value: 'Closed', meaning: 'Everything delivered and the requisition closed.' },
        { value: 'Cancelled', meaning: 'Cancelled or rejected — nothing will come.' },
      ],
      after: 'Open value (right) is what vendors still owe you: released POs, balance only.',
    },
    {
      target: 'p2p-pot-overdue-filter',
      title: 'Overdue',
      purpose: 'Shows only released POs whose expected delivery date has already passed and which still have a balance to receive.',
      why: 'Call these vendors first. The daily reminder chases exactly this list — nothing that is still in approval, short-closed, closed or cancelled.',
    },
    {
      target: 'p2p-pot-table',
      title: 'PO list',
      purpose: 'One row per purchase order — a requisition split across vendors shows each PO on its own row with its own vendor, stage, delivery date, delivered % and value. Search by PO number, vendor, item or requisition; filter by vendor, buyer, PO date and order project; click a column heading or use "Sort by" ("Most urgent first" puts the latest deliveries on top). The default order is PO number A to Z.',
      after: 'Click a row to open its side detail: Items (ordered, delivered, open), Receipts (goods receipts), Approval, Documents (the Word PO) and Timeline. "Open requisition & this PO" opens the requisition page on exactly that PO.',
    },
    {
      target: 'p2p-pot-status-badge',
      title: 'Stage badge',
      purpose: 'The true stage of the PO — hover for what it means. A PO that is only sent for approval shows "In approval", not as an order with the vendor.',
    },
    {
      target: 'p2p-pot-overdue-badge',
      title: 'Days to delivery',
      purpose: 'Red "5d late" = days past the PO\'s expected delivery; amber = due today or within a week; grey = later. Only released POs with a balance get one — everything else shows a dash.',
    },
  ],
}

export default config
