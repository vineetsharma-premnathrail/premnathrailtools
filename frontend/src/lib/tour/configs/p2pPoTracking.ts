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
      target: 'p2p-pot-stats',
      title: 'Counters',
      purpose: 'Small counters under the title: purchase orders, how many are overdue, how many are due within the next week, and how many are with the vendor. Open value (right of them) is what vendors still owe you: released POs, balance only. They follow the search and filters.',
    },
    {
      target: 'p2p-pot-search',
      title: 'Search',
      purpose: 'Type a PO number, vendor, item or requisition; the list narrows as you type.',
    },
    {
      target: 'p2p-pot-filter-btn',
      title: 'Filters',
      purpose: 'Opens the Filters popup. Choose, then press Apply Filters; the button shows how many filters are on and a Clear button appears next to it.',
      options: [
        { value: 'Stage', meaning: 'Draft, In approval, With vendor, Partly received, Received, Short-closed, Closed or Cancelled. In approval is not an order until the final approval is given, so it is never counted as overdue.' },
        { value: 'Delivery', meaning: 'Overdue = released POs whose expected delivery date has passed with goods still to come (your daily follow-up list); Due in 7 days = due today or within the next week.' },
        { value: 'Vendor / Buyer', meaning: 'Only the purchase orders of one vendor or one buyer.' },
        { value: 'Order project', meaning: 'Only the purchase orders charged to one order project.' },
        { value: 'PO date from / to', meaning: 'A range of PO dates.' },
        { value: 'Sort by', meaning: 'PO number (default, A to Z), most urgent first, delivery date, PO date, vendor, stage, value or delivered %.' },
      ],
    },
    {
      target: 'p2p-pot-table',
      title: 'PO list',
      purpose: 'One row per purchase order — a requisition split across vendors shows each PO on its own row with its own vendor, stage, delivery date, delivered % and value. Long vendor and buyer names are cut with "..." (hover for the full text). Click a column heading to sort; the default order is PO number A to Z.',
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
      purpose: 'Red "late by 5 days" = days past the PO\'s expected delivery; amber = due today or within a week; grey = later. Only released POs with a balance get one — everything else shows a dash.',
    },
  ],
}

export default config
