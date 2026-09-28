import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-item-form',
  pageTitle: 'Add Item',
  steps: [
    {
      target: 'item-back-btn',
      title: '← Back',
      purpose: 'Returns to the Item Master list without saving.',
    },
    {
      target: 'item-code',
      title: 'Item Code',
      required: true,
      whatToEnter: 'A unique short code for this item.',
      validExample: 'RM-0001',
      why: 'Used to identify this item everywhere else in Store & Inventory (issues, transfers, stock ledger). Cannot be changed after creation.',
    },
    {
      target: 'item-name',
      title: 'Item Name',
      required: true,
      whatToEnter: 'The full descriptive name of the item.',
      validExample: 'Mild Steel Rod 12mm',
    },
    {
      target: 'item-uom',
      title: 'UOM',
      purpose: 'Unit of Measure this item is stocked and issued in.',
      whatToEnter: 'A short unit code.',
      validExample: 'KG, NOS, MTR',
    },
    {
      target: 'item-type',
      title: 'Item Type',
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
      target: 'item-category',
      title: 'Category',
      purpose: 'Groups this item for filtering and reporting. Pulled from the Categories tab — add one there first if the one you need doesn\'t exist yet.',
    },
    {
      target: 'item-subcategory',
      title: 'Subcategory',
      purpose: 'Only enabled once a Category with subcategories is selected above.',
    },
    {
      target: 'item-description',
      title: 'Description',
      purpose: 'Free-text notes about the item — specification, usage, anything worth recording.',
    },
    {
      target: 'item-hsn',
      title: 'HSN / SAC Code',
      purpose: 'The tax classification code for this item, if applicable.',
    },
    {
      target: 'item-manufacturer',
      title: 'Manufacturer',
      purpose: 'Who makes this item, for sourcing reference.',
    },
    {
      target: 'item-tracking-flags',
      title: 'Serial / Batch / Expiry Control',
      purpose: 'Marks how individual units of this item should be traced.',
      options: [
        { value: 'Batch Controlled', meaning: 'One lot number per receipt — the batch, not the individual unit, is tracked.' },
        { value: 'Serial Controlled', meaning: 'Every unit gets its own serial number, tracked individually.' },
        { value: 'Expiry Controlled', meaning: 'This item has a shelf life that matters for stock rotation.' },
      ],
      after: 'These are informational flags right now — batch numbers can be entered on receipts/issues/transfers regardless of this setting.',
    },
    {
      target: 'item-min-stock',
      title: 'Minimum Stock',
      purpose: 'The lowest quantity this item should ever fall to — a planning reference, not an enforced limit.',
    },
    {
      target: 'item-max-stock',
      title: 'Maximum Stock',
      purpose: 'The highest quantity this item should be stocked up to.',
    },
    {
      target: 'item-reorder-level',
      title: 'Reorder Level',
      purpose: 'The quantity at which a fresh purchase/replenishment should be triggered.',
    },
    {
      target: 'item-standard-cost',
      title: 'Standard Cost',
      purpose: 'The reference unit cost used for valuation.',
    },
    {
      target: 'item-save-btn',
      title: 'Save Item',
      purpose: 'Creates the item. Item Code and Item Name are required — everything else can be filled in later from the item\'s detail page.',
      after: 'Takes you to the new item\'s detail page.',
    },
    {
      target: 'item-cancel-btn',
      title: 'Cancel',
      purpose: 'Discards this form and returns to the Item Master list.',
    },
  ],
}

export default config
