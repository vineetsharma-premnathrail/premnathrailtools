import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-item-edit-form',
  pageTitle: 'Edit Item',
  steps: [
    {
      target: 'item-edit-back-btn',
      title: '← Back',
      purpose: 'Leaves edit mode and goes back to the item without saving — same as Cancel.',
    },
    {
      target: 'item-edit-code',
      title: 'Item Code',
      purpose: 'Shown for reference only — the code is fixed once the item is created.',
      why: 'Every GRN, issue, transfer and stock ledger line refers to this code, so changing it would break the history.',
    },
    {
      target: 'item-edit-type',
      title: 'Item Type',
      purpose: 'The broad class of the item (Material, Consumable, Tool, Asset, Service…). Types are maintained under Store → Settings → Item Types.',
      after: 'Changing the type clears Category and Subcategory, because categories belong to one item type.',
    },
    {
      target: 'item-edit-category',
      title: 'Category',
      purpose: 'Groups the item for filtering and reports. Only categories of the selected Item Type are listed.',
    },
    {
      target: 'item-edit-subcategory',
      title: 'Subcategory',
      purpose: 'A finer group inside the chosen Category. Pick the Category first.',
    },
    {
      target: 'item-edit-name',
      title: 'Item Name',
      required: true,
      whatToEnter: 'The full descriptive name of the item, including size/grade where it matters.',
      validExample: 'Mild Steel Rod 12mm IS 2062',
      invalidExample: 'Rod (too vague — store staff cannot tell which rod)',
    },
    {
      target: 'item-edit-uom',
      title: 'UOM',
      required: true,
      purpose: 'Unit of Measure the item is stocked and issued in. Units are maintained under Store → Settings → Units of Measure.',
      validExample: 'KG, NOS, MTR',
      why: 'Change it only if no stock exists yet — quantities already on hand were counted in the old unit.',
    },
    {
      target: 'item-edit-part-code',
      title: 'Part Code',
      whatToEnter: 'Optional: the manufacturer\'s or drawing part number.',
      validExample: 'SKF 6205-2RS',
    },
    {
      target: 'item-edit-status',
      title: 'Status',
      options: [
        { value: 'Active', meaning: 'Normal — can be received, issued, transferred and reserved.' },
        { value: 'Inactive', meaning: 'Temporarily not in use; kept for history.' },
        { value: 'Discontinued', meaning: 'No longer bought or used; kept so old documents still show it.' },
      ],
      why: 'Use Inactive/Discontinued instead of deleting an item that already has transactions.',
    },
    {
      target: 'item-edit-description',
      title: 'Technical Specification',
      purpose: 'Free-text specification: grade, standard, dimensions, make — whatever purchase and quality need to buy and check the right thing.',
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
      target: 'item-edit-save-btn',
      title: 'Save Changes',
      purpose: 'Saves every field on this form. Item Name is required — everything else is optional.',
      after: 'Returns to the item\'s read-only detail view with the updated values. If something is wrong, a dialog explains what to fix.',
    },
    {
      target: 'item-edit-cancel-btn',
      title: 'Cancel',
      purpose: 'Discards any changes made on this form and returns to the read-only detail view.',
    },
  ],
}

export default config
