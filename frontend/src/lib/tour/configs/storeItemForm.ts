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
      target: 'item-type',
      title: 'Item Type',
      options: [
        { value: 'Material', meaning: 'Raw, production, electrical, hydraulic, mechanical, hardware, paint and packaging material.' },
        { value: 'Service', meaning: 'Job work, maintenance, professional services and consultancy.' },
        { value: 'Asset', meaning: 'Machinery, equipment, vehicles, IT assets and furniture.' },
        { value: 'Consumable', meaning: 'Office, cleaning, PPE, workshop and production consumables.' },
        { value: 'Tool & Equipment', meaning: 'Hand/power tools, measuring instruments, testing equipment and engineering tools.' },
      ],
    },
    {
      target: 'item-category',
      title: 'Category',
      purpose: 'Groups this item for filtering and reporting. Only categories for the picked Item Type are listed. New categories are added under Store → Settings → Categories.',
    },
    {
      target: 'item-subcategory',
      title: 'Subcategory',
      purpose: 'Pick a Category first, then one of its subcategories. Subcategories are added under Store → Settings → Categories.',
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
      target: 'item-description',
      title: 'Technical Specification',
      purpose: 'Free-text notes about the item — specification, usage, anything worth recording.',
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
