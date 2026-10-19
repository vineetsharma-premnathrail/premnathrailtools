import { TourConfig } from '../types'

const config: TourConfig = {
  id: 'store-item-detail',
  pageTitle: 'Item Detail',
  steps: [
    {
      target: 'item-detail-back-btn',
      title: '← Back',
      purpose: 'Returns to the Item Master list.',
    },
    {
      target: 'item-detail-edit-btn',
      title: 'Edit',
      purpose: 'Switches every field on this page into an editable form — Item Code stays fixed, everything else can be changed.',
      after: 'The same page turns into an edit form, with its own guided tour (open the tour again once you are in edit mode).',
    },
    {
      target: 'item-detail-delete-btn',
      title: 'Delete',
      purpose: 'Permanently removes this item from the Item Master.',
      why: 'There is no undo — a confirmation dialog asks before it actually deletes. An item that already has stock or transactions cannot be deleted; set its Status to Inactive or Discontinued instead.',
    },
    {
      target: 'item-detail-photo',
      title: 'Photo',
      purpose: 'A picture of the item so store staff can recognise it on the rack. You can upload, replace or remove the photo right here — no need to go into Edit.',
      whatToEnter: 'Pick an image file (JPG/PNG).',
    },
    {
      target: 'item-detail-info',
      title: 'Item Details',
      purpose: 'The master data for this item: code, type, category, name, unit of measure, part code, status and technical specification.',
      options: [
        { value: 'Active', meaning: 'Normal — the item can be received, issued, transferred and reserved.' },
        { value: 'Inactive', meaning: 'Temporarily not in use. Kept for history; hidden from most pickers.' },
        { value: 'Discontinued', meaning: 'No longer bought or used. Kept only so old documents still show it.' },
      ],
      why: 'Every stock transaction (GRN, issue, transfer, adjustment) points to this one record, so the same item must never be created twice under different names.',
    },
    {
      target: 'item-detail-purchasing',
      title: 'Purchasing',
      purpose: 'Preferred vendor, minimum order quantity, make and manufacturer part number.',
    },
    {
      target: 'item-detail-accounts',
      title: 'Tax & Accounts',
      purpose: 'HSN / SAC, GST rate, and the purchase and sales ledgers this item books to. The text in brackets says where the ledger comes from — the item itself, its category, or Finance\'s default.',
    },
    {
      target: 'item-detail-vendors',
      title: 'Vendors for this item',
      purpose: 'Everyone who can supply this item: the preferred vendor, vendors we have bought it from (last PO rate and date) and vendors whose catalog lists it.',
      why: 'Use it to pick a vendor and check a quoted price against what we paid last time.',
    },
    {
      target: 'item-detail-quality',
      title: 'Quality settings',
      purpose: 'Shows whether incoming stock of this item is checked by Quality before it can be used.',
      why: 'Inspection on receipt sends GRN quantity into "Quality" stock with an inspection lot instead of straight to Free stock — so nothing un-checked reaches the shop floor. "Test certificate required" means a lot cannot be accepted until the supplier\'s MTC (mill test certificate) is marked received.',
    },
  ],
}

export default config
