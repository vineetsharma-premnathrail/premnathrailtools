import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-items-list',
  pageTitle: 'Item Master',
  steps: [
    {
      target: 'store-nav-box',
      title: 'Items',
      purpose: 'The Item Master — every raw material, consumable, spare part, or finished good the company tracks in stock.',
    },
    {
      target: 'store-nav-chart',
      title: 'Stock',
      purpose: 'Current on-hand/reserved/available balances per item and store, plus the full movement history.',
    },
    {
      target: 'store-nav-send',
      title: 'Issues',
      purpose: 'Material issued out of a store to a department or project.',
    },
    {
      target: 'store-nav-lock',
      title: 'Reservations',
      purpose: 'Stock earmarked for a project or production order, blocking it from other allocation.',
    },
    {
      target: 'store-nav-settings',
      title: 'Settings',
      purpose: 'Store master data — Item Types, Units of Measure, Categories and Stores. Set these up once; every item and transaction picks from them.',
    },
    {
      target: 'items-add-btn',
      title: '+ Add Item',
      purpose: 'Opens the Add Item form to create a new Item Master record.',
      after: 'Takes you to a separate Create Item page — its own guided tour covers every field there.',
    },
    {
      target: 'items-search',
      title: 'Search',
      purpose: 'Searches by item code or item name.',
      whatToEnter: 'Any part of the code or name — the list updates automatically as you type.',
    },
    {
      target: 'items-type-filter',
      title: 'Item Type filter',
      purpose: 'Narrows the list to one item type.',
      options: [
        { value: 'Raw Material', meaning: 'Input material consumed in manufacturing.' },
        { value: 'Consumable', meaning: 'Used up during operations, not tracked as a finished asset.' },
        { value: 'Spare Part', meaning: 'Maintenance/replacement part for equipment.' },
        { value: 'Finished Good', meaning: 'Completed product ready for dispatch/sale.' },
        { value: 'Semi-Finished', meaning: 'Partially completed, still in production.' },
        { value: 'Asset', meaning: 'Equipment/tooling tracked as a stock item.' },
        { value: 'Other', meaning: 'Anything not covered above.' },
      ],
    },
    {
      target: 'items-table',
      title: 'Item rows',
      purpose: 'Click anywhere on a row to open that item\'s full detail page. If it says "No items yet", add the first item to the master.',
      after: 'Opens the item\'s detail page, where you can view every field and Edit or Delete it.',
    },
  ],
}

export default config
