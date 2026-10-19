import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-items-list',
  pageTitle: 'Item Master',
  steps: [
    {
      target: 'store-nav-box',
      title: 'Inventory',
      purpose: 'The Item Master and the stock picture. The pills underneath switch between Item Master, Stock, Movements, Adjustments, Reorder and Physical Count.',
    },
    {
      target: 'store-sub-items',
      title: 'Item Master',
      purpose: 'Every raw material, consumable, spare part, or finished good the company tracks in stock.',
    },
    {
      target: 'store-sub-stock',
      title: 'Stock',
      purpose: 'Current on-hand/reserved/available balances per item and store.',
    },
    {
      target: 'store-sub-movements',
      title: 'Movements',
      purpose: 'The stock ledger — every receipt, issue, return, transfer and adjustment that changed a balance, newest first.',
      why: 'If a stock figure looks wrong, this is where you trace exactly which document moved it, when, and by whom.',
    },
    {
      target: 'store-sub-adjustments',
      title: 'Adjustments',
      purpose: 'Corrections to book stock after a physical count (damage, loss, count difference). Each one goes for approval before it changes stock.',
    },
    {
      target: 'store-nav-inward',
      title: 'Inward',
      purpose: 'Everything coming into a store: GRN & Inspection (material from suppliers against a Purchase Order) and Returns (unused material sent back by departments).',
      why: 'Stock only increases once an inward document is posted, so the books always match what physically reached the store.',
    },
    {
      target: 'store-nav-outward',
      title: 'Outward',
      purpose: 'Everything leaving a store: Issues (material given to a department or project), Transfers (moved to another store) and Reservations (stock earmarked for a project or production order).',
    },
    {
      target: 'store-nav-pm-work',
      title: 'Project Work',
      purpose: 'Project WBS elements given to the Store department and project tasks assigned to you.',
    },
    {
      target: 'store-nav-settings',
      title: 'Settings',
      purpose: 'Store master data — Item Types, Units of Measure, Categories, Stores, Issue Types, Issue Rules and Plant Access. Set these up once; every item and transaction picks from them.',
    },
    {
      target: 'items-export-btn',
      title: 'Export',
      purpose: 'Downloads the Item Master (with the filters you have applied) as an Excel file — useful for review, physical count sheets or sharing with Purchase.',
    },
    {
      target: 'items-import-btn',
      title: 'Import',
      purpose: 'Bulk-creates items from an Excel sheet instead of typing them one by one.',
      whatToEnter: 'Download the template from the dialog, fill one item per row (name, type, unit, category…), then upload it.',
      after: 'Rows are checked first; any row with a problem is listed with the exact reason so you can fix the sheet and re-upload.',
      why: 'Fastest way to load the existing item list when starting on the ERP.',
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
      purpose: 'Narrows the list to one item type. The types come from Store → Settings → Item Types.',
      options: [
        { value: 'Material', meaning: 'Raw, production, electrical, hydraulic, mechanical, hardware, paint and packaging material.' },
        { value: 'Consumable', meaning: 'Used up during operations — office, cleaning, PPE, workshop consumables.' },
        { value: 'Tool & Equipment', meaning: 'Hand/power tools, measuring instruments, testing equipment.' },
        { value: 'Asset', meaning: 'Machinery, equipment, vehicles, IT assets and furniture.' },
        { value: 'Service', meaning: 'Job work, maintenance and professional services (no physical stock).' },
      ],
    },
    {
      target: 'items-category-filter',
      title: 'Category filter',
      purpose: 'Appears once an Item Type is picked and lists only that type\'s categories. Changing it resets the Subcategory filter.',
    },
    {
      target: 'items-subcategory-filter',
      title: 'Subcategory filter',
      purpose: 'Appears only when the chosen category has subcategories, and narrows further inside it.',
      after: 'A "Clear filters" link appears once any filter or search is set — it resets them all.',
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
