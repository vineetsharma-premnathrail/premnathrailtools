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
      target: 'item-part-code',
      title: 'Part Code',
      whatToEnter: 'Optional: the manufacturer\'s or drawing part number, if the item has one.',
      validExample: 'SKF 6205-2RS',
      why: 'Searching by the maker\'s part number is often faster than by name, and avoids creating the same item twice under different names.',
    },
    {
      target: 'item-preferred-vendor',
      title: 'Preferred vendor',
      purpose: 'The vendor we normally buy this item from, picked from the shared vendor master (Procurement → Vendors).',
      why: 'Purchase sees it first when raising a PR / RFQ. Linking the real vendor record (not typed text) lets the item page show that vendor\'s last PO rate and catalog price.',
    },
    {
      target: 'item-moq',
      title: 'Minimum order quantity',
      purpose: 'The smallest quantity the vendor sells, in the item\'s unit.',
      why: 'Planning rounds a shortage up to this quantity, so a PR is never raised for 3 when the vendor only sells boxes of 100.',
    },
    {
      target: 'item-hsn',
      title: 'HSN / SAC code',
      purpose: 'GST classification code from the vendor\'s invoice: HSN for goods (4, 6 or 8 digits), SAC for services (6 digits, starts with 99).',
      why: 'Every GST invoice and e-invoice line needs it; it also decides the GST rate.',
    },
    {
      target: 'item-gst',
      title: 'GST rate',
      purpose: 'The GST % for this item, from Finance\'s GST rate master.',
      why: 'Defaults the tax on PO and invoice lines so the buyer does not type it every time.',
    },
    {
      target: 'item-purchase-gl',
      title: 'Purchase ledger',
      purpose: 'The account a purchase of this item books to. Leave blank to use the category\'s ledger, then Finance\'s default Purchases ledger.',
      options: [
        { value: 'Blank (recommended)', meaning: 'Uses the category ledger — e.g. all Raw Material books to "Purchase – Raw Material".' },
        { value: 'Expense ledger', meaning: 'Override for this one item only.' },
        { value: 'Asset ledger', meaning: 'For capital items (machinery, equipment) that become fixed assets.' },
      ],
      why: 'This is how Finance sees the P&L split by type of purchase instead of one big "Purchases" figure.',
    },
    {
      target: 'item-standard-cost',
      title: 'Standard cost',
      purpose: 'A planned rate per unit, used for BOM and job estimates.',
      why: 'Stock itself is valued at the system weighted average (updated by every priced GRN), not at this number.',
    },
    {
      target: 'item-reorder-level',
      title: 'Reorder level',
      purpose: 'When free stock falls to this quantity, it is time to raise a PR.',
      why: 'Must sit above safety stock and below maximum stock — the form refuses levels that contradict each other.',
    },
    {
      target: 'item-inspection',
      title: 'Inspection on receipt',
      purpose: 'Tick when every incoming lot of this item must be checked by Quality.',
      why: 'When ticked, GRN quantity goes to Quality stock with an inspection lot; it becomes usable (Free stock) only after Quality accepts it.',
    },
    {
      target: 'item-mtc',
      title: 'Test certificate (MTC) required',
      purpose: 'Tick when the supplier must send a mill test certificate with each lot (steel, castings, critical parts). Needs Inspection on receipt.',
      why: 'Quality cannot accept the lot until the certificate is marked received — this prevents using uncertified material.',
    },
    {
      target: 'item-photo',
      title: 'Photo',
      purpose: 'Optional picture of the item, so store staff can recognise it on the rack.',
      whatToEnter: 'Pick or drag an image file (JPG/PNG).',
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
