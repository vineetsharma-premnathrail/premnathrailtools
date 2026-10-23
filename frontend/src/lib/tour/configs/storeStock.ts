import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-stock',
  pageTitle: 'Stock',
  steps: [
    {
      target: 'stock-plant-scope',
      title: 'Your plant',
      purpose: 'Shown when Plant Access is switched on: you only see the stock of your own plant(s). If it says no plant is set, ask an admin to set it in Store → Settings → Plant Access.',
    },
    {
      target: 'stock-export-btn',
      title: 'Export',
      purpose: 'Downloads the current balances as an Excel file — handy as a physical stock-count sheet.',
    },
    {
      target: 'stock-import-btn',
      title: 'Opening Stock Import (admin only)',
      purpose: 'Loads the stock already on the shelves when the ERP starts, or when a new store opens — the only way to put stock in without a document.',
      whatToEnter: 'Download the template, fill item code, store, quantity, rate (book value), the count-sheet reference and a remark per row, then upload.',
      after: 'Every valid row is posted as opening stock; if any row has a problem nothing is posted and each problem is listed with the reason.',
      why: 'It is used once, at go-live. After that, stock only moves through GRN, Issues, Returns, Transfers, Adjustments and Physical Count — there is no "add / remove stock by hand" screen.',
    },
    {
      target: 'stock-filters',
      title: 'Filters',
      purpose: 'Search by item code, name or store, and narrow by Store, Category and Subcategory. "Clear" appears once any filter is set.',
    },
    {
      target: 'stock-balances-table',
      title: 'Current Balances',
      purpose: 'One row per item per store.',
      options: [
        { value: 'On Hand (Free)', meaning: 'Usable quantity physically in the store.' },
        { value: 'Reserved', meaning: 'Part of On Hand earmarked for a project or order (see Reservations) — cannot be issued to anyone else.' },
        { value: 'Available', meaning: 'On Hand minus Reserved — what you can actually issue now.' },
        { value: 'Quality', meaning: 'Received but waiting for a Quality inspection decision — cannot be issued yet.' },
        { value: 'Blocked', meaning: 'Quarantine: damaged/rejected returned material held apart. Use "Clear" to record it as Scrap, Returned to vendor, or Released to usable stock after re-inspection.' },
      ],
      why: 'Keeping Quality and Blocked stock separate stops untested or damaged material from being issued to production.',
    },
  ],
}

export default config
